// Mouse handling for the drawing tools. Sits in front of the chart (capture
// phase) and claims a mousedown only when it belongs to a tool — everything
// else falls through to lightweight-charts for panning and zooming.

import type { ChartController, PanePoint } from './controller';
import type { MeasurePoint } from './primitives/measure';
import type { PositionLine } from './primitives/position';
import type { Corner, ZoneView } from './primitives/zones';

export type ToolMode = 'none' | 'level' | 'zone' | 'measure' | 'moveStop';

/** A zone's shape, without its id. */
export type ZoneShape = Omit<ZoneView, 'id'>;

/** What the chart asks of the app. Implemented by the chart component. */
export interface InteractionHost {
  mode(): ToolMode;
  setMode(mode: ToolMode): void;
  /** Rounds a raw price to the market's tick precision. */
  snap(price: number): number;
  placeLevel(price: number): void;
  selectLevel(id: string | null): void;
  moveLevel(id: string, price: number): void;
  addZone(shape: ZoneShape): void;
  selectZone(id: string | null): void;
  updateZone(id: string, shape: ZoneShape): void;
  clickStop(price: number): void;
  beginDrag(line: PositionLine): void;
  drag(line: PositionLine, price: number): void;
  endDrag(line: PositionLine): void;
}

/** A point in chart terms: a bar index and a price. */
interface BarPoint {
  logical: number;
  price: number;
}

type Drag =
  | { kind: 'level'; id: string; startY: number; moved: boolean }
  | { kind: 'position'; line: PositionLine }
  | { kind: 'measure'; start: PanePoint; moved: boolean }
  | { kind: 'zone-new'; from: BarPoint; start: PanePoint; moved: boolean }
  | { kind: 'zone-move'; id: string; from: BarPoint; original: ZoneShape }
  | { kind: 'zone-resize'; id: string; anchor: BarPoint };

/** Pixels the mouse must travel before a press counts as a drag. */
const DRAG_THRESHOLD = 3;

/**
 * How far the mouse may wander between press and release and still count as a
 * click when starting a zone. More forgiving than a drag threshold, because a
 * click is the normal way to start one.
 */
const CLICK_SLOP = 6;

const OPPOSITE: Record<Corner, Corner> = { tl: 'br', tr: 'bl', bl: 'tr', br: 'tl' };

export class Interaction {
  #el: HTMLElement;
  #chart: ChartController;
  #host: InteractionHost;
  #drag: Drag | null = null;
  /** Measuring click-to-click: the rectangle follows the mouse until the next click. */
  #measureFollows = false;
  /** Drawing a zone click-to-click: its first corner, while the box follows the mouse. */
  #zoneFrom: BarPoint | null = null;
  /** A press on an unselected zone: becomes a selection if the mouse does not move. */
  #zonePress: { id: string; x: number; y: number } | null = null;

  constructor(el: HTMLElement, chart: ChartController, host: InteractionHost) {
    this.#el = el;
    this.#chart = chart;
    this.#host = host;
    el.addEventListener('mousedown', this.#onDown, true);
    el.addEventListener('mousemove', this.#onHover);
  }

  destroy(): void {
    this.#el.removeEventListener('mousedown', this.#onDown, true);
    this.#el.removeEventListener('mousemove', this.#onHover);
    window.removeEventListener('mouseup', this.#onZoneRelease);
    this.#release();
  }

  /** Clears the measure tool. Returns true if there was something to clear. */
  clearMeasure(): boolean {
    this.#measureFollows = false;
    if (this.#drag?.kind === 'measure') this.#release();
    return this.#chart.measure.clear();
  }

  /** Abandons a zone that is being drawn. Returns true if there was one. */
  #cancelZone(): boolean {
    const drawing = this.#zoneFrom != null || this.#drag?.kind === 'zone-new';
    if (this.#drag?.kind === 'zone-new') this.#release();
    this.#zoneFrom = null;
    this.#chart.zones.setDraft(null);
    return drawing;
  }

  /**
   * Esc: backs out of whatever is being drawn, or clears a finished
   * measurement. Returns true if it did anything.
   */
  cancelDrawing(): boolean {
    if (this.#cancelZone()) {
      this.#host.setMode('none');
      return true;
    }
    return this.clearMeasure();
  }

  /** Completes the zone being drawn with `point` as its second corner. */
  #finishZone(from: BarPoint, point: PanePoint): void {
    const to = this.#barPoint(point);
    const shape = to ? this.#zoneBetween(from, to) : null;
    this.#cancelZone();
    this.#host.setMode('none');
    if (shape) this.#host.addZone(shape);
  }

  #measurePoint(point: PanePoint): MeasurePoint | null {
    const logical = this.#chart.logicalAt(point.x);
    const price = this.#chart.priceAt(point.y);
    return logical != null && price != null ? { logical, price } : null;
  }

  /** A pane point as a whole bar index and a tick-rounded price. */
  #barPoint(point: PanePoint): BarPoint | null {
    const logical = this.#chart.logicalAt(point.x);
    const price = this.#chart.priceAt(point.y);
    return logical != null && price != null ? { logical: Math.round(logical), price: this.#host.snap(price) } : null;
  }

  #priceAt(y: number): number | null {
    const price = this.#chart.priceAt(y);
    return price != null ? this.#host.snap(price) : null;
  }

  /**
   * The zone spanned by two points, or null if it has no height.
   *
   * A zone whose right edge is past the latest candle has no end: it keeps
   * extending to the right as new candles arrive.
   */
  #zoneBetween(a: BarPoint, b: BarPoint): ZoneShape | null {
    const top = Math.max(a.price, b.price);
    const bottom = Math.min(a.price, b.price);
    if (!(top > bottom)) return null;
    const left = Math.min(a.logical, b.logical);
    // At least one bar wide.
    const right = Math.max(a.logical, b.logical, left + 1);
    const chart = this.#chart;
    return {
      t1: chart.timeOfLogical(left),
      t2: right > chart.lastIndex ? null : chart.timeOfLogical(right),
      top,
      bottom
    };
  }

  /** A zone's corner as a point. An open-ended zone's right side is at infinity. */
  #cornerOf(zone: ZoneShape, corner: Corner): BarPoint {
    const chart = this.#chart;
    const left = corner === 'tl' || corner === 'bl';
    const top = corner === 'tl' || corner === 'tr';
    return {
      logical: left ? Math.round(chart.logicalOfTime(zone.t1)) : zone.t2 == null ? Infinity : Math.round(chart.logicalOfTime(zone.t2)),
      price: top ? zone.top : zone.bottom
    };
  }

  /** Stops lightweight-charts from seeing this press, so it does not pan. */
  #claim(event: MouseEvent): void {
    event.stopPropagation();
    event.preventDefault();
  }

  #capture(drag: Drag): void {
    this.#drag = drag;
    window.addEventListener('mousemove', this.#onMove);
    window.addEventListener('mouseup', this.#onUp);
  }

  #release(): void {
    this.#drag = null;
    window.removeEventListener('mousemove', this.#onMove);
    window.removeEventListener('mouseup', this.#onUp);
  }

  #onDown = (event: MouseEvent): void => {
    if (event.button !== 0) return;
    const point = this.#chart.panePoint(event);
    if (!point) return;
    const { measure, position, levels, zones } = this.#chart;
    const mode = this.#host.mode();

    // Second click of a click-to-click measurement.
    if (this.#measureFollows) {
      this.#claim(event);
      this.#measureFollows = false;
      measure.finish();
      return;
    }
    // Second click of a click-to-click zone. (If the tool was switched off in
    // between, the half-drawn zone is simply dropped.)
    if (this.#zoneFrom) {
      const from = this.#zoneFrom;
      if (mode === 'zone') {
        this.#claim(event);
        this.#finishZone(from, point);
        return;
      }
      this.#cancelZone();
    }
    // A finished measurement goes away on the next click, whatever that click does.
    if (measure.done) measure.clear();

    if (mode === 'measure' || event.shiftKey) {
      const start = this.#measurePoint(point);
      if (!start) return;
      this.#claim(event);
      measure.start(start);
      this.#capture({ kind: 'measure', start: point, moved: false });
      return;
    }

    if (mode === 'zone') {
      const from = this.#barPoint(point);
      if (!from) return;
      this.#claim(event);
      this.#capture({ kind: 'zone-new', from, start: point, moved: false });
      return;
    }

    if (mode === 'level' || mode === 'moveStop') {
      const price = this.#priceAt(point.y);
      if (price == null) return;
      this.#claim(event);
      this.#host.setMode('none');
      if (mode === 'level') this.#host.placeLevel(price);
      else this.#host.clickStop(price);
      return;
    }

    const line = position.lineAt(point.x, point.y);
    if (line) {
      this.#claim(event);
      position.freeze(true);
      this.#host.beginDrag(line);
      this.#capture({ kind: 'position', line });
      return;
    }

    const levelId = levels.levelAt(point.y);
    if (levelId) {
      this.#claim(event);
      this.#host.selectLevel(levelId);
      this.#capture({ kind: 'level', id: levelId, startY: event.clientY, moved: false });
      return;
    }

    // A corner handle of the selected zone resizes it from the opposite corner.
    const handle = zones.handleAt(point.x, point.y);
    const handled = handle ? zones.find(handle.id) : undefined;
    if (handle && handled) {
      this.#claim(event);
      this.#capture({ kind: 'zone-resize', id: handle.id, anchor: this.#cornerOf(handled, OPPOSITE[handle.corner]) });
      return;
    }

    const zoneId = zones.zoneAt(point.x, point.y);
    const zone = zoneId ? zones.find(zoneId) : undefined;
    if (zone && zones.selected === zone.id) {
      const from = this.#barPoint(point);
      if (!from) return;
      this.#claim(event);
      this.#capture({ kind: 'zone-move', id: zone.id, from, original: { ...zone } });
      return;
    }

    this.#host.selectLevel(null);
    this.#host.selectZone(null);
    // Zones can be large, so dragging across one must still pan the chart.
    // Only a press that goes nowhere selects it.
    if (zone) {
      this.#zonePress = { id: zone.id, x: event.clientX, y: event.clientY };
      window.addEventListener('mouseup', this.#onZoneRelease);
    }
  };

  #onZoneRelease = (event: MouseEvent): void => {
    window.removeEventListener('mouseup', this.#onZoneRelease);
    const press = this.#zonePress;
    this.#zonePress = null;
    if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) <= DRAG_THRESHOLD) {
      this.#host.selectZone(press.id);
    }
  };

  /** Mouse position relative to the chart, clamped into the plot area. */
  #clamped(event: MouseEvent): PanePoint {
    const rect = this.#el.getBoundingClientRect();
    const pane = this.#chart.paneSize();
    return {
      x: Math.max(0, Math.min(event.clientX - rect.left, pane.width)),
      y: Math.max(0, Math.min(event.clientY - rect.top, pane.height))
    };
  }

  #onMove = (event: MouseEvent): void => {
    const drag = this.#drag;
    if (!drag) return;
    const point = this.#clamped(event);

    if (drag.kind === 'measure') {
      const far = Math.hypot(point.x - drag.start.x, point.y - drag.start.y) > DRAG_THRESHOLD;
      drag.moved ||= far;
      const end = this.#measurePoint(point);
      if (end) this.#chart.measure.move(end);
      return;
    }

    if (drag.kind === 'zone-new') {
      drag.moved ||= Math.hypot(point.x - drag.start.x, point.y - drag.start.y) > CLICK_SLOP;
      this.#previewZone(drag.from, point);
      return;
    }

    if (drag.kind === 'zone-move' || drag.kind === 'zone-resize') {
      const to = this.#barPoint(point);
      if (to) this.#dragZone(drag, to);
      return;
    }

    const price = this.#priceAt(point.y);
    if (price == null) return;
    if (drag.kind === 'position') {
      this.#host.drag(drag.line, price);
    } else {
      drag.moved ||= Math.abs(event.clientY - drag.startY) > DRAG_THRESHOLD;
      if (drag.moved) this.#host.moveLevel(drag.id, price);
    }
  };

  /** Shows the zone being drawn, from its first corner to the mouse. */
  #previewZone(from: BarPoint, point: PanePoint): void {
    const to = this.#barPoint(point);
    this.#chart.zones.setDraft(to ? this.#zoneBetween(from, to) : null);
  }

  #dragZone(drag: Extract<Drag, { kind: 'zone-move' | 'zone-resize' }>, to: BarPoint): void {
    const chart = this.#chart;

    if (drag.kind === 'zone-resize') {
      const shape = this.#zoneBetween(drag.anchor, to);
      if (shape) this.#host.updateZone(drag.id, shape);
      return;
    }

    // Move: shift by whole bars and by price, keeping the size.
    const { original } = drag;
    const bars = to.logical - drag.from.logical;
    const delta = to.price - drag.from.price;
    const shift = (ms: number) => chart.timeOfLogical(Math.round(chart.logicalOfTime(ms)) + bars);
    this.#host.updateZone(drag.id, {
      t1: shift(original.t1),
      t2: original.t2 == null ? null : shift(original.t2),
      top: this.#host.snap(original.top + delta),
      bottom: this.#host.snap(original.bottom + delta)
    });
  }

  #onUp = (event: MouseEvent): void => {
    const drag = this.#drag;
    this.#release();
    if (!drag) return;

    if (drag.kind === 'position') {
      this.#chart.position.freeze(false);
      this.#host.endDrag(drag.line);
    } else if (drag.kind === 'measure') {
      // Press-drag-release finishes here. A plain click starts click-to-click
      // mode instead: the box follows the mouse until the next click.
      if (drag.moved) this.#chart.measure.finish();
      else this.#measureFollows = true;
      if (this.#host.mode() === 'measure') this.#host.setMode('none');
    } else if (drag.kind === 'zone-new') {
      // Click, move, click: releasing where you pressed leaves the zone
      // following the mouse, and the next click sets its far corner. Pressing,
      // dragging and releasing still works too.
      if (drag.moved) this.#finishZone(drag.from, this.#clamped(event));
      else this.#zoneFrom = drag.from;
    }
  };

  #onHover = (event: MouseEvent): void => {
    if (this.#zoneFrom) {
      if (this.#host.mode() === 'zone') this.#previewZone(this.#zoneFrom, this.#clamped(event));
      else this.#cancelZone();
      return;
    }
    if (!this.#measureFollows) return;
    const end = this.#measurePoint(this.#clamped(event));
    if (end) this.#chart.measure.move(end);
  };
}
