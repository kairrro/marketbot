// Rates scheduled events: calendar rows and earnings. Rules only (see profiles.ts),
// so the same inputs always give the same ratings and the past-data test can
// check them. The AI is not involved here.

import {
  DEFAULT_WINDOW,
  EARNINGS_NQ,
  EARNINGS_OPEN_NQ,
  EARNINGS_WINDOW,
  classifyEvent,
  exposureOf,
  type Profile
} from './profiles';
import { EARNINGS_OPEN_SWING, EARNINGS_SWING, swingFor, type Swing } from './swing';
import { ctAt, windowAround } from './time';
import {
  IMPACT_RANK,
  maxImpact,
  type Impact,
  type RawEvent,
  type ScheduledItem,
  type TrackedAsset,
  type Volatility
} from './types';

const markets = (assets: readonly TrackedAsset[]) => assets.filter((a) => a.enabled && a.kind === 'market');

function volatilityFor(impact: Impact, top: boolean): Volatility {
  if (impact === 'high') return top ? 'extreme' : 'elevated';
  return impact === 'medium' ? 'elevated' : 'normal';
}

/** "Feb. 2025" -> "Feb", "Q3 2025" -> "Q3". Anything else is left out. */
function shortPeriod(period: string | null | undefined): string {
  if (!period) return '';
  const month = /^([A-Z][a-z]{2})\.?\s+\d{4}$/.exec(period.trim());
  if (month) return month[1];
  const quarter = /^(Q[1-4])\b/.exec(period.trim());
  return quarter ? quarter[1] : '';
}

const fmtNum = (v: string | null | undefined) => (v == null || v === '' ? null : String(v));

/** Which tracked markets an item touches: the ones it is at least Medium for, or all of them when it is Low for everything. */
function affected(perAsset: Record<string, Impact>, overall: Impact): string[] {
  const floor = overall === 'low' ? 0 : 1;
  return Object.entries(perAsset)
    .filter(([, impact]) => IMPACT_RANK[impact] >= floor)
    .map(([symbol]) => symbol);
}

function build(
  profile: Profile,
  rows: RawEvent[],
  assets: readonly TrackedAsset[]
): ScheduledItem | null {
  const tracked = markets(assets);
  if (tracked.length === 0) return null;
  const main = rows.reduce((best, row) => (row.importance > best.importance ? row : best), rows[0]);

  const perAsset: Record<string, Impact> = {};
  let impact: Impact = 'low';
  for (const asset of tracked) {
    const tier = profile.tiers[exposureOf(asset.symbol)];
    perAsset[asset.symbol] = tier;
    impact = maxImpact(impact, tier);
  }

  const wide = impact === 'low' ? null : (profile.window?.[impact] ?? DEFAULT_WINDOW[impact]);
  const period = profile.period ? shortPeriod(main.period) : '';
  const swing: Record<string, Swing> = {};
  for (const [symbol, tier] of Object.entries(perAsset)) {
    const found = swingFor(profile.id, symbol, tier);
    if (found) swing[symbol] = found;
  }
  return {
    id: `${profile.id}:${main.timeMs}`,
    kind: profile.kind,
    family: profile.id,
    title: period ? `${profile.label} · ${period}` : profile.label,
    note: profile.note,
    timeMs: main.timeMs,
    assets: affected(perAsset, impact),
    perAsset,
    impact,
    volatility: volatilityFor(impact, Boolean(profile.top)),
    noTrade: wide ? windowAround(main.timeMs, wide.before, wide.after) : null,
    swing,
    forecast: fmtNum(main.forecast),
    previous: fmtNum(main.previous)
  };
}

/** Rates calendar rows: several rows for one release (CPI, core CPI) become one item. */
export function rateEvents(raw: readonly RawEvent[], assets: readonly TrackedAsset[]): ScheduledItem[] {
  const groups = new Map<string, { profile: Profile; rows: RawEvent[] }>();
  for (const ev of raw) {
    const profile = classifyEvent(ev.title, ev.country);
    if (!profile) continue;
    const key = `${profile.id}@${ev.timeMs}`;
    const group = groups.get(key);
    if (group) group.rows.push(ev);
    else groups.set(key, { profile, rows: [ev] });
  }
  const items: ScheduledItem[] = [];
  for (const { profile, rows } of groups.values()) {
    const item = build(profile, rows, assets);
    if (item) items.push(item);
  }
  return items.sort((a, b) => a.timeMs - b.timeMs);
}

// ---- earnings ----

export interface EarningsRow {
  symbol: string;
  name: string;
  /** When the company reports: before the open, after the close, or not said. */
  time: 'pre' | 'post' | 'unknown';
  /** Central-time date key of the report. */
  date: string;
}

/** The stocks the user tracks, by symbol. */
const trackedStocks = (assets: readonly TrackedAsset[]) =>
  new Map(assets.filter((a) => a.enabled && a.kind === 'stock').map((a) => [a.symbol.toUpperCase(), a]));

function earningsPerAsset(
  symbol: string,
  assets: readonly TrackedAsset[],
  tiers: Record<string, Impact>
): { perAsset: Record<string, Impact>; impact: Impact } {
  const nq = tiers[symbol.toUpperCase()] ?? 'low';
  const perAsset: Record<string, Impact> = {};
  let impact: Impact = 'low';
  for (const asset of markets(assets)) {
    const tier = exposureOf(asset.symbol) === 'index' ? nq : 'low';
    perAsset[asset.symbol] = tier;
    impact = maxImpact(impact, tier);
  }
  return { perAsset, impact };
}

function earningsItem(
  row: EarningsRow,
  assets: readonly TrackedAsset[],
  opts: { family: 'earnings' | 'earnings-open'; title: string; timeMs: number; note: string; outsideHours: boolean }
): ScheduledItem | null {
  const tracked = markets(assets);
  if (tracked.length === 0) return null;
  const { perAsset, impact } = earningsPerAsset(row.symbol, assets, opts.family === 'earnings' ? EARNINGS_NQ : EARNINGS_OPEN_NQ);
  const wide = EARNINGS_WINDOW[impact];
  // Measured on NQ: that is the market a stock's report moves. Gold and oil are Low for it.
  const known = (opts.family === 'earnings' ? EARNINGS_SWING : EARNINGS_OPEN_SWING)[row.symbol.toUpperCase()];
  const swing: Record<string, Swing> = {};
  for (const [symbol, tier] of Object.entries(perAsset)) {
    if (tier !== 'low' && known) swing[symbol] = known;
  }
  return {
    id: `${opts.family}:${row.symbol}:${opts.timeMs}`,
    kind: 'earnings',
    family: opts.family,
    title: opts.title,
    note: opts.note,
    timeMs: opts.timeMs,
    assets: [...affected(perAsset, impact), row.symbol],
    perAsset,
    impact,
    volatility: volatilityFor(impact, false),
    noTrade: wide ? windowAround(opts.timeMs, wide.before, wide.after) : null,
    swing,
    outsideHours: opts.outsideHours
  };
}

const AFTER_CLOSE = '15:05';
const BEFORE_OPEN = '06:30';
const CASH_OPEN = '08:30';

/** Earnings releases on their report date: the moment the numbers come out. */
export function earningsReleaseItems(rows: readonly EarningsRow[], assets: readonly TrackedAsset[]): ScheduledItem[] {
  const stocks = trackedStocks(assets);
  const items: ScheduledItem[] = [];
  for (const row of rows) {
    if (!stocks.has(row.symbol.toUpperCase())) continue;
    const pre = row.time === 'pre';
    const item = earningsItem(row, assets, {
      family: 'earnings',
      title: `${row.symbol} earnings, ${pre ? 'before the open' : 'after the close'}`,
      timeMs: ctAt(row.date, pre ? BEFORE_OPEN : AFTER_CLOSE),
      note: pre
        ? `${row.name} reports before the open.`
        : `${row.name} reports after the close. It hits the next open.`,
      outsideHours: !pre
    });
    if (item) items.push(item);
  }
  return items.sort((a, b) => a.timeMs - b.timeMs);
}

/**
 * The open that follows a report: `rows` reported last night (after the close) or
 * this morning (before the open), and `openDate` is the day trading opens on.
 */
export function earningsOpenItems(
  rows: readonly EarningsRow[],
  assets: readonly TrackedAsset[],
  openDate: string
): ScheduledItem[] {
  const stocks = trackedStocks(assets);
  const items: ScheduledItem[] = [];
  for (const row of rows) {
    if (!stocks.has(row.symbol.toUpperCase())) continue;
    const item = earningsItem(row, assets, {
      family: 'earnings-open',
      title: `${row.symbol} reported ${row.time === 'pre' ? 'this morning' : 'last night'}`,
      timeMs: ctAt(openDate, CASH_OPEN),
      note: 'The first minutes of the cash open can be jumpy.',
      outsideHours: false
    });
    if (item) items.push(item);
  }
  return items.sort((a, b) => a.timeMs - b.timeMs);
}
