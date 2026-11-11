// The candles a journaled trade is charted (and replayed with other targets)
// on. They come from the session's own saved candles, so the journal stores
// no candles of its own.

import { marketCloses, type Source } from '$lib/data';
import { tradeWindow, type TradeRecord } from '$lib/engine/journal';
import { TF_MS, TIMEFRAMES, type Candle, type Timeframe } from '$lib/engine/types';
import { candlesAfterEntry } from '$lib/engine/whatIf';
import { replay } from './replay.svelte';
import { sessionData } from './sessionData';
import { sessions } from './sessions.svelte';

export interface TradeCandles {
  tf: Timeframe;
  /** What the chart shows: context before the entry, the trade, a little after. */
  candles: Candle[];
  /** Every candle from the entry up to the replay's clock, for the what-if. */
  after: Candle[];
}

type Load = (source: Source, coin: string, tf: Timeframe) => Promise<Candle[] | undefined>;

/** The loaded chart's candles when they are the ones asked for, otherwise the session's saved ones. */
const fromSession: Load = async (source, coin, tf) => {
  const info = replay.info;
  if (info?.source === source && info.coin === coin && info.tf === tf) return replay.candles;
  return sessionData.loadCandles(sessions.activeId, { source, coin, tf });
};

/**
 * The trade's own timeframe if the session still holds it, otherwise the
 * nearest one that does. Nothing past the replay's clock is used.
 */
export async function tradeCandles(trade: TradeRecord, load: Load = fromSession): Promise<TradeCandles | null> {
  const source = trade.source as Source;
  const distance = (tf: Timeframe) => Math.abs(Math.log(TF_MS[tf] / TF_MS[trade.tf]));
  const seenUntil = Math.max(trade.exitTime, replay.info ? replay.cursorTime : 0);
  const closes = marketCloses(source);
  for (const tf of [...TIMEFRAMES].sort((a, b) => distance(a) - distance(b))) {
    const all = await load(source, trade.coin, tf);
    const candles = all ? tradeWindow(all, TF_MS[tf], trade, seenUntil, closes) : null;
    if (all && candles?.length) {
      return { tf, candles, after: candlesAfterEntry(all, TF_MS[tf], trade.entryTime, seenUntil, closes) };
    }
  }
  return null;
}

/** Candles for every trade given, reading each market and timeframe once. Trades without any are left out. */
export async function journalCandles(trades: readonly TradeRecord[]): Promise<{ trade: TradeRecord; data: TradeCandles }[]> {
  const cache = new Map<string, Promise<Candle[] | undefined>>();
  const load: Load = (source, coin, tf) => {
    const key = `${source}:${coin}:${tf}`;
    if (!cache.has(key)) cache.set(key, fromSession(source, coin, tf));
    return cache.get(key)!;
  };
  const found = [];
  for (const trade of trades) {
    const data = await tradeCandles(trade, load);
    if (data) found.push({ trade, data });
  }
  return found;
}
