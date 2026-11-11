// How big a swing to expect after an event. This is a SIZE, never a direction: the
// typical high-to-low range in the hour after, as a share of price, and how many
// times a normal hour that is. The numbers come from the past-data test (NQ and
// GC 2023 to 2026, CL the last two months) and are refreshed when the rules are
// tuned.

import { exposureOf } from './profiles';
import type { Exposure, Impact } from './types';

export interface Swing {
  /** Typical high-to-low range in the hour after, % of price. */
  pct: number;
  /** How many times the usual range for that hour of the day. */
  ratio: number;
}

const s = (pct: number, ratio: number): Swing => ({ pct, ratio });

/** The market a profile's numbers were measured on, for each exposure. */
const MEASURED_ON: Record<Exposure, 'NQ' | 'GC' | 'CL'> = { index: 'NQ', gold: 'GC', oil: 'CL' };

/** Per kind of event and market. Only pairs with enough past events are listed. */
const BY_FAMILY: Record<string, Partial<Record<'NQ' | 'GC' | 'CL', Swing>>> = {
  'fomc-decision': { NQ: s(0.96, 3.1), GC: s(1.33, 7.7) },
  cpi: { NQ: s(1.03, 3.5), GC: s(0.94, 2.0) },
  nfp: { NQ: s(0.75, 2.5), GC: s(1.1, 2.5) },
  ppi: { NQ: s(0.52, 1.7), GC: s(0.61, 1.3) },
  pce: { NQ: s(0.46, 1.5) },
  gdp: { NQ: s(0.56, 1.8) },
  'retail-sales': { NQ: s(0.41, 1.4) },
  'eia-crude': { CL: s(1.39, 1.1) }
};

/** A report from one of the big stocks, measured on NQ, by company. */
export const EARNINGS_SWING: Record<string, Swing> = {
  NVDA: s(1.17, 9.0),
  META: s(1.01, 7.7),
  AMZN: s(0.58, 4.4),
  AAPL: s(0.52, 4.0),
  GOOGL: s(0.49, 3.7),
  GOOG: s(0.49, 3.7),
  MSFT: s(0.5, 4.0),
  AVGO: s(0.31, 2.4),
  TSLA: s(0.29, 2.2)
};

/** The open after a report (busier than normal only for NVDA). */
export const EARNINGS_OPEN_SWING: Record<string, Swing> = { NVDA: s(1.35, 1.9) };

/**
 * Fallback by rating, when a kind of event has no numbers of its own. Oil is
 * scaled from NQ and GC (oil usually ranges about 1.1% an hour, and the free
 * data holds too few oil events to measure it directly).
 */
const BY_TIER: Record<'NQ' | 'GC' | 'CL', Partial<Record<Impact, Swing>>> = {
  NQ: { medium: s(0.54, 1.6), high: s(0.81, 3.1) },
  GC: { medium: s(0.61, 1.3), high: s(1.1, 2.5) },
  CL: { medium: s(1.55, 1.5), high: s(3.0, 2.8) }
};

const representative = (symbol: string) => MEASURED_ON[exposureOf(symbol)];

/** The swing for a kind of event on a market, or null when there are no past numbers (or it is Low). */
export function swingFor(family: string, symbol: string, tier: Impact): Swing | null {
  if (tier === 'low') return null;
  const asset = representative(symbol);
  return BY_FAMILY[family]?.[asset] ?? BY_TIER[asset][tier] ?? null;
}

/** The swing for a rated headline, by impact. Low gets none. */
export function swingForImpact(impact: Impact, symbol: string): Swing | null {
  if (impact === 'low') return null;
  return BY_TIER[representative(symbol)][impact] ?? null;
}

const round = (v: number, step: number) => Math.round(v / step) * step;

/** "3× a normal hour", or "about a normal hour" when it is barely more. */
export function fmtRatio(ratio: number): string {
  if (ratio < 1.25) return 'about a normal hour';
  return `${round(ratio, ratio < 5 ? 0.5 : 1).toFixed(ratio < 5 && round(ratio, 0.5) % 1 !== 0 ? 1 : 0)}× a normal hour`;
}

/** "1.0%". */
export const fmtPct = (pct: number): string => `${pct >= 10 ? pct.toFixed(0) : pct.toFixed(1)}%`;

/** The swing in the market's own units: NQ points, dollars for gold and oil. */
export function fmtSize(symbol: string, pct: number, price: number | undefined): string {
  if (!price || !(price > 0)) return '';
  const size = (pct / 100) * price;
  if (exposureOf(symbol) === 'index') return `≈ ${Math.round(size / 5) * 5 || Math.round(size)} pts`;
  return size >= 10 ? `≈ $${Math.round(size)}` : `≈ $${size.toFixed(2)}`;
}
