// Average True Range: how far a candle usually travels on the chart's own
// timeframe, in price. Wilder's smoothing, the same as TradingView's ATR.
// Only candles[0..count) are ever read, so nothing here can see past the cursor.

import type { Candle } from './types';

export const DEFAULT_ATR_PERIOD = 14;

/** Stop sizes offered as one-click choices, in ATRs. */
export const ATR_STOP_MULTS = [1, 1.5, 2, 3] as const;

/**
 * Candles read before the ones that count. Wilder's average forgets the past
 * geometrically, so a few lengths of warm-up lands within a hair of the value
 * from the very first candle, and keeps each step cheap however much history is loaded.
 */
const WARMUP_LENGTHS = 12;
/** Recent candles the "usual" ATR is taken over. */
const USUAL_WINDOW = 200;

export type Volatility = 'quiet' | 'normal' | 'fast';

export interface AtrReading {
  /** ATR at the last closed candle, in price. */
  value: number;
  /** As a % of that candle's close. */
  pct: number;
  /** The median ATR over the last ~200 candles: what is normal here. */
  usual: number;
  /** value / usual. Above 1 the market is moving more than it has lately. */
  ratio: number;
  /** Quiet under 0.75× usual, fast over 1.35×. */
  state: Volatility;
}

/** True range: the candle's own range, widened to the previous close when there was a gap. */
export function trueRange(candle: Candle, prevClose: number | null): number {
  if (prevClose == null) return candle.h - candle.l;
  return Math.max(candle.h - candle.l, Math.abs(candle.h - prevClose), Math.abs(candle.l - prevClose));
}

/**
 * ATR for each of candles[from..count): `out[i - from]`. The first value comes
 * `period` candles in (a plain average of those true ranges), and is NaN before that.
 */
export function atrSeries(candles: readonly Candle[], count: number, period: number, from = 0): number[] {
  const n = Math.max(1, Math.round(period));
  const start = Math.max(0, from);
  const out: number[] = [];
  let atr = NaN;
  let sum = 0;
  for (let i = start; i < count; i++) {
    const tr = trueRange(candles[i], i > start ? candles[i - 1].c : null);
    const seen = i - start + 1;
    if (seen < n) {
      sum += tr;
      atr = NaN;
    } else if (seen === n) {
      atr = (sum + tr) / n;
    } else {
      atr = (atr * (n - 1) + tr) / n;
    }
    out.push(atr);
  }
  return out;
}

/** The ATR at the last of candles[0..count), with what is usual lately. Null until `period` candles have closed. */
export function atrReading(candles: readonly Candle[], count: number, period: number): AtrReading | null {
  const n = Math.max(1, Math.round(period));
  if (count < n) return null;
  const from = Math.max(0, count - USUAL_WINDOW - n * WARMUP_LENGTHS);
  const series = atrSeries(candles, count, n, from).filter((value) => Number.isFinite(value));
  const value = series.at(-1);
  if (value == null || !(value > 0)) return null;

  const recent = series.slice(-USUAL_WINDOW).sort((a, b) => a - b);
  const usual = recent[Math.floor(recent.length / 2)];
  const ratio = value / usual;
  const close = candles[count - 1].c;
  return {
    value,
    pct: close > 0 ? (value / close) * 100 : 0,
    usual,
    ratio,
    state: ratio < 0.75 ? 'quiet' : ratio > 1.35 ? 'fast' : 'normal'
  };
}

/** A stop distance expressed in ATRs: 15 points on a 10-point ATR is 1.5. */
export function stopInAtr(distance: number, atr: number): number {
  return atr > 0 ? distance / atr : 0;
}

/** "1.5×", "2×": a multiple with no trailing zeros. */
export function fmtMult(mult: number): string {
  return `${Number(mult.toFixed(1))}×`;
}
