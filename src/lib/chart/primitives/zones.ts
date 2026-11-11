import type { PrimitiveHoveredItem } from 'lightweight-charts';
import { fillRect, type Target } from '../draw';
import { alpha, type ChartTheme } from '../theme';
import { Primitive } from './base';

/** A zone as the chart draws it: a box in time and price. */
export interface ZoneView {
  id: string;
  /** Open time (ms) of the candle the box starts on. */
  t1: number;
  /** Open time of the candle it ends on, or null to run to the right edge. */
  t2: number | null;
  top: number;
  bottom: number;
}

export type Corner = 'tl' | 'tr' | 'bl' | 'br';

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

const HANDLE = 7;
const HANDLE_REACH = 7;
const FILL = 0.13;
const FILL_SELECTED = 0.22;

/**
 * Rectangle zones: plain translucent boxes with no border, drawn behind the
 * candles. Times are absolute, so a zone marked on 15m sits in the same place
 * on 5m or 1h. The selected zone shows corner handles for resizing.
 */
export class ZonesPrimitive extends Primitive {
  #zones: ZoneView[] = [];
  #selected: string | null = null;
  /** A zone being drawn right now. */
  #draft: ZoneView | null = null;
  #toLogical: (ms: number) => number;

  constructor(theme: ChartTheme, toLogical: (ms: number) => number) {
    super(theme);
    this.zOrder = 'bottom';
    this.#toLogical = toLogical;
  }

  set(zones: readonly ZoneView[], selected: string | null): void {
    this.#zones = zones.map((zone) => ({ ...zone }));
    this.#selected = selected;
    this.invalidate();
  }

  setDraft(draft: Omit<ZoneView, 'id'> | null): void {
    this.#draft = draft ? { ...draft, id: '' } : null;
    this.invalidate();
  }

  get selected(): string | null {
    return this.#selected;
  }

  find(id: string): ZoneView | undefined {
    return this.#zones.find((zone) => zone.id === id);
  }

  #paneWidth(): number {
    return this.chart?.timeScale().width() ?? 0;
  }

  /** Pixel box of a zone, or null while the chart cannot place it. */
  #box(zone: ZoneView, width: number): Box | null {
    const left = this.x(this.#toLogical(zone.t1));
    const right = zone.t2 == null ? width : this.x(this.#toLogical(zone.t2));
    const top = this.y(zone.top);
    const bottom = this.y(zone.bottom);
    if (left == null || right == null || top == null || bottom == null) return null;
    return { left, right, top, bottom };
  }

  /** Handle positions, pulled just inside the pane where a zone runs off its right edge. */
  #corners(box: Box, width: number): Record<Corner, [number, number]> {
    const right = Math.min(box.right, width - HANDLE);
    return { tl: [box.left, box.top], tr: [right, box.top], bl: [box.left, box.bottom], br: [right, box.bottom] };
  }

  /** The topmost zone under a point. */
  zoneAt(x: number, y: number): string | null {
    const width = this.#paneWidth();
    for (let i = this.#zones.length - 1; i >= 0; i--) {
      const box = this.#box(this.#zones[i], width);
      if (box && x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) return this.#zones[i].id;
    }
    return null;
  }

  /** The resize handle of the selected zone under a point. */
  handleAt(x: number, y: number): { id: string; corner: Corner } | null {
    const zone = this.#selected ? this.find(this.#selected) : undefined;
    const box = zone ? this.#box(zone, this.#paneWidth()) : null;
    if (!zone || !box) return null;
    const corners = this.#corners(box, this.#paneWidth());
    for (const corner of Object.keys(corners) as Corner[]) {
      const [cx, cy] = corners[corner];
      if (Math.abs(cx - x) <= HANDLE_REACH && Math.abs(cy - y) <= HANDLE_REACH) return { id: zone.id, corner };
    }
    return null;
  }

  hitTest(x: number, y: number): PrimitiveHoveredItem | null {
    const handle = this.handleAt(x, y);
    if (handle) {
      const cursorStyle = handle.corner === 'tl' || handle.corner === 'br' ? 'nwse-resize' : 'nesw-resize';
      return { externalId: `zone:${handle.id}:${handle.corner}`, cursorStyle, zOrder: 'top' };
    }
    const id = this.zoneAt(x, y);
    if (!id) return null;
    // Only a selected zone can be dragged; an unselected one lets the chart pan.
    return { externalId: `zone:${id}`, cursorStyle: id === this.#selected ? 'move' : 'pointer', zOrder: 'bottom' };
  }

  protected draw(target: Target): void {
    const zones = this.#draft ? [...this.#zones, this.#draft] : this.#zones;
    if (zones.length === 0) return;

    target.useMediaCoordinateSpace(({ mediaSize }) => {
      for (const zone of zones) {
        const box = this.#box(zone, mediaSize.width);
        if (!box) continue;
        const selected = zone.id !== '' && zone.id === this.#selected;
        fillRect(target, box.left, box.top, box.right, box.bottom, alpha(this.theme.accent, selected ? FILL_SELECTED : FILL));

        if (!selected) continue;
        for (const [cx, cy] of Object.values(this.#corners(box, mediaSize.width))) {
          const half = HANDLE / 2;
          fillRect(target, cx - half - 1, cy - half - 1, cx + half + 1, cy + half + 1, this.theme.bg);
          fillRect(target, cx - half, cy - half, cx + half, cy + half, this.theme.accent);
        }
      }
    });
  }
}
