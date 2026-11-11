// Trade markers: an entry arrow and an exit dot (with the R result).

import type { SeriesMarker, Time } from 'lightweight-charts';
import { bucketOpen } from '$lib/engine/replay';
import type { Candle, Side } from '$lib/engine/types';
import { fmtR } from '$lib/format';
import type { ChartTheme } from './theme';

export interface MarkerTrade {
  coin: string;
  side: Side;
  entryTime: number;
  /** null while the trade is still open. */
  exitTime: number | null;
  r: number | null;
}

export interface MarkerContext {
  coin: string;
  tfMs: number;
  /** The loaded candles and how many of them are visible. Nothing past `count` is read. */
  candles: readonly Candle[];
  count: number;
  /** The candle still forming at the cursor, drawn after the visible ones. */
  forming: Candle | null;
  toTime: (ms: number) => Time;
  theme: ChartTheme;
}

/**
 * Index of the bar containing `instant`, clamped to the bars on the chart:
 * the visible candles, then `forming` (at index `count`) if there is one.
 */
export function barIndexAt(
  candles: readonly Candle[],
  count: number,
  tfMs: number,
  instant: number,
  forming: Candle | null = null
): number {
  const open = bucketOpen(instant, tfMs);
  if (forming && open >= forming.t) return count;
  let lo = 0;
  let hi = count - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (candles[mid].t <= open) lo = mid;
    else hi = mid - 1;
  }
  return Math.max(0, lo);
}

/**
 * Markers for the current coin, limited to what the replay has revealed: a
 * marker only appears once the candle it sits on is visible. Trades taken on
 * another timeframe snap to the candle that contains them.
 */
export function buildMarkers(trades: readonly MarkerTrade[], ctx: MarkerContext): SeriesMarker<Time>[] {
  if (ctx.count === 0) return [];
  const firstOpen = ctx.candles[0].t;
  const lastOpen = ctx.candles[ctx.count - 1].t;
  const { green, red } = ctx.theme;
  const markers: SeriesMarker<Time>[] = [];

  /**
   * Open time of the visible candle holding `instant`, or null if it is not on
   * the chart. A marker must sit on a candle that actually exists, so the
   * bucket is looked up rather than assumed.
   */
  const barFor = (instant: number): number | null => {
    const open = bucketOpen(instant, ctx.tfMs);
    if (open === ctx.forming?.t) return open;
    if (open < firstOpen || open > lastOpen) return null;
    const candle = ctx.candles[barIndexAt(ctx.candles, ctx.count, ctx.tfMs, instant)];
    return candle.t === open ? open : null;
  };

  for (const trade of trades) {
    if (trade.coin !== ctx.coin) continue;
    const long = trade.side === 'long';

    const entryBar = barFor(trade.entryTime);
    if (entryBar != null) {
      markers.push({
        time: ctx.toTime(entryBar),
        position: long ? 'belowBar' : 'aboveBar',
        shape: long ? 'arrowUp' : 'arrowDown',
        color: long ? green : red
      });
    }

    const exitBar = trade.exitTime != null ? barFor(trade.exitTime) : null;
    if (exitBar != null && trade.r != null) {
      markers.push({
        time: ctx.toTime(exitBar),
        position: long ? 'aboveBar' : 'belowBar',
        shape: 'circle',
        color: trade.r >= 0 ? green : red,
        text: fmtR(trade.r, 1)
      });
    }
  }

  // The library requires markers in ascending time order.
  return markers.sort((a, b) => (a.time as number) - (b.time as number));
}
