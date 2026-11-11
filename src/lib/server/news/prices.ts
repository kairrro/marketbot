// Past prices for the past-data test. Free sources only: 1-minute candles already
// saved on this machine (the Databento cache the backtester fills; nothing is ever
// downloaded from it here), and Yahoo's 5-minute candles for the last 59 days.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { yahooSymbol } from '$lib/data/stocks';
import type { Candle } from '$lib/engine/types';
import { getJson } from './http';

const CACHE_DIR = join(dirname(process.env.DB_PATH ?? './data/market-bot.db'), 'databento');

/** UTC dates (YYYY-MM-DD) with 1-minute candles saved for `coin`. */
export function cachedMinuteDates(coin: string): string[] {
  if (!existsSync(CACHE_DIR)) return [];
  const prefix = `${coin}-ohlcv-1m-`;
  return readdirSync(CACHE_DIR)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.json'))
    .map((f) => f.slice(prefix.length, -5))
    .sort();
}

/** One UTC day of 1-minute candles from the saved files, or none. */
export function readMinuteDay(coin: string, utcDate: string): Candle[] {
  try {
    const rows = JSON.parse(readFileSync(join(CACHE_DIR, `${coin}-ohlcv-1m-${utcDate}.json`), 'utf8')) as number[][];
    return rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }));
  } catch {
    return [];
  }
}

interface YahooChart {
  chart?: {
    result?: {
      timestamp?: number[];
      indicators?: { quote?: { open?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[]; close?: (number | null)[]; volume?: (number | null)[] }[] };
    }[];
  };
}

/** The last ~58 days of 5-minute candles for `coin`, straight from Yahoo (free). Empty if Yahoo does not answer. */
export async function yahooFiveMinute(coin: string, now = Date.now()): Promise<Candle[]> {
  const to = Math.floor(now / 1000);
  const from = Math.floor((now - 58 * 86_400_000) / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol(coin))}?interval=5m&period1=${from}&period2=${to}&includePrePost=false`;
  try {
    const body = await getJson<YahooChart>(url, { ttlMs: 6 * 3_600_000 });
    const r = body.chart?.result?.[0];
    const q = r?.indicators?.quote?.[0];
    if (!r?.timestamp || !q) return [];
    const out: Candle[] = [];
    for (let i = 0; i < r.timestamp.length; i++) {
      const [o, h, l, c] = [q.open?.[i], q.high?.[i], q.low?.[i], q.close?.[i]];
      if (o == null || h == null || l == null || c == null) continue;
      const t = r.timestamp[i] * 1000;
      // The bar still forming is not a closed candle.
      if (t + 300_000 > now) continue;
      out.push({ t, o, h, l, c, v: q.volume?.[i] ?? 0 });
    }
    return out;
  } catch {
    return [];
  }
}
