// Market sessions (Asia, London, New York): the high and low each one made, and
// how long those levels stood afterwards. Worked out from the visible candles
// only, so a session that is still open at the cursor shows its range so far.

import { zonedTime, type TimeZone } from '$lib/timezone';
import type { Candle } from './types';

export type MarketSessionId = 'asia' | 'london' | 'newYork';

export interface MarketSession {
  id: MarketSessionId;
  label: string;
  /** Used on the chart: "Asia H", "NY L". */
  short: string;
  /** The session's hours are local time here, so daylight saving is followed. */
  zone: TimeZone;
  /** Opening and closing time in `zone`, in minutes after midnight. */
  open: number;
  close: number;
  /** City the hours are given in, for the settings list. */
  city: string;
}

/** Exchange hours, the same defaults as TradingView's Trading Sessions indicator. */
export const MARKET_SESSIONS: readonly MarketSession[] = [
  { id: 'asia', label: 'Asia', short: 'Asia', zone: 'Asia/Tokyo', city: 'Tokyo', open: 9 * 60, close: 15 * 60 },
  {
    id: 'london',
    label: 'London',
    short: 'London',
    zone: 'Europe/London',
    city: 'London',
    open: 8 * 60,
    close: 16 * 60 + 30
  },
  {
    id: 'newYork',
    label: 'New York',
    short: 'NY',
    zone: 'America/New_York',
    city: 'New York',
    open: 9 * 60 + 30,
    close: 16 * 60
  }
];

/**
 * Sessions are only drawn up to this timeframe. On 4h and daily one candle
 * spans most of a session (or several), so there is no range to speak of.
 */
export const SESSION_MAX_TF_MS = 3_600_000;

export interface SessionRange {
  session: MarketSession;
  /** The session's opening and closing instants. */
  start: number;
  end: number;
  /** Indexes of its first and last candle (inclusive). */
  first: number;
  last: number;
  high: number;
  low: number;
  /** Still open at the cursor: the range is what it has made so far. */
  live: boolean;
  /**
   * Where each level stops after the session, as a bar index: the candle that
   * traded through it, or the next opening of the same session. null means it
   * is still standing at the cursor. Always null while the session is live.
   */
  highTo: number | null;
  lowTo: number | null;
  /** The level was traded through (rather than replaced by the next session). */
  highSwept: boolean;
  lowSwept: boolean;
}

const DAY_MS = 86_400_000;

/** "HH:MM" for minutes after midnight. */
export function fmtSessionTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

interface SessionWindow {
  start: number;
  end: number;
  /** On a Saturday or Sunday in the session's own time zone. */
  weekend: boolean;
}

// Where a session opens and closes on a given day never changes, and working
// it out takes time zone lookups, so each day is only worked out once.
const windows = new Map<string, SessionWindow>();

/** Just the hours: enough to place a session (or a custom window) on a day. */
export type SessionHours = Pick<MarketSession, 'zone' | 'open' | 'close'>;

/** The session on the calendar day starting at `day` (UTC midnight). */
function windowOn(session: SessionHours, day: number): SessionWindow {
  const key = `${session.zone}|${session.open}|${session.close}|${day}`;
  const cached = windows.get(key);
  if (cached) return cached;

  const date = new Date(day);
  const weekday = date.getUTCDay();
  const [y, m, d] = [date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()];
  const at = (minutes: number, nextDay = false) =>
    zonedTime(session.zone, y, m, d + (nextDay ? 1 : 0), Math.floor(minutes / 60), minutes % 60);
  const result: SessionWindow = {
    start: at(session.open),
    // A session that closes "earlier" than it opens runs past midnight.
    end: at(session.close, session.close <= session.open),
    weekend: weekday === 0 || weekday === 6
  };
  windows.set(key, result);
  return result;
}

/**
 * True when a candle opening at `ms` belongs to `session` (the same rule the
 * session ranges use: a candle is in a session when it OPENS inside it).
 * Weekends are out unless `weekends` is set.
 */
export function inSession(session: SessionHours, ms: number, weekends = false): boolean {
  const today = Math.floor(ms / DAY_MS) * DAY_MS;
  // A session's hours can fall on the neighbouring UTC day, so look at three.
  for (const day of [today - DAY_MS, today, today + DAY_MS]) {
    const hours = windowOn(session, day);
    if (hours.weekend && !weekends) continue;
    if (ms >= hours.start && ms < hours.end) return true;
  }
  return false;
}

/** Index of the first of `candles[0..count)` that opens at or after `ms`. */
function firstFrom(candles: readonly Candle[], count: number, ms: number): number {
  let lo = 0;
  let hi = count;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (candles[mid].t < ms) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * The bar index where a level stops: the first candle in `[from, until)` that
 * trades through it, else `until` itself when another session takes over
 * there, else null (still standing at the cursor).
 */
function standsUntil(
  candles: readonly Candle[],
  from: number,
  until: number,
  through: (candle: Candle) => boolean,
  replaced: boolean
): { to: number | null; swept: boolean } {
  for (let i = from; i < until; i++) {
    if (through(candles[i])) return { to: i, swept: true };
  }
  return { to: replaced ? until - 0.5 : null, swept: false };
}

/**
 * Every session range in `candles[0..count)`, oldest first. A candle belongs to
 * a session when it OPENS inside it. Sessions that began before the first
 * candle are left out: their high and low would be incomplete.
 *
 * The markets behind the sessions are shut at weekends, so Saturday and Sunday
 * are skipped unless `weekends` is set (crypto still trades, at the same hours).
 */
export function sessionRanges(
  candles: readonly Candle[],
  count: number,
  tfMs: number,
  sessions: readonly MarketSession[] = MARKET_SESSIONS,
  { weekends = false }: { weekends?: boolean } = {}
): SessionRange[] {
  if (count === 0 || tfMs > SESSION_MAX_TF_MS) return [];
  const firstOpen = candles[0].t;
  const lastOpen = candles[count - 1].t;
  /** The close of the last visible candle: everything up to here is known. */
  const seen = lastOpen + tfMs;
  const all: SessionRange[] = [];

  for (const session of sessions) {
    const own: SessionRange[] = [];
    for (let day = Math.floor(firstOpen / DAY_MS) * DAY_MS - DAY_MS; day <= lastOpen + DAY_MS; day += DAY_MS) {
      const hours = windowOn(session, day);
      if ((hours.weekend && !weekends) || hours.start < firstOpen || hours.start > lastOpen) continue;

      const first = firstFrom(candles, count, hours.start);
      if (first >= count || candles[first].t >= hours.end) continue;
      let last = first;
      let high = -Infinity;
      let low = Infinity;
      for (let i = first; i < count && candles[i].t < hours.end; i++) {
        last = i;
        if (candles[i].h > high) high = candles[i].h;
        if (candles[i].l < low) low = candles[i].l;
      }
      own.push({
        session,
        start: hours.start,
        end: hours.end,
        first,
        last,
        high,
        low,
        live: hours.end > seen,
        highTo: null,
        lowTo: null,
        highSwept: false,
        lowSwept: false
      });
    }

    // A level stands until price trades through it or the same session opens again.
    own.forEach((range, k) => {
      if (range.live) return;
      const next = own[k + 1];
      const until = next?.first ?? count;
      const high = standsUntil(candles, range.last + 1, until, (c) => c.h > range.high, next != null);
      const low = standsUntil(candles, range.last + 1, until, (c) => c.l < range.low, next != null);
      range.highTo = high.to;
      range.highSwept = high.swept;
      range.lowTo = low.to;
      range.lowSwept = low.swept;
    });
    all.push(...own);
  }
  return all.sort((a, b) => a.start - b.start);
}
