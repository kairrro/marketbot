// What a journaled trade's candles say beyond its own result: how far price
// went for and against it while it was open (MFE / MAE), and how it would
// have done with a fixed take profit at other R multiples, from the same entry
// and initial stop. Within a candle the stop is assumed to come first, as the
// trade engine does.

import type { TradeRecord } from './journal';
import { maxLag, visibleCount } from './replay';
import type { Candle } from './types';

export const WHAT_IF_TARGETS = [0.5, 1, 1.5, 2] as const;

/** Candles from the entry on are cut here, so one trade cannot hold up the rest. */
const MAX_AFTER = 3000;

type TradeShape = Pick<TradeRecord, 'side' | 'entry' | 'stop' | 'entryTime' | 'exitTime'>;

export interface Excursion {
  /** Furthest price went in the trade's favour while it was open, in R. */
  mfe: number;
  /** Furthest it went against it, in R. */
  mae: number;
}

/**
 * Before fees. `time`: closed by the 1-hour rule. `open`: neither stop nor
 * target by the last candle held, counted at that candle's close.
 */
export interface Outcome {
  kind: 'target' | 'stop' | 'time' | 'open';
  r: number;
}

export interface TradeWhatIf {
  excursion: Excursion | null;
  /** One per WHAT_IF_TARGETS. Empty when there are no candles after the entry. */
  outcomes: Outcome[];
}

/**
 * Candles that closed after `entryTime` and by `until`, in one unbroken
 * stretch: saved candles can jump to another date replayed later.
 */
export function candlesAfterEntry(
  candles: readonly Candle[],
  tfMs: number,
  entryTime: number,
  until: number,
  marketCloses = false
): Candle[] {
  const out: Candle[] = [];
  let previous = entryTime - tfMs;
  for (let i = visibleCount(candles, tfMs, entryTime); i < candles.length && out.length < MAX_AFTER; i++) {
    const c = candles[i];
    if (c.t + tfMs > until || c.t - previous > maxLag(tfMs, marketCloses)) break;
    out.push(c);
    previous = c.t;
  }
  return out;
}

const shape = (trade: TradeShape) => {
  const dir = trade.side === 'long' ? 1 : -1;
  const risk = Math.abs(trade.entry - trade.stop);
  return { dir, risk, r: (price: number) => (dir * (price - trade.entry)) / risk };
};

/**
 * What would have happened had the trade been held instead of closed by hand:
 * the first of the target or the initial stop that the candles opened at or
 * after the exit reach. The stop wins when a candle touches both. 'unknown'
 * when there are no such candles, or neither was reached by the last one.
 */
export function heldOutcome(
  trade: Pick<TradeRecord, 'side' | 'stop' | 'target' | 'exitTime'>,
  after: readonly Candle[]
): 'target' | 'stop' | 'unknown' {
  const dir = trade.side === 'long' ? 1 : -1;
  for (const c of after) {
    if (c.t < trade.exitTime) continue;
    if (dir * ((dir > 0 ? c.l : c.h) - trade.stop) <= 0) return 'stop';
    if (dir * ((dir > 0 ? c.h : c.l) - trade.target) >= 0) return 'target';
  }
  return 'unknown';
}

/** MFE and MAE over the candles that opened before the trade's exit. */
export function excursion(trade: TradeShape, after: readonly Candle[]): Excursion | null {
  const { dir, risk, r } = shape(trade);
  if (!(risk > 0)) return null;
  let mfe = 0;
  let mae = 0;
  let seen = false;
  for (const c of after) {
    if (c.t >= trade.exitTime) break;
    seen = true;
    mfe = Math.max(mfe, r(dir > 0 ? c.h : c.l));
    mae = Math.max(mae, -r(dir > 0 ? c.l : c.h));
  }
  return seen ? { mfe, mae } : null;
}

/**
 * The trade again with a take profit at `targetR`. With `timeRuleMs`, a trade
 * that has not touched +1R by then is closed at that candle's close.
 */
export function simulateTarget(
  trade: TradeShape,
  after: readonly Candle[],
  tfMs: number,
  targetR: number,
  timeRuleMs: number | null
): Outcome | null {
  const { dir, risk, r } = shape(trade);
  if (!(risk > 0) || after.length === 0) return null;
  const target = trade.entry + dir * targetR * risk;
  let reached1R = false;
  for (const c of after) {
    const worst = dir > 0 ? c.l : c.h;
    const best = dir > 0 ? c.h : c.l;
    // A gap through the stop fills at the open.
    if (dir * (worst - trade.stop) <= 0) {
      return { kind: 'stop', r: r(dir > 0 ? Math.min(trade.stop, c.o) : Math.max(trade.stop, c.o)) };
    }
    if (dir * (best - target) >= 0) return { kind: 'target', r: targetR };
    // The epsilon keeps a touch of exactly +1R from reading as 0.9999…R.
    if (r(best) >= 1 - 1e-9) reached1R = true;
    if (timeRuleMs != null && !reached1R && c.t + tfMs >= trade.entryTime + timeRuleMs) {
      return { kind: 'time', r: r(c.c) };
    }
  }
  return { kind: 'open', r: r(after[after.length - 1].c) };
}

export function tradeWhatIf(
  trade: TradeShape,
  after: readonly Candle[],
  tfMs: number,
  timeRuleMs: number | null
): TradeWhatIf {
  const outcomes = WHAT_IF_TARGETS.map((target) => simulateTarget(trade, after, tfMs, target, timeRuleMs));
  return {
    excursion: excursion(trade, after),
    outcomes: outcomes.every((o) => o != null) ? outcomes : []
  };
}

export interface WhatIfRow {
  targetR: number;
  trades: number;
  /** 0–100, after fees. */
  winRate: number | null;
  totalR: number;
  avgR: number | null;
  /** Still open at the last candle held (counted at its close). */
  open: number;
}

/** One row per target, after each trade's own fees in R. Trades without candles are left out. */
export function whatIfRows(items: readonly { whatIf: TradeWhatIf; feesR: number }[]): WhatIfRow[] {
  const known = items.filter((item) => item.whatIf.outcomes.length > 0);
  return WHAT_IF_TARGETS.map((targetR, i) => {
    const rs = known.map((item) => item.whatIf.outcomes[i].r - item.feesR);
    const totalR = rs.reduce((total, r) => total + r, 0);
    return {
      targetR,
      trades: rs.length,
      winRate: rs.length ? (rs.filter((r) => r > 0).length / rs.length) * 100 : null,
      totalR,
      avgR: rs.length ? totalR / rs.length : null,
      open: known.filter((item) => item.whatIf.outcomes[i].kind === 'open').length
    };
  });
}
