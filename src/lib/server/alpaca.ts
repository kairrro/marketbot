// US stock and ETF candles from Alpaca's market data API: intraday history back
// to 2016, where Yahoo keeps 60 days. Needs a free Alpaca account, with its
// keys in .env as ALPACA_KEY_ID and ALPACA_SECRET_KEY. The free plan serves
// full-market (SIP) bars as long as they ended at least 15 minutes ago.
//
// Alpaca's bars include pre- and post-market trading. Only regular hours
// (9:30–16:00 New York) are kept, so the candles match Yahoo's.

import { env } from '$env/dynamic/private';
import type { Candle } from '$lib/engine/types';
import { offsetMinutes } from '$lib/timezone';
import { StockError } from './stockError';

const BARS_URL = 'https://data.alpaca.markets/v2/stocks/bars';
/** Where Alpaca's history begins. */
export const ALPACA_START = Date.UTC(2016, 0, 1);
/** The free plan refuses bars from the last 15 minutes; a minute of margin. */
export const ALPACA_DELAY_MS = 16 * 60_000;
const PAGE_SIZE = 10_000;
const MAX_PAGES = 20;
const OPEN_MINUTE = 9 * 60 + 30;
const CLOSE_MINUTE = 16 * 60;

interface AlpacaBar {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export const alpacaReady = () => Boolean(env.ALPACA_KEY_ID && env.ALPACA_SECRET_KEY);

/** True for a bar that opened in New York's regular session. */
function regularHours(t: number): boolean {
  const minute = Math.floor((t + offsetMinutes(t, 'America/New_York') * 60_000) / 60_000) % 1440;
  return minute >= OPEN_MINUTE && minute < CLOSE_MINUTE;
}

/** Regular-hours bars of `minutes` length that open from `from` up to `to`, split-adjusted. */
export async function alpacaBars(symbol: string, minutes: number, from: number, to: number): Promise<Candle[]> {
  const out: Candle[] = [];
  let pageToken: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const query = new URLSearchParams({
      symbols: symbol,
      timeframe: `${minutes}Min`,
      start: new Date(from).toISOString(),
      // `end` is inclusive.
      end: new Date(to - 1).toISOString(),
      limit: String(PAGE_SIZE),
      adjustment: 'split',
      feed: 'sip',
      sort: 'asc'
    });
    if (pageToken) query.set('page_token', pageToken);

    let res: Response;
    try {
      res = await fetch(`${BARS_URL}?${query}`, {
        headers: { 'APCA-API-KEY-ID': env.ALPACA_KEY_ID ?? '', 'APCA-API-SECRET-KEY': env.ALPACA_SECRET_KEY ?? '' }
      });
    } catch (err) {
      throw new StockError(`Could not reach Alpaca: ${err instanceof Error ? err.message : err}`);
    }
    if (res.status === 401 || res.status === 403) {
      throw new StockError('Alpaca turned down the keys in .env (ALPACA_KEY_ID, ALPACA_SECRET_KEY).');
    }
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new StockError(body?.message ?? `Alpaca returned ${res.status}`);

    for (const bar of (body?.bars?.[symbol] ?? []) as AlpacaBar[]) {
      const t = Date.parse(bar.t);
      if (regularHours(t)) out.push({ t, o: bar.o, h: bar.h, l: bar.l, c: bar.c, v: bar.v });
    }
    pageToken = body?.next_page_token ?? null;
    if (!pageToken) break;
  }
  return out;
}
