import { describe, expect, it } from 'vitest';
import type { Candle } from '$lib/engine/types';
import { computePlaybook, emptyPlaybook, playbookFor } from './playbook';

// Wednesday 14 January 2026: Chicago is on CST, UTC-6, so 08:30 there is 14:30Z.
const WINTER = Date.UTC(2026, 0, 14, 6);
// Wednesday 15 July 2026: CDT, UTC-5.
const SUMMER = Date.UTC(2026, 6, 15, 5);

const at = (base: number, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return base + (h * 60 + m) * 60_000;
};

/** A candle at Chicago time `hhmm` on the day starting at `base` (that day's 00:00 Chicago in UTC). */
const bar = (hhmm: string, o: number, h: number, l: number, c: number, base = WINTER): Candle => ({
  t: at(base, hhmm),
  o,
  h,
  l,
  c,
  v: 0
});

/** A candle that goes nowhere: body 0.2, wicks of 0.5. */
const flat = (hhmm: string, base = WINTER) => bar(hhmm, 100, 100.5, 99.5, 100.2, base);

/** Every minute from `from` to `to` (inclusive) as flat candles. */
function flats(from: string, to: string, base = WINTER): Candle[] {
  const out: Candle[] = [];
  for (let t = at(base, from); t <= at(base, to); t += 60_000) out.push({ ...flat('00:00', base), t });
  return out;
}

/**
 * 08:20-08:34 on a quiet morning. The opening range (08:30-08:34) is 99 to 101:
 * one candle carries the extremes, the rest are flat.
 */
function opening(base = WINTER): Candle[] {
  const candles = flats('08:20', '08:34', base);
  const wide = candles.find((c) => c.t === at(base, '08:31'))!;
  wide.h = 101;
  wide.l = 99;
  return candles;
}

const indexOf = (candles: Candle[], hhmm: string, base = WINTER) => candles.findIndex((c) => c.t === at(base, hhmm));

describe('opening range', () => {
  it('is the high and low of 08:30 to 08:34 Chicago, final once 08:34 has closed', () => {
    const candles = [...opening(), ...flats('08:35', '08:36')];
    const { current, ranges } = computePlaybook(candles);
    expect(ranges).toHaveLength(1);
    expect(current).toMatchObject({ high: 101, low: 99, complete: true });
    expect(candles[current!.first].t).toBe(at(WINTER, '08:30'));
  });

  it('is not final while 08:30 to 08:34 is still being revealed', () => {
    const candles = opening();
    const mid = computePlaybook(candles, indexOf(candles, '08:33') + 1);
    expect(mid.current).toMatchObject({ complete: false });
  });

  it('follows Chicago time through daylight saving', () => {
    // In July 08:30 Chicago is 13:30Z, an hour earlier than in January.
    const summer = [...opening(SUMMER), ...flats('08:35', '08:36', SUMMER)];
    expect(computePlaybook(summer).current).toMatchObject({ high: 101, low: 99, complete: true });
    expect(new Date(summer[summer.length - 1].t).toISOString()).toBe('2026-07-15T13:36:00.000Z');
  });

  it('starts again each day, with the bias back to none', () => {
    const day1 = [...opening(), ...flats('08:35', '08:38'), bar('08:39', 100, 103, 99.9, 102.9)];
    const nextDay = WINTER + 86_400_000;
    const day2 = [...opening(nextDay), ...flats('08:35', '08:44', nextDay)];
    const result = computePlaybook([...day1, ...day2]);
    expect(result.ranges).toHaveLength(2);
    expect(result.biasChanges).toHaveLength(1);
    expect(result.biasChanges[0].index).toBe(indexOf(day1, '08:39'));
  });
});

describe('signal candle', () => {
  it('marks a bullish candle with the biggest body that closes in its top quarter', () => {
    // 08:36 is not a 5m close, so the bias is still none: a signal, but not Setup A.
    const candles = [...opening(), flat('08:35'), bar('08:36', 100, 103, 99.9, 102.9)];
    const { markers } = computePlaybook(candles);
    expect(markers).toEqual([
      { index: candles.length - 1, t: at(WINTER, '08:36'), kind: 'signal', side: 'long', high: 103, low: 99.9 }
    ]);
  });

  it('marks a bearish candle that closes in its bottom quarter', () => {
    const candles = [...opening(), flat('08:35'), bar('08:36', 100, 100.1, 97, 97.1)];
    expect(computePlaybook(candles).markers).toMatchObject([{ kind: 'signal', side: 'short' }]);
  });

  it('fails when the body is not the biggest of the last 10 (a tie fails too)', () => {
    const candles = opening();
    // A body of 2.0 sits among the previous 10 candles.
    candles[candles.length - 3] = bar('08:32', 100, 101, 99, 102);
    const bigger = bar('08:36', 100, 102.1, 99.9, 102.0);
    const tie = bar('08:37', 100, 102.1, 99.9, 102.0);
    const result = computePlaybook([...candles, flat('08:35'), bigger, tie]);
    expect(result.markers).toEqual([]);
  });

  it('fails when the close is in the middle of the range', () => {
    // Body 2 beats everything, but the close is 1.5 below the high of a 4.5 range.
    const candles = [...opening(), flat('08:35'), bar('08:36', 100, 104, 99.5, 102)];
    expect(computePlaybook(candles).markers).toEqual([]);
  });

  it('needs a full 10 candles before it', () => {
    const candles = [flat('08:34'), bar('08:35', 100, 103, 99.9, 102.9)];
    expect(computePlaybook(candles).markers).toEqual([]);
  });

  it('is ignored outside 08:35 to 14:00, with 14:00 itself already out', () => {
    const early = [...flats('08:15', '08:28'), bar('08:29', 100, 103, 99.9, 102.9)];
    expect(computePlaybook(early).markers).toEqual([]);

    const last = bar('13:59', 100, 103, 99.9, 102.9);
    const closed = bar('14:00', 100, 103, 99.9, 102.9);
    const lateFlats = flats('13:40', '13:58');
    expect(computePlaybook([...lateFlats, last]).markers).toHaveLength(1);
    expect(computePlaybook([...lateFlats, last, closed]).markers).toHaveLength(1);
  });
});

describe('day bias', () => {
  it('flips with the 5m close, and only on 5m-closing candles', () => {
    const candles = [
      ...opening(),
      ...flats('08:35', '08:38'),
      bar('08:39', 100, 101.6, 99.9, 101.5), // 5m close above 101: long
      flat('08:40'),
      bar('08:41', 100, 100.5, 98, 98.2), // below the range, but not a 5m close: nothing
      flat('08:42'),
      flat('08:43'),
      bar('08:44', 100, 100.2, 98.4, 98.5), // 5m close below 99: short
      bar('08:49', 100, 100.5, 99.5, 100), // inside the range: stays short
      bar('08:54', 100, 101.9, 100, 101.8) // back above: long again
    ];
    const { biasChanges } = computePlaybook(candles);
    expect(biasChanges.map((b) => [candles[b.index].t, b.bias])).toEqual([
      [at(WINTER, '08:39'), 'long'],
      [at(WINTER, '08:44'), 'short'],
      [at(WINTER, '08:54'), 'long']
    ]);
  });

  it('starts as none: a close beyond the range before 08:35 or after 14:00 sets nothing', () => {
    const lateDay = [...opening(), ...flats('08:35', '08:44'), bar('14:04', 100, 103, 100, 102.9)];
    expect(computePlaybook(lateDay).biasChanges).toEqual([]);
    // 08:34 is a 5m-closing minute too, but it belongs to the range, not the window.
    expect(computePlaybook(opening()).biasChanges).toEqual([]);
  });
});

describe('Setup A', () => {
  it('long: bias long, bullish signal, close above the last 3 highs', () => {
    // 08:39 closes the 5m bar above the range (bias long) and is a signal that clears the 3 highs before it.
    const candles = [...opening(), ...flats('08:35', '08:38'), bar('08:39', 100, 103, 99.9, 102.9)];
    const { markers, biasChanges } = computePlaybook(candles);
    expect(biasChanges).toHaveLength(1);
    expect(markers).toEqual([
      { index: candles.length - 1, t: at(WINTER, '08:39'), kind: 'setupA', side: 'long', high: 103, low: 99.9 }
    ]);
  });

  it('short: bias short, bearish signal, close below the last 3 lows', () => {
    const candles = [...opening(), ...flats('08:35', '08:38'), bar('08:39', 100, 100.1, 97, 97.1)];
    const { markers, biasChanges } = computePlaybook(candles);
    expect(biasChanges).toMatchObject([{ bias: 'short' }]);
    expect(markers).toMatchObject([{ kind: 'setupA', side: 'short' }]);
  });

  it('is only a signal when the close does not clear the last 3 highs', () => {
    const candles = [
      ...opening(),
      ...flats('08:35', '08:38'),
      bar('08:39', 100, 102.5, 99.9, 101.5), // sets the long bias; closes mid-range, so not a signal
      bar('08:40', 100, 103.5, 99.9, 100),
      bar('08:41', 100, 103.5, 99.9, 100),
      bar('08:42', 100, 103.5, 99.9, 100),
      bar('08:43', 99.8, 103.45, 99.7, 103.4) // a signal, but 103.4 is not above 103.5
    ];
    const { markers } = computePlaybook(candles);
    expect(markers).toMatchObject([{ index: candles.length - 1, kind: 'signal', side: 'long' }]);
  });

  it('is only a signal when it goes against the bias', () => {
    const candles = [
      ...opening(),
      ...flats('08:35', '08:38'),
      bar('08:39', 100, 102.5, 99.9, 101.5), // long, closes mid-range: not a signal
      bar('08:40', 100, 100.1, 97, 97.1) // bearish signal on a long day
    ];
    expect(computePlaybook(candles).markers).toMatchObject([{ index: candles.length - 1, kind: 'signal', side: 'short' }]);
  });
});

describe('no lookahead', () => {
  const day = [
    ...opening(),
    ...flats('08:35', '08:38'),
    bar('08:39', 100, 103, 99.9, 102.9),
    flat('08:40'),
    bar('08:41', 100, 100.5, 96, 96.1),
    flat('08:42'),
    flat('08:43'),
    bar('08:44', 100, 100.2, 98.4, 98.5),
    bar('08:45', 98.5, 104, 98.4, 103.9)
  ];

  // Candles that would change every answer if anything looked at them.
  const wild = (c: Candle): Candle => ({ ...c, o: 1, h: 1e6, l: -1e6, c: 1e6 });

  it('gives the same result whatever comes after the cursor', () => {
    for (let count = 0; count <= day.length; count++) {
      const alone = computePlaybook(day.slice(0, count));
      expect(computePlaybook(day, count)).toEqual(alone);
      expect(computePlaybook([...day.slice(0, count), ...day.slice(count).map(wild)], count)).toEqual(alone);
    }
  });

  it('only ever marks candles that have closed', () => {
    for (let count = 0; count <= day.length; count++) {
      const result = computePlaybook(day, count);
      for (const item of [...result.markers, ...result.biasChanges]) expect(item.index).toBeLessThan(count);
    }
  });

  it('keeps every earlier marker as the replay moves on', () => {
    const full = computePlaybook(day);
    expect(full.markers.length).toBeGreaterThan(0);
    for (let count = 0; count <= day.length; count++) {
      const result = computePlaybook(day, count);
      expect(result.markers).toEqual(full.markers.filter((m) => m.index < count));
      expect(result.biasChanges).toEqual(full.biasChanges.filter((b) => b.index < count));
    }
  });
});

describe('timeframe', () => {
  const candles = [...opening(), ...flats('08:35', '08:38'), bar('08:39', 100, 103, 99.9, 102.9)];

  it('marks the 1m chart', () => {
    expect(playbookFor(candles, candles.length, 60_000).markers).toHaveLength(1);
  });

  it('shows nothing on any other timeframe', () => {
    for (const tf of [300_000, 900_000, 3_600_000, 86_400_000]) {
      expect(playbookFor(candles, candles.length, tf)).toEqual(emptyPlaybook());
    }
  });
});
