// The swing dots, the sweeps of them, and the 1h mode shown on the replay
// chart. Dots and sweeps come from the chart's own candles, so they follow
// whatever timeframe is showing and reach as far back as the session's candles go. The mode needs 1h candles:
// those are loaded into the session beside the chart's (as a timeframe switch
// would) and only the ones closed at the cursor are read.

import { canLoadMore, loadCandles, loadMore, marketCloses, mergeCandles } from '$lib/data';
import { coversCursor, reachesCursor, visibleCount } from '$lib/engine/replay';
import { findSweeps, findSwings, marketMode, swingLines, type Mode, type Sweep, type SwingLine } from '$lib/engine/swings';
import { TF_MS, type Candle, type Timeframe } from '$lib/engine/types';
import { fmtPrice } from '$lib/format';
import { display } from './display.svelte';
import { replay, type LoadedInfo } from './replay.svelte';
import { sessionData } from './sessionData';
import { sessions } from './sessions.svelte';
import { ui } from './ui.svelte';

const MODE_TF: Timeframe = '1h';
/** Closed 1h candles the mode looks at: plenty of swings. */
const MODE_WINDOW = 500;
/** Without this many 1h candles leading up to the cursor, more are downloaded. */
const MIN_HISTORY = 100;

const marketKey = (info: { source: string; coin: string }) => `${info.source}:${info.coin}`;

class SwingStore {
  #data = $state.raw<{ key: string; candles: Candle[] }>({ key: '', candles: [] });
  #request = 0;
  #asked = new Set<string>();

  /** Every swing on the chart's closed candles, and whether price has gone past it since. */
  points = $derived.by<SwingLine[]>(() => {
    if (!display.swings || !replay.info) return [];
    return swingLines(replay.candles, replay.count, sessions.settings.swingSize, replay.tfMs);
  });

  /** Candles that swept those swings. */
  sweeps = $derived.by<Sweep[]>(() => (display.sweeps ? findSweeps(this.points, replay.candles) : []));

  /** Sweeps made by the last closed candle: the one that just happened. */
  latest = $derived.by<Sweep[]>(() => {
    const last = replay.count - 1;
    const recent: Sweep[] = [];
    for (let i = this.sweeps.length - 1; i >= 0 && this.sweeps[i].index === last; i--) recent.unshift(this.sweeps[i]);
    return recent;
  });

  mode = $derived.by<Mode | null>(() => {
    if (!display.swings) return null;
    const candles = this.#closed();
    return marketMode(findSwings(candles, candles.length, sessions.settings.swingSize, TF_MS[MODE_TF]));
  });

  constructor() {
    replay.onLoaded('swings', (info) => void this.#load(info));
    replay.onCandle('swings', () => {
      this.#extend();
      this.#pauseOnSweep();
    });
  }

  /** With "pause on sweeps" on, a candle that closes as a sweep stops playback there. */
  #pauseOnSweep(): void {
    if (!display.pauseOnSweep || this.latest.length === 0) return;
    replay.halt();
    const precision = replay.precision;
    const what = this.latest.map((s) => `${s.kind} ${fmtPrice(s.swings[0].price, precision)}`).join(' and ');
    ui.toast(`Sweep: took the swing ${what} and closed back.`);
  }

  /** The latest MODE_WINDOW 1h candles that have closed at the cursor. */
  #closed(): Candle[] {
    const info = replay.info;
    if (!info) return [];
    const all = info.tf === MODE_TF ? replay.candles : this.#data.key === marketKey(info) ? this.#data.candles : [];
    const count = visibleCount(all, TF_MS[MODE_TF], replay.cursorTime);
    // Held candles from another date replayed before say nothing about now.
    if (!reachesCursor(all, count, TF_MS[MODE_TF], replay.cursorTime, marketCloses(info.source))) return [];
    return all.slice(Math.max(0, count - MODE_WINDOW), count);
  }

  /** Brings in this market's 1h candles: the session's own, downloading when they fall short. */
  async #load(info: LoadedInfo): Promise<void> {
    const key = marketKey(info);
    const request = ++this.#request;
    const sessionId = sessions.activeId;
    if (this.#data.key !== key) {
      this.#data = { key, candles: [] };
      this.#asked.clear();
    }
    if (info.tf === MODE_TF) return;

    const dataset = { ...info, tf: MODE_TF };
    let candles = (await sessionData.loadCandles(sessionId, dataset)) ?? [];
    const covered = coversCursor(candles, TF_MS[MODE_TF], replay.cursorTime, MIN_HISTORY, marketCloses(info.source));
    if (!covered || visibleCount(candles, TF_MS[MODE_TF], replay.cursorTime) >= candles.length) {
      try {
        candles = mergeCandles(candles, await loadCandles({ ...dataset, anchor: replay.cursorTime }));
        void sessionData.saveCandles(sessionId, dataset, candles);
      } catch {
        // The mode just stays missing; the chart itself is unaffected.
      }
    }
    if (request !== this.#request) return;
    this.#data = { key, candles };
  }

  /** Asks for newer 1h candles once the cursor has caught up with the last one held. */
  #extend(): void {
    const info = replay.info;
    if (!info || info.tf === MODE_TF || this.#data.key !== marketKey(info)) return;
    const last = this.#data.candles.at(-1);
    if (!last || last.t + TF_MS[MODE_TF] > replay.cursorTime) return;
    const ask = `${MODE_TF}:${last.t}`;
    if (this.#asked.has(ask)) return;
    this.#asked.add(ask);
    if (canLoadMore(MODE_TF, last.t)) void this.#more(info, last.t);
  }

  async #more(info: LoadedInfo, lastOpen: number): Promise<void> {
    const key = marketKey(info);
    const sessionId = sessions.activeId;
    try {
      const more = await loadMore(info.source, info.coin, MODE_TF, lastOpen);
      if (this.#data.key !== key) return;
      const candles = mergeCandles(this.#data.candles, more);
      this.#data = { key, candles };
      void sessionData.saveCandles(sessionId, { ...info, tf: MODE_TF }, candles);
    } catch {
      // Tried once at this spot; the next load tries again.
    }
  }
}

export const swings = new SwingStore();
