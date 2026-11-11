import { alpha, type ChartTheme } from '../theme';
import type { Target } from '../draw';
import { Primitive } from './base';

/** Bars between the latest candle and the ruler. */
const OFFSET_BARS = 2;
/** Distances marked, in ATRs: a solid dot for the first, a ring for the second. */
const STEPS = [1, 2] as const;

export interface AtrRuler {
  /** Bar index to draw beside: the latest candle. */
  index: number;
  /** Price the distances are measured from. */
  anchor: number;
  /** One ATR, in price. */
  atr: number;
}

/**
 * ATR as a ruler of dots in the empty space beside the latest candle: 1 and 2
 * ATRs above and below the price (or the entry, while a trade is being
 * planned), labelled "1×" and "2×". Read against the swing dots and the
 * candles, it shows at a glance where a stop of a given size would land; the
 * size itself is in the legend. Dots, not lines, like the swings.
 */
export class AtrPrimitive extends Primitive {
  #ruler: AtrRuler | null = null;

  constructor(theme: ChartTheme) {
    super(theme);
  }

  set(ruler: AtrRuler | null): void {
    this.#ruler = ruler;
    this.invalidate();
  }

  protected draw(target: Target): void {
    const ruler = this.#ruler;
    if (!ruler || !(ruler.atr > 0)) return;
    const x = this.x(ruler.index + OFFSET_BARS);
    if (x == null) return;

    const dots: { x: number; y: number; step: number; label: string }[] = [];
    for (const step of STEPS) {
      for (const dir of [-1, 1]) {
        const y = this.y(ruler.anchor + dir * step * ruler.atr);
        if (y != null) dots.push({ x, y, step, label: `${step}×` });
      }
    }

    const solid = alpha(this.theme.accent, 0.95);
    const faint = alpha(this.theme.accent, 0.55);
    const radius = 3;
    target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
      ctx.save();
      ctx.lineWidth = Math.max(1, Math.floor(hr));
      for (const dot of dots) {
        ctx.beginPath();
        ctx.arc(dot.x * hr, dot.y * vr, radius * hr, 0, Math.PI * 2);
        if (dot.step === 1) {
          ctx.fillStyle = solid;
          ctx.fill();
        } else {
          ctx.strokeStyle = faint;
          ctx.stroke();
        }
      }
      ctx.restore();
    });

    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      ctx.save();
      ctx.font = this.font(10.5, 500);
      ctx.textBaseline = 'middle';
      ctx.fillStyle = alpha(this.theme.textMuted, 0.95);
      for (const dot of dots) {
        const width = ctx.measureText(dot.label).width;
        // To the right of the dot, or to its left when that would run off the chart.
        const fits = dot.x + radius + 6 + width <= mediaSize.width - 2;
        ctx.textAlign = fits ? 'left' : 'right';
        ctx.fillText(dot.label, fits ? dot.x + radius + 6 : dot.x - radius - 6, dot.y);
      }
      ctx.restore();
    });
  }
}
