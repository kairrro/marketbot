// Replay cursor maths. The cursor is an instant in time ("the market has been
// seen up to here"), not an index — that is what makes switching timeframe
// safe: every timeframe is filtered against the same instant.

import type { Candle } from './types';

/** The instant a candle is fully closed. */
export function closeTime(candle: Candle, tfMs: number): number {
  return candle.t + tfMs;
}

/**
 * How many candles are FULLY CLOSED at `cursorTime`. Candles are sorted by
 * open time, so this is also the index of the first hidden candle.
 *
 * A candle that is still forming at the cursor is never counted: its high,
 * low and close would leak prices from after the cursor.
 */
export function visibleCount(candles: readonly Candle[], tfMs: number, cursorTime: number): number {
  let lo = 0;
  let hi = candles.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (candles[mid].t + tfMs <= cursorTime) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * How far before the cursor the last closed candle may end and still be "at
 * the cursor": room for an exchange outage, not for a different stretch of
 * time. A market that closes (stocks) also gets room for a long weekend.
 */
export function maxLag(tfMs: number, marketCloses = false): number {
  return Math.max(3 * tfMs, marketCloses ? 4 * 86_400_000 : 4 * 3_600_000);
}

/**
 * True when the last of `candles[0..count)` (the ones closed at the cursor)
 * ends at or near the cursor. A session's saved candles can hold several
 * separate stretches of time, one per date replayed. When the cursor falls in
 * a hole between them, the candles before it are from long ago, and showing
 * them would put this timeframe on a different date from the others.
 */
export function reachesCursor(
  candles: readonly Candle[],
  count: number,
  tfMs: number,
  cursorTime: number,
  marketCloses = false
): boolean {
  return count > 0 && closeTime(candles[count - 1], tfMs) >= cursorTime - maxLag(tfMs, marketCloses);
}

/**
 * True when `candles` hold the `context` candles leading up to the cursor in
 * one unbroken stretch (outage-sized gaps aside). Counting the candles before
 * the cursor is not enough: they may belong to an older stretch.
 */
export function coversCursor(
  candles: readonly Candle[],
  tfMs: number,
  cursorTime: number,
  context: number,
  marketCloses = false
): boolean {
  const count = visibleCount(candles, tfMs, cursorTime);
  if (count < Math.max(1, context) || !reachesCursor(candles, count, tfMs, cursorTime, marketCloses)) return false;
  for (let i = count - context + 1; i < count; i++) {
    if (candles[i].t - candles[i - 1].t > maxLag(tfMs, marketCloses)) return false;
  }
  return true;
}

/**
 * Where a fresh replay starts: at `startMs` if given, otherwise
 * `defaultCount` candles in. Always leaves at least one candle visible, and
 * (when there is no start date) at least one candle left to step into.
 */
export function initialCount(
  candles: readonly Candle[],
  tfMs: number,
  startMs: number | null,
  defaultCount = 300
): number {
  if (candles.length === 0) return 0;
  if (startMs != null) return Math.max(1, visibleCount(candles, tfMs, startMs));
  return Math.max(1, Math.min(defaultCount, candles.length - 1));
}

export interface Advance {
  cursorTime: number;
  /** True when the revealed candle began before the cursor (after a timeframe switch). */
  overlap: boolean;
}

/** Moves the cursor forward over `candle`. The cursor never goes backwards. */
export function advance(cursorTime: number, candle: Candle, tfMs: number): Advance {
  return {
    cursorTime: Math.max(cursorTime, closeTime(candle, tfMs)),
    overlap: candle.t < cursorTime
  };
}

/**
 * The price at the cursor after candles have been (re)loaded.
 *
 * `known` is the price already established for this market at this cursor, if
 * any. It wins whenever the chart is behind the cursor: on a higher timeframe
 * the last closed candle may have ended long before the cursor, and its close
 * is an older price. Open P&L, entries and manual exits all use this value, so
 * they are the same on every timeframe.
 */
export function priceAtCursor(lastVisible: Candle, tfMs: number, cursorTime: number, known: number | null): number {
  const behindCursor = closeTime(lastVisible, tfMs) < cursorTime;
  return behindCursor && known != null ? known : lastVisible.c;
}

/** Lower-timeframe candles that a forming candle can be built from. */
export interface FineCandles {
  candles: readonly Candle[];
  tfMs: number;
}

/**
 * The candle still forming at `cursorTime` on a timeframe of `tfMs`: what the
 * exchange's candle looked like at that instant, built from lower-timeframe
 * candles that have closed by then. Nothing after the cursor is read.
 *
 * Null when the cursor sits on a candle boundary (nothing has formed yet) or
 * no source covers the forming candle's open. Of several sources, the one
 * reaching closest to the cursor wins (5m data reaches 10:35 where 15m stops
 * at 10:30); a tie goes to the one given first.
 */
export function formingCandle(sources: readonly FineCandles[], tfMs: number, cursorTime: number): Candle | null {
  const open = Math.floor(cursorTime / tfMs) * tfMs;
  if (open === cursorTime) return null;

  let best: Candle | null = null;
  let bestUntil = open;
  for (const { candles, tfMs: fineMs } of sources) {
    if (fineMs >= tfMs || candles.length === 0 || candles[0].t > open) continue;

    // First candle at or after the open.
    let lo = 0;
    let hi = candles.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (candles[mid].t < open) lo = mid + 1;
      else hi = mid;
    }

    // It has to start at the open: after a hole in the saved candles the first
    // one found would belong to some other stretch of time.
    if (lo >= candles.length || candles[lo].t !== open) continue;

    let built: Candle | null = null;
    let until = open;
    for (let i = lo; i < candles.length && candles[i].t + fineMs <= cursorTime; i++) {
      const c = candles[i];
      if (c.t !== until) break;
      built = built
        ? { t: open, o: built.o, h: Math.max(built.h, c.h), l: Math.min(built.l, c.l), c: c.c, v: built.v + c.v }
        : { ...c, t: open };
      until = c.t + fineMs;
    }
    if (built && until > bestUntil) {
      best = built;
      bestUntil = until;
    }
  }
  return best;
}

/**
 * Open time of the candle that an event at `instant` belongs to. Events happen
 * at a candle's close, so the instant itself is the NEXT candle's open — hence
 * the `- 1`.
 */
export function bucketOpen(instant: number, tfMs: number): number {
  return Math.floor((instant - 1) / tfMs) * tfMs;
}
