import type { Candle } from '$lib/engine/types';

/**
 * Sorts, de-duplicates and drops bad rows. Also drops any candle that had not
 * closed yet at `now`: exchanges return the forming candle as the last row and
 * its high/low/close are not final.
 */
export function sanitize(candles: Candle[], tfMs: number, now: number): Candle[] {
  const sorted = candles
    .filter((c) => [c.t, c.o, c.h, c.l, c.c].every(Number.isFinite) && c.t + tfMs <= now)
    .sort((a, b) => a.t - b.t);

  const out: Candle[] = [];
  for (const candle of sorted) {
    if (out.length && out[out.length - 1].t === candle.t) out[out.length - 1] = candle;
    else out.push(candle);
  }
  return out;
}

/**
 * Union of two sorted candle lists, sorted by open time. Where both have a
 * candle for the same time, `incoming` (the fresher download) wins.
 *
 * This is how a session's saved candles grow: nothing already saved is ever
 * dropped, even after the exchange itself has forgotten it.
 */
export function mergeCandles(saved: readonly Candle[], incoming: readonly Candle[]): Candle[] {
  if (saved.length === 0) return [...incoming];
  if (incoming.length === 0) return [...saved];

  const out: Candle[] = [];
  let i = 0;
  let j = 0;
  while (i < saved.length || j < incoming.length) {
    const a = saved[i];
    const b = incoming[j];
    if (!b || (a && a.t < b.t)) {
      out.push(a);
      i++;
    } else {
      out.push(b);
      j++;
      if (a && a.t === b.t) i++;
    }
  }
  return out;
}

const MAX_DECIMALS = 8;

/** Decimal places needed to print a price exactly (151.23 -> 2), capped at 8. */
export function decimalsOf(price: number): number {
  for (let d = 0; d < MAX_DECIMALS; d++) {
    if (Number(price.toFixed(d)) === price) return d;
  }
  return MAX_DECIMALS;
}

/**
 * Price decimals the market is quoted in, judged from `candles[from..to)`.
 *
 * Exchanges change tick size as price moves (Hyperliquid quotes 5 significant
 * figures), so this is measured on recent candles rather than fixed per coin.
 */
export function precisionOf(candles: readonly Candle[], from: number, to: number): number {
  let max = 0;
  for (let i = Math.max(0, from); i < Math.min(to, candles.length) && max < MAX_DECIMALS; i++) {
    const candle = candles[i];
    max = Math.max(max, decimalsOf(candle.h), decimalsOf(candle.l), decimalsOf(candle.c));
  }
  return max;
}
