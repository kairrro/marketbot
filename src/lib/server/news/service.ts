// Wires the news brief to the real world: live feeds, the model, Discord, the
// database. The brief and alert logic itself lives in $lib/news and is tested
// there with fakes.

import { yahooSymbol } from '$lib/data/stocks';
import { pollForAlerts, type PollResult } from '$lib/news/alerts';
import { buildMorningBrief, buildWeeklyBrief, type BriefDeps } from '$lib/news/brief';
import { addDays, ctDateKey, ctParts, inAlertWindow, nextMonday } from '$lib/news/time';
import type { Ask } from '$lib/news/ai';
import type { Brief, BriefKind, HeadlineItem, NewsSettings, NewsStatus, TrackedAsset } from '$lib/news/types';
import { fetchCalendar } from './calendar';
import { sendAlert, sendBrief, discordReady } from './discord';
import { fetchEarnings } from './earnings';
import { fetchRecentHeadlines } from './headlines';
import { getText } from './http';
import { aiReady, chatJson } from './openrouter';
import {
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

/** Latest price and the move since the last close for each tracked market, from Yahoo (free). */
export async function fetchQuotes(assets: readonly TrackedAsset[]): Promise<Quote[]> {
  const out: Quote[] = [];
  for (const a of assets.filter((x) => x.enabled && x.kind === 'market')) {
    try {
      const text = await getText(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol(a.symbol))}?range=1d&interval=5m`,
        { ttlMs: 60_000 }
      );
      const meta = (JSON.parse(text) as { chart?: { result?: { meta?: { regularMarketPrice?: number; chartPreviousClose?: number } }[] } }).chart?.result?.[0]?.meta;
      if (meta?.regularMarketPrice && meta.chartPreviousClose) {
        out.push({ symbol: a.symbol, price: meta.regularMarketPrice, changePct: (meta.regularMarketPrice / meta.chartPreviousClose - 1) * 100 });
      }
    } catch {
      // A market without a quote is left out of the mood context.
    }
  }
  return out;
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
  await sendBrief(stored.brief, getSettings().showLow);
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
