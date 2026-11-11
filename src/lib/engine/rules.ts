// Sizing and rule checks for a trade that has not been placed yet.

import { roundTo } from '$lib/format';
import { sizePosition, type Contract } from './trade';
import type { Side } from './types';

export const DEFAULT_STOP_PCT = 1;
/** Where a new position's target starts, in R. Only a starting point: any target is allowed. */
export const TARGET_R = 1;
/** The time rule: a trade not at +1R within this long (candle time) should be closed. */
export const TIME_RULE_MS = 3_600_000;

export interface PlanMetrics {
  /** Entry-to-stop distance in price terms (1R). */
  dist: number;
  stopPct: number;
  targetPct: number;
  /** Reward:risk of the target. */
  rr: number;
  /** What the position risks: with whole contracts, what they risk, which is at most what was asked. */
  riskUsd: number;
  /** Position size in coin units, or in whole contracts. */
  qty: number;
  /** Position size in $. */
  notional: number;
  /** Entry fee plus a taker exit (a stop or closing by hand), both charged on the entry notional. For futures, a commission in and out. */
  feesUsd: number;
  feesR: number;
}

export interface RuleWarning {
  code: 'min-stop';
  message: string;
}

/**
 * `feePct` is the taker fee; `entryFeePct` the fee on the entry, when it is not a market order.
 * With a futures `contract` the size is whole contracts and the fee is its commission in and out.
 */
export function planMetrics(
  entry: number,
  stop: number,
  target: number,
  riskUsd: number,
  feePct = 0,
  entryFeePct = feePct,
  contract: Contract | null = null
): PlanMetrics {
  const dist = Math.abs(entry - stop);
  const sized = sizePosition(entry, stop, riskUsd, contract);
  const qty = sized.qty;
  const feesUsd = contract ? qty * contract.commission * 2 : (qty * entry * (feePct + entryFeePct)) / 100;
  return {
    dist,
    stopPct: (dist / entry) * 100,
    targetPct: (Math.abs(target - entry) / entry) * 100,
    rr: dist > 0 ? Math.abs(target - entry) / dist : 0,
    riskUsd: sized.riskUsd,
    qty,
    notional: qty * entry * (contract?.multiplier ?? 1),
    feesUsd,
    feesR: sized.riskUsd > 0 ? feesUsd / sized.riskUsd : 0
  };
}

/** Compared at display precision, so a 0.50% stop is not flagged as "under 0.5%". */
export function stopTooTight(stopPct: number, minStopPct: number): boolean {
  return Number(stopPct.toFixed(2)) < minStopPct;
}

export function tightStopMessage(stopPct: number, minStopPct: number): string {
  return `Stop is only ${stopPct.toFixed(2)}% (min ${minStopPct}%).`;
}

/** Non-blocking warnings: the trade can still be placed. There is no rule on the target's R:R. */
export function planWarnings(metrics: PlanMetrics, minStopPct: number): RuleWarning[] {
  const warnings: RuleWarning[] = [];
  if (stopTooTight(metrics.stopPct, minStopPct)) {
    warnings.push({ code: 'min-stop', message: tightStopMessage(metrics.stopPct, minStopPct) });
  }
  return warnings;
}

/**
 * The price `r` R beyond entry, for a given stop. With `precision` it is
 * rounded to the market's tick.
 */
export function targetAt(side: Side, entry: number, stop: number, r = TARGET_R, precision?: number): number {
  const dir = side === 'long' ? 1 : -1;
  const target = entry + dir * r * Math.abs(entry - stop);
  return precision == null ? target : roundTo(target, precision);
}

/**
 * Default stop and target for a new position: stop 1% away (or `stopDist` away), target at 1R.
 *
 * With `precision` both are on the market's tick. The target is measured from
 * the stop AFTER rounding — rounding the two independently can leave the
 * default plan a tick off 1R.
 */
export function defaultPlan(
  side: Side,
  entry: number,
  precision?: number,
  /** A fixed stop distance in price terms (futures: points), instead of 1% of the entry. */
  stopDist?: number
): { stop: number; target: number } {
  const dir = side === 'long' ? 1 : -1;
  const raw = entry - (stopDist != null ? dir * stopDist : (dir * entry * DEFAULT_STOP_PCT) / 100);
  const rounded = precision == null ? raw : roundTo(raw, precision);
  // Rounding must never collapse the stop onto the entry.
  const stop = rounded === entry ? raw : rounded;
  return { stop, target: targetAt(side, entry, stop, TARGET_R, precision) };
}
