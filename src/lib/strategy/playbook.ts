// The NQ playbook: opening range, day bias and the candles worth a look.
// Pure and 1m-only. Everything is worked out from `candles[0..count)`, so a
// marker can only come from candles that have already closed in the replay.

import type { Candle, Side } from '$lib/engine/types';
import { offsetMinutes } from '$lib/timezone';

// ---- Settings ----

/** Every time of day below is read on this clock (daylight saving included). */
export const TIMEZONE = 'America/Chicago';
/** Candles before the signal candle whose bodies it has to beat. */
export const LOOKBACK = 10;
/** The close must sit in this top (or bottom) share of the candle's range. */
export const QUARTER = 0.25;
/** Setup A: the close must clear the high (low) of this many candles before it. */
export const BREATHER_BARS = 3;
/** Trading window, in minutes after midnight: candles that OPEN from 08:35 up to 14:00. */
export const WINDOW_START = 8 * 60 + 35;
export const WINDOW_END = 14 * 60;
/** Opening range: the 1m candles from 08:30 up to 08:35 (the first 5m candle). */
export const OR_START = 8 * 60 + 30;
export const OR_END = 8 * 60 + 35;
/** The playbook only reads 1m candles. */
export const PLAYBOOK_TF_MS = 60_000;

// ---- Results ----

export type Bias = Side | 'none';

export interface PlaybookMarker {
  /** Index into the candles passed in. */
  index: number;
  /** Open time of that candle. */
  t: number;
  /** A is Setup A; signal is any other signal candle (for Setup B checks). */
  kind: 'setupA' | 'signal';
  side: Side;
  /** The candle's high and low, to place the mark against. */
  high: number;
  low: number;
}

export interface BiasChange {
  index: number;
  t: number;
  /** The bias from this candle on. */
  bias: Side;
  high: number;
  low: number;
}

export interface OpeningRange {
  /** First and last candle of that day seen so far. */
  first: number;
  end: number;
  high: number;
  low: number;
  /** All of 08:30-08:34 has closed, so the levels are final. */
  complete: boolean;
}

export interface TradingWindow {
  /** First and last candle of that day inside the window. */
  from: number;
  to: number;
}

export interface Playbook {
  markers: PlaybookMarker[];
  biasChanges: BiasChange[];
  /** One opening range per day that has one. */
  ranges: OpeningRange[];
  /** The opening range of the day of the last candle, if it has one. */
  current: OpeningRange | null;
  windows: TradingWindow[];
}

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
/** Absorbs float noise on prices that are not exact binary fractions. */
const EPS = 1e-9;

export function emptyPlaybook(): Playbook {
  return { markers: [], biasChanges: [], ranges: [], current: null, windows: [] };
}

// Chicago's offset only ever changes on the hour, and working it out means a
// time zone lookup, so it is found once per hour of UTC.
const offsets = new Map<number, number>();

/** Chicago's calendar day (as a number) and minutes after midnight for a candle open time. */
function chicago(t: number): { day: number; minute: number } {
  const hour = Math.floor(t / HOUR_MS);
  let offset = offsets.get(hour);
  if (offset === undefined) {
    if (offsets.size > 200_000) offsets.clear();
    offset = offsetMinutes(hour * HOUR_MS, TIMEZONE);
    offsets.set(hour, offset);
  }
  const local = t + offset * MINUTE_MS;
  const day = Math.floor(local / DAY_MS);
  return { day, minute: Math.floor((local - day * DAY_MS) / MINUTE_MS) };
}

const body = (c: Candle) => Math.abs(c.c - c.o);

/**
 * The playbook for `candles[0..count)`. Candles past `count` are never read.
 * `candles` must be 1m candles, oldest first.
 */
export function computePlaybook(candles: readonly Candle[], count: number = candles.length): Playbook {
  const n = Math.min(count, candles.length);
  const out = emptyPlaybook();

  let day = NaN;
  let bias: Bias = 'none';
  let range: OpeningRange | null = null;
  let window: TradingWindow | null = null;

  for (let i = 0; i < n; i++) {
    const c = candles[i];
    const clock = chicago(c.t);
    if (clock.day !== day) {
      // A new day starts clean: no bias, no opening range.
      day = clock.day;
      bias = 'none';
      range = null;
      window = null;
    }
    const minute = clock.minute;

    // Opening range.
    if (minute >= OR_START && minute < OR_END) {
      if (!range) {
        range = { first: i, end: i, high: c.h, low: c.l, complete: false };
        out.ranges.push(range);
      } else {
        range.high = Math.max(range.high, c.h);
        range.low = Math.min(range.low, c.l);
      }
    }
    if (range) {
      range.end = i;
      if (minute >= OR_END - 1) range.complete = true;
    }

    if (minute < WINDOW_START || minute >= WINDOW_END) continue;

    if (!window) {
      window = { from: i, to: i };
      out.windows.push(window);
    }
    window.to = i;

    // Day bias: only on the candle that closes a 5m candle, and only once the range is final.
    if (range?.complete && minute % 5 === 4) {
      const next: Bias = c.c > range.high ? 'long' : c.c < range.low ? 'short' : bias;
      if (next !== bias && next !== 'none') {
        bias = next;
        out.biasChanges.push({ index: i, t: c.t, bias, high: c.h, low: c.l });
      }
    }

    // Signal candle: a body bigger than any of the last LOOKBACK, closing in its top (or bottom) quarter.
    if (i < LOOKBACK) continue;
    const size = body(c);
    let biggest = 0;
    for (let k = i - LOOKBACK; k < i; k++) biggest = Math.max(biggest, body(candles[k]));
    if (size <= biggest) continue;

    const span = c.h - c.l;
    const bullish = c.c > c.o && c.c >= c.h - QUARTER * span - EPS;
    const bearish = c.c < c.o && c.c <= c.l + QUARTER * span + EPS;
    if (!bullish && !bearish) continue;

    // Setup A also needs the close to clear the last few candles, in the bias's direction.
    let setupA = false;
    if (bullish && bias === 'long') {
      let high = -Infinity;
      for (let k = i - BREATHER_BARS; k < i; k++) high = Math.max(high, candles[k].h);
      setupA = c.c > high;
    } else if (bearish && bias === 'short') {
      let low = Infinity;
      for (let k = i - BREATHER_BARS; k < i; k++) low = Math.min(low, candles[k].l);
      setupA = c.c < low;
    }

    out.markers.push({
      index: i,
      t: c.t,
      kind: setupA ? 'setupA' : 'signal',
      side: bullish ? 'long' : 'short',
      high: c.h,
      low: c.l
    });
  }

  // `range` is the last candle's day; it only counts when that day has one.
  out.current = range;
  return out;
}

/** The playbook on the 1m chart, and nothing on any other timeframe. */
export function playbookFor(candles: readonly Candle[], count: number, tfMs: number): Playbook {
  return tfMs === PLAYBOOK_TF_MS ? computePlaybook(candles, count) : emptyPlaybook();
}
