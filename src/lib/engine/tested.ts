// Stretches of history already replayed, so the same data is never tested
// twice. Ranges are [start, end) in ms, sorted, and never overlap or touch.

import { zonedTime, type TimeZone } from '$lib/timezone';

export type Range = [number, number];

const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;
/** Untested time wanted after a start date: about a week of replay. */
export const RUNWAY_MS = 7 * DAY_MS;

/** `ranges` with [from, to) added, merged with anything it overlaps or touches. */
export function addRange(ranges: readonly Range[], from: number, to: number): Range[] {
  if (!(to > from)) return [...ranges];
  const out: Range[] = [];
  let start = from;
  let end = to;
  let placed = false;
  for (const [a, b] of ranges) {
    if (b < start) {
      out.push([a, b]);
    } else if (a > end) {
      if (!placed) out.push([start, end]);
      placed = true;
      out.push([a, b]);
    } else {
      start = Math.min(start, a);
      end = Math.max(end, b);
    }
  }
  if (!placed) out.push([start, end]);
  return out;
}

/** The parts of `ranges` that fall inside [from, to). */
export function overlapping(ranges: readonly Range[], from: number, to: number): Range[] {
  return ranges.filter(([a, b]) => a < to && b > from).map(([a, b]) => [Math.max(a, from), Math.min(b, to)]);
}

export function isTested(ranges: readonly Range[], time: number): boolean {
  return ranges.some(([a, b]) => a <= time && time < b);
}

/**
 * A random whole-hour start in [min, max] with `span` of untested time after
 * it. Every such hour is equally likely. Null when no gap is long enough.
 */
export function pickUntested(
  ranges: readonly Range[],
  min: number,
  max: number,
  span: number,
  random: () => number = Math.random
): number | null {
  const slots: Range[] = [];
  let free = min;
  for (const [a, b] of [...ranges, [Infinity, Infinity] as Range]) {
    const first = Math.ceil(free / HOUR_MS) * HOUR_MS;
    const last = Math.floor(Math.min(a - span, max) / HOUR_MS) * HOUR_MS;
    if (last >= first) slots.push([first, last]);
    free = Math.max(free, b);
    if (free > max) break;
  }
  const size = ([a, b]: Range) => (b - a) / HOUR_MS + 1;
  let pick = Math.floor(random() * slots.reduce((total, slot) => total + size(slot), 0));
  for (const slot of slots) {
    if (pick < size(slot)) return slot[0] + pick * HOUR_MS;
    pick -= size(slot);
  }
  return null;
}

/** How much of each month of `year` is tested, 0 to 1, with months as they fall in `zone`. */
export function monthCoverage(ranges: readonly Range[], year: number, zone: TimeZone): number[] {
  return Array.from({ length: 12 }, (_, month) => {
    const start = zonedTime(zone, year, month, 1);
    const end = zonedTime(zone, year, month + 1, 1);
    const tested = overlapping(ranges, start, end).reduce((total, [a, b]) => total + b - a, 0);
    return tested / (end - start);
  });
}
