// The automatic backtester page: the coins and dates, the strategy's settings,
// the candles it runs on and the results. Candles come from Binance spot on the
// strategy's timeframe, are kept per coin and timeframe in the same IndexedDB
// as the sessions, and are only downloaded for time not held yet. Results
// follow the settings as they change.

import { fetchBinance, mergeCandles, normalizeCoin, precisionOf, sanitize } from '$lib/data';
import { autoStats } from '$lib/engine/auto/report';
import { runBreakout, type CoinCandles } from '$lib/engine/auto/run';
import { DEFAULTS, TIME_ZONE, type BreakoutSettings, type Trade } from '$lib/engine/auto/types';
import { TF_MS, type Candle, type Timeframe } from '$lib/engine/types';
import { zonedTime } from '$lib/timezone';
import { storage } from './storage.svelte';

const DAY_MS = 86_400_000;
/** Candles asked for per request, so progress can be shown. */
const BATCH = 5000;
const MAX_COINS = 10;
const INPUTS_KEY = 'auto-breakout-inputs';
const SETTINGS_KEY = 'auto-breakout-fixed-2';
const cacheKey = (coin: string, tf: Timeframe) => `auto:binance:${coin}:${tf}`;

export interface AutoInputs {
  /** "BTC, ETH, SOL". */
  coins: string;
  /** "YYYY-MM-DD", CT calendar days, both included. */
  from: string;
  to: string;
}

/** Downloaded candles and the stretch [from, to) they cover. */
interface Cache {
  from: number;
  to: number;
  candles: Candle[];
}

interface Run {
  tf: Timeframe;
  from: number;
  to: number;
  coins: CoinCandles[];
}

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** CT midnight at the start of a "YYYY-MM-DD" day, plus `days`. */
function ctMidnight(day: string, days = 0): number | null {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  return parts ? zonedTime(TIME_ZONE, +parts[1], +parts[2] - 1, +parts[3] + days) : null;
}

/** Candles loaded before the window, so the lookbacks are full when it starts. */
const warmupMs = (s: BreakoutSettings) => (Math.max(s.entryLen, s.exitLen) + 5) * TF_MS[s.tf];

/** The settings the screen lets you change; the rest of the rules are fixed. */
const EDITABLE = ['feePct', 'riskPct', 'windowOn', 'windowFrom', 'windowTo', 'targetPct', 'maxDrawdownPct', 'dailyLossPct', 'monthlyStopR', 'partialR', 'accountSize', 'profitSplitPct'] as const;

/** The coins typed in: "btc, eth sol" -> ["BTC", "ETH", "SOL"], no repeats. */
export const parseCoins = (text: string) => [...new Set(text.split(/[\s,;]+/).map(normalizeCoin).filter(Boolean))];

/** What is wrong with the settings you can change, in words, or null. */
export function settingsError(s: BreakoutSettings): string | null {
  const numbers = [s.feePct, s.riskPct, s.windowFrom, s.windowTo, s.targetPct, s.maxDrawdownPct, s.dailyLossPct, s.monthlyStopR, s.partialR, s.accountSize, s.profitSplitPct];
  if (!numbers.every((x) => typeof x === 'number' && Number.isFinite(x))) return 'Fill in every number.';
  if (s.feePct < 0) return 'The fee cannot be below zero.';
  if (s.monthlyStopR < 0) return 'The monthly loss stop cannot be below zero (0 turns it off).';
  if (s.partialR < 0) return 'Calm mode cannot be below zero (0 turns it off).';
  if (s.riskPct <= 0) return 'Risk per trade must be above zero.';
  if (s.targetPct <= 0 || s.maxDrawdownPct <= 0) return 'The prop firm target and max drawdown must be above zero.';
  if (s.dailyLossPct < 0) return 'The daily loss limit cannot be below zero (0 means the firm has none).';
  if (s.accountSize <= 0) return 'The account size must be above zero.';
  if (s.profitSplitPct <= 0 || s.profitSplitPct > 100) return 'The profit split must be above 0 and at most 100%.';
  if (s.windowOn) {
    const hours = [s.windowFrom, s.windowTo];
    if (!hours.every(Number.isInteger) || s.windowFrom < 0 || s.windowFrom > 23 || s.windowTo < 0 || s.windowTo > 24) return 'Hours must be whole numbers from 0 to 24.';
    if (s.windowFrom === s.windowTo) return 'The entry hours start and end at the same time.';
  }
  return null;
}

class AutoStore {
  inputs = $state<AutoInputs>({
    coins: 'BTC, ETH, SOL',
    from: isoDay(Date.now() - 365 * DAY_MS),
    to: isoDay(Date.now() - DAY_MS)
  });
  settings = $state<BreakoutSettings>({ ...DEFAULTS });

  running = $state(false);
  /** Download progress, 0 to 1. */
  progress = $state(0);
  error = $state<string | null>(null);

  #run = $state.raw<Run | null>(null);
  #ready = false;

  /** The trade on the chart, by coin and entry time, so it stays put when the settings change the numbering. */
  #picked = $state<{ coin: string; time: number } | null>(null);

  settingsError = $derived(settingsError(this.settings));
  /** What the shown results were run on: the timeframe and window. */
  ran = $derived(this.#run ? { tf: this.#run.tf, from: this.#run.from, to: this.#run.to } : null);

  /** Every coin run together, so the limits on open trades hold across them. */
  result = $derived.by(() => {
    const run = this.#run;
    const s = $state.snapshot(this.settings);
    if (!run || settingsError(s)) return null;
    return runBreakout(run.coins, s, { from: run.from, to: run.to });
  });
  trades = $derived(this.result?.trades ?? []);
  stats = $derived(this.result ? autoStats(this.result.trades, this.result.from, this.result.to) : null);
  coinStats = $derived(
    this.result
      ? (this.#run?.coins ?? []).map(({ coin }) => ({
          coin,
          stats: autoStats(this.result!.trades.filter((t) => t.coin === coin), this.result!.from, this.result!.to)
        }))
      : []
  );

  /** The picked trade's place in the list: the same trade if it is still there, or the next one after it. */
  index = $derived.by(() => {
    const trades = this.trades;
    const picked = this.#picked;
    if (trades.length === 0) return -1;
    if (!picked) return 0;
    const same = trades.findIndex((t) => t.coin === picked.coin && t.entryTime === picked.time);
    if (same >= 0) return same;
    const next = trades.findIndex((t) => t.entryTime >= picked.time);
    return next < 0 ? trades.length - 1 : next;
  });
  trade = $derived<Trade | null>(this.trades[this.index] ?? null);
  /** The picked trade's coin: its candles, and the trades of that coin for the chart. */
  loaded = $derived(this.#run?.coins.find((c) => c.coin === this.trade?.coin) ?? this.#run?.coins[0] ?? null);

  pick(index: number): void {
    const trade = this.trades[index];
    if (trade) this.#picked = { coin: trade.coin, time: trade.entryTime };
  }

  step(by: number): void {
    this.pick(this.index + by);
  }

  async init(): Promise<void> {
    const [inputs, settings] = await Promise.all([
      storage.get<Partial<AutoInputs>>(INPUTS_KEY),
      storage.get<Partial<BreakoutSettings>>(SETTINGS_KEY)
    ]);
    for (const key of ['coins', 'from', 'to'] as const) {
      if (typeof inputs?.[key] === 'string') this.inputs[key] = inputs[key];
    }
    // Only what the screen lets you change comes back: older saves also hold rules that are fixed now.
    for (const key of EDITABLE) {
      if (settings?.[key] !== undefined) Object.assign(this.settings, { [key]: settings[key] });
    }
    this.#ready = true;
  }

  /** Call from an $effect: re-runs (and saves) whenever a setting changes. */
  saveSettings(): void {
    const settings = $state.snapshot(this.settings);
    if (this.#ready) void storage.set(SETTINGS_KEY, Object.fromEntries(EDITABLE.map((key) => [key, settings[key]])));
  }

  async run(): Promise<void> {
    const input = $state.snapshot(this.inputs);
    const settings = $state.snapshot(this.settings);
    const coins = parseCoins(input.coins);
    const from = ctMidnight(input.from);
    const to = ctMidnight(input.to, 1);
    this.error =
      coins.length === 0 ? 'Enter at least one coin.'
      : coins.length > MAX_COINS ? `Test at most ${MAX_COINS} coins at a time.`
      : from == null || to == null ? 'Pick both dates.'
      : from >= to ? 'The start date must be before the end date.'
      : settingsError(settings);
    if (this.error || from == null || to == null) return;

    this.running = true;
    this.progress = 0;
    try {
      const tf = settings.tf;
      const end = Math.min(to, Math.floor(Date.now() / TF_MS[tf]) * TF_MS[tf]);
      const loaded: CoinCandles[] = [];
      for (const [k, coin] of coins.entries()) {
        const candles = await this.#candles(coin, tf, from - warmupMs(settings), end, k / coins.length, 1 / coins.length);
        if (!candles.some((c) => c.t >= from)) throw new Error(`Binance has no ${tf} candles for ${coin} in that range.`);
        loaded.push({ coin, candles, precision: precisionOf(candles, candles.length - 1000, candles.length) });
      }
      this.inputs.coins = coins.join(', ');
      void storage.set(INPUTS_KEY, { ...input, coins: coins.join(', ') });
      this.#picked = null;
      this.#run = { tf, from, to: end, coins: loaded };
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.running = false;
    }
  }

  /** `tf` candles opening in [start, end), downloading whatever the cache does not cover yet. `base` and `share` place this download in the overall progress. */
  async #candles(coin: string, tf: Timeframe, start: number, end: number, base: number, share: number): Promise<Candle[]> {
    const tfMs = TF_MS[tf];
    const cache = (await storage.get<Cache>(cacheKey(coin, tf))) ?? { from: start, to: start, candles: [] };
    const gaps = cache.candles.length
      ? [
          [start, cache.from],
          [cache.to, end]
        ].filter(([a, b]) => b > a)
      : [[start, end]];
    const total = gaps.reduce((sum, [a, b]) => sum + (b - a) / tfMs, 0);
    let fetched = 0;
    let candles = cache.candles;

    for (const [a, b] of gaps) {
      for (let next = a; next < b; ) {
        const page = sanitize(await fetchBinance(coin, tf, next, Math.min(BATCH, Math.ceil((b - next) / tfMs))), tfMs, Date.now());
        const inside = page.filter((c) => c.t < b);
        if (inside.length === 0) break;
        candles = mergeCandles(candles, inside);
        next = inside[inside.length - 1].t + tfMs;
        fetched += inside.length;
        this.progress = base + share * Math.min(1, fetched / total);
      }
    }
    if (gaps.length > 0) {
      const covered = { from: Math.min(cache.from, start), to: Math.max(cache.to, end), candles };
      await storage.set(cacheKey(coin, tf), covered);
    }
    this.progress = base + share;
    return candles.filter((c) => c.t >= start && c.t + tfMs <= end);
  }
}

export const auto = new AutoStore();
