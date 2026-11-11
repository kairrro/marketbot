// Shared domain types for the backtester. Pure data — no DOM, no fetch.

export type Side = 'long' | 'short';

export type Timeframe = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d';

export const TIMEFRAMES: readonly Timeframe[] = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'];

export const TF_MS: Record<Timeframe, number> = {
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '30m': 1_800_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
  '1d': 86_400_000
};

/** How a timeframe is written in the UI. The ids above are what the exchanges expect. */
export const TF_LABEL: Record<Timeframe, string> = {
  '1m': '1m',
  '5m': '5m',
  '15m': '15m',
  '30m': '30m',
  '1h': '1h',
  '4h': '4h',
  '1d': '1D'
};

/** OHLCV candle. `t` is the candle's OPEN time, ms since epoch (UTC). */
export interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}
