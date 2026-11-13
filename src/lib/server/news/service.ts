// Wires the news brief to the real world: live feeds, the model, Discord, the
// database. The brief and alert logic itself lives in $lib/news and is tested
// there with fakes.

import { yahooSymbol } from '$lib/data/stocks';
import { pollForAlerts, type PollResult } from '$lib/news/alerts';
import { describeHeadlines, describeStock, writeSummary } from '$lib/news/ai';
import { buildMorningBrief, buildWeeklyBrief, noTradeOf, type BriefDeps } from '$lib/news/brief';
import { buildFeed, type Bars, type Feed } from '$lib/news/feed';
import { buildLookup, type Lookup, type NextEarnings } from '$lib/news/lookup';
import { findMoveAlerts, moveKey, toRecord, type MoveAlertRecord } from '$lib/news/moves';
import type { Candidate } from '$lib/news/noise';
import { buildSummary, type Summary } from '$lib/news/summary';
import { addDays, ctDateKey, ctParts, inAlertWindow, isWeekday, nextMonday } from '$lib/news/time';
import type { Ask } from '$lib/news/ai';
import type { Brief, BriefKind, HeadlineItem, NewsSettings, NewsStatus, TrackedAsset } from '$lib/news/types';
import { fetchCalendar } from './calendar';
import { sendAlert, sendBrief, sendMoveAlert, discordReady } from './discord';
import { fetchEarnings } from './earnings';
import { fetchFeedHeadlines, fetchRecentHeadlines } from './headlines';
import { getText } from './http';
import { aiReady, chatJson } from './openrouter';
import { yahooBars } from './prices';
import {
  cacheGet,
  cachePut,
  addAlert,
  getBrief,
  getSettings,
  listAssets,
  markAlertSent,
  markBriefSent,
  markSeen,
  pruneSeen,
  recentAlerts,
  saveBrief,
  seenKeys,
  seenTitles,
  stateRead,
  stateSet
} from './store';

/** The model call for the current setting, or null when there is no key. */
export function makeAsk(model: string): Ask | null {
  if (!aiReady()) return null;
  return (args) => chatJson<unknown>({ model, ...args });
}

interface Quote {
  symbol: string;
  price: number;
  changePct: number;
}

/** Latest price and the move since the last close for one symbol, from Yahoo (free). Null when there is none. */
export async function fetchQuote(symbol: string): Promise<Quote | null> {
  try {
    const text = await getText(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol(symbol))}?range=1d&interval=5m`,
      { ttlMs: 60_000 }
    );
    const meta = (JSON.parse(text) as { chart?: { result?: { meta?: { regularMarketPrice?: number; chartPreviousClose?: number } }[] } }).chart?.result?.[0]?.meta;
    if (meta?.regularMarketPrice && meta.chartPreviousClose) {
      return { symbol, price: meta.regularMarketPrice, changePct: (meta.regularMarketPrice / meta.chartPreviousClose - 1) * 100 };
    }
  } catch {
    // No quote.
  }
  return null;
}

/** Quotes for the tracked markets (and stocks too, when asked). A symbol without one is left out. */
export async function fetchQuotes(assets: readonly TrackedAsset[], kinds: readonly string[] = ['market']): Promise<Quote[]> {
  const list = assets.filter((x) => x.enabled && kinds.includes(x.kind));
  const got = await Promise.all(list.map((a) => fetchQuote(a.symbol)));
  return got.filter((q): q is Quote => q != null);
}

export function liveDeps(settings: NewsSettings, assets: readonly TrackedAsset[]): BriefDeps {
  const stocks = new Set(assets.filter((a) => a.enabled && a.kind === 'stock').map((a) => a.symbol.toUpperCase()));
  return {
    assets,
    calendar: async (from, to) => (await fetchCalendar(from, to)).events,
    earnings: (date) => fetchEarnings(date, stocks),
    headlines: async (since, until) => {
      const r = await fetchRecentHeadlines(assets, since);
      return { items: r.items.filter((h) => h.publishedAt <= until), failed: r.failed };
    },
    moves: async () => (await fetchQuotes(assets)).map((q) => ({ symbol: q.symbol, changePct: q.changePct })),
    ask: makeAsk(settings.model),
    model: settings.model
  };
}

/** Latest price of each tracked market by symbol (empty when Yahoo is not answering). */
async function priceMap(assets: readonly TrackedAsset[]): Promise<Record<string, number>> {
  const prices: Record<string, number> = {};
  for (const q of await fetchQuotes(assets).catch(() => [])) prices[q.symbol] = q.price;
  return prices;
}

export async function generateMorning(date = ctDateKey(Date.now())): Promise<Brief> {
  const settings = getSettings();
  const assets = listAssets();
  const brief = await buildMorningBrief(date, Date.now(), liveDeps(settings, assets));
  brief.prices = await priceMap(assets);
  saveBrief(brief);
  return brief;
}

export async function generateWeekly(monday?: string): Promise<Brief> {
  const settings = getSettings();
  const start = monday ?? nextMonday(addDays(ctDateKey(Date.now()), 1));
  const assets = listAssets();
  const brief = await buildWeeklyBrief(start, Date.now(), liveDeps(settings, assets));
  brief.prices = await priceMap(assets);
  saveBrief(brief);
  return brief;
}

/** Sends a stored brief to Discord. Returns false when there is nothing to send. */
export async function sendStoredBrief(kind: BriefKind, forDate: string): Promise<boolean> {
  const stored = getBrief(kind, forDate);
  if (!stored) return false;
  // A morning brief starts with the short version, when there is a fresh one for that day.
  const s = lastSummary();
  const summary = kind === 'morning' && s && s.date === forDate && Date.now() - s.generatedAt < 3 * 3_600_000 ? s : undefined;
  await sendBrief(stored.brief, getSettings().showLow, summary);
  markBriefSent(kind, forDate);
  return true;
}

export interface AlertRun extends Omit<PollResult, 'alerts'> {
  alerts: HeadlineItem[];
  sent: number;
  at: number;
  skipped?: string;
}

/** One live check. Outside the trading windows it does nothing, unless `force` is set. */
export async function runAlertCheck(force = false): Promise<AlertRun> {
  const settings = getSettings();
  const now = Date.now();
  const empty = { fetched: 0, fresh: 0, candidates: 0, alerts: [], heldBack: 0, failed: [], sent: 0, at: now };
  if (!force && !inAlertWindow(now, settings.alertWindows)) return { ...empty, skipped: 'outside the trading windows' };
  const ask = makeAsk(settings.model);
  if (!ask) return { ...empty, skipped: 'no OpenRouter key' };

  const assets = listAssets();
  const result = await pollForAlerts({
    assets,
    settings,
    now,
    ask,
    headlines: (since) => fetchRecentHeadlines(assets, since),
    seen: (ids) => seenKeys(ids),
    markSeen: (items) => markSeen(items),
    recentTitles: (since) => seenTitles(since),
    alertsInLastHour: () => recentAlerts(now - 3_600_000).length
  });

  let sent = 0;
  const prices = result.alerts.length > 0 ? await priceMap(assets) : {};
  for (const alert of result.alerts) {
    const id = addAlert(alert, now);
    if (settings.discordAlerts && discordReady()) {
      try {
        await sendAlert(alert, prices);
        markAlertSent(id);
        sent++;
      } catch (err) {
        console.error('News: could not send an alert to Discord:', err);
      }
    }
  }
  pruneSeen(now - 3 * 86_400_000);
  const run: AlertRun = { ...result, sent, at: now };
  stateSet('lastAlertRun', { ...run, alerts: run.alerts.length });
  return run;
}

export function newsStatus(): NewsStatus {
  const settings = getSettings();
  const now = Date.now();
  return {
    aiReady: aiReady(),
    discordReady: discordReady(),
    model: settings.model,
    now,
    today: ctParts(now).dateKey,
    windowOpen: inAlertWindow(now, settings.alertWindows),
    lastError: stateRead('lastError', null),
    lastAlertRun: stateRead('lastAlertRun', null),
    botRunning: globalThis.__newsBotIntervalId !== undefined
  };
}

declare global {
  var __newsBotIntervalId: ReturnType<typeof setInterval> | undefined;
}

// ---- the news feed ----

/** How far back the feed reaches. */
const FEED_DAYS = 7;

export const lastFeed = (): Feed | null => stateRead<Feed | null>('feed', null);

/** Hourly prices for each symbol, a few requests at a time. A symbol Yahoo does not know is left out. */
async function barsFor(symbols: string[]): Promise<Record<string, Bars>> {
  const out: Record<string, Bars> = {};
  for (let i = 0; i < symbols.length; i += 4) {
    const chunk = symbols.slice(i, i + 4);
    const got = await Promise.all(chunk.map((s) => yahooBars(s)));
    got.forEach((b, n) => {
      if (b) out[chunk[n]] = b;
    });
  }
  return out;
}

/**
 * One-line descriptions, asking the model only about stories it has not seen
 * (what it said is kept, so a refresh costs nothing for old stories).
 */
async function describeCached(ask: NonNullable<ReturnType<typeof makeAsk>>, candidates: Candidate[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const fresh: Candidate[] = [];
  for (const c of candidates) {
    const hit = cacheGet(`feedwhat2:${c.id}`, Infinity);
    if (hit == null) fresh.push(c);
    else {
      const what = (JSON.parse(hit) as { what: string | null }).what;
      if (what) out.set(c.id, what);
    }
  }
  if (fresh.length > 0) {
    const described = await describeHeadlines(ask, fresh, Date.now());
    for (const c of fresh) {
      const what = described.get(c.id) ?? null;
      cachePut(`feedwhat2:${c.id}`, JSON.stringify({ what }));
      if (what) out.set(c.id, what);
    }
  }
  return out;
}

let feedRun: Promise<Feed> | null = null;
export const feedRunning = (): boolean => feedRun != null;

/** Reads the past days' news, checks what prices did after each story, and keeps the result. Runs once at a time. */
export function generateFeed(): Promise<Feed> {
  feedRun ??= (async () => {
    const settings = getSettings();
    const assets = listAssets();
    const ask = makeAsk(settings.model);
    const feed = await buildFeed({
      assets,
      now: Date.now(),
      days: FEED_DAYS,
      minRatio: 1,
      limit: 30,
      headlines: (since) => fetchFeedHeadlines(assets, since),
      bars: barsFor,
      describe: ask ? (cs) => describeCached(ask, cs) : undefined,
      model: settings.model
    });
    stateSet('feed', feed);
    return feed;
  })().finally(() => {
    feedRun = null;
  });
  return feedRun;
}

// ---- the short summary ----

export const lastSummary = (): Summary | null => stateRead<Summary | null>('summary', null);

const nextWeekday = (dateKey: string): string => {
  let key = addDays(dateKey, 1);
  while (!isWeekday(key)) key = addDays(key, 1);
  return key;
};

let summaryRun: Promise<Summary> | null = null;
export const summaryRunning = (): boolean => summaryRun != null;

/**
 * The short version of the day: today's and the next trading day's events, the
 * feed, how each tracked market and stock is doing, phrased by the AI (or plain).
 */
export function generateSummary(): Promise<Summary> {
  summaryRun ??= (async () => {
    const settings = getSettings();
    const assets = listAssets();
    const ask = makeAsk(settings.model);
    const now = Date.now();
    const date = ctDateKey(now);

    // The feed is part of it. Reuse the last one unless it is old.
    let feed = lastFeed();
    if (!feed || now - feed.generatedAt > 90 * 60_000) feed = await generateFeed().catch(() => feed);

    const stocks = new Set(assets.filter((a) => a.enabled && a.kind === 'stock').map((a) => a.symbol.toUpperCase()));
    const base = {
      assets,
      calendar: async (from: number, to: number) => (await fetchCalendar(from, to)).events,
      earnings: (d: string) => fetchEarnings(d, stocks)
    };
    const symbols = assets.filter((a) => a.enabled && a.kind !== 'topic').map((a) => a.symbol);
    const [today, next, quotes, bars] = await Promise.all([
      buildMorningBrief(date, now, base),
      buildMorningBrief(nextWeekday(date), now, base),
      fetchQuotes(assets, ['market', 'stock']),
      barsFor(symbols)
    ]);
    const events = [...today.events, ...next.events].sort((a, b) => a.timeMs - b.timeMs);

    const quoteMap: Record<string, { price: number; changePct: number }> = {};
    const prices: Record<string, number> = {};
    for (const q of quotes) {
      quoteMap[q.symbol] = { price: q.price, changePct: q.changePct };
      prices[q.symbol] = q.price;
    }
    const typical: Record<string, number> = {};
    for (const [symbol, b] of Object.entries(bars)) typical[symbol] = b.typicalMove;

    const summary = await buildSummary({
      input: { assets, now, date, events, feed, quotes: quoteMap, typical, stayOut: noTradeOf(events) },
      prices,
      phrase: ask ? (facts) => writeSummary(ask, facts) : undefined,
      model: settings.model
    });
    for (const note of [...today.notes, ...next.notes]) {
      if (!summary.notes.includes(note) && !note.startsWith('AI is off')) summary.notes.push(note);
    }
    stateSet('summary', summary);
    return summary;
  })().finally(() => {
    summaryRun = null;
  });
  return summaryRun;
}

// ---- the stock finder ----

export class LookupError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

/** A company's short name from Yahoo's search (free), or the ticker when it cannot be found. */
async function companyName(symbol: string): Promise<string> {
  try {
    const text = await getText(
      `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}&quotesCount=3&newsCount=0`,
      { ttlMs: 24 * 3_600_000 }
    );
    const quotes = (JSON.parse(text) as { quotes?: { symbol?: string; shortname?: string; longname?: string }[] }).quotes ?? [];
    const hit = quotes.find((q) => q.symbol?.toUpperCase() === symbol) ?? quotes[0];
    return hit?.shortname ?? hit?.longname ?? symbol;
  } catch {
    return symbol;
  }
}

const tidyName = (name: string) =>
  name
    .replace(/[,.]?\s+(Inc|Corp|Corporation|Company|Co|Ltd|Limited|PLC|N\.?V|S\.?A|Holdings?|Group|Class [A-C])\b\.?/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

/** The next report date for a stock in the coming three weeks, from the Nasdaq calendar. */
async function nextEarnings(symbol: string, now: number): Promise<NextEarnings | null> {
  const dates: string[] = [];
  let key = ctDateKey(now);
  for (let i = 0; i < 22; i++) {
    if (isWeekday(key)) dates.push(key);
    key = addDays(key, 1);
  }
  const wanted = new Set([symbol]);
  const rows = await Promise.all(dates.map((d) => fetchEarnings(d, wanted).catch(() => [])));
  const hit = rows.flat()[0];
  return hit ? { date: hit.date, time: hit.time } : null;
}

/** Everything on one stock: price against a normal day, the next report, the week's stories with the moves after them. */
export async function lookupStock(raw: string): Promise<Lookup> {
  const symbol = raw.trim().toUpperCase();
  if (!/^[A-Z0-9.^=-]{1,12}$/.test(symbol)) throw new LookupError('That does not look like a ticker.', 400);

  const cached = cacheGet(`lookup:${symbol}`, 10 * 60_000);
  if (cached) return JSON.parse(cached) as Lookup;

  const settings = getSettings();
  const ask = makeAsk(settings.model);
  const known = listAssets().find((a) => a.symbol === symbol && a.kind !== 'topic');
  const [quote, name, bars] = await Promise.all([
    fetchQuote(symbol),
    known ? Promise.resolve(known.name) : companyName(symbol),
    yahooBars(symbol)
  ]);
  if (!quote && !bars) throw new LookupError(`No prices found for ${symbol}. Check the ticker.`, 404);

  // A tracked stock keeps its own search words (a CEO's name, say); any other gets its ticker and company name.
  const asset: TrackedAsset = known ?? {
    id: -1,
    kind: 'stock',
    symbol,
    name,
    keywords: [...new Set([symbol, tidyName(name)].filter(Boolean))],
    enabled: true,
    builtin: false
  };
  const now = Date.now();
  const feed = await buildFeed({
    assets: [asset],
    now,
    days: FEED_DAYS,
    minRatio: 0,
    limit: 14,
    requireBig: false,
    headlines: (since) => fetchFeedHeadlines([asset], since),
    bars: async () => (bars ? { [symbol]: bars } : {}),
    describe: ask ? (cs) => describeCached(ask, cs) : undefined,
    model: settings.model
  });
  const earnings = await nextEarnings(symbol, now).catch(() => null);
  const out = await buildLookup({
    symbol,
    name,
    now,
    quote: quote ? { price: quote.price, changePct: quote.changePct } : null,
    typicalMove: bars?.typicalMove ?? null,
    earnings,
    feed,
    phrase: ask ? (facts) => describeStock(ask, facts) : undefined,
    model: settings.model
  });
  cachePut(`lookup:${symbol}`, JSON.stringify(out));
  return out;
}

// ---- move alerts: a big day for a tracked symbol, with a story to go with it ----

/** Most pings in one day, so a wild day does not turn into a flood. */
const MAX_MOVES_PER_DAY = 6;

export const recentMoveAlerts = (): MoveAlertRecord[] => stateRead<MoveAlertRecord[]>('moveAlerts', []);

export interface MoveRun {
  found: MoveAlertRecord[];
  /** How many went to Discord. */
  sent: number;
  skipped?: string;
  /** Found only: nothing was saved or sent. */
  dry: boolean;
}

/**
 * Pings for tracked stocks and markets having a big day with a recent story. It
 * runs in the session hours only (8:30 to 3:15 Central, weekdays), unless forced.
 * A symbol is pinged once a day. `dry` finds them without saving or sending.
 */
export async function checkMoveAlerts(opts: { force?: boolean; dry?: boolean } = {}): Promise<MoveRun> {
  const settings = getSettings();
  const now = Date.now();
  const dry = opts.dry === true;
  const none: MoveRun = { found: [], sent: 0, dry };
  if (!opts.force) {
    if (!settings.moveAlerts) return { ...none, skipped: 'move alerts are off' };
    const p = ctParts(now);
    if (p.weekday === 0 || p.weekday === 6 || p.minuteOfDay < 8 * 60 + 30 || p.minuteOfDay >= 15 * 60 + 15) {
      return { ...none, skipped: 'outside market hours' };
    }
  }
  const feed = lastFeed();
  if (!feed) return { ...none, skipped: 'no news feed yet' };

  const assets = listAssets();
  const symbols = assets.filter((a) => a.enabled && a.kind !== 'topic').map((a) => a.symbol);
  const [quotes, bars] = await Promise.all([fetchQuotes(assets, ['market', 'stock']), barsFor(symbols)]);
  const quoteMap: Record<string, { price: number; changePct: number }> = {};
  const prices: Record<string, number> = {};
  for (const q of quotes) {
    quoteMap[q.symbol] = { price: q.price, changePct: q.changePct };
    prices[q.symbol] = q.price;
  }
  const typical: Record<string, number> = {};
  for (const [symbol, b] of Object.entries(bars)) typical[symbol] = b.typicalMove;

  const today = ctDateKey(now);
  const state = stateRead<{ date: string; keys: string[] }>('moveSent', { date: today, keys: [] });
  const sent = new Set(state.date === today ? state.keys : []);
  const found = findMoveAlerts({ assets, now, quotes: quoteMap, typical, feed, minRatio: settings.moveAlertRatio, sent })
    .slice(0, Math.max(0, MAX_MOVES_PER_DAY - sent.size))
    .map((a) => toRecord(a, now));
  if (dry) return { ...none, found };

  const sending = settings.moveAlerts && discordReady();
  let sentCount = 0;
  for (const rec of found) {
    if (sending) {
      try {
        await sendMoveAlert(rec, prices);
        rec.discordSentAt = Date.now();
        sentCount++;
      } catch (err) {
        // Not marked as pinged, so the next check tries again.
        console.error('News: could not send a move alert to Discord:', err);
        continue;
      }
    }
    sent.add(moveKey(rec.symbol, now));
  }
  const kept = found.filter((r) => sent.has(moveKey(r.symbol, now)));
  stateSet('moveSent', { date: today, keys: [...sent] });
  if (kept.length > 0) stateSet('moveAlerts', [...kept, ...recentMoveAlerts()].slice(0, 40));
  return { found: kept, sent: sentCount, dry };
}
