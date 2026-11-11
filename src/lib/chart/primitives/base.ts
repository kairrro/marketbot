import type {
  IChartApiBase,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  Logical,
  PrimitivePaneViewZOrder,
  SeriesAttachedParameter,
  SeriesType,
  Time
} from 'lightweight-charts';
import type { Target } from '../draw';
import type { ChartTheme } from '../theme';

/**
 * Shared plumbing for our series primitives: holds the chart/series it is
 * attached to, converts prices and bar indexes to pixels, and exposes a single
 * pane view whose renderer calls `draw`.
 */
export abstract class Primitive implements ISeriesPrimitive<Time> {
  protected chart: IChartApiBase<Time> | null = null;
  protected series: ISeriesApi<SeriesType, Time> | null = null;
  protected theme: ChartTheme;
  protected zOrder: PrimitivePaneViewZOrder = 'normal';

  #requestUpdate: (() => void) | null = null;
  // The library caches by array identity, so this array is created once.
  #views: readonly IPrimitivePaneView[];

  constructor(theme: ChartTheme) {
    this.theme = theme;
    const renderer: IPrimitivePaneRenderer = { draw: (target) => this.draw(target) };
    this.#views = [{ zOrder: () => this.zOrder, renderer: () => renderer }];
  }

  attached(param: SeriesAttachedParameter<Time>): void {
    this.chart = param.chart;
    this.series = param.series;
    this.#requestUpdate = param.requestUpdate;
  }

  detached(): void {
    this.chart = null;
    this.series = null;
    this.#requestUpdate = null;
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this.#views;
  }

  protected abstract draw(target: Target): void;

  /** Asks the chart to repaint. */
  protected invalidate(): void {
    this.#requestUpdate?.();
  }

  protected y(price: number): number | null {
    return this.series?.priceToCoordinate(price) ?? null;
  }

  /**
   * Pixel x for a bar index, which may be fractional.
   *
   * The library only converts whole indexes (anything else comes back as 0),
   * so the fraction is added by hand. Fractions are normal: a drawing made on
   * 5m sits part-way through a candle when it is viewed on 1h.
   */
  protected x(logical: number): number | null {
    const timeScale = this.chart?.timeScale();
    if (!timeScale || !Number.isFinite(logical)) return null;
    const whole = Math.floor(logical);
    const base = timeScale.logicalToCoordinate(whole as Logical);
    if (base == null || logical === whole) return base;
    // Bars are evenly spaced, so the next whole index gives the bar width.
    const next = timeScale.logicalToCoordinate((whole + 1) as Logical);
    return next == null ? base : base + (logical - whole) * (next - base);
  }

  protected font(size = 11, weight = 500): string {
    return `${weight} ${size}px ${this.theme.fontMono}`;
  }
}
