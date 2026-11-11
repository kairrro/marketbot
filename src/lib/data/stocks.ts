// US stocks, indices and futures from Yahoo Finance, and intraday stocks and
// ETFs from Alpaca when its keys are in .env. Neither answers browser requests
// from other sites, so candles come through this app's own server
// (/api/stocks), which also lines them up on UTC boundaries.

import { TF_MS, type Candle, type Timeframe } from '$lib/engine/types';
import { DataError } from './types';

const DAY_MS = 86_400_000;

/** Short names typed in the top bar, for Yahoo symbols that cannot be typed as they are. */
export const STOCK_ALIASES: Record<string, string> = {
  NQ: 'NQ=F',
  // Micro contracts follow the same index, so they use the full-size contract's prices.
  MNQ: 'NQ=F',
  ES: 'ES=F',
  MES: 'ES=F',
  YM: 'YM=F',
  RTY: 'RTY=F',
  GC: 'GC=F',
  CL: 'CL=F',
  NAS100: '^NDX',
  SPX: '^GSPC',
  DJI: '^DJI',
  VIX: '^VIX'
};

/** Suggested in the symbol field, in this order. Any other US ticker can be typed. */
export const STOCK_LIST: readonly { coin: string; name: string }[] = [
  { coin: 'NQ', name: 'Nasdaq 100 futures' },
  { coin: 'MNQ', name: 'Micro Nasdaq 100 futures' },
  { coin: 'ES', name: 'S&P 500 futures' },
  { coin: 'MES', name: 'Micro S&P 500 futures' },
  { coin: 'NAS100', name: 'Nasdaq 100 index' },
  { coin: 'SPX', name: 'S&P 500 index' },
  { coin: 'QQQ', name: 'Nasdaq 100 ETF' },
  { coin: 'SPY', name: 'S&P 500 ETF' },
  { coin: 'YM', name: 'Dow futures' },
  { coin: 'RTY', name: 'Russell 2000 futures' },
  { coin: 'DJI', name: 'Dow Jones index' },
  { coin: 'GC', name: 'Gold futures' },
  { coin: 'CL', name: 'Crude oil futures' },
  { coin: 'NVDA', name: 'Nvidia' },
  { coin: 'TSLA', name: 'Tesla' },
  { coin: 'AAPL', name: 'Apple' },
  { coin: 'MSFT', name: 'Microsoft' },
  { coin: 'AMZN', name: 'Amazon' },
  { coin: 'META', name: 'Meta' },
  { coin: 'GOOGL', name: 'Alphabet' },
  { coin: 'AMD', name: 'AMD' },
  { coin: 'AVGO', name: 'Broadcom' },
  { coin: 'NFLX', name: 'Netflix' },
  { coin: 'PLTR', name: 'Palantir' },
  { coin: 'COIN', name: 'Coinbase' },
  { coin: 'MSTR', name: 'Strategy' },
  { coin: 'HOOD', name: 'Robinhood' }
];

export const yahooSymbol = (coin: string) => STOCK_ALIASES[coin] ?? coin;

/** How far back Yahoo keeps each timeframe (a day short of its limit, to stay clear of it). Alpaca goes back to 2016. */
export const STOCK_HISTORY_MS: Record<Timeframe, number> = {
  '1m': 29 * DAY_MS,
  '5m': 59 * DAY_MS,
  '15m': 59 * DAY_MS,
  '30m': 59 * DAY_MS,
  '1h': 729 * DAY_MS,
  '4h': 729 * DAY_MS,
  '1d': Infinity
};

/** Days loaded before and after the replay time: at least a few hundred candles of context. */
const WINDOW_DAYS: Record<Timeframe, [before: number, after: number]> = {
  '1m': [5, 5],
  '5m': [30, 30],
  '15m': [60, 60],
  '30m': [90, 60],
  '1h': [200, 120],
  '4h': [600, 360],
  '1d': [600, 1500]
};

export function stockWindow(tf: Timeframe, anchor: number, now: number): [from: number, to: number] {
  const [before, after] = WINDOW_DAYS[tf];
  return [anchor - before * DAY_MS, Math.min(now, anchor + after * DAY_MS)];
}

/** The stretch to load after `lastOpen` when the replay runs out of candles. */
export function stockAhead(tf: Timeframe, lastOpen: number, now: number): [from: number, to: number] {
  return [lastOpen + TF_MS[tf], Math.min(now, lastOpen + WINDOW_DAYS[tf][1] * DAY_MS)];
}

async function call<T>(params: Record<string, string | number>): Promise<T> {
  const query = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  const res = await fetch(`/api/stocks?${query}`);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new DataError(body?.message ?? `Stocks request failed (${res.status})`, 'stocks');
  return body as T;
}

export async function fetchStocks(coin: string, tf: Timeframe, from: number, to: number): Promise<Candle[]> {
  const rows = await call<number[][]>({ symbol: coin, tf, from: Math.floor(from), to: Math.floor(to) });
  return rows.map((r) => ({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] }));
}

/** The earliest time `tf` candles can be had for this symbol, from whichever provider serves them. */
export async function stockHistoryStart(coin: string, tf: Timeframe): Promise<number> {
  return (await call<{ start: number }>({ symbol: coin, tf, start: 1 })).start;
}
