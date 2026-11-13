// The stock finder: type a ticker, get what you need on it without reading the
// news. Today's move against a normal day, the next earnings date, the stories of
// the past week with the price move that followed each, and three short bullets.
// A size and a record, never a direction.

import type { Feed, FeedItem } from './feed';
import { EARNINGS_SWING, fmtPct, type Swing } from './swing';
import { fmtDay, fmtTime, ctDateKey } from './time';
import { movePhrase } from './summary';

export interface NextEarnings {
  /** Central-time date key of the report. */
  date: string;
  time: 'pre' | 'post' | 'unknown';
}

export interface Lookup {
  symbol: string;
  name: string;
  price: number | null;
  changePct: number | null;
  typicalMove: number | null;
  earnings: NextEarnings | null;
  /** What a report from this stock typically does to NQ (known for the big names). */
  earningsSwing: Swing | null;
  stories: FeedItem[];
  bullets: string[];
  generatedAt: number;
  model: string | null;
  notes: string[];
}

export interface LookupFacts {
  symbol: string;
  name: string;
  today: string | null;
  normalDay: string | null;
  nextEarnings: string | null;
  nqSwingOnEarnings: string | null;
  stories: { what: string; when: string; moves: string }[];
}

export interface LookupDeps {
  symbol: string;
  name: string;
  now: number;
  quote: { price: number; changePct: number } | null;
  typicalMove: number | null;
  earnings: NextEarnings | null;
  /** Stories about this stock, from buildFeed with every move kept. */
  feed: Feed;
  /** Phrases the facts into bullets. Absent when the AI is off. */
  phrase?: (facts: LookupFacts) => Promise<string[]>;
  model?: string | null;
}

const signed = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%`;

const earningsText = (e: NextEarnings) =>
  `${fmtDay(e.date)} ${e.time === 'pre' ? 'before the open' : e.time === 'post' ? 'after the close' : '(time not given)'}`;

export function gatherLookupFacts(d: LookupDeps, stories: FeedItem[], earningsSwing: Swing | null): LookupFacts {
  return {
    symbol: d.symbol,
    name: d.name,
    today: d.quote ? signed(d.quote.changePct) : null,
    normalDay: d.typicalMove != null ? `${d.typicalMove.toFixed(1)}%` : null,
    nextEarnings: d.earnings ? earningsText(d.earnings) : null,
    nqSwingOnEarnings: earningsSwing ? `NQ ~${fmtPct(earningsSwing.pct)} in the hour after a report` : null,
    stories: stories.slice(0, 5).map((s) => ({
      what: s.what,
      when: `${fmtDay(ctDateKey(s.publishedAt))} ${fmtTime(s.publishedAt)}`,
      moves: s.moves.filter((m) => m.symbol === d.symbol).map(movePhrase).join(', ')
    }))
  };
}

/** Three plain lines from the facts alone. */
export function plainBullets(f: LookupFacts): string[] {
  const out: string[] = [];
  if (f.today) out.push(`Today ${f.today}${f.normalDay ? `. A normal day is about ${f.normalDay}.` : '.'}`);
  const moved = f.stories.filter((s) => s.moves);
  if (moved.length > 0) out.push(`After stories this week: ${moved.slice(0, 2).map((s) => `${s.moves} (${s.when})`).join('; ')}.`);
  else out.push('No story this week was followed by a clear move.');
  if (f.nextEarnings) out.push(`Next earnings: ${f.nextEarnings}.${f.nqSwingOnEarnings ? ` ${f.nqSwingOnEarnings}.` : ''}`);
  return out;
}

export async function buildLookup(d: LookupDeps): Promise<Lookup> {
  const notes = [...d.feed.notes];
  const stories = d.feed.items.filter((i) => i.moves.some((m) => m.symbol === d.symbol));
  const earningsSwing = EARNINGS_SWING[d.symbol] ?? null;
  const facts = gatherLookupFacts(d, stories, earningsSwing);

  let bullets = plainBullets(facts);
  let model: string | null = null;
  if (d.phrase) {
    try {
      bullets = await d.phrase(facts);
      model = d.model ?? null;
    } catch (err) {
      notes.push(`The AI could not phrase it (${err instanceof Error ? err.message : err}), so these are the plain lines.`);
    }
  }
  return {
    symbol: d.symbol,
    name: d.name,
    price: d.quote?.price ?? null,
    changePct: d.quote?.changePct ?? null,
    typicalMove: d.typicalMove,
    earnings: d.earnings,
    earningsSwing,
    stories,
    bullets,
    generatedAt: d.now,
    model,
    notes
  };
}
