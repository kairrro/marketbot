import { TF_MS, type Candle, type Timeframe } from '$lib/engine/types';
import { DataError } from './types';

const KLINES_URL = 'https://data-api.binance.vision/api/v3/klines';
const PAGE_SIZE = 1000;

export const BINANCE_DEFAULT_COUNT = 8000;

// [openTime, open, high, low, close, volume, closeTime, ...]
type Kline = [number, string, string, string, string, string, ...unknown[]];

/** Open time of the first daily candle Binance has for this coin. */
export async function binanceListedAt(coin: string): Promise<number> {
  const symbol = `${coin.toUpperCase()}USDT`;
  const res = await fetch(`${KLINES_URL}?symbol=${encodeURIComponent(symbol)}&interval=1d&startTime=0&limit=1`);
  if (!res.ok) throw new DataError(`Binance returned ${res.status} (is ${symbol} listed on Binance spot?)`, 'binance');
  const rows: unknown = await res.json();
  if (!Array.isArray(rows) || !Array.isArray(rows[0])) throw new DataError(`No Binance history for ${symbol}`, 'binance');
  return Number(rows[0][0]);
}

/** Binance spot klines, paginated forward from `startMs` up to about `count` candles. */
export async function fetchBinance(
  coin: string,
  tf: Timeframe,
  startMs: number,
  count = BINANCE_DEFAULT_COUNT
): Promise<Candle[]> {
  const symbol = `${coin.toUpperCase()}USDT`;
  const candles: Candle[] = [];
  let from = Math.max(0, Math.floor(startMs));

  while (candles.length < count) {
    const url = `${KLINES_URL}?symbol=${encodeURIComponent(symbol)}&interval=${tf}&startTime=${from}&limit=${PAGE_SIZE}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new DataError(`Binance returned ${res.status} (is ${symbol} listed on Binance spot?)`, 'binance');
    }

    const page: unknown = await res.json();
    if (!Array.isArray(page)) throw new DataError('Unexpected Binance response', 'binance');
    const rows = page as Kline[];
    if (rows.length === 0) break;

    for (const row of rows) {
      candles.push({ t: row[0], o: +row[1], h: +row[2], l: +row[3], c: +row[4], v: +row[5] });
    }
    from = rows[rows.length - 1][0] + TF_MS[tf];
    if (rows.length < PAGE_SIZE) break;
  }

  return candles;
}
