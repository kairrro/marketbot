// Owns the lightweight-charts instance: creates it, feeds it candles, and
// exposes the handful of operations the rest of the app needs. No app state in
// here — the Svelte component pushes state in.

import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  CrosshairMode,
  LineStyle,
  TickMarkType,
  type CandlestickData,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type Logical,
  type SeriesMarker,
  type Time,
  type UTCTimestamp
} from 'lightweight-charts';
import type { Candle } from '$lib/engine/types';
import { fmtDateTime, fmtWeekday } from '$lib/format';
import type { TimeZone } from '$lib/timezone';
import { AtrPrimitive } from './primitives/atr';
import { LevelsPrimitive } from './primitives/levels';
import { MarketSessionsPrimitive } from './primitives/marketSessions';
import { MeasurePrimitive } from './primitives/measure';
import { PlaybookPrimitive } from './primitives/playbook';
import { PositionPrimitive } from './primitives/position';
import { SwingsPrimitive } from './primitives/swings';
import { ZonesPrimitive } from './primitives/zones';
import { alpha, readTheme, type ChartTheme } from './theme';
import { chartMs, toChartTime, tzOffsetSec } from './time';

/** Bars of empty space kept to the right of the latest candle. */
const RIGHT_OFFSET = 12;
/** Bars shown after a load. */
const INITIAL_BARS = 160;
/** Above this many new candles a full redraw is cheaper than per-candle updates. */
const MAX_INCREMENTAL = 200;

export interface PanePoint {
  x: number;
  y: number;
}

export class ChartController {
  readonly chart: IChartApi;
  readonly series: ISeriesApi<'Candlestick'>;
  readonly theme: ChartTheme;
  readonly levels: LevelsPrimitive;
  readonly marketSessions: MarketSessionsPrimitive;
  readonly swings: SwingsPrimitive;
  readonly atr: AtrPrimitive;
  readonly playbook: PlaybookPrimitive;
  readonly zones: ZonesPrimitive;
  readonly position: PositionPrimitive;
  readonly measure: MeasurePrimitive;

  #el: HTMLElement;
  #markers: ISeriesMarkersPluginApi<Time>;
  #priceLine: IPriceLine | null = null;
  #drawn: { datasetId: number; count: number; offset: number; precision: number; forming: number | null } = {
    datasetId: -1,
    count: 0,
    offset: 0,
    precision: -1,
    forming: null
  };
  /** The visible candles, for converting between bar indexes and real time. */
  #bars: { candles: readonly Candle[]; count: number; tfMs: number; forming: Candle | null } = {
    candles: [],
    count: 0,
    tfMs: 60_000,
    forming: null
  };
  #fontFlip = false;

  constructor(el: HTMLElement) {
    this.#el = el;
    const theme = (this.theme = readTheme(el));

    this.chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: theme.bg },
        textColor: theme.textMuted,
        fontFamily: theme.fontMono,
        fontSize: 11,
        // Attribution is shown in the Settings tab instead of over the chart.
        attributionLogo: false
      },
      // The crosshair's time label, with the day of the week: "Mon Feb 26 '25 09:30".
      localization: { timeFormatter: (time: Time) => fmtDateTime(chartMs(time), 'UTC') },
      grid: { vertLines: { color: theme.grid }, horzLines: { color: theme.grid } },
      rightPriceScale: { borderColor: theme.border, scaleMargins: { top: 0.12, bottom: 0.12 } },
      timeScale: {
        borderColor: theme.border,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: RIGHT_OFFSET,
        // Follows new candles while the latest one is in view, and stays put
        // once the user has scrolled back.
        shiftVisibleRangeOnNewBar: true,
        // Day ticks get their weekday ("Mon 26"); every other tick keeps the default.
        tickMarkFormatter: (time: Time, type: TickMarkType) =>
          type === TickMarkType.DayOfMonth ? fmtWeekday(chartMs(time), 'UTC') : null
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: alpha(theme.textMuted, 0.5), style: LineStyle.Dashed, labelBackgroundColor: theme.surface },
        horzLine: { color: alpha(theme.textMuted, 0.5), style: LineStyle.Dashed, labelBackgroundColor: theme.surface }
      }
    });

    this.series = this.chart.addSeries(CandlestickSeries, {
      upColor: theme.green,
      downColor: theme.red,
      wickUpColor: theme.green,
      wickDownColor: theme.red,
      borderVisible: false,
      // The built-in line follows the last candle on screen, which is not
      // always the current price. setPrice() draws the real one instead.
      priceLineVisible: false,
      lastValueVisible: false
    });

    this.#markers = createSeriesMarkers(this.series, []);
    this.levels = new LevelsPrimitive(theme);
    this.marketSessions = new MarketSessionsPrimitive(theme);
    this.swings = new SwingsPrimitive(theme);
    this.atr = new AtrPrimitive(theme);
    this.playbook = new PlaybookPrimitive(theme);
    this.zones = new ZonesPrimitive(theme, (ms) => this.logicalOfTime(ms));
    this.position = new PositionPrimitive(theme);
    this.measure = new MeasurePrimitive(theme);
    // Attached first so the user's own zones are drawn over the session boxes,
    // and swing dots, levels and the position over the session boxes.
    this.series.attachPrimitive(this.marketSessions);
    this.series.attachPrimitive(this.swings);
    this.series.attachPrimitive(this.atr);
    this.series.attachPrimitive(this.playbook);
    this.series.attachPrimitive(this.zones);
    this.series.attachPrimitive(this.levels);
    this.series.attachPrimitive(this.position);
    this.series.attachPrimitive(this.measure);
  }

  /** Seconds added to every timestamp so the axis reads in the chosen time zone. */
  get offset(): number {
    return this.#drawn.offset;
  }

  time(ms: number): UTCTimestamp {
    return toChartTime(ms, this.#drawn.offset);
  }

  #bar(candle: Candle): CandlestickData<Time> {
    return { time: this.time(candle.t), open: candle.o, high: candle.h, low: candle.l, close: candle.c };
  }

  /**
   * Draws `candles[0..count)`, then `forming` (the candle still forming at the
   * cursor, if any), with times shown in `zone`. Called on every load and
   * every step; steps are applied as cheap per-candle updates.
   *
   * The caller must only ever pass the visible count — this class never sees
   * a candle beyond the replay cursor's index, and never reads past `count`.
   */
  sync(
    candles: readonly Candle[],
    count: number,
    forming: Candle | null,
    datasetId: number,
    precision: number,
    tfMs: number,
    zone: TimeZone
  ): void {
    this.#bars = { candles, count, tfMs, forming: count > 0 ? forming : null };
    if (count === 0) {
      this.series.setData([]);
      this.#drawn = { ...this.#drawn, datasetId, count: 0, forming: null };
      return;
    }

    // The zone's UTC offset at the cursor. If the replay crosses a DST change,
    // or the zone is switched, the whole series is redrawn so recent candles
    // always show the true time there.
    const offset = tzOffsetSec(candles[count - 1].t, zone);
    const drawn = this.#drawn;
    const added = count - drawn.count;
    const fresh = datasetId !== drawn.datasetId;
    // A drawn forming candle can only be replaced, never removed: it has to be
    // overwritten by the next candle drawn, or everything is redrawn.
    const nextOpen = added > 0 ? candles[drawn.count].t : (forming?.t ?? null);
    const formingKept = drawn.forming == null || nextOpen === drawn.forming;

    if (precision !== drawn.precision) {
      this.series.applyOptions({ priceFormat: { type: 'price', precision, minMove: 1 / 10 ** precision } });
    }

    if (fresh || offset !== drawn.offset || added < 0 || added > MAX_INCREMENTAL || !formingKept) {
      // Recorded first: #bar() times each candle with the offset in #drawn.
      this.#drawn = { datasetId, count, offset, precision, forming: forming?.t ?? null };
      const bars: CandlestickData<Time>[] = [];
      for (let i = 0; i < count; i++) bars.push(this.#bar(candles[i]));
      if (forming) bars.push(this.#bar(forming));
      this.series.setData(bars);
      if (fresh) this.showLatest();
    } else {
      for (let i = drawn.count; i < count; i++) this.series.update(this.#bar(candles[i]));
      if (forming) this.series.update(this.#bar(forming));
      this.#drawn = { datasetId, count, offset, precision, forming: forming?.t ?? null };
    }
  }

  // ---- time <-> bar index ----
  //
  // Drawings are stored in real time so they survive a timeframe switch. These
  // two convert to and from the chart's bar indexes. Past either end of the
  // visible candles they extrapolate at one bar per timeframe, so a drawing can
  // reach into the empty space to the right of the latest candle.

  /** Number of bars on the chart: the visible candles and the forming one. */
  get #barCount(): number {
    return this.#bars.count + (this.#bars.forming ? 1 : 0);
  }

  /** Open time of the bar at a whole index inside the chart. */
  #barTime(index: number): number {
    const { candles, count, forming } = this.#bars;
    return index < count ? candles[index].t : forming!.t;
  }

  /** Index of the latest bar (the forming candle, if one is drawn). */
  get lastIndex(): number {
    return this.#barCount - 1;
  }

  /** Bar index for an instant (fractional inside a candle or a gap). */
  logicalOfTime(ms: number): number {
    const { tfMs } = this.#bars;
    const count = this.#barCount;
    if (count === 0) return 0;
    const first = this.#barTime(0);
    const last = this.#barTime(count - 1);
    if (ms <= first) return (ms - first) / tfMs;
    if (ms >= last) return count - 1 + (ms - last) / tfMs;

    // Last bar that opens at or before `ms`.
    let lo = 0;
    let hi = count - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if (this.#barTime(mid) <= ms) lo = mid;
      else hi = mid - 1;
    }
    const open = this.#barTime(lo);
    const span = this.#barTime(lo + 1) - open;
    return lo + Math.min(1, (ms - open) / span);
  }

  /** Open time of the bar at a (whole) index. */
  timeOfLogical(logical: number): number {
    const { tfMs } = this.#bars;
    const count = this.#barCount;
    const index = Math.round(logical);
    if (count === 0) return 0;
    if (index < 0) return this.#barTime(0) + index * tfMs;
    if (index >= count) return this.#barTime(count - 1) + (index - (count - 1)) * tfMs;
    return this.#barTime(index);
  }

  /** Frames the most recent candles, as after a load. */
  showLatest(): void {
    const count = this.#barCount;
    this.chart.priceScale('right').applyOptions({ autoScale: true });
    this.chart.timeScale().setVisibleLogicalRange({
      from: Math.max(0, count - INITIAL_BARS),
      to: count - 1 + RIGHT_OFFSET
    });
  }

  /** Jumps back to the latest candle (no animation, so it lands immediately). */
  scrollToLatest(): void {
    this.chart.timeScale().scrollToPosition(RIGHT_OFFSET, false);
  }

  /** False once the user has scrolled the latest candle off the right edge. */
  isAtLatest(): boolean {
    return this.chart.timeScale().scrollPosition() >= 0;
  }

  onScroll(fn: () => void): () => void {
    const timeScale = this.chart.timeScale();
    timeScale.subscribeVisibleLogicalRangeChange(fn);
    return () => timeScale.unsubscribeVisibleLogicalRangeChange(fn);
  }

  /**
   * The empty square in the bottom-right corner, under the price axis and
   * beside the time axis. It changes size with the price labels.
   */
  corner(): { width: number; height: number } {
    return { width: this.chart.priceScale('right').width(), height: this.chart.timeScale().height() };
  }

  /** Calls `fn` whenever the axes change size (the time axis narrows as the price axis widens). */
  onResize(fn: () => void): () => void {
    const timeScale = this.chart.timeScale();
    timeScale.subscribeSizeChange(fn);
    return () => timeScale.unsubscribeSizeChange(fn);
  }

  /**
   * Draws the current-price line. This is the price at the replay cursor, which
   * on a higher timeframe can sit away from the last closed candle.
   */
  setPrice(price: number | null): void {
    if (price == null) {
      if (this.#priceLine) this.series.removePriceLine(this.#priceLine);
      this.#priceLine = null;
    } else if (this.#priceLine) {
      this.#priceLine.applyOptions({ price });
    } else {
      this.#priceLine = this.series.createPriceLine({
        price,
        color: alpha(this.theme.textMuted, 0.6),
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: true,
        title: ''
      });
    }
  }

  setMarkers(markers: SeriesMarker<Time>[]): void {
    this.#markers.setMarkers(markers);
  }

  // ---- pixel <-> value ----

  /** Size of the plot area (the chart minus its price and time axes). */
  paneSize(): { width: number; height: number } {
    return {
      width: this.#el.clientWidth - this.chart.priceScale('right').width(),
      height: this.#el.clientHeight - this.chart.timeScale().height()
    };
  }

  /** Converts a mouse event to plot-area coordinates, or null when it is over an axis. */
  panePoint(event: MouseEvent): PanePoint | null {
    const rect = this.#el.getBoundingClientRect();
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const pane = this.paneSize();
    const inside = point.x >= 0 && point.y >= 0 && point.x <= pane.width && point.y <= pane.height;
    return inside ? point : null;
  }

  priceAt(y: number): number | null {
    return this.series.coordinateToPrice(y);
  }

  logicalAt(x: number): number | null {
    return this.chart.timeScale().coordinateToLogical(x) as Logical | null;
  }

  /**
   * Re-measures and repaints text after a web font has loaded. The library
   * caches text widths per font string, so the string has to actually change.
   */
  refreshFonts(): void {
    this.#fontFlip = !this.#fontFlip;
    const fontFamily = this.#fontFlip ? `${this.theme.fontMono}, monospace` : this.theme.fontMono;
    this.chart.applyOptions({ layout: { fontFamily } });
  }

  // ---- screenshot ----

  /** The chart exactly as drawn, including our primitives. */
  screenshot(): Promise<Blob | null> {
    return new Promise((resolve) => {
      try {
        const canvas = this.chart.takeScreenshot(true);
        canvas.toBlob((blob) => resolve(blob), 'image/webp', 0.9);
      } catch (err) {
        console.warn('Backtester: screenshot failed', err);
        resolve(null);
      }
    });
  }

  destroy(): void {
    this.chart.remove();
  }
}
