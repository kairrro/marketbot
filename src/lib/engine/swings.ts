// Swing highs and lows, what price has done to them since, and the trend mode
// they add up to. Only candles[0..count) are ever read, so a swing does not
// exist until the candles that confirm it have closed.

import type { Candle } from './types';

export type SwingKind = 'high' | 'low';
export type SwingStatus = 'fresh' | 'swept' | 'broken';
export type Trend = 'up' | 'down' | 'range';

export const DEFAULT_SWING_SIZE = 2;

export interface Swing {
  kind: SwingKind;
  /** Index of the candle that made it. */
  index: number;
  /** Open time of that candle. */
  time: number;
  price: number;
  /** Close time of the last confirming candle: the moment the swing is known. */
  confirmedAt: number;
}

export interface SwingLine extends Swing {
  /** Swept: a wick went through and the candle closed back. Broken: a candle closed through. */
  status: SwingStatus;
  /** Close time of the candle that swept or broke it. null while fresh. */
  endTime: number | null;
  /** Index of that candle. null while fresh. */
  endIndex: number | null;
}

/** One candle that swept liquidity: a wick past one or more swings, then a close back inside. */
export interface Sweep {
  /** 'high': it wicked above swing highs and closed back below them. 'low': the mirror. */
  kind: SwingKind;
  /** Index of the sweeping candle. */
  index: number;
  /** How far its wick reached: its high for a sweep of highs, its low for lows. */
  reach: number;
  /** The swings it took, furthest from the close first. */
  swings: SwingLine[];
}

export interface Mode {
  trend: Trend;
  /** The last swing high and low, and halfway between (the range when trend is 'range'). */
  high: number;
  low: number;
  mid: number;
}

/**
 * Every swing in candles[0..count). A swing high is a candle whose high is
 * above the highs of the `size` candles before it and not below those of the
 * `size` candles after it; a swing low the same with lows. Of equal highs (or
 * lows) close together, the first is the swing. That way the candle that made
 * a higher timeframe's swing is a swing on the lower timeframe too, even when
 * another candle there touched the same price.
 */
export function findSwings(candles: readonly Candle[], count: number, size: number, tfMs: number): Swing[] {
  const n = Math.max(1, Math.round(size));
  const swings: Swing[] = [];
  for (let i = n; i + n < count; i++) {
    const c = candles[i];
    let high = true;
    let low = true;
    for (let k = 1; k <= n; k++) {
      const before = candles[i - k];
      const after = candles[i + k];
      high &&= c.h > before.h && c.h >= after.h;
      low &&= c.l < before.l && c.l <= after.l;
    }
    const confirmedAt = candles[i + n].t + tfMs;
    if (high) swings.push({ kind: 'high', index: i, time: c.t, price: c.h, confirmedAt });
    if (low) swings.push({ kind: 'low', index: i, time: c.t, price: c.l, confirmedAt });
  }
  return swings;
}

/** The first candle after the swing, up to candles[count - 1], that swept or broke it. */
export function swingStatus(
  swing: Swing,
  candles: readonly Candle[],
  count: number,
  tfMs: number
): Pick<SwingLine, 'status' | 'endTime' | 'endIndex'> {
  const dir = swing.kind === 'high' ? 1 : -1;
  for (let j = swing.index + 1; j < count; j++) {
    const c = candles[j];
    if (dir * (c.c - swing.price) > 0) return { status: 'broken', endTime: c.t + tfMs, endIndex: j };
    if (dir * ((dir > 0 ? c.h : c.l) - swing.price) > 0) return { status: 'swept', endTime: c.t + tfMs, endIndex: j };
  }
  return { status: 'fresh', endTime: null, endIndex: null };
}

/**
 * Every swing in candles[0..count) with what has happened to it since: the
 * same answer as `swingStatus` for each, in one pass over the candles, so it
 * stays cheap over thousands of them.
 */
export function swingLines(candles: readonly Candle[], count: number, size: number, tfMs: number): SwingLine[] {
  const n = Math.max(1, Math.round(size));
  const lines: SwingLine[] = findSwings(candles, count, size, tfMs).map((swing) => ({
    ...swing,
    status: 'fresh',
    endTime: null,
    endIndex: null
  }));
  // Swings no candle has gone past yet, newest last. Each is closer to price
  // than the ones before it (a lower high, a higher low): a further one would
  // have been taken by the candle that made the nearer one. So a candle only
  // ever takes swings off the end.
  const open: Record<SwingKind, SwingLine[]> = { high: [], low: [] };
  let next = 0;
  for (let j = 0; j < count; j++) {
    const c = candles[j];
    for (const kind of ['high', 'low'] as const) {
      const dir = kind === 'high' ? 1 : -1;
      const reach = kind === 'high' ? c.h : c.l;
      const stack = open[kind];
      while (stack.length > 0 && dir * (reach - stack[stack.length - 1].price) > 0) {
        const line = stack.pop()!;
        line.status = dir * (c.c - line.price) > 0 ? 'broken' : 'swept';
        line.endTime = c.t + tfMs;
        line.endIndex = j;
      }
    }
    // Swings confirmed by this candle can be taken from the next one on.
    while (next < lines.length && lines[next].index + n === j) {
      open[lines[next].kind].push(lines[next]);
      next++;
    }
  }
  return lines;
}

/**
 * The sweeps among `lines` (from `swingLines` over the same candles), one per
 * candle and side, oldest first. A candle that wicked through several swing
 * highs at once is one sweep of all of them.
 */
export function findSweeps(lines: readonly SwingLine[], candles: readonly Candle[]): Sweep[] {
  const byCandle = new Map<string, Sweep>();
  for (const line of lines) {
    if (line.status !== 'swept' || line.endIndex == null) continue;
    const key = `${line.kind}:${line.endIndex}`;
    let sweep = byCandle.get(key);
    if (!sweep) {
      const c = candles[line.endIndex];
      sweep = { kind: line.kind, index: line.endIndex, reach: line.kind === 'high' ? c.h : c.l, swings: [] };
      byCandle.set(key, sweep);
    }
    sweep.swings.push(line);
  }
  const sweeps = [...byCandle.values()];
  for (const sweep of sweeps) {
    const dir = sweep.kind === 'high' ? 1 : -1;
    sweep.swings.sort((a, b) => dir * (b.price - a.price));
  }
  return sweeps.sort((a, b) => a.index - b.index || (a.kind === 'high' ? -1 : 1));
}

/**
 * From the last two swing highs and last two swing lows: higher highs and
 * higher lows are UP, lower highs and lower lows DOWN, anything else RANGE.
 * Null until there are two of each.
 */
export function marketMode(swings: readonly Swing[]): Mode | null {
  const last2 = (kind: SwingKind) => swings.filter((s) => s.kind === kind).slice(-2).map((s) => s.price);
  const [h1, h2] = last2('high');
  const [l1, l2] = last2('low');
  if (h2 == null || l2 == null) return null;
  const trend: Trend = h2 > h1 && l2 > l1 ? 'up' : h2 < h1 && l2 < l1 ? 'down' : 'range';
  return { trend, high: h2, low: l2, mid: (h2 + l2) / 2 };
}
