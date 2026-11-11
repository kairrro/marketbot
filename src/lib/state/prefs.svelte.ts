// Small conveniences remembered between visits, independent of any session:
// favourite timeframes, playback speed, the journal drawer and its size, the time zone,
// session highlights, and the market last typed into the top bar (used by
// sessions that have no chart of their own yet).

import { SOURCES, type Source } from '$lib/data';
import { MARKET_SESSIONS, type MarketSessionId } from '$lib/engine/marketSessions';
import { TIMEFRAMES, type Timeframe } from '$lib/engine/types';
import { isTimeZone, type TimeZone } from '$lib/timezone';
import { display } from './display.svelte';
import { replay, SPEEDS, type Speed } from './replay.svelte';
import { storage } from './storage.svelte';
import { ui } from './ui.svelte';

const KEY = 'prefs';

/** Shown in the top bar until the user picks their own. */
const DEFAULT_FAVORITES: Timeframe[] = ['5m', '15m', '1h', '4h', '1d'];

interface Prefs {
  source: Source;
  coin: string;
  tf: Timeframe;
  speed: Speed;
  journalOpen: boolean;
  journalHeight: number;
  journalFull: boolean;
  favorites: Timeframe[];
  timeZone: TimeZone;
  sessions: boolean;
  hiddenSessions: MarketSessionId[];
  weekendSessions: boolean;
  swings: boolean;
  sweeps: boolean;
  pauseOnSweep: boolean;
  atr: boolean;
  atrPeriod: number;
  sessionOnly: MarketSessionId | 'custom' | null;
  customHours: { zone: TimeZone; open: number; close: number };
}

const isMinutes = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 24 * 60;

let loaded = $state(false);

class Favorites {
  /** Timeframes shown as buttons in the top bar. The rest stay in the menu. */
  timeframes = $state<Timeframe[]>([...DEFAULT_FAVORITES]);

  has(tf: Timeframe): boolean {
    return this.timeframes.includes(tf);
  }

  toggle(tf: Timeframe): void {
    const next = this.has(tf) ? this.timeframes.filter((t) => t !== tf) : [...this.timeframes, tf];
    // Kept in timeframe order, whatever order they were starred in.
    this.timeframes = TIMEFRAMES.filter((t) => next.includes(t));
  }
}

export const favorites = new Favorites();

export async function loadPrefs(): Promise<void> {
  const prefs = await storage.get<Partial<Prefs>>(KEY);
  if (prefs) {
    if (SOURCES.some((source) => source.id === prefs.source)) replay.source = prefs.source!;
    if (typeof prefs.coin === 'string' && prefs.coin) replay.coinInput = prefs.coin;
    if (TIMEFRAMES.includes(prefs.tf as Timeframe)) replay.tf = prefs.tf as Timeframe;
    if (SPEEDS.includes(prefs.speed as Speed)) replay.speed = prefs.speed as Speed;
    if (typeof prefs.journalOpen === 'boolean') ui.journalOpen = prefs.journalOpen;
    if (Number.isFinite(prefs.journalHeight)) ui.journalHeight = prefs.journalHeight!;
    if (typeof prefs.journalFull === 'boolean') ui.journalFull = prefs.journalFull;
    if (Array.isArray(prefs.favorites)) {
      favorites.timeframes = TIMEFRAMES.filter((tf) => prefs.favorites!.includes(tf));
    }
    if (isTimeZone(prefs.timeZone)) display.timeZone = prefs.timeZone;
    if (typeof prefs.sessions === 'boolean') display.sessions = prefs.sessions;
    if (Array.isArray(prefs.hiddenSessions)) {
      display.hiddenSessions = MARKET_SESSIONS.map((s) => s.id).filter((id) => prefs.hiddenSessions!.includes(id));
    }
    if (typeof prefs.weekendSessions === 'boolean') display.weekendSessions = prefs.weekendSessions;
    if (typeof prefs.swings === 'boolean') display.swings = prefs.swings;
    if (typeof prefs.sweeps === 'boolean') display.sweeps = prefs.sweeps;
    if (typeof prefs.pauseOnSweep === 'boolean') display.pauseOnSweep = prefs.pauseOnSweep;
    if (typeof prefs.atr === 'boolean') display.atr = prefs.atr;
    if (typeof prefs.atrPeriod === 'number' && Number.isInteger(prefs.atrPeriod) && prefs.atrPeriod >= 1 && prefs.atrPeriod <= 200) {
      display.atrPeriod = prefs.atrPeriod;
    }
    const hours = prefs.customHours;
    if (hours && isTimeZone(hours.zone) && isMinutes(hours.open) && isMinutes(hours.close) && hours.open !== hours.close) {
      replay.customHours = { zone: hours.zone, open: hours.open, close: hours.close };
    }
    replay.sessionOnly =
      prefs.sessionOnly === 'custom' ? 'custom' : (MARKET_SESSIONS.find((s) => s.id === prefs.sessionOnly)?.id ?? null);
  }
  loaded = true;
}

/** Call from an $effect: re-runs (and saves) whenever one of these changes. */
export function savePrefs(): void {
  const prefs: Prefs = {
    source: replay.info?.source ?? replay.source,
    coin: replay.info?.coin ?? replay.coinInput,
    tf: replay.tf,
    speed: replay.speed,
    journalOpen: ui.journalOpen,
    journalHeight: ui.journalHeight,
    journalFull: ui.journalFull,
    favorites: $state.snapshot(favorites.timeframes),
    timeZone: display.timeZone,
    sessions: display.sessions,
    hiddenSessions: $state.snapshot(display.hiddenSessions),
    weekendSessions: display.weekendSessions,
    swings: display.swings,
    sweeps: display.sweeps,
    pauseOnSweep: display.pauseOnSweep,
    atr: display.atr,
    atrPeriod: display.atrPeriod,
    sessionOnly: replay.sessionOnly,
    customHours: $state.snapshot(replay.customHours)
  };
  if (loaded) void storage.set(KEY, prefs);
}
