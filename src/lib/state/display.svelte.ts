// How the chart and times are shown: the time zone, and which market sessions
// are highlighted. Independent of any session, and remembered between visits
// (see prefs.svelte.ts).

import { DEFAULT_ATR_PERIOD } from '$lib/engine/atr';
import { MARKET_SESSIONS, type MarketSessionId } from '$lib/engine/marketSessions';
import { fmtDateTime } from '$lib/format';
import { LOCAL, offsetLabel, offsetMinutes, type TimeZone } from '$lib/timezone';

const PLAYBOOK_KEY = 'marketbot.playbook';

function readPlaybook(): boolean {
  try {
    return localStorage.getItem(PLAYBOOK_KEY) === '1';
  } catch {
    return false;
  }
}

class Display {
  /** Every time in the backtester (chart axis, legend, journal) is shown in this zone. */
  timeZone = $state<TimeZone>(LOCAL);
  /** Highlight session highs and lows on the chart. */
  sessions = $state(true);
  /** Sessions switched off one by one in Settings. */
  hiddenSessions = $state<MarketSessionId[]>([]);
  /** Also draw sessions on Saturdays and Sundays, when the markets they are named after are shut. */
  weekendSessions = $state(false);
  /** The NQ playbook on the 1m chart: opening range, day bias and setups. Kept in localStorage. */
  playbook = $state(readPlaybook());
  /** Dot the swing highs and lows on the chart and show the 1h mode. */
  swings = $state(true);
  /** Mark the candles that swept a swing, and link each to what it took. */
  sweeps = $state(true);
  /** Stop playback when a candle closes as a sweep. */
  pauseOnSweep = $state(false);
  /** ATR: the volatility reading in the legend, the 1× / 2× ruler beside the latest candle, and ATR stops in the ticket. */
  atr = $state(true);
  /** Candles the ATR averages over. */
  atrPeriod = $state(DEFAULT_ATR_PERIOD);

  shownSessions = $derived(MARKET_SESSIONS.filter((session) => !this.hiddenSessions.includes(session.id)));

  /** "UTC+2" for the zone at the given instant (offsets move with daylight saving). */
  offsetAt(ms: number): string {
    return offsetLabel(offsetMinutes(ms || Date.now(), this.timeZone));
  }

  setPlaybook(on: boolean): void {
    this.playbook = on;
    try {
      localStorage.setItem(PLAYBOOK_KEY, on ? '1' : '0');
    } catch {
      // Blocked storage: the switch still works until the page is closed.
    }
  }

  isShown(id: MarketSessionId): boolean {
    return !this.hiddenSessions.includes(id);
  }

  toggleSession(id: MarketSessionId): void {
    this.hiddenSessions = this.isShown(id)
      ? [...this.hiddenSessions, id]
      : this.hiddenSessions.filter((hidden) => hidden !== id);
  }
}

export const display = new Display();

/** "Oct 14, 09:30" in the chosen time zone. */
export function fmtTime(ms: number): string {
  return fmtDateTime(ms, display.timeZone);
}
