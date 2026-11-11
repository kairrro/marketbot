import { describe, expect, it } from 'vitest';
import { atrReading, atrSeries, fmtMult, stopInAtr, trueRange } from './atr';
import type { Candle } from './types';

const TF = 60_000;

/** Candles from [high, low, close] rows. */
function bars(rows: number[][]): Candle[] {
  return rows.map(([h, l, c], i) => ({ t: i * TF, o: (h + l) / 2, h, l, c, v: 0 }));
}

describe('trueRange', () => {
  const candle = bars([[12, 10, 11]])[0];

  it('is the candle range when there is no gap', () => {
    expect(trueRange(candle, null)).toBe(2);
    expect(trueRange(candle, 11)).toBe(2);
  });

  it('reaches back to the previous close after a gap', () => {
    expect(trueRange(candle, 8)).toBe(4); // gapped up: high - previous close
    expect(trueRange(candle, 15)).toBe(5); // gapped down: previous close - low
  });
});

describe('atrSeries', () => {
  // True ranges: 2, 2, 4 (gap from close 11 up to a 15 high / 13 low → 15 - 11), 2, 2.
  const candles = bars([
    [12, 10, 11],
    [12, 10, 11],
    [15, 13, 14],
    [15, 13, 14],
    [15, 13, 14]
  ]);

  it('is NaN until a full period has closed, then the plain average of those true ranges', () => {
    const atr = atrSeries(candles, candles.length, 3);
    expect(atr.slice(0, 2).every(Number.isNaN)).toBe(true);
    expect(atr[2]).toBeCloseTo((2 + 2 + 4) / 3, 10);
  });

  it("then smooths the way Wilder's does: (previous × (n - 1) + true range) / n", () => {
    const atr = atrSeries(candles, candles.length, 3);
    expect(atr[3]).toBeCloseTo((atr[2] * 2 + 2) / 3, 10);
    expect(atr[4]).toBeCloseTo((atr[3] * 2 + 2) / 3, 10);
  });

  it('never reads past count', () => {
    const atr = atrSeries(candles, 3, 3);
    expect(atr).toHaveLength(3);
    expect(atr[2]).toBeCloseTo(8 / 3, 10);
  });

  it('can start part-way, with the first true range being just that candle\'s range', () => {
    const atr = atrSeries(candles, candles.length, 2, 2);
    // From candle 2: ranges 2 (no previous close in the window), 2 → average 2.
    expect(atr[1]).toBeCloseTo(2, 10);
  });
});

describe('atrReading', () => {
  it('is null before a full period has closed', () => {
    expect(atrReading(bars([[11, 10, 10.5]]), 1, 14)).toBeNull();
  });

  it('reads the last closed candle, in price and as a % of its close', () => {
    // Every candle is 2 wide and closes where it opened, so ATR is 2.
    const flat = bars(Array.from({ length: 40 }, () => [101, 99, 100]));
    const reading = atrReading(flat, flat.length, 14)!;
    expect(reading.value).toBeCloseTo(2, 10);
    expect(reading.pct).toBeCloseTo(2, 10);
    expect(reading.ratio).toBeCloseTo(1, 10);
    expect(reading.state).toBe('normal');
  });

  it('calls it fast when the latest candles are much wider than usual, and quiet when much narrower', () => {
    const calm = Array.from({ length: 150 }, () => [101, 99, 100]);
    const wild = Array.from({ length: 30 }, () => [110, 90, 100]);
    const fast = bars([...calm, ...wild]);
    expect(atrReading(fast, fast.length, 14)!.state).toBe('fast');

    const busy = Array.from({ length: 150 }, () => [110, 90, 100]);
    const still = Array.from({ length: 30 }, () => [100.5, 99.5, 100]);
    const quiet = bars([...busy, ...still]);
    expect(atrReading(quiet, quiet.length, 14)!.state).toBe('quiet');
  });

  it('gives the same answer whether it starts at the first candle or only warms up on the latest ones', () => {
    // A long, noisy history: the short warm-up must land on the full-history value.
    let seed = 7;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    let close = 100;
    const rows: number[][] = [];
    for (let i = 0; i < 2000; i++) {
      const next = close + (rand() - 0.5) * 2;
      rows.push([Math.max(close, next) + rand(), Math.min(close, next) - rand(), next]);
      close = next;
    }
    const candles = bars(rows);
    const full = atrSeries(candles, candles.length, 14).at(-1)!;
    expect(atrReading(candles, candles.length, 14)!.value).toBeCloseTo(full, 6);
  });
});

describe('stopInAtr / fmtMult', () => {
  it('expresses a stop in ATRs', () => {
    expect(stopInAtr(15, 10)).toBe(1.5);
    expect(stopInAtr(15, 0)).toBe(0);
  });

  it('formats multiples without trailing zeros', () => {
    expect(fmtMult(1)).toBe('1×');
    expect(fmtMult(1.5)).toBe('1.5×');
    expect(fmtMult(2.04)).toBe('2×');
  });
});
