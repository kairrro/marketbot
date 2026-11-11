// Candle loading. Everything the rest of the app needs from an exchange goes
// through loadCandles / loadMore, which return clean, closed, sorted candles.

import { TF_MS, type Candle, type Timeframe } from '$lib/engine/types';
import { BINANCE_DEFAULT_COUNT, binanceListedAt, fetchBinance } from './binance';
import { fetchHyperliquid, HL_MAX_CANDLES } from './hyperliquid';
import { sanitize } from './sanitize';
import { fetchStocks, stockAhead, stockHistoryStart, stockWindow } from './stocks';
import { DataError, SOURCE_LABEL, type CandleRequest, type Source } from './types';

export { fetchCoins, matchCoins, type CoinInfo } from './coins';
export { fetchBinance } from './binance';
export { mergeCandles, precisionOf, sanitize } from './sanitize';
export * from './types';

const DAY_MS = 86_400_000;

/** Candles of context to load before the anchor, so the chart is not empty at the start. */
const CONTEXT_CANDLES = 400;

/** Fewer than this is not worth replaying (a brand-new listing on the daily chart, say). */
export const MIN_CANDLES = 20;

/**
 * Upper-cases a typed coin. Hyperliquid's "k" markets (kPEPE, kBONK…) are
 * case-sensitive, so a lower-case k followed by an upper-case ticker is kept.
 */
export function normalizeCoin(input: string): string {
  const coin = input.trim();
  if (/^k[A-Z0-9]+$/.test(coin)) return coin;
  return coin.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function wrap(err: unknown, source: Source): DataError {
  if (err instanceof DataError) return err;
  const reason = err instanceof Error ? err.message : String(err);
  return new DataError(`${SOURCE_LABEL[source]} request failed: ${reason}`, source);
}

export async function loadCandles(req: CandleRequest, now = Date.now()): Promise<Candle[]> {
  const tfMs = TF_MS[req.tf];
  let raw: Candle[];

  try {
    const anchor = req.anchor ?? now - 30 * DAY_MS;
    if (req.source === 'hyperliquid') {
      raw = await fetchHyperliquid(req.coin, req.tf, now);
    } else if (req.source === 'stocks') {
      raw = await fetchStocks(req.coin, req.tf, ...stockWindow(req.tf, anchor, now));
    } else {
      raw = await fetchBinance(req.coin, req.tf, anchor - CONTEXT_CANDLES * tfMs);
    }
  } catch (err) {
    throw wrap(err, req.source);
  }

  const candles = sanitize(raw, tfMs, now);
  if (candles.length < MIN_CANDLES) {
    throw new DataError(`Not enough candles for ${req.coin} ${req.tf} on ${SOURCE_LABEL[req.source]}.`, req.source);
  }
  return candles;
}

/** The earliest time `source` serves `tf` candles for this coin from. */
export async function historyStart(source: Source, coin: string, tf: Timeframe, now = Date.now()): Promise<number> {
  try {
    if (source === 'stocks') return await stockHistoryStart(coin, tf);
    return source === 'binance' ? await binanceListedAt(coin) : now - HL_MAX_CANDLES * TF_MS[tf];
  } catch (err) {
    throw wrap(err, source);
  }
}

/** True when a closed candle newer than `lastOpen` could exist by now. */
export function canLoadMore(tf: Timeframe, lastOpen: number, now = Date.now()): boolean {
  return lastOpen + 2 * TF_MS[tf] <= now;
}

/**
 * Closed candles that come after `lastOpen`, as far as the source can serve
 * them. Binance pages forward from that point; Hyperliquid can only return its
 * most recent window, which may or may not connect to it.
 */
export async function loadMore(
  source: Source,
  coin: string,
  tf: Timeframe,
  lastOpen: number,
  now = Date.now()
): Promise<Candle[]> {
  try {
    const raw =
      source === 'binance'
        ? await fetchBinance(coin, tf, lastOpen + TF_MS[tf], BINANCE_DEFAULT_COUNT / 2)
        : source === 'stocks'
          ? await fetchStocks(coin, tf, ...stockAhead(tf, lastOpen, now))
          : await fetchHyperliquid(coin, tf, now);
    return sanitize(raw, TF_MS[tf], now).filter((candle) => candle.t > lastOpen);
  } catch (err) {
    throw wrap(err, source);
  }
}
