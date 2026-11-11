import type { Sweep, SwingLine } from '$lib/engine/swings';
import { hLine, type Target } from '../draw';
import { alpha, type ChartTheme } from '../theme';
import { Primitive } from './base';

/** Space between a candle's wick and its dot, in CSS pixels. */
const GAP = 4;

/**
 * Swing highs and lows as dots: one above the candle that made a high, one
 * below the candle that made a low. Solid while no candle has traded past it
 * (the liquidity is still there); a faint ring once one has.
 *
 * A sweep (a wick through, then a close back) gets a small triangle past the
 * sweeping candle's wick, red for highs taken and green for lows, and a dotted
 * link back to each swing it took, whose ring takes the same colour.
 *
 * Everything is found on the chart's own candles, so it sits at bar indexes.
 */
export class SwingsPrimitive extends Primitive {
  #points: readonly SwingLine[] = [];
  #sweeps: readonly Sweep[] = [];

  constructor(theme: ChartTheme) {
    super(theme);
  }

  set(points: readonly SwingLine[], sweeps: readonly Sweep[]): void {
    this.#points = points;
    this.#sweeps = sweeps;
    this.invalidate();
  }

  protected draw(target: Target): void {
    const range = this.chart?.timeScale().getVisibleLogicalRange();
    if (!range || this.#points.length === 0) return;
    const x0 = this.x(0);
    const x1 = this.x(1);
    if (x0 == null || x1 == null) return;
    const spacing = x1 - x0;
    const from = range.from - 1;
    const to = range.to + 1;
    // Smaller when zoomed out, so neighbouring marks do not run together.
    const radius = Math.max(2, Math.min(3.5, spacing * 0.3));
    const half = Math.max(3, Math.min(5, spacing * 0.4));
    const color = (sweep: Sweep) => (sweep.kind === 'high' ? this.theme.red : this.theme.green);

    // Links first, so the dots sit on top of their ends.
    const swept = new Map<SwingLine, string>();
    const shown = this.#sweeps.filter((sweep) => sweep.index >= from && sweep.swings.some((s) => s.index <= to));
    for (const sweep of shown) {
      const end = this.x(sweep.index);
      for (const swing of sweep.swings) {
        swept.set(swing, color(sweep));
        const start = this.x(swing.index);
        const y = this.y(swing.price);
        if (start == null || end == null || y == null) continue;
        hLine(target, y, start, end, { color: alpha(color(sweep), 0.55), dash: [2, 3] });
      }
    }

    const solid = alpha(this.theme.text, 0.9);
    const faint = alpha(this.theme.text, 0.4);
    target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
      ctx.save();
      ctx.lineWidth = Math.max(1, Math.floor(hr));
      for (const point of this.#points) {
        if (point.index < from || point.index > to) continue;
        const x = this.x(point.index);
        const y = this.y(point.price);
        if (x == null || y == null) continue;
        const cy = point.kind === 'high' ? y - GAP - radius : y + GAP + radius;
        ctx.beginPath();
        ctx.arc(x * hr, cy * vr, radius * hr, 0, Math.PI * 2);
        if (point.status === 'fresh') {
          ctx.fillStyle = solid;
          ctx.fill();
        } else {
          const sweptBy = swept.get(point);
          ctx.strokeStyle = sweptBy ? alpha(sweptBy, 0.9) : faint;
          ctx.stroke();
        }
      }

      // Past the wick, clear of where that candle's own dot would go, pointing back at it.
      for (const sweep of shown) {
        const x = this.x(sweep.index);
        const y = this.y(sweep.reach);
        if (x == null || y == null) continue;
        const dir = sweep.kind === 'high' ? -1 : 1;
        const tip = y + dir * (GAP + radius * 2 + 2);
        const base = tip + dir * half * 1.3;
        ctx.beginPath();
        ctx.moveTo(x * hr, tip * vr);
        ctx.lineTo((x - half) * hr, base * vr);
        ctx.lineTo((x + half) * hr, base * vr);
        ctx.closePath();
        ctx.fillStyle = color(sweep);
        ctx.fill();
      }
      ctx.restore();
    });
  }
}
