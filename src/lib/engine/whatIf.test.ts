import { describe, expect, it } from 'vitest';
import type { Candle } from './types';
import { candlesAfterEntry, excursion, simulateTarget, tradeWhatIf, whatIfRows } from './whatIf';

const M5 = 300_000;
const T0 = Date.UTC(2025, 0, 6);
const bar = (i: number, o: number, h: number, l: number, c: number): Candle => ({ t: T0 + i * M5, o, h, l, c, v: 1 });

// Long from 100 with the stop at 99 (1R = 1), taken at the close of candle 0, closed at the close of candle 3.
const trade = { side: 'long' as const, entry: 100, stop: 99, entryTime: T0 + M5, exitTime: T0 + 4 * M5 };
const candles = [
  bar(0, 99.5, 100.2, 99.4, 100),
  bar(1, 100, 100.6, 99.7, 100.4), // +0.6R, −0.3R
  bar(2, 100.4, 101.2, 100.1, 101), // +1.2R
  bar(3, 101, 101.1, 100.3, 100.5), // closed here (by hand)
  bar(4, 100.5, 102.1, 100.4, 102), // after the exit: +2.1R
  bar(5, 102, 102.2, 98.5, 98.8) // then the stop
];
const after = candlesAfterEntry(candles, M5, trade.entryTime, T0 + 6 * M5);

describe('what-if', () => {
  it('starts at the first candle after the entry and stops at the replay clock', () => {
    expect(after.map((c) => c.t)).toEqual([1, 2, 3, 4, 5].map((i) => T0 + i * M5));
    expect(candlesAfterEntry(candles, M5, trade.entryTime, T0 + 3 * M5)).toHaveLength(2);
  });

  it('does not run on into another stretch of saved candles', () => {
    const jumped = [...candles.slice(0, 3), bar(2000, 100, 105, 95, 100)];
    expect(candlesAfterEntry(jumped, M5, trade.entryTime, T0 + 3000 * M5)).toHaveLength(2);
  });

  it('measures how far price went for and against the trade while it was open', () => {
    const e = excursion(trade, after)!;
    expect(e.mfe).toBeCloseTo(1.2, 10);
    expect(e.mae).toBeCloseTo(0.3, 10);
  });

  it('replays the trade with each target, stop first within a candle', () => {
    const at = (r: number) => simulateTarget(trade, after, M5, r, null);
    expect(at(0.5)).toEqual({ kind: 'target', r: 0.5 });
    expect(at(1)).toEqual({ kind: 'target', r: 1 });
    expect(at(2)).toEqual({ kind: 'target', r: 2 });
    expect(at(3)?.kind).toBe('stop');
    expect(at(3)?.r).toBeCloseTo(-1, 10);
    // A candle that reaches both counts as a stop.
    const both = [bar(1, 100, 102.5, 98.5, 100)];
    expect(simulateTarget(trade, both, M5, 2, null)?.kind).toBe('stop');
  });

  it('fills a gap through the stop at the open', () => {
    const gap = [bar(1, 98, 98.5, 97.5, 98)];
    expect(simulateTarget(trade, gap, M5, 1, null)).toEqual({ kind: 'stop', r: -2 });
  });

  it('closes by the 1-hour rule when +1R was not touched in time', () => {
    const slow = Array.from({ length: 14 }, (_, i) => bar(i + 1, 100, 100.5, 99.8, 100.2));
    const out = simulateTarget(trade, slow, M5, 2, 3_600_000);
    expect(out?.kind).toBe('time');
    expect(out?.r).toBeCloseTo(0.2, 10);
    expect(simulateTarget(trade, slow, M5, 2, null)?.kind).toBe('open');
  });

  it('sums each target after every trade’s own fees', () => {
    const rows = whatIfRows([{ whatIf: tradeWhatIf(trade, after, M5, null), feesR: 0.1 }]);
    expect(rows.map((row) => row.totalR.toFixed(2))).toEqual(['0.40', '0.90', '1.40', '1.90']);
    expect(rows[0]).toMatchObject({ trades: 1, winRate: 100, open: 0 });
  });
});
