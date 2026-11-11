import { describe, expect, it } from 'vitest';
import { inSession, MARKET_SESSIONS, sessionRanges, type MarketSessionId, type SessionRange } from './marketSessions';
import type { Candle } from './types';

const HOUR = 3_600_000;
const FIVE_MIN = 300_000;

/** `n` flat candles (high 101, low 99) every `tfMs` from `start`, with some overridden. */
function series(start: string, n: number, tfMs: number, overrides: Record<number, Partial<Candle>> = {}): Candle[] {
  const t0 = Date.parse(start);
  return Array.from({ length: n }, (_, i) => ({ t: t0 + i * tfMs, o: 100, h: 101, l: 99, c: 100, v: 0, ...overrides[i] }));
}

const of = (ranges: SessionRange[], id: MarketSessionId) => ranges.filter((range) => range.session.id === id);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 16);

// Wednesday 14 January 2026, winter: Tokyo 09:00 is 00:00 UTC, London is on
// UTC, New York 09:30 is 14:30 UTC. Candles start Tuesday 20:00 UTC, so index
// 4 is Wednesday 00:00 UTC.
const WED = '2026-01-13T20:00:00Z';

describe('inSession', () => {
  const ny = MARKET_SESSIONS.find((s) => s.id === 'newYork')!;

  it('covers New York 09:30 to 16:00 local, following daylight saving', () => {
    // Winter: 09:30 ET is 14:30 UTC, 16:00 ET is 21:00 UTC.
    expect(inSession(ny, Date.parse('2026-01-14T14:29:00Z'))).toBe(false);
    expect(inSession(ny, Date.parse('2026-01-14T14:30:00Z'))).toBe(true);
    expect(inSession(ny, Date.parse('2026-01-14T20:55:00Z'))).toBe(true);
    expect(inSession(ny, Date.parse('2026-01-14T21:00:00Z'))).toBe(false);
    // Summer: 09:30 ET is 13:30 UTC.
    expect(inSession(ny, Date.parse('2026-07-15T13:30:00Z'))).toBe(true);
    expect(inSession(ny, Date.parse('2026-07-15T13:25:00Z'))).toBe(false);
  });

  it('takes any hours, not just the named sessions', () => {
    // 09:30 to 11:00 New York, winter: 14:30 to 16:00 UTC.
    const window = { zone: 'America/New_York', open: 9 * 60 + 30, close: 11 * 60 };
    expect(inSession(window, Date.parse('2026-01-14T14:30:00Z'))).toBe(true);
    expect(inSession(window, Date.parse('2026-01-14T15:55:00Z'))).toBe(true);
    expect(inSession(window, Date.parse('2026-01-14T16:00:00Z'))).toBe(false);
  });

  it('runs a window that passes midnight', () => {
    // 20:00 to 02:00 New York, winter: 01:00 to 07:00 UTC.
    const window = { zone: 'America/New_York', open: 20 * 60, close: 2 * 60 };
    expect(inSession(window, Date.parse('2026-01-14T01:00:00Z'))).toBe(true);
    expect(inSession(window, Date.parse('2026-01-14T06:55:00Z'))).toBe(true);
    expect(inSession(window, Date.parse('2026-01-14T07:00:00Z'))).toBe(false);
    expect(inSession(window, Date.parse('2026-01-14T00:55:00Z'))).toBe(false);
  });

  it('leaves out weekends unless asked', () => {
    const saturday = Date.parse('2026-01-17T15:00:00Z');
    expect(inSession(ny, saturday)).toBe(false);
    expect(inSession(ny, saturday, true)).toBe(true);
  });
});

describe('sessionRanges', () => {
  it('finds each session high and low from the candles that open inside it', () => {
    const candles = series(WED, 48, HOUR, { 6: { h: 120 }, 8: { l: 80 } });
    const ranges = sessionRanges(candles, candles.length, HOUR);

    const [asia] = of(ranges, 'asia');
    expect(iso(asia.start)).toBe('2026-01-14T00:00');
    expect(iso(asia.end)).toBe('2026-01-14T06:00');
    expect(asia).toMatchObject({ first: 4, last: 9, high: 120, low: 80, live: false });

    const [london] = of(ranges, 'london');
    expect(iso(london.start)).toBe('2026-01-14T08:00');
    // 16:00 opens before the 16:30 close; 17:00 does not.
    expect(london).toMatchObject({ first: 12, last: 20 });

    const [newYork] = of(ranges, 'newYork');
    expect(iso(newYork.start)).toBe('2026-01-14T14:30');
    // The 14:00 candle opened before 14:30, so New York starts at 15:00.
    expect(newYork).toMatchObject({ first: 19, last: 24 });
  });

  it('returns ranges oldest first', () => {
    const candles = series(WED, 48, HOUR);
    const starts = sessionRanges(candles, candles.length, HOUR).map((range) => range.start);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });

  it('never reads past the visible candles', () => {
    // Visible: Tuesday 20:00 to Wednesday 02:00. The 80 low at 04:00 is still in the future.
    const candles = series(WED, 48, HOUR, { 6: { h: 120 }, 8: { l: 80 } });
    const [asia] = of(sessionRanges(candles, 7, HOUR), 'asia');
    expect(asia).toMatchObject({ first: 4, last: 6, high: 120, low: 99, live: true, highTo: null, lowTo: null });
    expect(of(sessionRanges(candles, 7, HOUR), 'london')).toEqual([]);
  });

  it('carries a level until price trades through it', () => {
    // Asia high 120; the 10:00 candle (index 14) takes it out.
    const candles = series(WED, 48, HOUR, { 6: { h: 120 }, 8: { l: 80 }, 14: { h: 121 } });
    const [asia] = of(sessionRanges(candles, candles.length, HOUR), 'asia');
    expect(asia).toMatchObject({ highTo: 14, highSwept: true });
  });

  it('carries an untouched level until the same session opens again', () => {
    // Thursday's Asia session opens at index 28.
    const candles = series(WED, 48, HOUR, { 8: { l: 80 } });
    const [wednesday, thursday] = of(sessionRanges(candles, candles.length, HOUR), 'asia');
    expect(thursday.first).toBe(28);
    expect(wednesday).toMatchObject({ lowTo: 27.5, lowSwept: false });
  });

  it('leaves an untouched level standing at the cursor when nothing has replaced it', () => {
    const candles = series(WED, 48, HOUR, { 8: { l: 80 } });
    const [asia] = of(sessionRanges(candles, 20, HOUR), 'asia');
    expect(asia).toMatchObject({ live: false, lowTo: null, lowSwept: false });
  });

  it('only sweeps on a trade beyond the level, not a touch', () => {
    const candles = series(WED, 48, HOUR, { 6: { h: 120 }, 14: { h: 120 } });
    const [asia] = of(sessionRanges(candles, 20, HOUR), 'asia');
    expect(asia).toMatchObject({ highTo: null, highSwept: false });
  });

  it('skips a session that began before the first candle', () => {
    // Starts Wednesday 02:00 UTC, two hours into Asia.
    const candles = series('2026-01-14T02:00:00Z', 30, HOUR);
    expect(of(sessionRanges(candles, candles.length, HOUR), 'asia').map((r) => iso(r.start))).toEqual([
      '2026-01-15T00:00'
    ]);
  });

  it('has no sessions at the weekend', () => {
    // Friday 16 to Monday 19 January.
    const candles = series('2026-01-16T00:00:00Z', 96, HOUR);
    const days = sessionRanges(candles, candles.length, HOUR).map((range) => new Date(range.start).getUTCDay());
    expect(new Set(days)).toEqual(new Set([5, 1]));
  });

  it('includes the weekend when asked, at the same hours', () => {
    const candles = series('2026-01-16T00:00:00Z', 96, HOUR);
    const ranges = sessionRanges(candles, candles.length, HOUR, undefined, { weekends: true });
    expect(new Set(ranges.map((range) => new Date(range.start).getUTCDay()))).toEqual(new Set([5, 6, 0, 1]));
    expect(of(ranges, 'asia').map((range) => iso(range.start))).toEqual([
      '2026-01-16T00:00',
      '2026-01-17T00:00',
      '2026-01-18T00:00',
      '2026-01-19T00:00'
    ]);
  });

  it("carries Friday's levels over the weekend to Monday's session", () => {
    // Friday's Asia low (index 3) is never traded through again.
    const candles = series('2026-01-16T00:00:00Z', 96, HOUR, { 3: { l: 80 } });
    const [friday, monday] = of(sessionRanges(candles, candles.length, HOUR), 'asia');
    expect(iso(monday.start)).toBe('2026-01-19T00:00');
    expect(friday).toMatchObject({ lowTo: monday.first - 0.5, lowSwept: false });
  });

  it("follows daylight saving in each session's own time zone", () => {
    // Wednesday 15 July 2026: London is UTC+1 and New York UTC-4.
    const candles = series('2026-07-15T05:00:00Z', 12 * 17, FIVE_MIN);
    const ranges = sessionRanges(candles, candles.length, FIVE_MIN);
    expect(iso(of(ranges, 'london')[0].start)).toBe('2026-07-15T07:00');
    expect(iso(candles[of(ranges, 'london')[0].first].t)).toBe('2026-07-15T07:00');
    expect(iso(of(ranges, 'newYork')[0].start)).toBe('2026-07-15T13:30');
    expect(iso(candles[of(ranges, 'newYork')[0].first].t)).toBe('2026-07-15T13:30');
  });

  it('is empty above 1h, and with no candles', () => {
    const candles = series(WED, 48, 4 * HOUR);
    expect(sessionRanges(candles, candles.length, 4 * HOUR)).toEqual([]);
    expect(sessionRanges([], 0, HOUR)).toEqual([]);
  });
});
