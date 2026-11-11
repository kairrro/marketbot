import { describe, expect, it } from 'vitest';
import { addRange, DAY_MS, isTested, monthCoverage, overlapping, pickUntested, type Range } from './tested';

const H = 3_600_000;

describe('addRange', () => {
  it('keeps ranges sorted and apart', () => {
    let ranges: Range[] = [];
    ranges = addRange(ranges, 50, 60);
    ranges = addRange(ranges, 10, 20);
    ranges = addRange(ranges, 30, 40);
    expect(ranges).toEqual([
      [10, 20],
      [30, 40],
      [50, 60]
    ]);
  });

  it('merges a range that overlaps or touches others', () => {
    const ranges: Range[] = [
      [10, 20],
      [30, 40],
      [50, 60]
    ];
    expect(addRange(ranges, 15, 35)).toEqual([
      [10, 40],
      [50, 60]
    ]);
    // Step by step, each candle starts where the last one ended.
    expect(addRange(ranges, 40, 45)).toEqual([
      [10, 20],
      [30, 45],
      [50, 60]
    ]);
    expect(addRange(ranges, 0, 100)).toEqual([[0, 100]]);
  });

  it('ignores an empty range and never changes the one it was given', () => {
    const ranges: Range[] = [[10, 20]];
    expect(addRange(ranges, 30, 30)).toEqual([[10, 20]]);
    addRange(ranges, 15, 25);
    expect(ranges).toEqual([[10, 20]]);
  });
});

describe('overlapping and isTested', () => {
  const ranges: Range[] = [
    [10, 20],
    [30, 40]
  ];

  it('clips the tested parts to the window asked about', () => {
    expect(overlapping(ranges, 15, 35)).toEqual([
      [15, 20],
      [30, 35]
    ]);
    expect(overlapping(ranges, 20, 30)).toEqual([]);
  });

  it('treats the end of a range as untested', () => {
    expect(isTested(ranges, 10)).toBe(true);
    expect(isTested(ranges, 19)).toBe(true);
    expect(isTested(ranges, 20)).toBe(false);
  });
});

describe('pickUntested', () => {
  const span = 2 * H;

  it('only picks whole hours with enough untested time after them', () => {
    // Free: [0, 5h) and [8h, ...). Starts: 0..3h, then 8h..10h (max).
    const ranges: Range[] = [[5 * H, 8 * H]];
    const picks = new Set<number>();
    for (let i = 0; i < 7; i++) picks.add(pickUntested(ranges, 0, 10 * H, span, () => i / 7)!);
    expect([...picks].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 8, 9, 10].map((h) => h * H));
  });

  it('starts no earlier than min and no later than max', () => {
    expect(pickUntested([], 1.5 * H, 3.2 * H, span, () => 0)).toBe(2 * H);
    expect(pickUntested([], 1.5 * H, 3.2 * H, span, () => 0.999)).toBe(3 * H);
  });

  it('gives up when no gap is long enough', () => {
    const ranges: Range[] = [
      [0, 3 * H],
      [4 * H, 20 * H]
    ];
    expect(pickUntested(ranges, 0, 10 * H, span)).toBeNull();
  });

  it('skips ranges that start before min', () => {
    expect(pickUntested([[-10 * H, 5 * H]], 0, 6 * H, span, () => 0)).toBe(5 * H);
  });
});

describe('monthCoverage', () => {
  it('reports the share of each month that is tested', () => {
    const jan = Date.UTC(2026, 0, 1);
    const ranges: Range[] = [
      [jan, jan + 31 * DAY_MS],
      [Date.UTC(2026, 2, 1), Date.UTC(2026, 2, 1) + 3.1 * DAY_MS]
    ];
    const months = monthCoverage(ranges, 2026, 'UTC');
    expect(months[0]).toBe(1);
    expect(months[1]).toBe(0);
    expect(months[2]).toBeCloseTo(0.1, 10);
  });

  it('follows the month boundaries of the time zone', () => {
    // 3am UTC on Feb 1 is still January in Chicago.
    const ranges: Range[] = [[Date.UTC(2026, 1, 1, 0), Date.UTC(2026, 1, 1, 3)]];
    expect(monthCoverage(ranges, 2026, 'America/Chicago')[0]).toBeGreaterThan(0);
    expect(monthCoverage(ranges, 2026, 'America/Chicago')[1]).toBe(0);
  });
});
