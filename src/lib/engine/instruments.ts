// Futures the replay trades in whole contracts. The candles come from the
// Stocks source; a micro contract follows the same index as its full-size one,
// so it uses the same prices and only differs in what a point is worth.

import { fmtQty } from '$lib/format';

export interface Futures {
  /** The name typed in the top bar. */
  symbol: string;
  name: string;
  /** $ one contract gains or loses per 1.00 of price. */
  pointValue: number;
  /** A micro contract, which costs a fraction of the full-size one to trade. */
  micro: boolean;
  /** The smallest price move. Stops and targets sit on it. */
  tick: number;
  /** Stop sizes, in points, offered as one-click choices for a scalp on the 1m chart. */
  stops: readonly number[];
  /** The stop a new trade starts with, in points, until another is picked. */
  defaultStop: number;
}

const NQ_STOPS = [10, 15, 20, 30] as const;
const ES_STOPS = [3, 4, 6, 8] as const;

export const FUTURES: readonly Futures[] = [
  { symbol: 'NQ', name: 'Nasdaq 100 futures', pointValue: 20, micro: false, tick: 0.25, stops: NQ_STOPS, defaultStop: 15 },
  { symbol: 'MNQ', name: 'Micro Nasdaq 100 futures', pointValue: 2, micro: true, tick: 0.25, stops: NQ_STOPS, defaultStop: 15 },
  { symbol: 'ES', name: 'S&P 500 futures', pointValue: 50, micro: false, tick: 0.25, stops: ES_STOPS, defaultStop: 4 },
  { symbol: 'MES', name: 'Micro S&P 500 futures', pointValue: 5, micro: true, tick: 0.25, stops: ES_STOPS, defaultStop: 4 },
  { symbol: 'YM', name: 'Dow futures', pointValue: 5, micro: false, tick: 1, stops: [20, 30, 40, 60], defaultStop: 30 },
  { symbol: 'RTY', name: 'Russell 2000 futures', pointValue: 50, micro: false, tick: 0.1, stops: [4, 6, 8, 12], defaultStop: 6 },
  { symbol: 'GC', name: 'Gold futures', pointValue: 100, micro: false, tick: 0.1, stops: [2, 3, 5, 8], defaultStop: 3 },
  { symbol: 'CL', name: 'Crude oil futures', pointValue: 1000, micro: false, tick: 0.01, stops: [0.1, 0.15, 0.2, 0.3], defaultStop: 0.15 }
];

/** A price moved onto the nearest tick, with float noise removed. */
export function snapToTick(price: number, tick: number): number {
  const decimals = (String(tick).split('.')[1] ?? '').length;
  return Number((Math.round(price / tick) * tick).toFixed(decimals));
}

/** The futures contract a market is, or null for crypto, stocks and indices. */
export function futuresFor(source: string | undefined, coin: string | undefined): Futures | null {
  if (source !== 'stocks' || !coin) return null;
  return FUTURES.find((future) => future.symbol === coin) ?? null;
}

/** "3 contracts" for futures, "0.333 SOL" for anything else. */
export function fmtSize(qty: number, coin: string, contracts: boolean): string {
  if (!contracts) return `${fmtQty(qty)} ${coin}`;
  const count = Math.round(qty);
  return `${count} ${count === 1 ? 'contract' : 'contracts'}`;
}
