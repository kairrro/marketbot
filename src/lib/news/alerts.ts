// The live alert check: fetch fresh headlines, drop what was seen or repeats a
// story, keep only what could be big for a tracked asset, let the AI rate it, and
// let through only what is rated high enough, a few per hour at most. Fewer,
// better alerts beat lots of alerts. Dependencies are passed in, like in brief.ts.

import { rateHeadlines, type Ask } from './ai';
import { isDuplicate, pickCandidates, type RawHeadline } from './noise';
import { HOUR, MINUTE } from './time';
import { IMPACT_RANK, type HeadlineItem, type NewsSettings, type TrackedAsset } from './types';

export interface AlertDeps {
  assets: readonly TrackedAsset[];
  settings: NewsSettings;
  now: number;
  ask: Ask;
  headlines(sinceMs: number): Promise<{ items: RawHeadline[]; failed: string[] }>;
  /** Which of these ids have been looked at before. */
  seen(ids: string[]): Set<string>;
  markSeen(items: { key: string; title: string }[]): void;
  /** Titles looked at in the last few hours, to catch the same story from another outlet. */
  recentTitles(sinceMs: number): string[];
  /** How many alerts went out in the last hour. */
  alertsInLastHour(): number;
}

export interface PollResult {
  fetched: number;
  fresh: number;
  candidates: number;
  alerts: HeadlineItem[];
  /** Cut by the hourly limit, not by rating. */
  heldBack: number;
  failed: string[];
}

export async function pollForAlerts(deps: AlertDeps): Promise<PollResult> {
  const { settings, now } = deps;
  const since = now - settings.freshMinutes * MINUTE;
  const { items, failed } = await deps.headlines(since);

  const recent = items.filter((h) => h.publishedAt >= since && h.publishedAt <= now + 5 * MINUTE);
  const seen = deps.seen(recent.map((h) => h.id));
  const titles = deps.recentTitles(now - 6 * HOUR);

  // New to us, and not the same story as one already handled (or as another one in this batch).
  const fresh: RawHeadline[] = [];
  const batch: string[] = [];
  for (const h of [...recent].sort((a, b) => a.publishedAt - b.publishedAt)) {
    if (seen.has(h.id)) continue;
    if (isDuplicate(h.title, titles) || isDuplicate(h.title, batch)) {
      deps.markSeen([{ key: h.id, title: h.title }]);
      continue;
    }
    fresh.push(h);
    batch.push(h.title);
  }

  const candidates = pickCandidates(fresh, deps.assets, 5);
  const keep = new Set(candidates.map((c) => c.id));
  // Everything that is not worth a rating is done with now. Candidates wait until they are rated.
  deps.markSeen(fresh.filter((h) => !keep.has(h.id)).map((h) => ({ key: h.id, title: h.title })));

  let rated: HeadlineItem[] = [];
  if (candidates.length > 0) {
    rated = await rateHeadlines(deps.ask, candidates, deps.assets, now);
    deps.markSeen(candidates.map((c) => ({ key: c.id, title: c.title })));
  }

  const worthy = rated
    .filter((h) => IMPACT_RANK[h.impact] >= IMPACT_RANK[settings.alertMinImpact])
    .sort((a, b) => IMPACT_RANK[b.impact] - IMPACT_RANK[a.impact] || b.publishedAt - a.publishedAt);
  const room = Math.max(0, settings.maxAlertsPerHour - deps.alertsInLastHour());
  return {
    fetched: items.length,
    fresh: fresh.length,
    candidates: candidates.length,
    alerts: worthy.slice(0, room),
    heldBack: Math.max(0, worthy.length - room),
    failed
  };
}
