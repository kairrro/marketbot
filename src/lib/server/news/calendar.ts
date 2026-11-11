// The economic calendar, from free sources with no key: TradingView's public
// calendar feed (any date range, past or future) and, as a fallback for the
// current week, the Forex Factory weekly JSON.

import { getJson, SourceError } from './http';
import type { RawEvent } from '$lib/news/types';
import { DAY } from '$lib/news/time';

const TV = 'https://economic-calendar.tradingview.com/events';
const FF = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';

/** Countries kept: the US, plus the places whose central banks and oil decisions are felt here. */
const COUNTRIES = 'US,EU,GB,JP,CN';

interface TvEvent {
  id: string;
  title: string;
  country: string;
  period?: string | null;
  importance?: number;
  date: string;
  actual?: number | string | null;
  forecast?: number | string | null;
  previous?: number | string | null;
  unit?: string | null;
}

const str = (v: unknown) => (v == null || v === '' ? null : String(v));

async function fromTradingView(fromMs: number, toMs: number, ttlMs: number): Promise<RawEvent[]> {
  const out: RawEvent[] = [];
  // Two-week slices: small answers, and a past slice is cached for good.
  for (let from = fromMs; from < toMs; from += 14 * DAY) {
    const to = Math.min(toMs, from + 14 * DAY);
    const url = `${TV}?from=${new Date(from).toISOString()}&to=${new Date(to).toISOString()}&countries=${COUNTRIES}`;
    const past = to < Date.now() - 2 * DAY;
    const body = await getJson<{ status?: string; result?: TvEvent[] }>(url, {
      ttlMs: past ? Infinity : ttlMs,
      headers: { Origin: 'https://www.tradingview.com' }
    });
    if (body.status !== 'ok' || !Array.isArray(body.result)) throw new SourceError('The calendar feed answered with an error.');
    for (const e of body.result) {
      const timeMs = Date.parse(e.date);
      if (!Number.isFinite(timeMs)) continue;
      out.push({
        id: String(e.id),
        title: e.title,
        country: e.country,
        timeMs,
        importance: e.importance ?? 0,
        period: str(e.period),
        forecast: str(e.forecast),
        previous: str(e.previous),
        actual: str(e.actual)
      });
    }
  }
  return out;
}

const CURRENCY_COUNTRY: Record<string, string> = { USD: 'US', EUR: 'EU', GBP: 'GB', JPY: 'JP', CNY: 'CN' };
const FF_IMPORTANCE: Record<string, number> = { High: 1, Medium: 0, Low: -1 };

interface FfEvent {
  title: string;
  country: string;
  date: string;
  impact: string;
  forecast?: string;
  previous?: string;
}

async function fromForexFactory(ttlMs: number): Promise<RawEvent[]> {
  const rows = await getJson<FfEvent[]>(FF, { ttlMs });
  const out: RawEvent[] = [];
  for (const e of rows) {
    const country = CURRENCY_COUNTRY[e.country];
    const timeMs = Date.parse(e.date);
    if (!country || !Number.isFinite(timeMs) || !(e.impact in FF_IMPORTANCE)) continue;
    out.push({
      id: `ff:${e.title}:${timeMs}`,
      title: e.title,
      country,
      timeMs,
      importance: FF_IMPORTANCE[e.impact],
      forecast: str(e.forecast),
      previous: str(e.previous)
    });
  }
  return out;
}

export interface CalendarResult {
  events: RawEvent[];
  /** Plain note when the main feed failed and the fallback was used. */
  note?: string;
}

/** Calendar rows with a release time in [fromMs, toMs). Newer ranges are asked for fresh every 20 minutes. */
export async function fetchCalendar(fromMs: number, toMs: number, ttlMs = 20 * 60_000): Promise<CalendarResult> {
  try {
    const events = (await fromTradingView(fromMs, toMs, ttlMs)).filter((e) => e.timeMs >= fromMs && e.timeMs < toMs);
    return { events };
  } catch (err) {
    // The weekly file only covers the current week; use it when that is what was asked for.
    const now = Date.now();
    if (toMs > now - 7 * DAY && fromMs < now + 7 * DAY) {
      try {
        const events = (await fromForexFactory(ttlMs)).filter((e) => e.timeMs >= fromMs && e.timeMs < toMs);
        return { events, note: `Main calendar feed was down (${err instanceof Error ? err.message : err}). Used the backup, which has fewer events.` };
      } catch {
        // Fall through to the original error.
      }
    }
    throw err;
  }
}
