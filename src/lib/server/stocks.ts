// Candles for US stocks, indices and futures, from Yahoo Finance's chart API
// and, for intraday stocks and ETFs when its keys are set, from Alpaca.
//
// Yahoo keeps 1m for 30 days, 5m–30m for 60 days, hourly for two years and
// daily for everything; Alpaca has intraday stocks and ETFs back to 2016, but
// no futures or indices. Everything is put on UTC boundaries like the crypto
// sources. Stock hours start at :30 (the 9:30 open), so hourly candles are
// built from 30m ones where those exist; Yahoo's older hours are moved to the
// next whole hour — later, never earlier, so no candle closes before the
// prices in it happened.

import { DATABENTO_START, isDatabentoFuture } from '$lib/data/databentoBars';
import { STOCK_ALIASES, STOCK_HISTORY_MS, yahooSymbol } from '$lib/data/stocks';
import { TF_LABEL, TF_MS, type Candle, type Timeframe } from '$lib/engine/types';
import { ALPACA_DELAY_MS, ALPACA_START, alpacaBars, alpacaReady } from './alpaca';
import { databentoBars, databentoReady } from './databento';
import { StockError } from './stockError';

export { StockError } from './stockError';

const CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart/';
const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
/** Yahoo serves at most 8 days of 1m candles per request. */
const ONE_MINUTE_CHUNK_MS = 7 * DAY_MS;

type Interval = '1m' | '5m' | '15m' | '30m' | '60m' | '1d';

const INTERVAL_MS: Record<Interval, number> = {
  '1m': MINUTE_MS,
  '5m': 5 * MINUTE_MS,
  '15m': 15 * MINUTE_MS,
  '30m': 30 * MINUTE_MS,
  '60m': HOUR_MS,
  '1d': DAY_MS
};

type Series = (number | null)[];

interface ChartResult {
  meta?: { regularMarketTime?: number; firstTradeDate?: number };
  timestamp?: number[];
  indicators?: { quote?: { open?: Series; high?: Series; low?: Series; close?: Series; volume?: Series }[] };
}

async function chart(symbol: string, interval: Interval, from: number, to: number): Promise<ChartResult> {
  const query = `interval=${interval}&period1=${Math.floor(from / 1000)}&period2=${Math.ceil(to / 1000)}&includePrePost=false`;
  let res: Response;
  try {
    res = await fetch(`${CHART_URL}${encodeURIComponent(symbol)}?${query}`);
  } catch (err) {
    throw new StockError(`Could not reach Yahoo: ${err instanceof Error ? err.message : err}`);
  }
  const body = await res.json().catch(() => null);
  const result: ChartResult | undefined = body?.chart?.result?.[0];
  if (res.ok && result) return result;
  const reason: string = body?.chart?.error?.description ?? `Yahoo returned ${res.status}`;
  throw new StockError(res.status === 404 ? `${symbol}: ${reason}` : reason, res.status === 404 ? 404 : 502);
}

/**
 * Yahoo's candles from `from` up to `to`, without empty rows. For intraday
 * intervals the row Yahoo adds for the latest quote, and the candle still
 * forming, are dropped too.
 */
async function rows(symbol: string, interval: Interval, from: number, to: number): Promise<Candle[]> {
  const result = await chart(symbol, interval, from, to);
  const times = result.timestamp ?? [];
  const q = result.indicators?.quote?.[0] ?? {};
  const latest = (result.meta?.regularMarketTime ?? Infinity) * 1000;
  const out: Candle[] = [];
  for (let i = 0; i < times.length; i++) {
    const t = times[i] * 1000;
    const [o, h, l, c] = [q.open?.[i], q.high?.[i], q.low?.[i], q.close?.[i]];
    if (t < from || t >= to || o == null || h == null || l == null || c == null) continue;
    if (interval !== '1d' && t + INTERVAL_MS[interval] > latest) continue;
    out.push({ t, o, h, l, c, v: q.volume?.[i] ?? 0 });
  }
  return out;
}

/**
 * Sorted candles combined into `tfMs` buckets on UTC boundaries. A candle
 * lasting `spanMs` that does not fit inside one bucket goes to the later one.
 */
function bucket(candles: readonly Candle[], spanMs: number, tfMs: number): Candle[] {
  const out: Candle[] = [];
  for (const c of candles) {
    let t = Math.floor(c.t / tfMs) * tfMs;
    if (c.t + spanMs > t + tfMs) t += tfMs;
    const last = out[out.length - 1];
    if (last?.t === t) {
      last.h = Math.max(last.h, c.h);
      last.l = Math.min(last.l, c.l);
      last.c = c.c;
      last.v += c.v;
    } else {
      out.push({ ...c, t });
    }
  }
  return out;
}

/** Hourly candles: from 30m ones where Yahoo still has those, from its own hours before that. */
async function hours(symbol: string, from: number, to: number, now: number): Promise<Candle[]> {
  // Split at a UTC midnight: no stock trades then, and futures hours are whole already.
  const seam = Math.min(Math.max(Math.ceil((now - STOCK_HISTORY_MS['30m']) / DAY_MS) * DAY_MS, from), to);
  const [older, recent] = await Promise.all([
    seam > from ? rows(symbol, '60m', from, seam) : [],
    seam < to ? rows(symbol, '30m', seam, to) : []
  ]);
  return [...bucket(older, HOUR_MS, HOUR_MS), ...bucket(recent, INTERVAL_MS['30m'], HOUR_MS)];
}

/** Futures and indices: typed by a short name, and not on Alpaca. */
const isAlias = (coin: string) => Object.hasOwn(STOCK_ALIASES, coin);

/** Intraday stocks and ETFs come from Alpaca once its keys are set. */
const usesAlpaca = (coin: string, tf: Timeframe) => tf !== '1d' && !isAlias(coin) && alpacaReady();

/** CME futures intraday come from Databento once its key is set: real prices around the clock, back to 2010. */
const usesDatabento = (coin: string, tf: Timeframe) => tf !== '1d' && isDatabentoFuture(coin) && databentoReady();

/** Why there are no candles that far back, and what to do instead. */
function tooOld(coin: string, tf: Timeframe): string {
  const name = TF_LABEL[tf];
  if (usesDatabento(coin, tf)) return `${coin} ${name} history on Databento starts in ${new Date(DATABENTO_START[coin]).getUTCFullYear()}.`;
  if (usesAlpaca(coin, tf)) return `Alpaca's ${name} history starts in 2016.`;
  const yahoo = `Yahoo only keeps ${name} candles for the last ${Math.round(STOCK_HISTORY_MS[tf] / DAY_MS) + 1} days.`;
  if (isDatabentoFuture(coin)) {
    return `${yahoo} For older ${coin} history add a Databento key to .env (DATABENTO_API_KEY): real futures candles back to ${new Date(DATABENTO_START[coin]).getUTCFullYear()}. Or use a higher timeframe.`;
  }
  if (isAlias(coin)) {
    const keys = alpacaReady() ? '' : ' (with Alpaca keys in .env)';
    return `${yahoo} For older ${name} history use the ETF${keys}: QQQ for the Nasdaq 100, SPY for the S&P 500. Or a higher timeframe.`;
  }
  return `${yahoo} Add free Alpaca keys to .env (ALPACA_KEY_ID, ALPACA_SECRET_KEY) for stock history back to 2016, or use a higher timeframe.`;
}

/** Closed candles for `coin` on `tf` that open between `fromMs` and `toMs`. */
export async function stockCandles(
  coin: string,
  tf: Timeframe,
  fromMs: number,
  toMs: number,
  now = Date.now()
): Promise<Candle[]> {
  const symbol = yahooSymbol(coin);
  const tfMs = TF_MS[tf];
  const databento = usesDatabento(coin, tf);
  const alpaca = usesAlpaca(coin, tf);
  const earliest = databento ? DATABENTO_START[coin] : alpaca ? ALPACA_START : now - STOCK_HISTORY_MS[tf];
  const from = Math.floor(Math.max(fromMs, earliest, 0) / tfMs) * tfMs;
  // Only whole buckets: one cut short would look like a closed candle.
  const to = Math.floor(Math.min(toMs, alpaca ? now - ALPACA_DELAY_MS : now) / tfMs) * tfMs;
  if (from >= to) throw new StockError(tooOld(coin, tf), 400);

  let candles: Candle[];
  if (databento) {
    // One-minute candles build every timeframe up to 30m, hourly ones the longer timeframes.
    const hourly = tfMs >= HOUR_MS;
    candles = bucket(await databentoBars(coin, hourly ? 'ohlcv-1h' : 'ohlcv-1m', from, to), hourly ? HOUR_MS : MINUTE_MS, tfMs);
  } else if (alpaca) {
    // Hours from 30m bars, so the 9:00 hour holds 9:30–10:00 and nothing from before the open.
    const minutes = tfMs >= 3_600_000 ? 30 : tfMs / MINUTE_MS;
    candles = bucket(await alpacaBars(symbol, minutes, from, to), minutes * MINUTE_MS, tfMs);
  } else if (tf === '1m') {
    const chunks: Promise<Candle[]>[] = [];
    for (let t = from; t < to; t += ONE_MINUTE_CHUNK_MS) {
      chunks.push(rows(symbol, '1m', t, Math.min(to, t + ONE_MINUTE_CHUNK_MS)));
    }
    candles = (await Promise.all(chunks)).flat();
  } else if (tf === '5m' || tf === '15m' || tf === '30m') {
    candles = await rows(symbol, tf, from, to);
  } else if (tf === '1h' || tf === '4h') {
    // From an hour early: a :30 hour moved forward can land on the first bucket.
    candles = bucket(await hours(symbol, from - HOUR_MS, to, now), HOUR_MS, tfMs);
  } else {
    candles = bucket(await rows(symbol, '1d', from - DAY_MS, to), 0, DAY_MS);
  }
  return candles.filter((c) => c.t >= from && c.t < to);
}

/** The earliest time `tf` candles can be had for this symbol. */
export async function stockHistoryStart(coin: string, tf: Timeframe, now = Date.now()): Promise<number> {
  if (usesDatabento(coin, tf)) return DATABENTO_START[coin];
  const alpaca = usesAlpaca(coin, tf);
  if (tf !== '1d' && !alpaca) return now - STOCK_HISTORY_MS[tf];
  const first = (await chart(yahooSymbol(coin), '1d', now - 7 * DAY_MS, now)).meta?.firstTradeDate;
  if (first == null) throw new StockError(`Yahoo has no start date for ${coin}.`, 404);
  const listed = Math.ceil((first * 1000) / DAY_MS) * DAY_MS;
  return alpaca ? Math.max(listed, ALPACA_START) : listed;
}
