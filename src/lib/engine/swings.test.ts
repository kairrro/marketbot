import { describe, expect, it } from 'vitest';
import { findSweeps, findSwings, marketMode, swingLines, swingStatus, type Swing } from './swings';
import type { Candle } from './types';

const TF = 900_000;

/** Candles from [high, low] pairs (close halfway), or [high, low, close]. */
function bars(rows: number[][]): Candle[] {
  return rows.map(([h, l, c], i) => ({ t: i * TF, o: (h + l) / 2, h, l, c: c ?? (h + l) / 2, v: 0 }));
}

// A swing high at 2 (15) and a swing low at 4 (9).
const BASE = [
  [10, 9],
  [11, 10],
  [15, 13],
  [12, 10],
  [11, 9],
  [13, 11],
  [12, 10]
];

describe('findSwings', () => {
  it('finds a high with lower highs on both sides, and a low with higher lows', () => {
    const swings = findSwings(bars(BASE), BASE.length, 2, TF);
    expect(swings.map((s) => [s.kind, s.index, s.price])).toEqual([
      ['high', 2, 15],
      ['low', 4, 9]
    ]);
  });

  it('dates a swing at its candle and knows it only after the confirming candles close', () => {
    const [high] = findSwings(bars(BASE), BASE.length, 2, TF);
    expect(high.time).toBe(2 * TF);
    // Candles 3 and 4 confirm it: known at the close of candle 4.
    expect(high.confirmedAt).toBe(5 * TF);
  });

  it('counts the first of equal highs or lows, and only that one', () => {
    const tops = bars([[10, 9], [11, 10], [15, 13], [15, 13], [11, 10], [10, 9]]);
    expect(findSwings(tops, tops.length, 2, TF).map((s) => [s.kind, s.index])).toEqual([['high', 2]]);
    const bottoms = bars([[15, 13], [14, 12], [11, 9], [12, 9], [14, 12], [15, 13]]);
    expect(findSwings(bottoms, bottoms.length, 2, TF).map((s) => [s.kind, s.index])).toEqual([['low', 2]]);
    const flat = bars([[10, 9], [10, 9], [10, 9], [10, 9], [10, 9], [10, 9]]);
    expect(findSwings(flat, flat.length, 2, TF)).toEqual([]);
  });

  it('takes the number of candles each side as a setting', () => {
    // Size 1 takes every local peak; wider sizes need more lower highs either side.
    const rows = [[10, 9], [12, 10], [11, 10], [14, 12], [11, 10], [13, 11], [10, 9]];
    expect(findSwings(bars(rows), rows.length, 1, TF).filter((s) => s.kind === 'high').map((s) => s.index)).toEqual([
      1, 3, 5
    ]);
    expect(findSwings(bars(rows), rows.length, 2, TF).filter((s) => s.kind === 'high').map((s) => s.index)).toEqual([
      3
    ]);
    expect(findSwings(bars(rows), rows.length, 3, TF).filter((s) => s.kind === 'high').map((s) => s.index)).toEqual([
      3
    ]);
  });

  describe('no lookahead', () => {
    const candles = bars(BASE);

    it('only finds a swing once both candles after it have closed', () => {
      expect(findSwings(candles, 4, 2, TF)).toEqual([]);
      expect(findSwings(candles, 5, 2, TF).map((s) => s.index)).toEqual([2]);
      expect(findSwings(candles, 6, 2, TF).map((s) => s.index)).toEqual([2]);
      expect(findSwings(candles, 7, 2, TF).map((s) => s.index)).toEqual([2, 4]);
    });

    it('never reads a candle at or past count', () => {
      // Whatever comes after the cursor, even nonsense, changes nothing.
      const future = [...candles.slice(0, 5), ...bars([[1e9, -1e9], [NaN, NaN], [0, 0]]).map((c, i) => ({ ...c, t: (5 + i) * TF }))];
      expect(findSwings(future, 5, 2, TF)).toEqual(findSwings(candles, 5, 2, TF));
    });

    it('at every cursor, matches the full history cut at what was known by then', () => {
      const rows = [[5, 4], [7, 5], [6, 5], [9, 7], [8, 6], [6, 3], [7, 5], [10, 8], [9, 7], [8, 6], [11, 9], [9, 8]];
      const all = bars(rows);
      const everything = findSwings(all, all.length, 2, TF);
      for (let count = 0; count <= all.length; count++) {
        const cursor = count * TF;
        expect(findSwings(all, count, 2, TF)).toEqual(everything.filter((s) => s.confirmedAt <= cursor));
      }
    });
  });
});

describe('swingStatus', () => {
  const high = (rest: number[][]) => {
    const candles = bars([...BASE.slice(0, 5), ...rest]);
    const swing = findSwings(candles, 5, 2, TF)[0];
    return { swing, candles, status: swingStatus(swing, candles, candles.length, TF) };
  };

  it('stays fresh while price stays under it, a touch included', () => {
    expect(high([[14, 12], [15, 13]]).status).toEqual({ status: 'fresh', endTime: null, endIndex: null });
  });

  it('is swept by a wick through it that closes back', () => {
    expect(high([[14, 12], [15.5, 13, 14.8]]).status).toEqual({ status: 'swept', endTime: 7 * TF, endIndex: 6 });
  });

  it('is broken by a close through it', () => {
    expect(high([[15.6, 13, 15.2]]).status).toEqual({ status: 'broken', endTime: 6 * TF, endIndex: 5 });
  });

  it('keeps the first thing that happened to it', () => {
    expect(high([[15.5, 13, 14.8], [16, 14, 15.9]]).status.status).toBe('swept');
  });

  it('works the other way round for lows', () => {
    const candles = bars([...BASE, [10, 8.5, 9.5], [10, 8, 8.8]]);
    const low = findSwings(candles, 7, 2, TF).find((s) => s.kind === 'low')!;
    expect(swingStatus(low, candles, 7, TF).status).toBe('fresh');
    expect(swingStatus(low, candles, 8, TF)).toEqual({ status: 'swept', endTime: 8 * TF, endIndex: 7 });
    expect(swingStatus(low, bars([...BASE, [10, 8, 8.9]]), 8, TF).status).toBe('broken');
  });

  it('ignores candles at or past count', () => {
    const { swing, candles } = high([[14, 12], [16, 14, 15.9]]);
    expect(swingStatus(swing, candles, 6, TF).status).toBe('fresh');
    expect(swingStatus(swing, candles, 7, TF).status).toBe('broken');
  });

  it('labels every swing in one pass', () => {
    const candles = bars([...BASE, [15.5, 12, 14]]);
    expect(swingLines(candles, candles.length, 2, TF).map((l) => [l.kind, l.status])).toEqual([
      ['high', 'swept'],
      ['low', 'fresh']
    ]);
  });

  it('agrees with swingStatus on every swing of a long random walk', () => {
    let seed = 7;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    let price = 100;
    const candles: Candle[] = [];
    for (let i = 0; i < 3000; i++) {
      const o = price;
      const c = Math.round((o + (rand() - 0.5) * 4) * 10) / 10;
      const h = Math.max(o, c) + Math.round(rand() * 20) / 10;
      const l = Math.min(o, c) - Math.round(rand() * 20) / 10;
      candles.push({ t: i * TF, o, h, l, c, v: 0 });
      price = c;
    }
    for (const size of [1, 2, 5]) {
      for (const count of [500, 3000]) {
        const lines = swingLines(candles, count, size, TF);
        expect(lines.length).toBeGreaterThan(20);
        expect(lines).toEqual(
          findSwings(candles, count, size, TF).map((s) => ({ ...s, ...swingStatus(s, candles, count, TF) }))
        );
      }
    }
  });
});

describe('findSweeps', () => {
  // Swing highs at 2 (15) and 6 (14), a swing low at 4 (9).
  const rows = [
    [10, 9],
    [11, 10],
    [15, 13],
    [12, 10],
    [11, 9],
    [12, 10.5],
    [14, 12],
    [13, 11],
    [12.5, 10.5]
  ];

  it('is one sweep per candle and side, with every swing it took, furthest first', () => {
    const candles = bars([...rows, [15.5, 11, 12]]);
    const lines = swingLines(candles, candles.length, 2, TF);
    const sweeps = findSweeps(lines, candles);
    expect(sweeps.map((s) => [s.kind, s.index, s.reach, s.swings.map((l) => l.price)])).toEqual([
      ['high', 9, 15.5, [15, 14]]
    ]);
  });

  it('leaves out swings closed through, and ones still untouched', () => {
    const broken = bars([...rows, [15.5, 11, 15.2]]);
    expect(findSweeps(swingLines(broken, broken.length, 2, TF), broken)).toEqual([]);
    const quiet = bars([...rows, [13.5, 11, 12]]);
    expect(findSweeps(swingLines(quiet, quiet.length, 2, TF), quiet)).toEqual([]);
  });

  it('finds sweeps of lows too, and keeps them in candle order', () => {
    const candles = bars([...rows, [14.5, 11, 12], [12, 8.5, 10]]);
    const sweeps = findSweeps(swingLines(candles, candles.length, 2, TF), candles);
    expect(sweeps.map((s) => [s.kind, s.index, s.reach])).toEqual([
      ['high', 9, 14.5],
      ['low', 10, 8.5]
    ]);
  });
});

describe('marketMode', () => {
  const swing = (kind: 'high' | 'low', price: number, index: number): Swing => ({
    kind,
    index,
    time: index * TF,
    price,
    confirmedAt: (index + 3) * TF
  });
  const swings = (highs: number[], lows: number[]) =>
    [...highs.map((p, i) => swing('high', p, i * 2)), ...lows.map((p, i) => swing('low', p, i * 2 + 1))].sort(
      (a, b) => a.index - b.index
    );

  it('is UP on higher highs and higher lows', () => {
    expect(marketMode(swings([10, 12], [5, 6]))).toEqual({ trend: 'up', high: 12, low: 6, mid: 9 });
  });

  it('is DOWN on lower highs and lower lows', () => {
    expect(marketMode(swings([12, 10], [6, 5]))?.trend).toBe('down');
  });

  it('is a RANGE otherwise, between the last high and low', () => {
    expect(marketMode(swings([10, 12], [6, 5]))).toEqual({ trend: 'range', high: 12, low: 5, mid: 8.5 });
    expect(marketMode(swings([12, 10], [5, 6]))?.trend).toBe('range');
    expect(marketMode(swings([10, 10], [5, 6]))?.trend).toBe('range');
  });

  it('only looks at the last two of each', () => {
    expect(marketMode(swings([20, 10, 12], [9, 5, 6]))?.trend).toBe('up');
  });

  it('has no mode until there are two highs and two lows', () => {
    expect(marketMode(swings([10, 12], [5]))).toBeNull();
    expect(marketMode([])).toBeNull();
  });

  it('reads a rising zigzag of candles as UP', () => {
    const rows = [[5, 4], [7, 5], [6, 5], [9, 7], [8, 6], [6, 4.5], [7, 5], [10, 8], [9, 7], [8, 6], [11, 9], [9, 8], [12, 10], [13, 11]];
    const candles = bars(rows);
    expect(marketMode(findSwings(candles, candles.length, 1, TF))?.trend).toBe('up');
  });
});
