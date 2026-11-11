import { fmtDuration, fmtPct, fmtSigned } from '$lib/format';
import { fillRect, pill, strokeRect, type PillLine, type Target } from '../draw';
import { alpha, type ChartTheme } from '../theme';
import { Primitive } from './base';

export interface MeasurePoint {
  /** Bar index (fractional while dragging). */
  logical: number;
  price: number;
}

export interface MeasureContext {
  tfMs: number;
  precision: number;
  /** 1R of the open (or drafted) trade, so a move can be read in R. */
  risk: { dist: number; dir: 1 | -1 } | null;
}

export interface MeasureStats {
  change: number;
  pct: number;
  bars: number;
  spanMs: number;
  r: number | null;
}

/** What the label shows for a measurement from `a` to `b`. Pure, so it can be tested. */
export function measureStats(a: MeasurePoint, b: MeasurePoint, ctx: MeasureContext): MeasureStats {
  const change = b.price - a.price;
  const bars = Math.round(b.logical) - Math.round(a.logical);
  return {
    change,
    pct: a.price !== 0 ? (change / a.price) * 100 : 0,
    bars,
    spanMs: Math.abs(bars) * ctx.tfMs,
    r: ctx.risk && ctx.risk.dist > 0 ? (change * ctx.risk.dir) / ctx.risk.dist : null
  };
}

/**
 * The measure tool: a faint rectangle between two points with a small label
 * (price change, %, bars, time and — with a trade on — R).
 */
export class MeasurePrimitive extends Primitive {
  #a: MeasurePoint | null = null;
  #b: MeasurePoint | null = null;
  #done = false;
  #ctx: MeasureContext = { tfMs: 60_000, precision: 2, risk: null };

  constructor(theme: ChartTheme) {
    super(theme);
    this.zOrder = 'top';
  }

  /** True while a measurement is being drawn. */
  get drawing(): boolean {
    return this.#a != null && !this.#done;
  }

  /** True when a finished measurement is on screen. */
  get done(): boolean {
    return this.#a != null && this.#done;
  }

  setContext(ctx: MeasureContext): void {
    this.#ctx = ctx;
    if (this.#a) this.invalidate();
  }

  start(point: MeasurePoint): void {
    this.#a = point;
    this.#b = point;
    this.#done = false;
    this.invalidate();
  }

  move(point: MeasurePoint): void {
    if (!this.drawing) return;
    this.#b = point;
    this.invalidate();
  }

  finish(): void {
    if (this.drawing) this.#done = true;
    this.invalidate();
  }

  /** Removes the measurement. Returns true if there was one. */
  clear(): boolean {
    const had = this.#a != null;
    this.#a = null;
    this.#b = null;
    this.#done = false;
    if (had) this.invalidate();
    return had;
  }

  protected draw(target: Target): void {
    const a = this.#a;
    const b = this.#b;
    if (!a || !b) return;
    const x1 = this.x(a.logical);
    const x2 = this.x(b.logical);
    const y1 = this.y(a.price);
    const y2 = this.y(b.price);
    if (x1 == null || x2 == null || y1 == null || y2 == null) return;

    const stats = measureStats(a, b, this.#ctx);
    const up = stats.change >= 0;
    const color = up ? this.theme.green : this.theme.red;

    fillRect(target, x1, y1, x2, y2, alpha(color, 0.08));
    strokeRect(target, x1, y1, x2, y2, alpha(color, 0.5));

    const lines: PillLine[] = [
      {
        text: `${fmtSigned(stats.change, this.#ctx.precision)}  (${fmtPct(stats.pct, 2, true)})`,
        color
      },
      { text: `${Math.abs(stats.bars)} bars · ${fmtDuration(stats.spanMs)}`, color: this.theme.textMuted }
    ];
    if (stats.r != null) lines.push({ text: `${fmtSigned(stats.r)}R` });

    target.useMediaCoordinateSpace(({ mediaSize }) => {
      // Label sits just past the end of the move: above when measuring up, below when down.
      pill(target, lines, (x1 + x2) / 2, up ? Math.min(y1, y2) - 8 : Math.max(y1, y2) + 8, {
        font: this.font(),
        color: this.theme.text,
        background: alpha(this.theme.surface, 0.96),
        border: alpha(color, 0.45),
        align: 'center',
        baseline: up ? 'bottom' : 'top',
        bounds: mediaSize
      });
    });
  }
}
