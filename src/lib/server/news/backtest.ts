// The past-data test. For every past day with prices, it builds the morning brief
// exactly as the live bot would at 8:00 AM Central (calendar and earnings as they
// were published, nothing that came after) and then checks each rating against
// what the market actually did in the 60 minutes after: NQ, GC and CL.
//
// The scheduled-event ratings are rules, so this needs no AI and costs nothing.
// Headlines rated by the AI are not part of it (see the notes it writes).

import type { Candle } from '$lib/engine/types';
import type { BacktestProgress, BacktestResult, Coverage, FamilyRow, SampleView, SummaryView, WindowRow } from '$lib/news/backtestTypes';
import { buildMorningBrief } from '$lib/news/brief';
import { QUIET_BELOW, SPIKE_AT, firstAtOrAfter, mean, measureReaction, median, summarize, type Reaction, type Sample, type Summary } from '$lib/news/evaluate';
import { DEFAULT_ASSETS } from '$lib/news/defaults';
import { DEFAULT_WINDOW, PROFILES } from '$lib/news/profiles';
import type { EarningsRow } from '$lib/news/rate';
import { DAY, MINUTE, addDays, ctAt, ctDateKey, ctParts, isWeekday, previousWeekday } from '$lib/news/time';
import { IMPACT_RANK, type Impact, type RawEvent, type ScheduledItem, type TrackedAsset } from '$lib/news/types';
import { fetchCalendar } from './calendar';
import { fetchEarnings } from './earnings';
import { cachedMinuteDates, readMinuteDay, yahooFiveMinute } from './prices';
import { stateRead, stateSet } from './store';

let progress: BacktestProgress = { running: false, phase: '', done: 0, total: 0, startedAt: null, error: null };
export const backtestProgress = (): BacktestProgress => progress;
export const lastBacktest = (): BacktestResult | null => stateRead<BacktestResult | null>('backtest', null);

const step = (phase: string, done = 0, total = 0) => {
  progress = { ...progress, phase, done, total };
};

// ---- price access ----

interface Series {
  symbol: string;
  /** 1-minute candles saved locally, read a day at a time. */
  minuteDates: Set<string>;
  five: Candle[];
}

/** A small cache of recently read days, so a run over hundreds of days does not hold them all. */
class DayCache {
  private map = new Map<string, Candle[]>();
  get(coin: string, utcDate: string): Candle[] {
    const key = `${coin}|${utcDate}`;
    let hit = this.map.get(key);
    if (!hit) {
      hit = readMinuteDay(coin, utcDate);
      this.map.set(key, hit);
      if (this.map.size > 40) this.map.delete(this.map.keys().next().value as string);
    }
    return hit;
  }
}

const utcDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

interface Measured {
  reaction: Reaction;
  barMs: number;
  source: 'minute' | 'five';
}

function measureAt(series: Series, days: DayCache, t0: number): Measured | null {
  if (series.minuteDates.size > 0) {
    const a = utcDate(t0 - 15 * MINUTE);
    const b = utcDate(t0 + 70 * MINUTE);
    if (series.minuteDates.has(a) || series.minuteDates.has(b)) {
      const candles = a === b ? days.get(series.symbol, a) : [...days.get(series.symbol, a), ...days.get(series.symbol, b)];
      const reaction = measureReaction(candles, t0, MINUTE);
      if (reaction) return { reaction, barMs: MINUTE, source: 'minute' };
    }
  }
  if (series.five.length > 0) {
    const reaction = measureReaction(series.five, t0, 5 * MINUTE);
    if (reaction) return { reaction, barMs: 5 * MINUTE, source: 'five' };
  }
  return null;
}

const slotOf = (ms: number) => Math.floor(ctParts(ms).minuteOfDay / 5) * 5;

// ---- the run ----

/** The 1-minute candles around t0 (this UTC day, and the next when the window crosses midnight). */
function minuteCandles(series: Series, days: DayCache, t0: number): Candle[] {
  const a = utcDate(t0 - 15 * MINUTE);
  const b = utcDate(t0 + 80 * MINUTE);
  return a === b ? days.get(series.symbol, a) : [...days.get(series.symbol, a), ...days.get(series.symbol, b)];
}

const view = (s: Sample): SampleView => ({
  date: ctDateKey(s.timeMs),
  timeMs: s.timeMs,
  label: s.label,
  family: s.family,
  asset: s.asset,
  tier: s.tier,
  range30: s.reaction.range30,
  range60: s.reaction.range60,
  net30: s.reaction.net30,
  net60: s.reaction.net60,
  baseline: s.baseline,
  ratio: s.ratio
});

const summaryView = (s: Summary): SummaryView => ({ ...s, highQuiet: s.highQuiet.map(view), lowSpike: s.lowSpike.map(view) });

const HORIZON = 120;
/** "Calm" means back under this multiple of the usual range for that time of day. */
const CALM_MULTIPLE = 2;

/** The minute-by-minute range (as a share of price) for the ${HORIZON} minutes from t0. NaN where a minute is missing; null with no price before. */
function minuteRanges(candles: readonly Candle[], t0: number): number[] | null {
  const start = firstAtOrAfter(candles, t0);
  const before = candles[start - 1];
  if (!before || t0 - (before.t + MINUTE) > 3 * MINUTE) return null;
  const out: number[] = [];
  for (let k = 0; k < HORIZON; k++) {
    const c = candles[start + k];
    out.push(c && c.t === t0 + k * MINUTE ? (c.h - c.l) / c.c : NaN);
  }
  return out;
}

/**
 * Minutes after the event until NQ was back under twice its usual range for that
 * time of day (the median minute on days with nothing scheduled) and stayed
 * there. Minutes with no trading (the daily break) count as calm. If it never
 * calms in the window, the last minute searched.
 */
function calmMinutes(ranges: readonly number[], usual: readonly number[]): number | null {
  if (ranges.slice(0, 60).filter(Number.isNaN).length > 12) return null;
  const smooth = ranges.map((_, k) => mean(ranges.slice(k, k + 3).filter((v) => !Number.isNaN(v))));
  const calmAt = (k: number) => Number.isNaN(smooth[k]) || Number.isNaN(usual[k]) || smooth[k] <= CALM_MULTIPLE * usual[k];
  const last = HORIZON - 10;
  for (let k = 0; k < last; k++) {
    if ([0, 1, 2, 3, 4].every((d) => calmAt(k + d))) return k;
  }
  return last;
}

const percentile = (values: number[], p: number) => {
  const s = [...values].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN;
};

export async function runBacktest(): Promise<BacktestResult> {
  if (progress.running) throw new Error('The test is already running.');
  const startedAt = Date.now();
  progress = { running: true, phase: 'Starting', done: 0, total: 0, startedAt, error: null };
  try {
    const result = await run(startedAt);
    stateSet('backtest', result);
    progress = { ...progress, running: false, phase: 'Done', error: null };
    return result;
  } catch (err) {
    progress = { ...progress, running: false, phase: 'Failed', error: err instanceof Error ? err.message : String(err) };
    throw err;
  }
}

async function run(startedAt: number): Promise<BacktestResult> {
  const notes: string[] = [];
  const now = Date.now();

  // The rules are tested on the default tracked assets, whatever the user has changed since.
  const assets: TrackedAsset[] = DEFAULT_ASSETS.map((a, i) => ({
    id: i + 1,
    kind: a.kind,
    symbol: a.symbol,
    name: a.name,
    keywords: [...a.keywords],
    enabled: true,
    builtin: true
  }));
  const markets = assets.filter((a) => a.kind === 'market');
  const stockSet = new Set(assets.filter((a) => a.kind === 'stock').map((a) => a.symbol));

  // 1. Prices.
  step('Reading saved prices');
  const series: Record<string, Series> = {};
  const coverage: Coverage[] = [];
  const dayDates = new Set<string>();
  const days = new DayCache();
  for (const m of markets) {
    const minuteDates = new Set(cachedMinuteDates(m.symbol));
    step(`Loading ${m.symbol} 5-minute prices from Yahoo`);
    const five = await yahooFiveMinute(m.symbol, now);
    series[m.symbol] = { symbol: m.symbol, minuteDates, five };
    if (minuteDates.size > 0) {
      const list = [...minuteDates];
      coverage.push({ asset: m.symbol, source: '1-minute, saved locally', from: list[0], to: list[list.length - 1], days: list.length });
      for (const d of list) if (isWeekday(d)) dayDates.add(d);
    }
    if (five.length > 0) {
      const fiveDays = new Set(five.map((c) => ctDateKey(c.t)));
      const list = [...fiveDays].sort();
      coverage.push({ asset: m.symbol, source: '5-minute, Yahoo (last 58 days)', from: list[0], to: list[list.length - 1], days: list.length });
      for (const d of list) if (isWeekday(d)) dayDates.add(d);
    }
    if (minuteDates.size === 0 && five.length === 0) notes.push(`No price data for ${m.symbol}, so it is not tested.`);
  }
  const dates = [...dayDates].sort();
  if (dates.length === 0) throw new Error('There are no past prices to test against.');

  // 2. The calendar for every stretch of dates, and earnings for the reporting seasons.
  step('Reading the economic calendar');
  const ranges: [string, string][] = [];
  for (const d of dates) {
    const last = ranges[ranges.length - 1];
    if (last && Date.parse(d) - Date.parse(last[1]) <= 21 * DAY) last[1] = d;
    else ranges.push([d, d]);
  }
  const events: RawEvent[] = [];
  let done = 0;
  for (const [from, to] of ranges) {
    step('Reading the economic calendar', done++, ranges.length);
    try {
      events.push(...(await fetchCalendar(ctAt(addDays(from, -1), 0), ctAt(addDays(to, 2), 0), Infinity)).events);
    } catch (err) {
      notes.push(`The calendar could not be read for ${from} to ${to} (${err instanceof Error ? err.message : err}).`);
    }
  }

  const earnDates = new Set<string>();
  for (const d of dates) {
    earnDates.add(d);
    earnDates.add(previousWeekday(d));
  }
  const earnings = new Map<string, EarningsRow[]>();
  const list = [...earnDates].sort();
  for (let i = 0; i < list.length; i++) {
    step('Reading earnings dates', i, list.length);
    try {
      earnings.set(list[i], await fetchEarnings(list[i], stockSet));
    } catch {
      // A day Nasdaq will not give is a day with no earnings in the test.
    }
  }

  // 3. The brief for each day, as it would have been at 8:00 AM.
  step('Building each day\'s brief', 0, dates.length);
  const itemsByDate = new Map<string, ScheduledItem[]>();
  const all: ScheduledItem[] = [];
  for (let i = 0; i < dates.length; i++) {
    const date = dates[i];
    const brief = await buildMorningBrief(date, ctAt(date, '08:00'), {
      assets,
      calendar: async (from, to) => events.filter((e) => e.timeMs >= from && e.timeMs < to),
      earnings: async (d) => earnings.get(d) ?? []
    });
    itemsByDate.set(date, brief.events);
    all.push(...brief.events);
  }

  // 4. What counts as a quiet day for a clock time: no Medium or High event nearby.
  const busyTimes = all.filter((i) => IMPACT_RANK[i.impact] >= 1).map((i) => i.timeMs).sort((a, b) => a - b);
  const isBusy = (t0: number) => {
    let lo = 0;
    let hi = busyTimes.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (busyTimes[mid] < t0 - 30 * MINUTE) lo = mid + 1;
      else hi = mid;
    }
    return lo < busyTimes.length && busyTimes[lo] <= t0 + 90 * MINUTE;
  };
  const slots = [...new Set(all.map((i) => slotOf(i.timeMs)))];

  step('Working out what a normal day looks like', 0, markets.length);
  const baseline = new Map<string, number>(); // `${asset}|${source}|${slot}` -> median 60-minute range, %
  // NQ's usual 1-minute range for each of the 75 minutes after a clock time, for judging when it calmed down.
  const usualMinutes = new Map<number, number[]>();
  const minuteSamples = new Map<number, number[][]>();
  let marketNo = 0;
  for (const m of markets) {
    step('Working out what a normal day looks like', marketNo++, markets.length);
    const s = series[m.symbol];
    const ranges60 = new Map<string, number[]>();
    for (const date of dates) {
      for (const slot of slots) {
        const t0 = ctAt(date, slot);
        if (isBusy(t0)) continue;
        const got = measureAt(s, days, t0);
        if (!got) continue;
        const key = `${m.symbol}|${got.source}|${slot}`;
        (ranges60.get(key) ?? ranges60.set(key, []).get(key)!).push(got.reaction.range60);
        if (m.symbol === 'NQ' && got.source === 'minute') {
          const r = minuteRanges(minuteCandles(s, days, t0), t0);
          if (r) {
            const per = minuteSamples.get(slot) ?? minuteSamples.set(slot, Array.from({ length: HORIZON }, () => [])).get(slot)!;
            r.forEach((v, k) => {
              if (!Number.isNaN(v)) per[k].push(v);
            });
          }
        }
      }
    }
    for (const [key, values] of ranges60) {
      if (values.length >= 8) baseline.set(key, median(values));
    }
  }
  for (const [slot, per] of minuteSamples) {
    const all75 = per.flat();
    const overall = all75.length ? median(all75) : NaN;
    usualMinutes.set(slot, per.map((v) => (v.length >= 8 ? median(v) : overall)));
  }

  // 5. The samples: every (event, market) pair, rated, with what actually happened.
  step('Measuring what happened after each event', 0, all.length);
  const samples: Sample[] = [];
  const minuteCalm = new Map<string, number[]>();
  let excluded = 0;
  let n = 0;
  for (const item of all) {
    step('Measuring what happened after each event', n++, all.length);
    const sameDay = itemsByDate.get(ctDateKey(item.timeMs)) ?? [];
    for (const m of markets) {
      const tier = item.perAsset[m.symbol];
      if (!tier) continue;
      const rank = (o: ScheduledItem) => IMPACT_RANK[o.perAsset[m.symbol] ?? 'low'];
      // Skip when a bigger event for this market sits in the same window: the reaction would be its, not this one's.
      const clash = sameDay.some((o) => o !== item && o.timeMs >= item.timeMs - 30 * MINUTE && o.timeMs <= item.timeMs + 60 * MINUTE && rank(o) > IMPACT_RANK[tier]);
      if (clash) {
        excluded++;
        continue;
      }
      // One reaction per time and market: of several events at the same minute, only the biggest counts.
      const twin = sameDay.some((o) => o !== item && o.timeMs === item.timeMs && (rank(o) > IMPACT_RANK[tier] || (rank(o) === IMPACT_RANK[tier] && o.id < item.id)));
      if (twin) continue;

      const got = measureAt(series[m.symbol], days, item.timeMs);
      if (!got) continue;
      const base = baseline.get(`${m.symbol}|${got.source}|${slotOf(item.timeMs)}`);
      if (!base || !(base > 0)) continue;
      samples.push({
        family: item.family,
        label: item.title,
        asset: m.symbol,
        tier,
        timeMs: item.timeMs,
        reaction: got.reaction,
        baseline: base,
        ratio: got.reaction.range60 / base
      });

      const usual = usualMinutes.get(slotOf(item.timeMs));
      if (m.symbol === 'NQ' && got.source === 'minute' && usual && IMPACT_RANK[item.impact] >= 1) {
        const r = minuteRanges(minuteCandles(series.NQ, days, item.timeMs), item.timeMs);
        const calm = r ? calmMinutes(r, usual) : null;
        if (calm != null) (minuteCalm.get(item.family) ?? minuteCalm.set(item.family, []).get(item.family)!).push(calm);
      }
    }
  }
  if (samples.length === 0) throw new Error('No event could be matched with prices.');

  // 6. Summaries.
  step('Summing up');
  const sorted = samples.map((s) => s.timeMs).sort((a, b) => a - b);
  const splitAt = sorted[Math.floor(sorted.length * 0.6)];
  const tuneUntil = ctDateKey(splitAt);
  const tune = samples.filter((s) => s.timeMs < splitAt);
  const hold = samples.filter((s) => s.timeMs >= splitAt);

  const perAsset: Record<string, SummaryView> = {};
  for (const m of markets) {
    const mine = samples.filter((s) => s.asset === m.symbol);
    if (mine.length > 0) perAsset[m.symbol] = summaryView(summarize(mine));
  }

  const labels = new Map(PROFILES.map((p) => [p.id, p.label]));
  labels.set('earnings', 'Earnings release');
  labels.set('earnings-open', 'Open after earnings');
  const pairKeys = [...new Set(samples.map((s) => `${s.family}|${s.asset}|${s.tier}`))];
  const families: FamilyRow[] = pairKeys
    .map((key) => {
      const [family, asset, tier] = key.split('|');
      const s = samples.filter((x) => x.family === family && x.asset === asset && x.tier === tier);
      const early = s.filter((x) => x.timeMs < splitAt);
      const late = s.filter((x) => x.timeMs >= splitAt);
      return {
        family,
        label: labels.get(family) ?? family,
        asset,
        tier: tier as Impact,
        n: s.length,
        avgRange60: mean(s.map((x) => x.reaction.range60)),
        medianRatio: median(s.map((x) => x.ratio)),
        avgRatio: mean(s.map((x) => x.ratio)),
        quietPct: (s.filter((x) => x.ratio < QUIET_BELOW).length / s.length) * 100,
        spikePct: (s.filter((x) => x.ratio >= SPIKE_AT).length / s.length) * 100,
        tuneN: early.length,
        tuneRatio: median(early.map((x) => x.ratio)),
        holdN: late.length,
        holdRatio: median(late.map((x) => x.ratio))
      };
    })
    .sort((a, b) => b.medianRatio - a.medianRatio);

  const windows: WindowRow[] = [...minuteCalm.entries()]
    .filter(([, v]) => v.length >= 3)
    .map(([family, v]) => {
      const profile = PROFILES.find((p) => p.id === family);
      const sampleItem = [...itemsByDate.values()].flat().find((i) => i.family === family && IMPACT_RANK[i.impact] >= 1);
      const tier: Impact = sampleItem?.impact ?? 'medium';
      // The window the rules actually give: read off a real item of this family, not a copy of the logic.
      const after = sampleItem?.noTrade ? Math.round((sampleItem.noTrade.endMs - sampleItem.timeMs) / MINUTE) : (profile?.window?.[tier]?.after ?? DEFAULT_WINDOW[tier]?.after ?? 0);
      return {
        family,
        label: labels.get(family) ?? family,
        n: v.length,
        medianCalm: median(v),
        p80Calm: percentile(v, 0.8),
        after,
        coveredPct: (v.filter((c) => c <= after).length / v.length) * 100,
        suggested: Math.max(10, Math.ceil(percentile(v, 0.8) / 5) * 5)
      };
    })
    .sort((a, b) => b.p80Calm - a.p80Calm);

  notes.push(
    'Ratings of scheduled events (economic data, Fed, earnings) are rules, tested here. They are checked against NQ, GC and CL range in the 60 minutes after each event, compared with the same clock time on days with nothing scheduled.',
    'Live headline alerts (rated by the AI) are not part of this test: free sources give article dates, not exact times, and it needs the OpenRouter key.'
  );

  return {
    version: 1,
    ranAt: Date.now(),
    durationMs: Date.now() - startedAt,
    coverage,
    tuneUntil,
    splitMs: splitAt,
    overall: summaryView(summarize(samples)),
    tune: summaryView(summarize(tune)),
    hold: summaryView(summarize(hold)),
    perAsset,
    families,
    windows,
    samples: samples.map(view).sort((x, y) => x.timeMs - y.timeMs),
    excluded,
    notes
  };
}
