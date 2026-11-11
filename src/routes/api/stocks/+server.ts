import { json } from '@sveltejs/kit';
import { TIMEFRAMES, type Timeframe } from '$lib/engine/types';
import { stockCandles, StockError, stockHistoryStart } from '$lib/server/stocks';

// Stock candles for the backtester, fetched from Yahoo (or Alpaca) on the browser's behalf.
// GET ?symbol=NQ&tf=5m&from=<ms>&to=<ms>  ->  [[t, o, h, l, c, v], ...]
// GET ?symbol=NQ&tf=5m&start=1            ->  { start }: the earliest time candles can be had
export async function GET({ url }) {
  const coin = (url.searchParams.get('symbol') ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9.^=-]{1,15}$/.test(coin)) {
    return json({ message: 'A stock symbol is required.' }, { status: 400 });
  }
  const tf = url.searchParams.get('tf') as Timeframe;
  if (!TIMEFRAMES.includes(tf)) return json({ message: 'A timeframe is required.' }, { status: 400 });

  try {
    if (url.searchParams.has('start')) return json({ start: await stockHistoryStart(coin, tf) });

    const from = Number(url.searchParams.get('from'));
    const to = Number(url.searchParams.get('to'));
    if (!Number.isFinite(from) || !Number.isFinite(to)) {
      return json({ message: 'from and to are required.' }, { status: 400 });
    }
    const candles = await stockCandles(coin, tf, from, to);
    return json(candles.map((c) => [c.t, c.o, c.h, c.l, c.c, c.v]));
  } catch (err) {
    const status = err instanceof StockError ? err.status : 502;
    return json({ message: err instanceof Error ? err.message : String(err) }, { status });
  }
}
