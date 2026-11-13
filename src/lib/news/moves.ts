// Move alerts: a tracked stock (or market) is having a big day AND a story about
// it came out in the last day or so. Then the ping says what the story was and how
// far the price has gone, measured. It is a record of what happened, never a
// forecast, and it is rare on purpose: one ping per symbol per day.

import type { Feed, FeedItem } from './feed';
import { HOUR, ctDateKey } from './time';
import type { TrackedAsset } from './types';

/** A story counts as the likely reason for a day's move for this long. */
const STORY_AGE = 30 * HOUR;

export interface MoveAlert {
  /** `SYMBOL|date`: one ping per symbol per day. */
  key: string;
  symbol: string;
  name: string;
  price: number;
  /** Percent change today, from the last close. Signed. */
  pct: number;
  /** How many times a normal day's move that is. */
  ratio: number;
  story: FeedItem;
}

/** A move alert as stored and shown. */
export interface MoveAlertRecord {
  id: string;
  symbol: string;
  name: string;
  price: number;
  pct: number;
  ratio: number;
  what: string;
  headline: string;
  source: string;
  url: string;
  publishedAt: number;
  createdAt: number;
  discordSentAt: number | null;
}

export interface MoveInput {
  assets: readonly TrackedAsset[];
  now: number;
  quotes: Record<string, { price: number; changePct: number }>;
  /** How far each symbol moves in a normal day, %. */
  typical: Record<string, number>;
  feed: Feed | null;
  /** Smallest move, in normal days, that gets a ping. */
  minRatio: number;
  /** Keys already pinged today. */
  sent: ReadonlySet<string>;
}

/** Floor for a symbol's normal daily move, so a very quiet one does not trip on small moves. */
const MIN_TYPICAL = 0.25;

export const moveKey = (symbol: string, now: number): string => `${symbol}|${ctDateKey(now)}`;

/** The symbols having a big day that have a recent story to go with it, biggest move first. */
export function findMoveAlerts(input: MoveInput): MoveAlert[] {
  const { now, feed } = input;
  if (!feed) return [];
  const out: MoveAlert[] = [];
  for (const a of input.assets) {
    if (!a.enabled || a.kind === 'topic') continue;
    const quote = input.quotes[a.symbol];
    const typical = input.typical[a.symbol];
    if (!quote || !(typical > 0)) continue;
    const ratio = Math.abs(quote.changePct) / Math.max(typical, MIN_TYPICAL);
    if (ratio < input.minRatio) continue;
    const key = moveKey(a.symbol, now);
    if (input.sent.has(key)) continue;
    // The newest story that this symbol's price moved after.
    const story = feed.items
      .filter((i) => now - i.publishedAt <= STORY_AGE && i.moves.some((m) => m.symbol === a.symbol))
      .sort((x, y) => y.publishedAt - x.publishedAt)[0];
    if (!story) continue;
    out.push({ key, symbol: a.symbol, name: a.name, price: quote.price, pct: quote.changePct, ratio, story });
  }
  return out.sort((x, y) => y.ratio - x.ratio);
}

export function toRecord(a: MoveAlert, createdAt: number): MoveAlertRecord {
  return {
    id: `${a.key}@${createdAt}`,
    symbol: a.symbol,
    name: a.name,
    price: a.price,
    pct: a.pct,
    ratio: a.ratio,
    what: a.story.what,
    headline: a.story.headline,
    source: a.story.source,
    url: a.story.url,
    publishedAt: a.story.publishedAt,
    createdAt,
    discordSentAt: null
  };
}
