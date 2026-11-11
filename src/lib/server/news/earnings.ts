// The earnings calendar, from Nasdaq's free public feed (any date, past or
// future, no key).

import { getJson } from './http';
import { cacheGet, cachePut } from './store';
import type { EarningsRow } from '$lib/news/rate';
import { DEFAULT_ASSETS } from '$lib/news/defaults';

interface NasdaqRow {
  symbol: string;
  name: string;
  time?: string;
  marketCap?: string;
}

interface NasdaqBody {
  data?: { rows?: NasdaqRow[] | null } | null;
}

interface Kept {
  symbol: string;
  name: string;
  time: EarningsRow['time'];
}

const URL_BASE = 'https://api.nasdaq.com/api/calendar/earnings?date=';
const DEFAULT_STOCKS = new Set(DEFAULT_ASSETS.filter((a) => a.kind === 'stock').map((a) => a.symbol));
/** A past day is kept for good, but only the big names: the whole day is ~40 KB of mostly small caps. */
const BIG = 1e10;

const parseCap = (s: string | undefined): number => {
  const n = Number((s ?? '').replace(/[$,]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

const timeOf = (t: string | undefined): EarningsRow['time'] =>
  t === 'time-pre-market' ? 'pre' : t === 'time-after-hours' ? 'post' : 'unknown';

const tidy = (name: string) => name.replace(/\s+(Inc\.?|Corporation|Corp\.?|Platforms|Class [A-C].*)$/i, '').trim();

async function download(dateKey: string): Promise<NasdaqRow[]> {
  const body = await getJson<NasdaqBody>(`${URL_BASE}${dateKey}`, {
    headers: { Accept: 'application/json, text/plain, */*', Origin: 'https://www.nasdaq.com', Referer: 'https://www.nasdaq.com/' }
  });
  return body.data?.rows ?? [];
}

/** Companies reporting on `dateKey` that are in `symbols`. */
export async function fetchEarnings(dateKey: string, symbols: ReadonlySet<string>): Promise<EarningsRow[]> {
  const past = Date.parse(`${dateKey}T23:59:59Z`) < Date.now() - 2 * 86_400_000;
  const key = `earnings:${dateKey}`;
  let kept: Kept[] | null = null;

  if (past) {
    const hit = cacheGet(key, Infinity);
    if (hit) kept = JSON.parse(hit) as Kept[];
  } else {
    const hit = cacheGet(key, 30 * 60_000);
    if (hit) kept = JSON.parse(hit) as Kept[];
  }

  if (!kept) {
    const rows = await download(dateKey);
    kept = rows
      // Today and the days ahead keep everyone (any tracked stock); history keeps the big names only.
      .filter((r) => !past || parseCap(r.marketCap) >= BIG || DEFAULT_STOCKS.has(r.symbol.toUpperCase()))
      .map((r) => ({ symbol: r.symbol.toUpperCase(), name: tidy(r.name), time: timeOf(r.time) }));
    cachePut(key, JSON.stringify(kept));
  }
  return kept.filter((r) => symbols.has(r.symbol)).map((r) => ({ ...r, date: dateKey }));
}
