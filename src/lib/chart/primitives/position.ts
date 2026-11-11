import type { AutoscaleInfo, ISeriesPrimitiveAxisView, PrimitiveHoveredItem } from 'lightweight-charts';
import type { Side } from '$lib/engine/types';
import { fillRect, hLine, pill, type Target } from '../draw';
import { alpha, type ChartTheme } from '../theme';
import { Primitive } from './base';
import { HIT_TOLERANCE } from './levels';

export type PositionLine = 'entry' | 'stop' | 'target';

/** Everything the position tool needs to draw. Built by `positionView.ts`. */
export interface PositionView {
  side: Side;
  entry: number;
  stop: number;
  target: number;
  /** The +1R guide line. */
  oneR: number;
  /** Bar index the zones start at. null = left edge of the pane. */
  fromLogical: number | null;
  labels: { entry: string; stop: string; target: string; oneR: string; stopWarning?: string };
  draggable: Record<PositionLine, boolean>;
  /** The target is a take-profit order rather than a guide. */
  targetIsOrder: boolean;
  /** A limit entry that has not filled: its line is dashed. */
  entryPending?: boolean;
  format: (price: number) => string;
}

const ZONE_OPACITY = 0.09;

/**
 * TradingView-style long/short position: an entry line with a soft red risk
 * zone down to the stop and a soft green reward zone up to the target (mirrored
 * for shorts). The stop and target lines can be dragged, and so can the entry
 * while it is a limit order that has not filled.
 *
 * Orders are drawn solid: always the stop, and the target when it is a
 * take-profit order. Otherwise the target and +1R are dashed: they are where
 * the trader plans to take profit, not orders.
 */
export class PositionPrimitive extends Primitive {
  #view: PositionView | null = null;
  #axisViews: ISeriesPrimitiveAxisView[] = [];
  #frozen: AutoscaleInfo | null = null;

  constructor(theme: ChartTheme) {
    super(theme);
  }

  set(view: PositionView | null): void {
    const shapeChanged = (view == null) !== (this.#view == null);
    this.#view = view;
    // Axis labels read the live view, so the array only needs replacing when
    // the tool appears or disappears.
    if (shapeChanged) this.#axisViews = this.#buildAxisViews();
    this.invalidate();
  }

  #buildAxisViews(): ISeriesPrimitiveAxisView[] {
    if (!this.#view) return [];
    const label = (price: () => number | undefined, color: string): ISeriesPrimitiveAxisView => ({
      coordinate: () => {
        const value = price();
        return (value != null ? this.y(value) : null) ?? -1000;
      },
      text: () => {
        const value = price();
        return value != null ? (this.#view?.format(value) ?? '') : '';
      },
      textColor: () => '#ffffff',
      backColor: () => color,
      visible: () => price() != null
    });
    return [
      label(() => this.#view?.entry, this.theme.accent),
      label(() => this.#view?.stop, this.theme.red),
      label(() => this.#view?.target, this.theme.green)
    ];
  }

  priceAxisViews(): readonly ISeriesPrimitiveAxisView[] {
    return this.#axisViews;
  }

  #range(): AutoscaleInfo | null {
    const view = this.#view;
    if (!view) return null;
    const prices = [view.entry, view.stop, view.target, view.oneR];
    return { priceRange: { minValue: Math.min(...prices), maxValue: Math.max(...prices) } };
  }

  /** Keeps the stop and target on screen when the price scale auto-fits. */
  autoscaleInfo(): AutoscaleInfo | null {
    return this.#frozen ?? this.#range();
  }

  /**
   * Holds the price scale still while a line is dragged. Without this the scale
   * would re-fit on every mouse move and the line would slide under the cursor.
   */
  freeze(on: boolean): void {
    this.#frozen = on ? this.#range() : null;
    if (!on) this.invalidate();
  }

  #fromX(): number {
    const from = this.#view?.fromLogical;
    return Math.max(0, (from != null ? this.x(from) : null) ?? 0);
  }

  /** The draggable line under a point, if any. */
  lineAt(x: number, y: number): PositionLine | null {
    const view = this.#view;
    if (!view || x < this.#fromX() - HIT_TOLERANCE) return null;
    const near = (price: number) => {
      const py = this.y(price);
      return py != null && Math.abs(py - y) <= HIT_TOLERANCE;
    };
    if (view.draggable.stop && near(view.stop)) return 'stop';
    if (view.draggable.target && near(view.target)) return 'target';
    if (view.draggable.entry && near(view.entry)) return 'entry';
    return null;
  }

  hitTest(x: number, y: number): PrimitiveHoveredItem | null {
    const line = this.lineAt(x, y);
    return line ? { externalId: `position:${line}`, cursorStyle: 'ns-resize', zOrder: 'top' } : null;
  }

  protected draw(target: Target): void {
    const view = this.#view;
    if (!view) return;
    const { green, red, accent, surface, text } = this.theme;

    target.useMediaCoordinateSpace(({ mediaSize }) => {
      const yEntry = this.y(view.entry);
      const yStop = this.y(view.stop);
      const yTarget = this.y(view.target);
      const yOneR = this.y(view.oneR);
      if (yEntry == null || yStop == null || yTarget == null) return;
      const left = this.#fromX();
      const right = mediaSize.width;
      if (left >= right) return;

      fillRect(target, left, yEntry, right, yStop, alpha(red, ZONE_OPACITY));
      fillRect(target, left, yEntry, right, yTarget, alpha(green, ZONE_OPACITY));

      if (yOneR != null) hLine(target, yOneR, left, right, { color: alpha(green, 0.45), dash: [3, 4] });
      hLine(target, yTarget, left, right, { color: alpha(green, 0.9), dash: view.targetIsOrder ? undefined : [7, 4] });
      hLine(target, yStop, left, right, { color: alpha(red, 0.9) });
      hLine(target, yEntry, left, right, { color: alpha(accent, 0.9), dash: view.entryPending ? [7, 4] : undefined });

      const style = { font: this.font(), color: text, background: alpha(surface, 0.94), bounds: mediaSize };
      const labelX = right - 10;
      const tag = (y: number | null, label: string, color: string, warning?: string) => {
        if (y == null || !label) return;
        const lines = warning ? [{ text: label }, { text: warning, color: red }] : [{ text: label }];
        pill(target, lines, labelX, y, { ...style, border: alpha(color, 0.55), align: 'right' });
      };
      // Skip the +1R tag when it would sit on top of a neighbouring label.
      if (yOneR != null && Math.abs(yOneR - yEntry) > 26 && Math.abs(yOneR - yTarget) > 26) {
        tag(yOneR, view.labels.oneR, green);
      }
      tag(yTarget, view.labels.target, green);
      tag(yStop, view.labels.stop, red, view.labels.stopWarning);
      tag(yEntry, view.labels.entry, accent);
    });
  }
}
