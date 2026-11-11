// The yardstick for the past-data test: how far price actually moved after an
// event, and whether that matched the impact it was given. Pure functions over
// candles, so they can be checked without any data source.

import type { Candle } from '$lib/engine/types';
import { MINUTE } from './time';
import { IMPACTS, type Impact } from './types';

/** Reaction measured from the last price before the event. All moves are % of that price. */
export interface Reaction {
  /** High to low over the window, including the starting price. */
  range30: number;
  range60: number;
  /** Close-to-close, ignoring direction. */
  net30: number;
  net60: number;
}

/** Index of the first candle whose open is at or after `t` (candles sorted by open time). */
export function firstAtOrAfter(candles: readonly Candle[], t: number): number {
  let lo = 0;
  let hi = candles.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * How price reacted in the 30 and 60 minutes after `t0`. Null when there is no
 * price just before the event, or too much of the window is missing (market
 * closed, data gap), so a closed market is never mistaken for a quiet one.
 */
export function measureReaction(candles: readonly Candle[], t0: number, barMs: number): Reaction | null {
  const start = firstAtOrAfter(candles, t0);
  const before = candles[start - 1];
  if (!before) return null;
  const p0 = before.c;
  // The price before must be recent: no more than a few bars old.
  if (t0 - (before.t + barMs) > 3 * barMs + 2 * MINUTE || !(p0 > 0)) return null;

  const take = (minutes: number): { range: number; net: number } | null => {
    const end = t0 + minutes * MINUTE;
    const expected = Math.round((minutes * MINUTE) / barMs);
    let hi = p0;
    let lo = p0;
    let last = p0;
    let count = 0;
    for (let i = start; i < candles.length && candles[i].t < end; i++) {
      hi = Math.max(hi, candles[i].h);
      lo = Math.min(lo, candles[i].l);
      last = candles[i].c;
      count++;
    }
    if (count < expected * 0.8) return null;
    return { range: ((hi - lo) / p0) * 100, net: (Math.abs(last - p0) / p0) * 100 };
  };

  const a = take(30);
  const b = take(60);
  if (!a || !b) return null;
  return { range30: a.range, range60: b.range, net30: a.net, net60: b.net };
}

export const median = (values: readonly number[]): number => {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

export const mean = (values: readonly number[]): number =>
  values.length === 0 ? NaN : values.reduce((a, b) => a + b, 0) / values.length;

/** Ratio of a reaction to what the same clock time normally does. At or above SPIKE_AT it is a spike. */
export const QUIET_BELOW = 1.25;
export const SPIKE_AT = 2;

export interface Sample {
  family: string;
  label: string;
  asset: string;
  tier: Impact;
  timeMs: number;
  reaction: Reaction;
  /** What the same clock window does on days without events: median 60-minute range, % */
  baseline: number;
  /** range60 over baseline. */
  ratio: number;
}

export interface TierStats {
  tier: Impact;
  n: number;
  /** What the same clock window does on a day with nothing scheduled, % (the yardstick). */
  avgBaseline: number;
  avgRange60: number;
  avgNet30: number;
  avgNet60: number;
  medianRatio: number;
  avgRatio: number;
  /** Share of events whose 60-minute range stayed under QUIET_BELOW times normal. */
  quietPct: number;
  /** Share whose range reached SPIKE_AT times normal. */
  spikePct: number;
}

export function tierStats(samples: readonly Sample[], tier: Impact): TierStats {
  const s = samples.filter((x) => x.tier === tier);
  const n = s.length;
  const share = (pred: (x: Sample) => boolean) => (n ? (s.filter(pred).length / n) * 100 : NaN);
  return {
    tier,
    n,
    avgBaseline: mean(s.map((x) => x.baseline)),
    avgRange60: mean(s.map((x) => x.reaction.range60)),
    avgNet30: mean(s.map((x) => x.reaction.net30)),
    avgNet60: mean(s.map((x) => x.reaction.net60)),
    medianRatio: median(s.map((x) => x.ratio)),
    avgRatio: mean(s.map((x) => x.ratio)),
    quietPct: share((x) => x.ratio < QUIET_BELOW),
    spikePct: share((x) => x.ratio >= SPIKE_AT)
  };
}

export interface Summary {
  total: number;
  byTier: TierStats[];
  /** Whether the average move grows from Low to Medium to High (the thing the test is for). */
  ordered: boolean;
  /** High-rated events that came and went quietly, quietest first. */
  highQuiet: Sample[];
  /** Low-rated events that spiked, biggest first. */
  lowSpike: Sample[];
}

export function summarize(samples: readonly Sample[], worst = 8): Summary {
  const byTier = IMPACTS.map((tier) => tierStats(samples, tier));
  const [low, medium, high] = byTier;
  const have = byTier.filter((t) => t.n > 0);
  let ordered = have.length > 1;
  for (let i = 1; i < have.length; i++) if (!(have[i].avgRange60 > have[i - 1].avgRange60)) ordered = false;
  void low;
  void medium;
  void high;
  return {
    total: samples.length,
    byTier,
    ordered,
    highQuiet: samples
      .filter((x) => x.tier === 'high' && x.ratio < QUIET_BELOW)
      .sort((a, b) => a.ratio - b.ratio)
      .slice(0, worst),
    lowSpike: samples
      .filter((x) => x.tier === 'low' && x.ratio >= SPIKE_AT)
      .sort((a, b) => b.ratio - a.ratio)
      .slice(0, worst)
  };
}
