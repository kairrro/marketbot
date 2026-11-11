// Builds the morning brief and the weekly preview. Every source comes in through
// `BriefDeps`, so the same code runs live (real feeds), in the past-data test
// (history, only what existed at the time) and in unit tests (fakes).

import { fallbackMood, rateHeadlines, writeMood, type Ask } from './ai';
import { dedupeHeadlines, pickCandidates, type RawHeadline } from './noise';
import { earningsOpenItems, earningsReleaseItems, rateEvents, type EarningsRow } from './rate';
import { addDays, ctAt, isWeekday, mergeWindows, previousWeekday, HOUR } from './time';
import {
  IMPACT_RANK,
  type Brief,
  type HeadlineItem,
  type RawEvent,
  type ScheduledItem,
  type TrackedAsset
} from './types';

export interface BriefDeps {
  assets: readonly TrackedAsset[];
  /** Calendar rows with a release time in [fromMs, toMs). */
  calendar(fromMs: number, toMs: number): Promise<RawEvent[]>;
  /** Tracked companies reporting on a Central-time date. */
  earnings(dateKey: string): Promise<EarningsRow[]>;
  /** Headlines published in (sinceMs, untilMs]. Only needed for the morning brief. */
  headlines?(sinceMs: number, untilMs: number): Promise<{ items: RawHeadline[]; failed: string[] }>;
  /** How far the markets have moved since the last close, as context for the mood line. */
  moves?(): Promise<{ symbol: string; changePct: number }[]>;
  /** The model, or null to run without AI. */
  ask?: Ask | null;
  model?: string | null;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Scheduled items for one Central-time day: calendar, earnings, and the open after a report. */
async function dayItems(date: string, deps: BriefDeps, notes: string[]): Promise<{ items: ScheduledItem[]; incomplete: boolean }> {
  const from = ctAt(date, 0);
  const to = ctAt(addDays(date, 1), 0);
  let incomplete = false;
  const items: ScheduledItem[] = [];

  try {
    items.push(...rateEvents(await deps.calendar(from, to), deps.assets));
  } catch (err) {
    incomplete = true;
    notes.push(`The economic calendar could not be read (${errText(err)}).`);
  }

  try {
    const today = await deps.earnings(date);
    // After the close today: the release itself. Before the open today: already out, so it is the open that matters.
    items.push(...earningsReleaseItems(today.filter((r) => r.time !== 'pre'), deps.assets));
    items.push(...earningsOpenItems(today.filter((r) => r.time === 'pre'), deps.assets, date));
    // After the close on the last trading day: the reaction is at today's open.
    const before = await deps.earnings(previousWeekday(date));
    items.push(...earningsOpenItems(before.filter((r) => r.time !== 'pre'), deps.assets, date));
  } catch (err) {
    notes.push(`The earnings calendar could not be read (${errText(err)}).`);
  }
  return { items: items.sort((a, b) => a.timeMs - b.timeMs), incomplete };
}

export const noTradeOf = (items: readonly ScheduledItem[]) =>
  mergeWindows(items.filter((i) => i.noTrade && IMPACT_RANK[i.impact] >= 1).map((i) => i.noTrade!));

/** How far back overnight news reaches: the last close, but never more than three days. */
export function overnightSince(date: string, now: number): number {
  return Math.max(ctAt(previousWeekday(date), '15:00'), now - 72 * HOUR);
}

/** The morning brief for Central-time `date`, written as of `now` (nothing later than that is used). */
export async function buildMorningBrief(date: string, now: number, deps: BriefDeps): Promise<Brief> {
  const notes: string[] = [];
  const { items: events, incomplete } = await dayItems(date, deps, notes);

  let overnight: HeadlineItem[] = [];
  if (deps.headlines) {
    if (!deps.ask) {
      notes.push('AI is off (no OpenRouter key), so overnight news was not rated.');
    } else {
      try {
        const fetched = await deps.headlines(overnightSince(date, now), now);
        for (const f of fetched.failed) notes.push(`${f}.`);
        const candidates = pickCandidates(dedupeHeadlines(fetched.items.filter((h) => h.publishedAt <= now)), deps.assets, 12);
        const rated = await rateHeadlines(deps.ask, candidates, deps.assets, now);
        overnight = rated
          .filter((h) => IMPACT_RANK[h.impact] >= 1)
          .sort((a, b) => IMPACT_RANK[b.impact] - IMPACT_RANK[a.impact] || b.publishedAt - a.publishedAt)
          .slice(0, 6);
      } catch (err) {
        notes.push(`Overnight news could not be rated (${errText(err)}).`);
      }
    }
  }

  let mood = fallbackMood({ events, overnight, moves: [] });
  if (deps.ask) {
    try {
      const moves = deps.moves ? await deps.moves().catch(() => []) : [];
      mood = await writeMood(deps.ask, { events, overnight, moves });
    } catch (err) {
      notes.push(`The mood summary could not be written (${errText(err)}).`);
    }
  }

  return {
    kind: 'morning',
    forDate: date,
    generatedAt: now,
    model: deps.ask ? (deps.model ?? null) : null,
    events,
    overnight,
    mood,
    noTrade: noTradeOf(events),
    notes,
    incomplete
  };
}

/** The weekly preview for the week starting Monday `monday`: the events that matter, day by day. */
export async function buildWeeklyBrief(monday: string, now: number, deps: BriefDeps): Promise<Brief> {
  const notes: string[] = [];
  const from = ctAt(monday, 0);
  const to = ctAt(addDays(monday, 5), 0);
  let incomplete = false;
  const events: ScheduledItem[] = [];

  try {
    events.push(...rateEvents(await deps.calendar(from, to), deps.assets));
  } catch (err) {
    incomplete = true;
    notes.push(`The economic calendar could not be read (${errText(err)}).`);
  }

  try {
    for (let i = 0; i < 5; i++) {
      const date = addDays(monday, i);
      if (!isWeekday(date)) continue;
      events.push(...earningsReleaseItems(await deps.earnings(date), deps.assets));
    }
  } catch (err) {
    notes.push(`The earnings calendar could not be read (${errText(err)}).`);
  }

  // The week ahead is about what matters: Medium and High only.
  const big = events.filter((e) => IMPACT_RANK[e.impact] >= 1).sort((a, b) => a.timeMs - b.timeMs);
  return {
    kind: 'weekly',
    forDate: monday,
    generatedAt: now,
    model: null,
    events: big,
    overnight: [],
    mood: null,
    noTrade: noTradeOf(big),
    notes,
    incomplete
  };
}
