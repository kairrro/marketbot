import type { ISeriesPrimitiveAxisView, PrimitiveHoveredItem } from 'lightweight-charts';
import { fillRect, hLine, type Target } from '../draw';
import { alpha, type ChartTheme } from '../theme';
import { Primitive } from './base';

export interface LevelView {
  id: string;
  price: number;
}

/** Pixels either side of a line that still count as "on" it. */
export const HIT_TOLERANCE = 5;

/** Horizontal price levels: dashed lines across the pane, each with an axis label. */
export class LevelsPrimitive extends Primitive {
  #levels: LevelView[] = [];
  #selected: string | null = null;
  #format: (price: number) => string = String;
  #axisViews: ISeriesPrimitiveAxisView[] = [];

  constructor(theme: ChartTheme) {
    super(theme);
  }

  set(levels: readonly LevelView[], selected: string | null, format: (price: number) => string): void {
    this.#levels = levels.map((level) => ({ ...level }));
    this.#selected = selected;
    this.#format = format;
    // A new array every time the set changes, as the library's cache requires.
    this.#axisViews = this.#levels.map((level) => this.#axisView(level));
    this.invalidate();
  }

  #color(level: LevelView): string {
    return level.id === this.#selected ? this.theme.accent : this.theme.level;
  }

  #axisView(level: LevelView): ISeriesPrimitiveAxisView {
    return {
      coordinate: () => this.y(level.price) ?? -1000,
      text: () => this.#format(level.price),
      textColor: () => (level.id === this.#selected ? '#ffffff' : this.theme.bg),
      backColor: () => this.#color(level),
      visible: () => this.y(level.price) != null
    };
  }

  priceAxisViews(): readonly ISeriesPrimitiveAxisView[] {
    return this.#axisViews;
  }

  /** The level under a y coordinate, nearest first. */
  levelAt(y: number): string | null {
    let best: string | null = null;
    let bestDistance = HIT_TOLERANCE + 1;
    for (const level of this.#levels) {
      const ly = this.y(level.price);
      if (ly == null) continue;
      const distance = Math.abs(ly - y);
      if (distance < bestDistance) {
        best = level.id;
        bestDistance = distance;
      }
    }
    return best;
  }

  hitTest(_x: number, y: number): PrimitiveHoveredItem | null {
    const id = this.levelAt(y);
    return id ? { externalId: `level:${id}`, cursorStyle: 'ns-resize', zOrder: 'normal' } : null;
  }

  protected draw(target: Target): void {
    target.useMediaCoordinateSpace(({ mediaSize }) => {
      for (const level of this.#levels) {
        const y = this.y(level.price);
        if (y == null) continue;
        const selected = level.id === this.#selected;
        hLine(target, y, 0, mediaSize.width, {
          color: selected ? this.theme.accent : alpha(this.theme.level, 0.75),
          dash: selected ? undefined : [5, 4]
        });
        // A small grip on the selected level shows it can be dragged or deleted.
        if (selected) fillRect(target, mediaSize.width - 14, y - 3, mediaSize.width - 8, y + 3, this.theme.accent);
      }
    });
  }
}
