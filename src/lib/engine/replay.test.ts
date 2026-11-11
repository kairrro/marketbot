import { describe, expect, it } from 'vitest';
import {
  advance,
  bucketOpen,
  closeTime,
  coversCursor,
  formingCandle,
  initialCount,
  priceAtCursor,
  reachesCursor,
  visibleCount
} from './replay';
import { TF_MS, TIMEFRAMES, type Candle, type Timeframe } from './types';

const HOUR = TF_MS['1h'];
const START = Date.UTC(2025, 0, 6, 0, 0); // a Monday, midnight UTC

/** 24h of 1m candles with a different, recognisable price on every candle. */
function minuteCandles(count = 24 * 60): Candle[] {
  return Array.from({ length: count }, (_, i) => {
    const open = 100 + i;
    return { t: START + i * TF_MS['1m'], o: open, h: open + 0.9, l: open - 0.9, c: open + 0.5, v: 1 };
  });
}

/** Builds higher-timeframe candles the way an exchange would. */
function aggregate(base: Candle[], tf: Timeframe): Candle[] {
  const tfMs = TF_MS[tf];
  const buckets = new Map<number, Candle>();
  for (const candle of base) {
    const t = Math.floor(candle.t / tfMs) * tfMs;
    const bucket = buckets.get(t);
    if (!bucket) buckets.set(t, { ...candle, t });
    else {
      bucket.h = Math.max(bucket.h, candle.h);
      bucket.l = Math.min(bucket.l, candle.l);
      bucket.c = candle.c;
      bucket.v += candle.v;
    }
  }
  return [...buckets.values()];
}

const base = minuteCandles();
const sets = Object.fromEntries(TIMEFRAMES.map((tf) => [tf, aggregate(base, tf)])) as Record<Timeframe, Candle[]>;

describe('visibleCount', () => {
  it('counts only candles that are fully closed at the cursor', () => {
    const candles = sets['5m'];
    // 00:00–00:05 closes exactly at the cursor: visible.
    expect(visibleCount(candles, TF_MS['5m'], START + 5 * 60_000)).toBe(1);
    // One millisecond earlier it is still forming.
    expect(visibleCount(candles, TF_MS['5m'], START + 5 * 60_000 - 1)).toBe(0);
    expect(visibleCount(candles, TF_MS['5m'], START + 12 * 60_000)).toBe(2);
  });

  it('handles the edges', () => {
    expect(visibleCount([], TF_MS['5m'], START)).toBe(0);
    expect(visibleCount(sets['1h'], HOUR, START - 1)).toBe(0);
    expect(visibleCount(sets['1h'], HOUR, START + 1000 * HOUR)).toBe(sets['1h'].length);
  });
});

describe('no lookahead when switching timeframe', () => {
  it('hides the higher-timeframe candle that is still forming', () => {
    // Replaying 5m, cursor at 10:35. The 10:00 1h candle runs until 11:00.
    const cursor = START + 10 * HOUR + 35 * 60_000;
    const count = visibleCount(sets['1h'], HOUR, cursor);
    const lastVisible = sets['1h'][count - 1];

    expect(lastVisible.t).toBe(START + 9 * HOUR);
    expect(closeTime(lastVisible, HOUR)).toBe(START + 10 * HOUR);
    // The forming candle is the first hidden one.
    expect(sets['1h'][count].t).toBe(START + 10 * HOUR);
  });

  it('never shows a price from after the cursor, on any timeframe, at any cursor', () => {
    // Walk the cursor minute by minute, as a 1m replay would.
    for (let i = 1; i < base.length; i += 7) {
      const cursor = closeTime(base[i - 1], TF_MS['1m']);
      // Highest price that exists at or before the cursor (prices rise 1 per minute).
      const maxSeen = base[i - 1].h;

      for (const tf of TIMEFRAMES) {
        const tfMs = TF_MS[tf];
        const candles = sets[tf];
        const count = visibleCount(candles, tfMs, cursor);
        const visible = candles.slice(0, count);

        const lastClose = Math.max(...visible.map((c) => closeTime(c, tfMs)), -Infinity);
        expect(lastClose).toBeLessThanOrEqual(cursor);
        expect(Math.max(...visible.map((c) => c.h), -Infinity)).toBeLessThanOrEqual(maxSeen);
        // ...and nothing that has already closed is held back.
        if (count < candles.length) expect(closeTime(candles[count], tfMs)).toBeGreaterThan(cursor);
      }
    }
  });

  it('shows everything again on a lower timeframe without moving the cursor', () => {
    // Step 1h up to 11:00, then drop to 1m: every minute up to 11:00 is fair game.
    const cursor = START + 11 * HOUR;
    const count = visibleCount(sets['1m'], TF_MS['1m'], cursor);
    expect(count).toBe(11 * 60);
    expect(closeTime(sets['1m'][count - 1], TF_MS['1m'])).toBe(cursor);
  });

  it('keeps the cursor where it was when the new timeframe is behind it', () => {
    const cursor = START + 10 * HOUR + 35 * 60_000;
    const next = sets['1h'][visibleCount(sets['1h'], HOUR, cursor)];
    const step = advance(cursor, next, HOUR);
    // The revealed 10:00 candle started before the cursor: flagged as overlapping.
    expect(step.overlap).toBe(true);
    expect(step.cursorTime).toBe(START + 11 * HOUR);
  });
});

describe('price at the cursor', () => {
  // Replaying 5m, cursor at 10:35. The price is the close of the 10:30 candle.
  const cursor = START + 10 * HOUR + 35 * 60_000;
  const fiveMin = sets['5m'];
  const price = fiveMin[visibleCount(fiveMin, TF_MS['5m'], cursor) - 1].c;

  it('is the close of the last candle when that candle ends at the cursor', () => {
    const last = fiveMin[visibleCount(fiveMin, TF_MS['5m'], cursor) - 1];
    expect(closeTime(last, TF_MS['5m'])).toBe(cursor);
    expect(priceAtCursor(last, TF_MS['5m'], cursor, null)).toBe(last.c);
    // A stale known price never overrides a candle that closes at the cursor.
    expect(priceAtCursor(last, TF_MS['5m'], cursor, 1)).toBe(last.c);
  });

  it('does not change when switching to a higher timeframe', () => {
    for (const tf of ['15m', '30m', '1h', '4h'] as const) {
      const candles = sets[tf];
      const last = candles[visibleCount(candles, TF_MS[tf], cursor) - 1];
      // The chart's last candle closed before the cursor, at an older price...
      expect(closeTime(last, TF_MS[tf])).toBeLessThan(cursor);
      expect(last.c).not.toBe(price);
      // ...but the price in use is still the one at the cursor.
      expect(priceAtCursor(last, TF_MS[tf], cursor, price)).toBe(price);
    }
  });

  it('comes back unchanged on the way down to a lower timeframe', () => {
    const oneMin = sets['1m'];
    const last = oneMin[visibleCount(oneMin, TF_MS['1m'], cursor) - 1];
    // The 1m candle ending at 10:35 closes where the 5m candle did.
    expect(priceAtCursor(last, TF_MS['1m'], cursor, price)).toBe(price);
  });

  it('falls back to the last close when nothing better is known', () => {
    const hourly = sets['1h'];
    const last = hourly[visibleCount(hourly, HOUR, cursor) - 1];
    expect(priceAtCursor(last, HOUR, cursor, null)).toBe(last.c);
  });
});

describe('advance', () => {
  it('moves to the close of the revealed candle', () => {
    const candles = sets['5m'];
    const cursor = closeTime(candles[9], TF_MS['5m']);
    expect(advance(cursor, candles[10], TF_MS['5m'])).toEqual({
      cursorTime: closeTime(candles[10], TF_MS['5m']),
      overlap: false
    });
  });

  it('never moves the cursor backwards', () => {
    const cursor = START + 5 * HOUR;
    expect(advance(cursor, sets['5m'][0], TF_MS['5m']).cursorTime).toBe(cursor);
  });
});

describe('initialCount', () => {
  it('starts 300 candles in by default', () => {
    expect(initialCount(sets['1m'], TF_MS['1m'], null)).toBe(300);
  });

  it('leaves a candle to step into on short data', () => {
    expect(initialCount(sets['1h'], HOUR, null)).toBe(23);
  });

  it('starts at the start date, showing only candles closed by then', () => {
    const start = START + 6 * HOUR + 2 * 60_000; // 06:02
    const count = initialCount(sets['5m'], TF_MS['5m'], start);
    expect(closeTime(sets['5m'][count - 1], TF_MS['5m'])).toBe(START + 6 * HOUR);
  });

  it('always shows at least one candle', () => {
    expect(initialCount(sets['5m'], TF_MS['5m'], START - HOUR)).toBe(1);
    expect(initialCount([], TF_MS['5m'], null)).toBe(0);
  });
});

describe('formingCandle', () => {
  const fine = (tf: Timeframe) => ({ candles: sets[tf], tfMs: TF_MS[tf] });
  // Replaying 5m, cursor at 10:35: the 1h and 4h candles are mid-way through.
  const cursor = START + 10 * HOUR + 35 * 60_000;

  it('matches the exchange candle so far, built from what has closed by the cursor', () => {
    // The 1m candles that make up 10:00–10:35, aggregated as an exchange would.
    const sofar = aggregate(
      base.filter((c) => c.t >= START + 10 * HOUR && closeTime(c, TF_MS['1m']) <= cursor),
      '1h'
    )[0];
    expect(formingCandle([fine('5m')], HOUR, cursor)).toEqual(sofar);
    expect(formingCandle([fine('1m')], HOUR, cursor)).toEqual(sofar);
  });

  it('never shows a price from after the cursor', () => {
    const maxSeen = base[visibleCount(base, TF_MS['1m'], cursor) - 1].h;
    for (const tf of ['15m', '30m', '1h', '4h', '1d'] as const) {
      const forming = formingCandle([fine('5m')], TF_MS[tf], cursor);
      expect(forming).not.toBeNull();
      expect(forming!.t).toBe(bucketOpen(cursor, TF_MS[tf]));
      expect(forming!.h).toBeLessThanOrEqual(maxSeen);
    }
  });

  it('keeps the real open and only part of the range until the candle closes', () => {
    const almost = START + 11 * HOUR - TF_MS['5m'];
    const forming = formingCandle([fine('5m')], HOUR, almost)!;
    const full = sets['1h'].find((c) => c.t === START + 10 * HOUR)!;
    expect(forming.o).toBe(full.o);
    expect(forming.h).toBeLessThan(full.h);
  });

  it('is null on a candle boundary', () => {
    expect(formingCandle([fine('5m')], HOUR, START + 11 * HOUR)).toBeNull();
  });

  it('prefers the source reaching closest to the cursor', () => {
    // 15m stops at 10:30; 5m reaches 10:35.
    const forming = formingCandle([fine('15m'), fine('5m')], HOUR, cursor)!;
    expect(forming.c).toBe(sets['5m'][visibleCount(sets['5m'], TF_MS['5m'], cursor) - 1].c);
  });

  it('skips sources that do not cover the open or are not lower timeframes', () => {
    const late = { candles: sets['5m'].filter((c) => c.t > START + 10 * HOUR), tfMs: TF_MS['5m'] };
    expect(formingCandle([late], HOUR, cursor)).toBeNull();
    expect(formingCandle([fine('4h')], HOUR, cursor)).toBeNull();
    expect(formingCandle([], HOUR, cursor)).toBeNull();
  });

  it('ignores saved candles that pick up again after a hole', () => {
    // An older stretch, then nothing until 10:15: the 10:00 candle cannot be built from that.
    const holed = {
      candles: sets['5m'].filter((c) => c.t < START + 2 * HOUR || c.t >= START + 10 * HOUR + 15 * 60_000),
      tfMs: TF_MS['5m']
    };
    expect(formingCandle([holed], HOUR, cursor)).toBeNull();
    // A hole after the open: only the unbroken part from the open counts.
    const gap = { candles: sets['5m'].filter((c) => c.t !== START + 10 * HOUR + 15 * 60_000), tfMs: TF_MS['5m'] };
    expect(formingCandle([gap], HOUR, cursor)!.c).toBe(sets['5m'].find((c) => c.t === START + 10 * HOUR + 10 * 60_000)!.c);
  });
});

describe('candles from separate stretches of time', () => {
  // What a session holds after replaying two dates: 5m candles for 00:00–06:00
  // and for 18:00–24:00, nothing in between.
  const tf = TF_MS['5m'];
  const saved = sets['5m'].filter((c) => c.t < START + 6 * HOUR || c.t >= START + 18 * HOUR);

  it('does not take an older stretch for the candles at the cursor', () => {
    const inHole = START + 12 * HOUR;
    const count = visibleCount(saved, tf, inHole);
    expect(count).toBe(72); // every candle of the morning is "before the cursor"...
    expect(reachesCursor(saved, count, tf, inHole)).toBe(false); // ...but they stop six hours short of it
    expect(coversCursor(saved, tf, inHole, 50)).toBe(false);
  });

  it('accepts the stretch the cursor is in', () => {
    const evening = START + 20 * HOUR;
    expect(reachesCursor(saved, visibleCount(saved, tf, evening), tf, evening)).toBe(true);
    expect(coversCursor(saved, tf, evening, 24)).toBe(true);
    // 30 candles back reaches over the hole into the morning.
    expect(coversCursor(saved, tf, evening, 30)).toBe(false);
  });

  it('allows an outage-sized gap', () => {
    const outage = sets['5m'].filter((c) => c.t < START + 8 * HOUR || c.t >= START + 9 * HOUR);
    const cursor = START + 10 * HOUR;
    expect(coversCursor(outage, tf, cursor, 100)).toBe(true);
    expect(reachesCursor(outage, visibleCount(outage, tf, START + 8 * HOUR + 50 * 60_000), tf, START + 8 * HOUR + 50 * 60_000)).toBe(true);
  });

  it('lets a market that closes (stocks) bridge a night or a weekend, but not weeks', () => {
    const inHole = START + 12 * HOUR;
    const count = visibleCount(saved, tf, inHole);
    expect(reachesCursor(saved, count, tf, inHole, true)).toBe(true);
    expect(coversCursor(saved, tf, START + 20 * HOUR, 30, true)).toBe(true);
    const monday = START + 3 * 24 * HOUR;
    expect(reachesCursor(saved, visibleCount(saved, tf, monday), tf, monday, true)).toBe(true);
    const weeksLater = START + 14 * 24 * HOUR;
    expect(reachesCursor(saved, visibleCount(saved, tf, weeksLater), tf, weeksLater, true)).toBe(false);
  });
});

describe('bucketOpen', () => {
  it('maps an event at a candle close back to that candle', () => {
    const entry = START + 10 * HOUR + 35 * 60_000; // close of the 10:30 5m candle
    expect(bucketOpen(entry, TF_MS['5m'])).toBe(START + 10 * HOUR + 30 * 60_000);
    expect(bucketOpen(entry, TF_MS['1h'])).toBe(START + 10 * HOUR);
    // An event exactly on the hour belongs to the hour that just closed.
    expect(bucketOpen(START + 11 * HOUR, HOUR)).toBe(START + 10 * HOUR);
  });
});
