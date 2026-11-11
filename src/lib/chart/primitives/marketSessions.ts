import type { MarketSessionId, SessionRange } from '$lib/engine/marketSessions';
import { fillRect, hLine, type Target } from '../draw';
import { alpha, type ChartTheme } from '../theme';
import { Primitive } from './base';

const BOX_FILL = 0.07;
const LINE = 0.8;
const CARRY = 0.5;
/** Boxes narrower than this (CSS px) are left unlabelled. */
const LABEL_MIN_WIDTH = 44;

/**
 * Market-session highlights: a faint box over each session's range, with its
 * high and low drawn as lines. After the session closes the two levels carry
 * on, dashed, until price trades through them or the same session opens
 * again. Drawn behind the candles, and purely visual: nothing here is clickable.
 */
export class MarketSessionsPrimitive extends Primitive {
  #ranges: readonly SessionRange[] = [];

  constructor(theme: ChartTheme) {
    super(theme);
    this.zOrder = 'bottom';
  }

  set(ranges: readonly SessionRange[]): void {
    this.#ranges = ranges;
    this.invalidate();
  }

  #color(id: MarketSessionId): string {
    if (id === 'asia') return this.theme.sessionAsia;
    if (id === 'london') return this.theme.sessionLondon;
    return this.theme.sessionNewYork;
  }

  protected draw(target: Target): void {
    const visible = this.chart?.timeScale().getVisibleLogicalRange();
    if (this.#ranges.length === 0 || !visible) return;

    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      for (const range of this.#ranges) {
        // Skip ranges whose box and carried levels are all off screen.
        const reach = range.live ? range.last : Math.max(range.highTo ?? Infinity, range.lowTo ?? Infinity);
        if (range.first - 1 > visible.to || reach + 1 < visible.from) continue;

        const left = this.x(range.first - 0.5);
        const right = this.x(range.last + 0.5);
        const yHigh = this.y(range.high);
        const yLow = this.y(range.low);
        if (left == null || right == null || yHigh == null || yLow == null) continue;
        const color = this.#color(range.session.id);

        fillRect(target, left, yHigh, right, yLow, alpha(color, BOX_FILL));
        hLine(target, yHigh, left, right, { color: alpha(color, LINE) });
        hLine(target, yLow, left, right, { color: alpha(color, LINE) });

        if (!range.live) {
          const carry = (y: number, to: number | null) => {
            const end = to == null ? mediaSize.width : this.x(to);
            if (end != null) hLine(target, y, right, end, { color: alpha(color, CARRY), dash: [4, 4] });
          };
          carry(yHigh, range.highTo);
          carry(yLow, range.lowTo);
        }

        // Nothing trades above a session's high or below its low inside the
        // box, so the labels sit just outside it without covering candles.
        if (right - left >= LABEL_MIN_WIDTH) {
          ctx.save();
          ctx.font = this.font(10);
          ctx.fillStyle = alpha(color, 0.95);
          ctx.textAlign = 'left';
          ctx.textBaseline = 'bottom';
          ctx.fillText(`${range.session.short} H`, left + 3, yHigh - 3);
          ctx.textBaseline = 'top';
          ctx.fillText(`${range.session.short} L`, left + 3, yLow + 3);
          ctx.restore();
        }
      }
    });
  }
}
