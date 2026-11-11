import { describe, expect, it } from 'vitest';
import type { Candle } from '$lib/engine/types';
import { loadDays, runsOf, type DayStore } from './databentoCache';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 9, 27, 12);
const d = (n: number) => Date.UTC(2026, 9, n);

const bar = (t: number): Candle => ({ t, o: 1, h: 2, l: 0.5, c: 1.5, v: 10 });

/** A fake market with a candle every hour, and a log of what was asked for. */
function setup() {
  const kept = new Map<number, Candle[]>();
  const asked: [number, number][] = [];
  const store: DayStore = {
    read: (day) => kept.get(day) ?? null,
    write: (day, candles) => void kept.set(day, candles)
  };
  const fetchRange = async (start: number, end: number) => {
    asked.push([start, end]);
    const out: Candle[] = [];
    for (let t = start; t < end; t += HOUR) out.push(bar(t));
    return out;
  };
  return { kept, asked, store, fetchRange };
}

describe('runsOf', () => {
  it('groups consecutive days and splits at a gap or at the longest run', () => {
    expect(runsOf([d(1), d(2), d(3), d(6)])).toEqual([[d(1), d(2), d(3)], [d(6)]]);
    expect(runsOf([d(1), d(2), d(3), d(4), d(5)], 2)).toEqual([[d(1), d(2)], [d(3), d(4)], [d(5)]]);
    expect(runsOf([])).toEqual([]);
  });
});

describe('loadDays', () => {
  it('asks for whole days in one request, and returns only what was wanted', async () => {
    const s = setup();
    const out = await loadDays(d(5) + 6 * HOUR, d(7) + 2 * HOUR, NOW, s.store, s.fetchRange);
    expect(s.asked).toEqual([[d(5), d(8)]]);
    expect(out[0].t).toBe(d(5) + 6 * HOUR);
    expect(out.at(-1)!.t).toBe(d(7) + HOUR);
  });

  it('never asks again for days it has kept', async () => {
    const s = setup();
    await loadDays(d(5), d(8), NOW, s.store, s.fetchRange);
    s.asked.length = 0;
    const again = await loadDays(d(5), d(8), NOW, s.store, s.fetchRange);
    expect(s.asked).toEqual([]);
    expect(again).toHaveLength(72);
  });

  it('asks only for the days missing, in a request of their own', async () => {
    const s = setup();
    await loadDays(d(5), d(6), NOW, s.store, s.fetchRange);
    await loadDays(d(8), d(9), NOW, s.store, s.fetchRange);
    s.asked.length = 0;
    await loadDays(d(5), d(9), NOW, s.store, s.fetchRange);
    expect(s.asked).toEqual([[d(6), d(8)]]);
  });

  it('keeps a day with no candles, so a weekend is not asked for again', async () => {
    const s = setup();
    const noCandles = async (start: number, end: number) => (s.asked.push([start, end]), [] as Candle[]);
    await loadDays(d(3), d(5), NOW, s.store, noCandles);
    s.asked.length = 0;
    await loadDays(d(3), d(5), NOW, s.store, noCandles);
    expect(s.asked).toEqual([]);
  });

  it('does not keep the last two days, and never asks past now', async () => {
    const s = setup();
    await loadDays(d(24), d(28), NOW, s.store, s.fetchRange);
    expect(s.asked).toEqual([[d(24), NOW]]);
    expect([...s.kept.keys()]).toEqual([d(24)]);
    s.asked.length = 0;
    await loadDays(d(24), d(28), NOW, s.store, s.fetchRange);
    expect(s.asked).toEqual([[d(25), NOW]]);
  });

  it('splits a long stretch into several requests', async () => {
    const s = setup();
    await loadDays(d(1) - 100 * DAY, d(1), NOW, s.store, s.fetchRange);
    expect(s.asked.map(([a, b]) => (b - a) / DAY)).toEqual([60, 40]);
  });

  it('returns every candle of a long stretch once, in order', async () => {
    const s = setup();
    const out = await loadDays(d(1) - 200 * DAY, d(1), NOW, s.store, s.fetchRange);
    expect(out).toHaveLength(200 * 24);
    expect(out.every((c, i) => i === 0 || c.t > out[i - 1].t)).toBe(true);
  });
});
