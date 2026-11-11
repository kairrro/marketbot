import type { IPrimitivePaneRenderer, IPrimitivePaneView } from 'lightweight-charts';
import type { Playbook } from '$lib/strategy/playbook';
import { fillRect, hLine, type Target } from '../draw';
import { alpha, type ChartTheme } from '../theme';
import { Primitive } from './base';

const ORANGE = '#f59e0b';
const WINDOW_TINT = 0.05;
/** Distance from a candle's wick to the nearest edge of a mark, in CSS pixels. Clears the swing dots. */
const GAP = 14;
/** Distance to the "Long day" / "Short day" labels, past the marks. */
const LABEL_GAP = 26;
/** Ranges narrower than this (CSS px) are left unlabelled. */
const LABEL_MIN_WIDTH = 44;

/**
 * The playbook: a faint tint over each trading window, the day's opening range
 * as dashed orange lines, a label where the day bias is set or flips, a triangle
 * on every Setup A and a small gray dot on every other signal candle.
 *
 * Everything sits at bar indexes of the chart's own 1m candles. The tint is
 * drawn behind the candles; the rest in front of them.
 */
export class PlaybookPrimitive extends Primitive {
  #playbook: Playbook | null = null;
  #views: readonly IPrimitivePaneView[];

  constructor(theme: ChartTheme) {
    super(theme);
    const layer = (zOrder: 'bottom' | 'normal', draw: (target: Target) => void): IPrimitivePaneView => {
      const renderer: IPrimitivePaneRenderer = { draw };
      return { zOrder: () => zOrder, renderer: () => renderer };
    };
    this.#views = [layer('bottom', (target) => this.#drawTint(target)), layer('normal', (target) => this.draw(target))];
  }

  set(playbook: Playbook | null): void {
    this.#playbook = playbook;
    this.invalidate();
  }

  override paneViews(): readonly IPrimitivePaneView[] {
    return this.#views;
  }

  #drawTint(target: Target): void {
    const visible = this.chart?.timeScale().getVisibleLogicalRange();
    if (!this.#playbook || !visible) return;
    target.useMediaCoordinateSpace(({ mediaSize }) => {
      for (const window of this.#playbook!.windows) {
        if (window.from - 1 > visible.to || window.to + 1 < visible.from) continue;
        const left = this.x(window.from - 0.5);
        const right = this.x(window.to + 0.5);
        if (left == null || right == null) continue;
        fillRect(target, left, 0, right, mediaSize.height, alpha(this.theme.accent, WINDOW_TINT));
      }
    });
  }

  protected draw(target: Target): void {
    const playbook = this.#playbook;
    const visible = this.chart?.timeScale().getVisibleLogicalRange();
    if (!playbook || !visible) return;
    const from = visible.from - 1;
    const to = visible.to + 1;
    const x0 = this.x(0);
    const x1 = this.x(1);
    if (x0 == null || x1 == null) return;
    const spacing = x1 - x0;
    const { green, red } = this.theme;

    // Opening range of the day at the cursor, once its five minutes are in.
    const range = playbook.current;
    if (range?.complete && range.first - 1 <= to && range.end + 1 >= from) {
      const left = this.x(range.first - 0.5);
      const right = this.x(range.end + 0.5);
      const yHigh = this.y(range.high);
      const yLow = this.y(range.low);
      if (left != null && right != null && yHigh != null && yLow != null) {
        const style = { color: alpha(ORANGE, 0.9), dash: [5, 4] };
        hLine(target, yHigh, left, right, style);
        hLine(target, yLow, left, right, style);
        if (right - left >= LABEL_MIN_WIDTH) {
          target.useMediaCoordinateSpace(({ context: ctx }) => {
            ctx.save();
            ctx.font = this.font(10);
            ctx.fillStyle = alpha(ORANGE, 0.95);
            ctx.textAlign = 'left';
            ctx.textBaseline = 'bottom';
            ctx.fillText('OR H', left + 3, yHigh - 3);
            ctx.textBaseline = 'top';
            ctx.fillText('OR L', left + 3, yLow + 3);
            ctx.restore();
          });
        }
      }
    }

    const half = Math.max(5, Math.min(7, spacing * 0.5));
    const height = half * 1.8;
    const dot = Math.max(2, Math.min(3, spacing * 0.3));

    target.useMediaCoordinateSpace(({ context: ctx }) => {
      ctx.save();
      ctx.textAlign = 'center';

      for (const mark of playbook.markers) {
        if (mark.index < from || mark.index > to) continue;
        const x = this.x(mark.index);
        const long = mark.side === 'long';
        // Bullish marks go below the candle, bearish above.
        const edge = this.y(long ? mark.low : mark.high);
        if (x == null || edge == null) continue;
        const dir = long ? 1 : -1;
        const color = long ? green : red;

        if (mark.kind === 'signal') {
          ctx.beginPath();
          ctx.arc(x, edge + dir * (GAP + dot), dot, 0, Math.PI * 2);
          ctx.fillStyle = alpha(this.theme.textMuted, 0.9);
          ctx.fill();
          continue;
        }

        // Setup A: a triangle pointing at the candle, with an "A" in it.
        const tip = edge + dir * GAP;
        const base = tip + dir * height;
        ctx.beginPath();
        ctx.moveTo(x, tip);
        ctx.lineTo(x - half, base);
        ctx.lineTo(x + half, base);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
        ctx.font = this.font(Math.round(half * 1.3), 700);
        ctx.fillStyle = this.theme.bg;
        ctx.textBaseline = 'middle';
        ctx.fillText('A', x, tip + dir * height * 0.65);
      }

      // "Long day" above the candle, "Short day" below it: away from the marks on the other side.
      ctx.font = this.font(10, 600);
      for (const change of playbook.biasChanges) {
        if (change.index < from || change.index > to) continue;
        const long = change.bias === 'long';
        const x = this.x(change.index);
        const edge = this.y(long ? change.high : change.low);
        if (x == null || edge == null) continue;
        ctx.fillStyle = long ? green : red;
        ctx.textBaseline = long ? 'bottom' : 'top';
        ctx.fillText(long ? 'Long day' : 'Short day', x, edge + (long ? -LABEL_GAP : LABEL_GAP));
      }
      ctx.restore();
    });
  }
}
