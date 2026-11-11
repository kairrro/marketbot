<script lang="ts">
  // Cumulative R after each trade, as a lightweight-charts line. The x axis is
  // the trade number, so the time scale is hidden and "time" is just an index.
  import { onMount } from 'svelte';
  import {
    ColorType,
    createChart,
    CrosshairMode,
    LineSeries,
    LineStyle,
    type IChartApi,
    type ISeriesApi,
    type UTCTimestamp
  } from 'lightweight-charts';
  import { readTheme } from '$lib/chart/theme';

  let { equity, height = 150 }: { equity: number[]; height?: number } = $props();

  let el: HTMLDivElement;
  let chart: IChartApi | null = null;
  let series = $state.raw<ISeriesApi<'Line'> | null>(null);

  onMount(() => {
    const theme = readTheme(el);
    chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: theme.textMuted,
        fontFamily: theme.fontMono,
        fontSize: 10,
        attributionLogo: false
      },
      grid: { vertLines: { visible: false }, horzLines: { color: theme.border } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.15, bottom: 0.15 } },
      timeScale: { visible: false, borderVisible: false, fixLeftEdge: true, fixRightEdge: true },
      crosshair: {
        mode: CrosshairMode.Magnet,
        vertLine: { visible: false, labelVisible: false },
        horzLine: { color: theme.border, style: LineStyle.Dashed, labelBackgroundColor: theme.surface }
      },
      handleScroll: false,
      handleScale: false
    });
    series = chart.addSeries(LineSeries, {
      color: theme.accent,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
      crosshairMarkerRadius: 3,
      priceFormat: { type: 'custom', minMove: 0.01, formatter: (value: number) => `${value.toFixed(1)}R` }
    });
    // A reference line at breakeven.
    series.createPriceLine({
      price: 0,
      color: theme.textMuted,
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      axisLabelVisible: false
    });

    return () => {
      series = null;
      chart?.remove();
      chart = null;
    };
  });

  $effect(() => {
    if (!series) return;
    series.setData(equity.map((value, i) => ({ time: i as UTCTimestamp, value })));
    chart?.timeScale().fitContent();
  });
</script>

<div class="curve" style:height="{height}px" bind:this={el}></div>

<style>
  .curve {
    margin-top: 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface-2);
    overflow: hidden;
  }
</style>
