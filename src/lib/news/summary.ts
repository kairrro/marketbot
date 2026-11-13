// The short version: what matters today for what you track, in a few lines, for
// someone who does not want to read news. It says how BIG a swing to expect and
// when to stay out, and what prices already did after a story. It never says
// which way a price will go. The facts are gathered here from data; the AI only
// phrases them (see writeSummary in ai.ts), and a plain fallback covers it being off.

import type { Feed, FeedItem, Move } from './feed';
import { fmtPct, fmtRatio, fmtSize, type Swing } from './swing';
import { DAY, HOUR, MINUTE, fmtRange, fmtTime, fmtDay, ctDateKey } from './time';
import { IMPACT_RANK, type Impact, type NoTradeWindow, type ScheduledItem, type TrackedAsset } from './types';

export type Level = 'quiet' | 'careful' | 'big';

export const LEVEL_LABEL: Record<Level, string> = { quiet: 'Quiet', careful: 'Be careful', big: 'Big day' };

export interface Upcoming {
  title: string;
  timeMs: number;
  impact: Impact;
  assets: string[];
  swing: Record<string, Swing>;
  noTrade: NoTradeWindow | null;
}

export interface RecentStory {
  what: string;
  publishedAt: number;
  source: string;
  url: string;
  move: Move;
}

/** One line of the board: a market or stock, how it is doing today, what is next, what moved it lately. */
export interface AssetLine {
  symbol: string;
  name: string;
  kind: 'market' | 'stock';
  price: number | null;
  /** Percent change today, from the last close. */
  changePct: number | null;
  /** How far it moves in a normal day, %. */
  typicalMove: number | null;
  next: Upcoming | null;
  story: RecentStory | null;
}

export interface Summary {
  generatedAt: number;
  /** Today in Central time. */
  date: string;
  level: Level;
  headline: string;
  bullets: string[];
  stayOut: NoTradeWindow[];
  assets: AssetLine[];
  /** The model that phrased it, or null for the plain version. */
  model: string | null;
  notes: string[];
}

/** Everything the summary is made from. */
export interface SummaryInput {
  assets: readonly TrackedAsset[];
  now: number;
  date: string;
  /** Rated events for today and the next trading day. */
  events: readonly ScheduledItem[];
  feed: Feed | null;
  quotes: Record<string, { price: number; changePct: number }>;
  /** Normal daily move by symbol, %. */
  typical: Record<string, number>;
  stayOut: readonly NoTradeWindow[];
}

/** An event is still ahead (or happening) until its stay-out window, or a quarter hour, has passed. */
export const isUpcoming = (e: ScheduledItem, now: number): boolean => (e.noTrade?.endMs ?? e.timeMs + 15 * MINUTE) >= now;

/** A story is recent for a day and a half. */
const RECENT = 36 * HOUR;

export function recentStories(feed: Feed | null, now: number): FeedItem[] {
  return (feed?.items ?? []).filter((i) => now - i.publishedAt <= RECENT && i.moves.some((m) => m.ratio >= 1.5));
}

/** Quiet, be careful, or big day. Rules, not AI. */
export function riskLevel(events: readonly ScheduledItem[], feed: Feed | null, now: number): Level {
  const ahead = events.filter((e) => isUpcoming(e, now) && e.timeMs - now <= DAY);
  if (ahead.some((e) => e.impact === 'high')) return 'big';
  if (ahead.some((e) => e.impact === 'medium')) return 'careful';
  if (recentStories(feed, now).some((i) => i.moves.some((m) => m.ratio >= 2))) return 'careful';
  return 'quiet';
}

const upcomingOf = (e: ScheduledItem): Upcoming => ({
  title: e.title,
  timeMs: e.timeMs,
  impact: e.impact,
  assets: e.assets,
  swing: e.swing ?? {},
  noTrade: e.noTrade
});

/** The board: one line per tracked market and stock. */
export function buildBoard(input: SummaryInput): AssetLine[] {
  const { now, events } = input;
  const ahead = events.filter((e) => isUpcoming(e, now)).sort((a, b) => a.timeMs - b.timeMs);
  const stories = (feed: Feed | null) => (feed?.items ?? []).filter((i) => now - i.publishedAt <= 3 * DAY);
  const lines: AssetLine[] = [];
  for (const a of input.assets) {
    if (!a.enabled || a.kind === 'topic') continue;
    const next =
      a.kind === 'market'
        ? ahead.find((e) => IMPACT_RANK[e.perAsset[a.symbol] ?? 'low'] >= 1)
        : ahead.find((e) => e.assets.includes(a.symbol));
    let story: RecentStory | null = null;
    for (const item of stories(input.feed)) {
      const move = item.moves.find((m) => m.symbol === a.symbol);
      if (move && move.ratio >= 1.5 && (!story || move.ratio > story.move.ratio)) {
        story = { what: item.what, publishedAt: item.publishedAt, source: item.source, url: item.url, move };
      }
    }
    const q = input.quotes[a.symbol];
    lines.push({
      symbol: a.symbol,
      name: a.name,
      kind: a.kind,
      price: q?.price ?? null,
      changePct: q?.changePct ?? null,
      typicalMove: input.typical[a.symbol] ?? null,
      next: next ? upcomingOf(next) : null,
      story
    });
  }
  return lines;
}

/** "NQ ~1.0% (≈ 260 pts, 3.5× a normal hour)". */
export function swingPhrase(swing: Record<string, Swing>, prices: Record<string, number> = {}): string {
  return Object.entries(swing)
    .map(([symbol, sw]) => {
      const size = fmtSize(symbol, sw.pct, prices[symbol]);
      return `${symbol} ~${fmtPct(sw.pct)} (${size ? `${size}, ` : ''}${fmtRatio(sw.ratio)})`;
    })
    .join(', ');
}

/** "NVDA −4.3% (1.6× a normal day)": a measured move, signed. */
export function movePhrase(m: Move): string {
  const sign = m.pct >= 0 ? '+' : '−';
  const times = m.ratio < 1.25 ? 'a normal day' : `${m.ratio.toFixed(1)}× a normal day`;
  return `${m.symbol} ${sign}${Math.abs(m.pct).toFixed(1)}% (${times})`;
}

const when = (ms: number, now: number) => (ctDateKey(ms) === ctDateKey(now) ? fmtTime(ms) : `${fmtDay(ctDateKey(ms))} ${fmtTime(ms)}`);

/** The facts the AI is given to phrase, and the plain version is built from. */
export interface Facts {
  level: Level;
  stayOut: string[];
  upcoming: { title: string; when: string; impact: Impact; swing: string; stayOut: string | null }[];
  stories: { what: string; when: string; moves: string }[];
  board: { symbol: string; today: string | null; normalDay: string | null }[];
}

export function gatherFacts(input: SummaryInput, level: Level, prices: Record<string, number>): Facts {
  const { now } = input;
  const ahead = input.events
    .filter((e) => isUpcoming(e, now) && IMPACT_RANK[e.impact] >= 1)
    .sort((a, b) => a.timeMs - b.timeMs)
    .slice(0, 6);
  return {
    level,
    stayOut: input.stayOut.filter((w) => w.endMs >= now).map((w) => fmtRange(w.startMs, w.endMs) + ' Central'),
    upcoming: ahead.map((e) => ({
      title: e.title,
      when: when(e.timeMs, now),
      impact: e.impact,
      swing: swingPhrase(e.swing ?? {}, prices),
      stayOut: e.noTrade ? fmtRange(e.noTrade.startMs, e.noTrade.endMs) : null
    })),
    stories: recentStories(input.feed, now)
      .slice(0, 5)
      .map((i) => ({ what: i.what, when: when(i.publishedAt, now), moves: i.moves.filter((m) => m.ratio >= 1.5).map(movePhrase).join(', ') })),
    board: input.assets
      .filter((a) => a.enabled && a.kind !== 'topic')
      .map((a) => {
        const q = input.quotes[a.symbol];
        return {
          symbol: a.symbol,
          today: q ? `${q.changePct >= 0 ? '+' : '−'}${Math.abs(q.changePct).toFixed(1)}%` : null,
          normalDay: input.typical[a.symbol] != null ? `${input.typical[a.symbol].toFixed(1)}%` : null
        };
      })
  };
}

/** The plain version, from the facts alone. Used when the AI is off or fails. */
export function plainSummary(facts: Facts): { headline: string; bullets: string[] } {
  const top = facts.upcoming.find((u) => u.impact === 'high') ?? facts.upcoming[0];
  const headline =
    facts.level === 'quiet'
      ? 'Quiet. Nothing big is scheduled, and no story has moved prices much.'
      : top
        ? `${LEVEL_LABEL[facts.level]}: ${top.title} at ${top.when} Central.${top.swing ? ` Expect ${top.swing.split(' (')[0]} to swing.` : ''}`
        : `${LEVEL_LABEL[facts.level]}: a recent story moved prices.`;
  const bullets: string[] = [];
  for (const u of facts.upcoming.slice(0, 3)) {
    bullets.push(`${u.when} ${u.title}${u.swing ? `: ${u.swing}` : ''}.${u.stayOut ? ` Stay out ${u.stayOut}.` : ''}`);
  }
  for (const s of facts.stories.slice(0, 2)) bullets.push(`Already moved: ${s.moves} after a story ${s.when}.`);
  if (facts.upcoming.length === 0 && facts.stories.length === 0) bullets.push('Nothing to stay out of.');
  return { headline, bullets };
}

export interface Phrased {
  headline: string;
  bullets: string[];
}

export interface SummaryDeps {
  input: SummaryInput;
  prices: Record<string, number>;
  /** Phrases the facts. Throws on failure. Absent when the AI is off. */
  phrase?: (facts: Facts) => Promise<Phrased>;
  model?: string | null;
}

export async function buildSummary(deps: SummaryDeps): Promise<Summary> {
  const { input } = deps;
  const notes: string[] = [];
  const level = riskLevel(input.events, input.feed, input.now);
  const facts = gatherFacts(input, level, deps.prices);
  let text = plainSummary(facts);
  let model: string | null = null;
  if (deps.phrase) {
    try {
      text = await deps.phrase(facts);
      model = deps.model ?? null;
    } catch (err) {
      notes.push(`The AI could not phrase it (${err instanceof Error ? err.message : err}), so this is the plain version.`);
    }
  } else {
    notes.push('AI is off, so this is the plain version.');
  }
  return {
    generatedAt: input.now,
    date: input.date,
    level,
    headline: text.headline,
    bullets: text.bullets,
    stayOut: input.stayOut.filter((w) => w.endMs >= input.now),
    assets: buildBoard(input),
    model,
    notes
  };
}
