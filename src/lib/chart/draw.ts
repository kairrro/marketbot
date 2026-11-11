// Canvas helpers shared by the primitives. Lines and rectangles are drawn in
// bitmap space so they stay crisp at any device pixel ratio; text is drawn in
// media (CSS pixel) space.

import type { IPrimitivePaneRenderer } from 'lightweight-charts';

/** The canvas target lightweight-charts hands to a renderer. */
export type Target = Parameters<IPrimitivePaneRenderer['draw']>[0];

export interface LineStyle {
  color: string;
  /** Dash pattern in CSS pixels. Solid when omitted. */
  dash?: number[];
}

export function hLine(target: Target, y: number, x1: number, x2: number, style: LineStyle): void {
  if (x2 <= x1) return;
  target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
    const width = Math.max(1, Math.floor(vr));
    const py = Math.round(y * vr) + (width % 2 ? 0.5 : 0);
    ctx.save();
    ctx.strokeStyle = style.color;
    ctx.lineWidth = width;
    ctx.setLineDash((style.dash ?? []).map((d) => d * hr));
    ctx.beginPath();
    ctx.moveTo(Math.round(x1 * hr), py);
    ctx.lineTo(Math.round(x2 * hr), py);
    ctx.stroke();
    ctx.restore();
  });
}

export function fillRect(target: Target, x1: number, y1: number, x2: number, y2: number, color: string): void {
  target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
    const left = Math.round(Math.min(x1, x2) * hr);
    const top = Math.round(Math.min(y1, y2) * vr);
    const right = Math.round(Math.max(x1, x2) * hr);
    const bottom = Math.round(Math.max(y1, y2) * vr);
    ctx.fillStyle = color;
    ctx.fillRect(left, top, right - left, bottom - top);
  });
}

/** 1px outline, drawn just inside the rectangle. */
export function strokeRect(target: Target, x1: number, y1: number, x2: number, y2: number, color: string): void {
  target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
    const width = Math.max(1, Math.floor(hr));
    const left = Math.round(Math.min(x1, x2) * hr);
    const top = Math.round(Math.min(y1, y2) * vr);
    const right = Math.round(Math.max(x1, x2) * hr);
    const bottom = Math.round(Math.max(y1, y2) * vr);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.strokeRect(left + width / 2, top + width / 2, right - left - width, bottom - top - width);
    ctx.restore();
  });
}

export interface PillLine {
  text: string;
  color?: string;
}

export interface PillStyle {
  font: string;
  color: string;
  background: string;
  border: string;
  /** Where (x, y) sits on the pill. */
  align?: 'left' | 'center' | 'right';
  baseline?: 'top' | 'middle' | 'bottom';
  /** Keep the pill inside this box (the pane), with a small margin. */
  bounds?: { width: number; height: number };
}

const PAD_X = 7;
const PAD_Y = 4;
const LINE_HEIGHT = 15;
const RADIUS = 5;

/** A small rounded label with one or more lines of text. */
export function pill(target: Target, lines: PillLine[], x: number, y: number, style: PillStyle): void {
  if (lines.length === 0) return;
  target.useMediaCoordinateSpace(({ context: ctx }) => {
    ctx.save();
    ctx.font = style.font;
    const width = Math.ceil(Math.max(...lines.map((line) => ctx.measureText(line.text).width))) + PAD_X * 2;
    const height = lines.length * LINE_HEIGHT + PAD_Y * 2 - 1;

    let left = style.align === 'right' ? x - width : style.align === 'center' ? x - width / 2 : x;
    let top = style.baseline === 'bottom' ? y - height : style.baseline === 'top' ? y : y - height / 2;
    if (style.bounds) {
      left = Math.max(4, Math.min(left, style.bounds.width - width - 4));
      top = Math.max(4, Math.min(top, style.bounds.height - height - 4));
    }
    left = Math.round(left);
    top = Math.round(top);

    ctx.beginPath();
    ctx.roundRect(left + 0.5, top + 0.5, width - 1, height - 1, RADIUS);
    ctx.fillStyle = style.background;
    ctx.fill();
    ctx.strokeStyle = style.border;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.textBaseline = 'middle';
    ctx.textAlign = style.align === 'center' ? 'center' : 'left';
    const textX = style.align === 'center' ? left + width / 2 : left + PAD_X;
    lines.forEach((line, i) => {
      ctx.fillStyle = line.color ?? style.color;
      ctx.fillText(line.text, textX, top + PAD_Y + LINE_HEIGHT * i + LINE_HEIGHT / 2);
    });
    ctx.restore();
  });
}
