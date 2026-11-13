// The news feed: stories from the past days that were followed by a real price
// move in an asset you track (a CEO scandal and the stock that day, say). The
// moves are measured from prices, not guessed, and the AI only writes the plain
// one-line description. Sources come in through `FeedDeps`, like in brief.ts.

import type { Candle } from '$lib/engine/types';
import { dedupeHeadlines, pickCandidates, type Candidate, type RawHeadline } from './noise';
import { DAY, HOUR, ctDateKey } from './time';
import type { TrackedAsset } from './types';

/** Hourly prices for one symbol, and how far it normally moves in a day. */
export interface Bars {
  symbol: string;
  hourly: Candle[];
  /** Average absolute close-to-close move per day over about a month, in %. */
  typicalMove: number;
}

/** What the price actually did after a story. A measurement, not a prediction. */
export interface Move {
  symbol: string;
  /** Percent change from the last price before the story to about a day later. Signed. */
  pct: number;
  /** How many times a normal day's move that is. */
  ratio: number;
  /** Hours between the story and the price it is measured to. */
  hours: number;
}

export interface FeedItem {
  id: string;
  /** One plain sentence on what happened (the AI's, or the headline when the AI is off). */
  what: string;
  headline: string;
  source: string;
  url: string;
  publishedAt: number;
  /** Prices that moved, strongest first. */
  moves: Move[];
  /** The AI wrote `what` (and checked it for direction words). */
  described: boolean;
}

export interface Feed {
  generatedAt: number;
  days: number;
  model: string | null;
  items: FeedItem[];
  notes: string[];
}

/** Smallest move, in normal days, that a story about no particular stock is credited with. */
export const MACRO_RATIO = 2;

/** Floor for a symbol's normal daily move, so a very quiet one does not make everything look huge. */
const MIN_TYPICAL = 0.25;

/**
 * How the price moved after a story: from the last price before it was
 * published to the price about a day later. Null when there are no prices
 * before the story, or less than an hour after it.
 */
export function reaction(bars: Bars, publishedAt: number, now: number): Move | null {
  if (bars.hourly.length === 0 || !(bars.typicalMove > 0)) return null;
  const horizon = Math.min(now, publishedAt + DAY);
  let before: number | null = null;
  let after: Candle | null = null;
  for (const c of bars.hourly) {
    const end = c.t + HOUR;
    if (end <= publishedAt) before = c.c;
    else if (end <= horizon) after = c;
  }
  if (before == null || !after || !(before > 0)) return null;
  const hours = (after.t + HOUR - publishedAt) / HOUR;
  if (hours < 1) return null;
  const pct = (after.c / before - 1) * 100;
  return { symbol: bars.symbol, pct, ratio: Math.abs(pct) / Math.max(bars.typicalMove, MIN_TYPICAL), hours };
}

/** The symbols whose price a story could have moved: the stocks and markets it names, or every market for a macro story. */
export function symbolsFor(c: Pick<Candidate, 'matched'>, assets: readonly TrackedAsset[]): string[] {
  const named = [...new Set(c.matched.filter((a) => a.kind !== 'topic').map((a) => a.symbol))];
  if (named.length > 0) return named.slice(0, 4);
  return assets.filter((a) => a.enabled && a.kind === 'market').map((a) => a.symbol);
}

export interface FeedDeps {
  assets: readonly TrackedAsset[];
  now: number;
  days: number;
  /** Smallest move, in normal days, worth keeping. */
  minRatio?: number;
  /** Most stories kept. */
  limit?: number;
  /** When false, stories need no big-news signal (used to look up one stock). */
  requireBig?: boolean;
  headlines(sinceMs: number): Promise<{ items: RawHeadline[]; failed: string[] }>;
  bars(symbols: string[]): Promise<Record<string, Bars>>;
  /** Plain one-line descriptions by headline id, for the stories that are real news. Omitted ids are dropped. */
  describe?(candidates: Candidate[]): Promise<Map<string, string>>;
  model?: string | null;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function buildFeed(deps: FeedDeps): Promise<Feed> {
  const { assets, now, days } = deps;
  const minRatio = deps.minRatio ?? 1;
  const limit = deps.limit ?? 24;
  const notes: string[] = [];

  const fetched = await deps.headlines(now - days * DAY);
  for (const f of fetched.failed) notes.push(`${f}.`);
  const candidates = pickCandidates(
    dedupeHeadlines(fetched.items.filter((h) => h.publishedAt <= now)),
    assets,
    600,
    deps.requireBig ?? true
  );

  const wanted = new Map<string, string[]>();
  for (const c of candidates) wanted.set(c.id, symbolsFor(c, assets));
  const bars = await deps.bars([...new Set([...wanted.values()].flat())]);
  const missing = [...new Set([...wanted.values()].flat())].filter((s) => !bars[s]);
  if (missing.length > 0) notes.push(`No prices for ${missing.join(', ')}, so their stories could not be checked.`);

  // Keep the stories that were followed by a real move, with the move. A story that names a
  // stock is judged on that stock. A macro story could be behind any market's day, so it must be
  // followed by a much bigger move before it is pinned on one.
  const moved: { c: Candidate; moves: Move[] }[] = [];
  for (const c of candidates) {
    const named = c.matched.some((a) => a.kind !== 'topic');
    const needed = named ? minRatio : Math.max(minRatio, MACRO_RATIO);
    const moves = (wanted.get(c.id) ?? [])
      .map((s) => (bars[s] ? reaction(bars[s], c.publishedAt, now) : null))
      .filter((m): m is Move => m != null && m.ratio >= needed)
      .sort((a, b) => b.ratio - a.ratio);
    if (moves.length > 0) moved.push({ c, moves });
  }

  // A day with a big move has many headlines about it. Keep the two best-sourced per symbol and day,
  // and of equals the earliest: it is the one that broke the story.
  const taken = new Map<string, number>();
  const kept = moved
    .sort((a, b) => b.c.score - a.c.score || a.c.publishedAt - b.c.publishedAt)
    .filter(({ c, moves }) => {
      const key = `${moves[0].symbol}|${ctDateKey(c.publishedAt)}`;
      const n = taken.get(key) ?? 0;
      taken.set(key, n + 1);
      return n < 2;
    })
    .sort((a, b) => b.moves[0].ratio - a.moves[0].ratio)
    .slice(0, limit);

  let descriptions: Map<string, string> | null = null;
  if (deps.describe && kept.length > 0) {
    try {
      descriptions = await deps.describe(kept.map((k) => k.c));
    } catch (err) {
      notes.push(`The AI could not describe the stories (${errText(err)}), so the headlines are shown as published.`);
    }
  } else if (!deps.describe) {
    notes.push('AI is off, so headlines are shown as published.');
  }

  const items: FeedItem[] = [];
  for (const { c, moves } of kept) {
    const what = descriptions?.get(c.id);
    // The AI left it out: it is not news worth showing.
    if (descriptions && what == null) continue;
    items.push({
      id: c.id,
      what: what ?? c.headline,
      headline: c.headline,
      source: c.source,
      url: c.url,
      publishedAt: c.publishedAt,
      moves: moves.slice(0, 3),
      described: what != null
    });
  }
  items.sort((a, b) => b.publishedAt - a.publishedAt);
  return { generatedAt: now, days, model: descriptions ? (deps.model ?? null) : null, items, notes };
}
