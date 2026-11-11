<script lang="ts">
  // One coin's candles in CT, scrolled to the picked trade: its entry, the
  // stop as it trailed, the level it broke out of and where it exited. Every
  // other trade of the coin is a small arrow, and the chart scrolls and zooms freely.
  import { onMount } from 'svelte';
  import {
    CandlestickSeries,
    ColorType,
    createChart,
    createSeriesMarkers,
    CrosshairMode,
    LineSeries,
    LineStyle,
    LineType,
    TickMarkType,
    type IChartApi,
    type ISeriesApi,
    type ISeriesMarkersPluginApi,
    type LineData,
    type SeriesMarker,
    type Time
  } from 'lightweight-charts';
  import { alpha, readTheme, type ChartTheme } from '$lib/chart/theme';
  import { chartMs, toChartTime, tzOffsetSec } from '$lib/chart/time';
  import { EXIT_LABEL } from '$lib/engine/auto/report';
  import { TIME_ZONE, type Trade } from '$lib/engine/auto/types';
  import type { Candle } from '$lib/engine/types';
  import { fmtDateTime, fmtR, fmtWeekday } from '$lib/format';

  let {
    candles,
    tfMs,
    entryLen,
    trade,
    trades,
    precision
  }: {
    candles: readonly Candle[];
    tfMs: number;
    /** Candles the breakout level is drawn back over. */
    entryLen: number;
    trade: Trade | null;
    /** Every trade; only the picked trade's coin is marked. */
    trades: readonly Trade[];
    precision: number;
  } = $props();

  interface Chart {
    chart: IChartApi;
    theme: ChartTheme;
    candles: ISeriesApi<'Candlestick'>;
    entry: ISeriesApi<'Line'>;
    stop: ISeriesApi<'Line'>;
    level: ISeriesApi<'Line'>;
    markers: ISeriesMarkersPluginApi<Time>;
  }

  /** Candles shown before the breakout level starts and after the exit. */
  const BEFORE = 10;
  const AFTER = 15;

  let el: HTMLDivElement;
  let view = $state.raw<Chart | null>(null);
  /** What the candle series holds, so it is only set again when that changes. */
  let shown: { candles: readonly Candle[]; offset: number } | null = null;

  // One offset for all the candles keeps their times in order across a DST change; it is the picked trade's, so that trade reads right.
  const offset = $derived(tzOffsetSec(trade?.entryTime ?? candles.at(-1)?.t ?? 0, TIME_ZONE));

  onMount(() => {
    const theme = readTheme(el);
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: theme.bg },
        textColor: theme.textMuted,
        fontFamily: theme.fontMono,
        fontSize: 10,
        attributionLogo: false
      },
      localization: { timeFormatter: (time: Time) => fmtDateTime(chartMs(time), 'UTC') },
      grid: { vertLines: { color: theme.grid }, horzLines: { color: theme.grid } },
      rightPriceScale: { borderColor: theme.border, scaleMargins: { top: 0.1, bottom: 0.1 } },
      timeScale: {
        borderColor: theme.border,
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: (time: Time, type: TickMarkType) =>
          type === TickMarkType.DayOfMonth ? fmtWeekday(chartMs(time), 'UTC') : null
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: alpha(theme.textMuted, 0.5), style: LineStyle.Dashed, labelBackgroundColor: theme.surface },
        horzLine: { color: alpha(theme.textMuted, 0.5), style: LineStyle.Dashed, labelBackgroundColor: theme.surface }
      }
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: alpha(theme.green, 0.75),
      downColor: alpha(theme.red, 0.75),
      wickUpColor: alpha(theme.green, 0.75),
      wickDownColor: alpha(theme.red, 0.75),
      borderVisible: false,
      priceLineVisible: false,
      lastValueVisible: false
    });
    const line = (color: string, style: LineStyle, width: 1 | 2 = 2, lineType = LineType.Simple) =>
      chart.addSeries(LineSeries, {
        color,
        lineWidth: width,
        lineStyle: style,
        lineType,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false
      });
    view = {
      chart,
      theme,
      candles: series,
      entry: line(theme.text, LineStyle.Solid),
      stop: line(theme.red, LineStyle.Solid, 2, LineType.WithSteps),
      level: line(theme.accent, LineStyle.Dotted, 1),
      markers: createSeriesMarkers(series, [])
    };
    return () => {
      view = null;
      shown = null;
      chart.remove();
    };
  });

  $effect(() => {
    if (!view) return;
    const time = (ms: number) => toChartTime(ms, offset);
    if (shown?.candles !== candles || shown.offset !== offset) {
      view.candles.applyOptions({ priceFormat: { type: 'price', precision, minMove: 10 ** -precision } });
      view.candles.setData(candles.map((c) => ({ time: time(c.t), open: c.o, high: c.h, low: c.l, close: c.c })));
      shown = { candles, offset };
    }
    draw(view, trade, trades, time);
  });

  /** Index of the first candle opening at or after `ms`. */
  function indexAt(ms: number): number {
    let lo = 0;
    let hi = candles.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (candles[mid].t < ms) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** Line points in time order, one per time: a later value at the same time wins. */
  function points(rows: [number, number][], time: (ms: number) => Time): LineData<Time>[] {
    const byTime = new Map<number, number>();
    for (const [t, value] of rows) byTime.set(t, value);
    return [...byTime].sort(([a], [b]) => a - b).map(([t, value]) => ({ time: time(t), value }));
  }

  function draw(v: Chart, trade: Trade | null, trades: readonly Trade[], time: (ms: number) => Time) {
    const { theme } = v;
    const sameCoin = trades.filter((t) => t.coin === trade?.coin);
    const others: SeriesMarker<Time>[] = sameCoin
      .filter((t) => t !== trade)
      .map((t) => ({
        time: time(t.signalTime),
        position: t.side === 'long' ? 'belowBar' : 'aboveBar',
        shape: t.side === 'long' ? 'arrowUp' : 'arrowDown',
        color: alpha(t.side === 'long' ? theme.green : theme.red, 0.45),
        size: 0.6
      }));

    if (!trade) {
      for (const series of [v.entry, v.stop, v.level]) series.setData([]);
      v.markers.setMarkers([]);
      v.chart.timeScale().setVisibleLogicalRange({ from: candles.length - 150, to: candles.length + 5 });
      return;
    }

    const long = trade.side === 'long';
    // The bar the trade ended in: the exit time is that candle's close.
    const exitBar = trade.exitTime - tfMs;
    const levelFrom = trade.signalTime - entryLen * tfMs;
    // From the entry (the breakout candle's close) to the close of the candle that exited.
    v.entry.setData(points([[trade.entryTime, trade.entry], [trade.exitTime, trade.entry]], time));
    // A stop set at a close holds from the next candle on, which opens at that same time.
    const moves = trade.trail.filter((m) => m.time < trade.exitTime);
    v.stop.setData(
      points(
        [[trade.entryTime, trade.stop], ...moves.map((m): [number, number] => [m.time, m.stop]), [trade.exitTime, moves.at(-1)?.stop ?? trade.stop]],
        time
      )
    );
    v.level.setData(points([[levelFrom, trade.breakoutLevel], [trade.signalTime, trade.breakoutLevel]], time));

    const markers: SeriesMarker<Time>[] = [
      ...others,
      ...(trade.partial
        ? [{ time: time(trade.partial.time - tfMs), position: long ? 'aboveBar' : 'belowBar', shape: 'circle', color: theme.accent, size: 0.7, text: 'Third off' } as SeriesMarker<Time>]
        : []),
      {
        time: time(trade.signalTime),
        position: long ? 'belowBar' : 'aboveBar',
        shape: long ? 'arrowUp' : 'arrowDown',
        color: long ? theme.green : theme.red,
        text: 'Entry'
      },
      {
        time: time(exitBar),
        position: long ? 'aboveBar' : 'belowBar',
        shape: 'circle',
        color: trade.r > 0 ? theme.green : trade.r < 0 ? theme.red : theme.textMuted,
        text: `${EXIT_LABEL[trade.exitReason]} ${fmtR(trade.r, 1)}`
      }
    ];
    v.markers.setMarkers(markers.sort((a, b) => (a.time as number) - (b.time as number)));
    v.chart.timeScale().setVisibleLogicalRange({ from: indexAt(levelFrom) - BEFORE, to: indexAt(exitBar) + AFTER });
  }
</script>

<div class="chart" bind:this={el}></div>
<ul class="legend">
  <li><span class="key entry"></span>Entry</li>
  <li><span class="key stop"></span>Stop, as it trailed</li>
  <li><span class="key level"></span>Level it broke out of</li>
  <li><span class="arrow"></span>Other trades of this coin</li>
</ul>

<style>
  .chart {
    height: 440px;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }

  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
    margin-top: 8px;
    color: var(--text-2);
    font-size: 11.5px;
  }

  .legend li {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .key {
    width: 14px;
    height: 0;
    border-top: 2px solid;
  }

  .key.entry {
    border-color: var(--text);
  }

  .key.stop {
    border-color: var(--red);
  }

  .key.level {
    border-top: 1px dotted var(--accent);
  }

  .arrow {
    width: 0;
    height: 0;
    border-right: 4px solid transparent;
    border-bottom: 7px solid var(--green);
    border-left: 4px solid transparent;
    opacity: 0.6;
  }

  @media (max-width: 767px) {
    .chart {
      height: 320px;
    }
  }
</style>
