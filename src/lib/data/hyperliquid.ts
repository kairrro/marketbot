import { TF_MS, type Candle, type Timeframe } from '$lib/engine/types';
import { DataError } from './types';

const INFO_URL = 'https://api.hyperliquid.xyz/info';

/** Hyperliquid only keeps (and returns) roughly this many candles per interval. */
export const HL_MAX_CANDLES = 5000;

interface HlCandle {
  t: number;
  o: string;
  h: string;
  l: string;
  c: string;
  v: string;
}

/** The most recent ~5000 candles for a Hyperliquid perp. */
export async function fetchHyperliquid(coin: string, tf: Timeframe, now = Date.now()): Promise<Candle[]> {
  const res = await fetch(INFO_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'candleSnapshot',
      req: { coin, interval: tf, startTime: now - HL_MAX_CANDLES * TF_MS[tf], endTime: now }
    })
  });
  if (!res.ok) {
    throw new DataError(`Hyperliquid returned ${res.status} (is ${coin} listed there?)`, 'hyperliquid');
  }

  const json: unknown = await res.json();
  if (!Array.isArray(json)) throw new DataError('Unexpected Hyperliquid response', 'hyperliquid');

  return (json as HlCandle[]).map((row) => ({
    t: row.t,
    o: +row.o,
    h: +row.h,
    l: +row.l,
    c: +row.c,
    v: +row.v
  }));
}
