// Replay state: the loaded candles and the cursor that hides the future.
//
// Only `candles.slice(0, count)` may ever be shown or traded on. `cursorTime`
// is the instant the market has been seen up to; it only ever moves forward
// within a replay, including across timeframe switches.
//
// Candles belong to the session: everything downloaded is merged into the
// session's saved candles, and a saved replay comes back without the network.

import {
  canLoadMore,
  DataError,
  loadCandles,
  loadMore,
  marketCloses,
  mergeCandles,
  MIN_CANDLES,
  normalizeCoin,
  otherSource,
  precisionOf,
  SOURCE_LABEL,
  type Source
} from '$lib/data';
import {
  advance,
  closeTime,
  coversCursor,
  formingCandle,
  initialCount,
  maxLag,
  priceAtCursor,
  reachesCursor,
  visibleCount,
  type FineCandles
} from '$lib/engine/replay';
import {
  inSession,
  MARKET_SESSIONS,
  SESSION_MAX_TF_MS,
  type MarketSessionId,
  type SessionHours
} from '$lib/engine/marketSessions';
import { TF_LABEL, TF_MS, TIMEFRAMES, type Candle, type Timeframe } from '$lib/engine/types';
import { parseLocalInput } from '$lib/format';
import { display, fmtTime } from './display.svelte';
import { sessionData, type Dataset } from './sessionData';
import { sessions } from './sessions.svelte';
import { ui } from './ui.svelte';

export type LoadedInfo = Dataset;

/** Enough to put a replay back exactly where it was (with the session's saved candles). */
export interface ReplaySnapshot extends Dataset {
  cursorTime: number;
  startInput: string;
  /** The price at the cursor. Missing in views saved before it was tracked. */
  price?: number | null;
}

/**
 * Most recent visible candles used to judge how many decimals the market is
 * quoted in. Kept short: on a daily chart a long window reaches back to prices
 * that were quoted with a different tick.
 */
const PRECISION_WINDOW = 12;

/**
 * On a timeframe switch, saved candles are used as they are if they give at
 * least this much history before the cursor. Otherwise more are downloaded.
 */
const SAVED_CONTEXT = 200;

export interface StepInfo {
  candle: Candle;
  /** Cursor before the step: what was revealed runs from here to `time`. */
  from: number;
  /** Cursor after the step: the close of the revealed candle. */
  time: number;
  /** The candle began before the previous cursor (first step after a timeframe switch). */
  overlap: boolean;
}

export interface Notice {
  kind: 'info' | 'warn' | 'error';
  text: string;
  hint?: string;
  /** After a failed load: the same request against the other data source. */
  suggest?: { source: Source; tf: Timeframe; keepCursor: boolean };
}

export const SPEEDS = [1, 2, 5, 10] as const;
export type Speed = (typeof SPEEDS)[number];

const SPEED_MS: Record<Speed, number> = { 1: 1000, 2: 400, 5: 150, 10: 50 };

const IDLE_NOTICE: Notice = { kind: 'info', text: 'Pick a coin and timeframe, then press Load.' };

type Guard = (next: { coin: string; tf: Timeframe; source: Source; keepCursor: boolean }) => string | null;

class ReplayStore {
  // What the top bar is set to (not necessarily what is loaded).
  source = $state<Source>('hyperliquid');
  coinInput = $state('SOL');
  tf = $state<Timeframe>('5m');
  startInput = $state('');
  speed = $state<Speed>(2);
  /**
   * Trade one market session only (null: all hours). Stepping then skips from
   * the end of the session to the start of its next day. Remembered between
   * visits (see prefs.svelte.ts).
   */
  sessionOnly = $state<MarketSessionId | 'custom' | null>(null);
  /** The hours used when `sessionOnly` is 'custom': minutes after midnight in `zone`. */
  customHours = $state<SessionHours>({ zone: 'America/New_York', open: 9 * 60 + 30, close: 11 * 60 });

  // The loaded dataset.
  candles = $state.raw<Candle[]>([]);
  info = $state.raw<LoadedInfo | null>(null);
  /** Bumps whenever `candles` is replaced by a different dataset. */
  datasetId = $state(0);
  /** Number of visible candles. `candles[count]` is the next one to reveal. */
  count = $state(0);
  cursorTime = $state(0);

  loading = $state(false);
  playing = $state(false);
  notice = $state.raw<Notice | null>(IDLE_NOTICE);

  /**
   * The price at the cursor: what a trade would fill at right now.
   *
   * This is NOT the close of the last visible candle. After switching to a
   * higher timeframe the last closed candle can be well behind the cursor (at
   * 10:35 the last closed 1h candle ended at 10:00), and the price must not
   * jump back with it. So it is carried across timeframe switches and only
   * moves when the cursor does.
   */
  price = $state<number | null>(null);

  /**
   * The candle still forming at the cursor, after switching up a timeframe
   * mid-candle (at 10:35 on 1h: the 10:00 candle so far). Built from the
   * lower-timeframe candles this session holds, up to the cursor only. It is
   * for display: the visible candles and everything traded on stay closed
   * candles. Cleared by the next step, which reveals the whole candle.
   */
  forming = $state.raw<Candle | null>(null);

  /** The last visible (fully closed) candle on the current timeframe. */
  last = $derived(this.count > 0 ? (this.candles[this.count - 1] ?? null) : null);
  /** Price decimals, judged from recent VISIBLE candles only. */
  precision = $derived(this.info ? precisionOf(this.candles, this.count - PRECISION_WINDOW, this.count) : 2);
  tfMs = $derived(this.info ? TF_MS[this.info.tf] : TF_MS[this.tf]);

  #timer: ReturnType<typeof setInterval> | null = null;
  #halted = false;
  /** Counts halt() calls, so a long step can tell it was stopped part-way. */
  #halts = 0;
  #request = 0;
  /** The start-date field as it was at the last load, to tell when it has been edited. */
  #appliedStart: string | null = null;
  /** Open times after which more candles have already been asked for. */
  #askedAfter = new Set<number>();
  // Listeners are registered under a name, and registering again under the
  // same name replaces the old one. In development Vite re-creates a store
  // that listens here whenever its code changes, and the old copy must stop
  // reacting: two trade stores would both close an open trade and journal it twice.
  #guards = new Map<string, Guard>();
  #holds = new Map<string, () => boolean>();
  #onCandle = new Map<string, (info: StepInfo) => void>();
  #onLoaded = new Map<string, (info: LoadedInfo) => void>();

  /** A guard can veto a load by returning a reason. */
  addGuard(name: string, guard: Guard): void {
    this.#guards.set(name, guard);
  }

  /**
   * While any hold returns true, the trading-session filter does not skip: the
   * candles after the session ends are stepped one by one like any others. The
   * trade store holds while a trade is open, so it can finish before the replay
   * jumps to the next day.
   */
  addHold(name: string, hold: () => boolean): void {
    this.#holds.set(name, hold);
  }

  onCandle(name: string, fn: (info: StepInfo) => void): void {
    this.#onCandle.set(name, fn);
  }

  onLoaded(name: string, fn: (info: LoadedInfo) => void): void {
    this.#onLoaded.set(name, fn);
  }

  /** Puts the top-bar inputs back to what is actually loaded. */
  #revertInputs(): void {
    if (!this.info) return;
    this.coinInput = this.info.coin;
    this.tf = this.info.tf;
    this.source = this.info.source;
  }

  /** Swaps in a dataset and tells everyone who cares. */
  #commit(
    info: LoadedInfo,
    candles: Candle[],
    count: number,
    cursorTime: number,
    price: number,
    forming: Candle | null
  ): void {
    this.candles = candles;
    this.info = info;
    this.source = info.source;
    this.coinInput = info.coin;
    this.tf = info.tf;
    this.count = count;
    this.cursorTime = cursorTime;
    this.price = price;
    this.forming = forming;
    this.datasetId += 1;
    this.#appliedStart = this.startInput;
    this.#askedAfter.clear();
    for (const fn of this.#onLoaded.values()) fn(info);
  }

  // ---- saved replays ----

  snapshot(): ReplaySnapshot | null {
    if (!this.info) return null;
    return { ...this.info, cursorTime: this.cursorTime, startInput: this.startInput, price: this.price };
  }

  /**
   * Puts a saved replay back with the session's own candles — no network.
   * Returns false if those candles do not reach the saved cursor.
   */
  restore(view: ReplaySnapshot, candles: Candle[]): boolean {
    const count = visibleCount(candles, TF_MS[view.tf], view.cursorTime);
    if (!reachesCursor(candles, count, TF_MS[view.tf], view.cursorTime, marketCloses(view.source))) return false;

    this.pause();
    const request = ++this.#request;
    this.loading = false;
    this.startInput = view.startInput ?? '';
    const info = { source: view.source, coin: view.coin, tf: view.tf };
    this.#commit(info, candles, count, view.cursorTime, view.price ?? candles[count - 1].c, null);
    // Restoring has to happen at once, so the forming candle follows when read.
    void this.#formingAt(info, view.cursorTime, sessions.activeId).then((forming) => {
      if (request === this.#request && this.cursorTime === view.cursorTime) this.forming = forming;
    });
    this.notice = {
      kind: 'info',
      text: `${view.coin} ${TF_LABEL[view.tf]} restored from this session (${candles.length} saved candles).`,
      hint: `Replay is where you left it: ${fmtTime(view.cursorTime)}.`
    };
    return true;
  }

  /**
   * Empties the chart. With `keep`, the session's place in time is remembered
   * even though its candles could not be shown, so the next Load resumes there.
   */
  clear(notice: Notice = IDLE_NOTICE, keep?: ReplaySnapshot): void {
    this.pause();
    this.#request += 1;
    this.loading = false;
    this.candles = [];
    this.info = null;
    this.count = 0;
    this.cursorTime = keep?.cursorTime ?? 0;
    this.price = null;
    this.forming = null;
    this.datasetId += 1;
    this.#askedAfter.clear();
    this.#appliedStart = null;
    if (keep) {
      this.source = keep.source;
      this.coinInput = keep.coin;
      this.tf = keep.tf;
      this.startInput = keep.startInput ?? '';
      this.#appliedStart = this.startInput;
    }
    this.notice = notice;
  }

  // ---- loading ----

  /**
   * Loads candles for the top-bar settings.
   *
   * A session has one clock. Once it has a place in time, loading another coin
   * or timeframe stays at that instant — the replay never loses its place, and
   * you never see one coin's future while another is still in the past. The
   * clock only moves when a start date is newly typed in. A session with no
   * place yet starts at the start date, or 300 candles in.
   *
   * `stay` forces staying at the cursor whatever the start-date field says
   * (used when switching timeframe).
   *
   * Whatever is downloaded is merged into the session's saved candles for
   * this market and timeframe. If the download fails, the saved candles are
   * used on their own.
   */
  async load(stay = false): Promise<boolean> {
    this.pause();
    const coin = normalizeCoin(this.coinInput);
    if (!coin) {
      this.notice = { kind: 'error', text: 'Enter a coin.' };
      return false;
    }

    // The date field is read in the chart's time zone, like everything else.
    const typedStart =
      this.startInput !== this.#appliedStart ? parseLocalInput(this.startInput, display.timeZone) : null;
    const keepCursor = stay || (typedStart == null && this.cursorTime > 0);
    const next: Dataset = { source: this.source, coin, tf: this.tf };
    for (const guard of this.#guards.values()) {
      const reason = guard({ ...next, keepCursor });
      if (reason) {
        // Nothing was loaded or lost, so this is a passing remark, not an error state.
        this.#revertInputs();
        ui.toast(reason, 'warn');
        return false;
      }
    }

    const tfMs = TF_MS[next.tf];
    const tfName = TF_LABEL[next.tf];
    const label = SOURCE_LABEL[next.source];
    const closes = marketCloses(next.source);
    const startMs = keepCursor ? null : parseLocalInput(this.startInput, display.timeZone);
    const sessionId = sessions.activeId;
    const request = ++this.#request;
    this.loading = true;
    this.notice = { kind: 'info', text: `Loading ${coin} ${tfName}…` };

    try {
      const saved = (await sessionData.loadCandles(sessionId, next)) ?? [];
      if (request !== this.#request) return false;

      // On a timeframe switch the session may already hold everything needed:
      // the stretch of candles right up to the cursor, and at least one after
      // it. Saved candles from other dates replayed before do not count.
      const savedIsEnough =
        keepCursor &&
        coversCursor(saved, tfMs, this.cursorTime, SAVED_CONTEXT, closes) &&
        visibleCount(saved, tfMs, this.cursorTime) < saved.length;

      let candles = saved;
      let fetched: Candle[] | null = null;
      let offline: string | null = null;
      if (!savedIsEnough) {
        try {
          fetched = await loadCandles({ ...next, anchor: keepCursor ? this.cursorTime : startMs });
          candles = mergeCandles(saved, fetched);
        } catch (err) {
          if (saved.length < MIN_CANDLES) throw err;
          offline = err instanceof Error ? err.message : String(err);
        }
        if (request !== this.#request) return false;
      }

      const first = candles[0];
      const lastCandle = candles[candles.length - 1];
      let count: number;
      let cursorTime: number;
      let warning: string | null = null;

      if (keepCursor) {
        count = visibleCount(candles, tfMs, this.cursorTime);
        // Jumping to the earliest candle here would move the cursor FORWARD in
        // time, i.e. show the future. Refuse instead.
        if (count < 1) {
          throw new DataError(
            `${label} has no ${tfName} candles at the replay time (its data starts ${fmtTime(first.t)}).`,
            next.source
          );
        }
        // Candles that stop well before the cursor are from another stretch of
        // time: this timeframe would show a different date from the others.
        if (!reachesCursor(candles, count, tfMs, this.cursorTime, closes)) {
          const until = fmtTime(closeTime(candles[count - 1], tfMs));
          throw new DataError(
            offline
              ? `Could not reach ${label}, and the ${tfName} candles saved in this session stop at ${until}, before the replay time.`
              : `${label} has no ${tfName} candles at the replay time (the last one before it ends ${until}).`,
            next.source
          );
        }
        cursorTime = this.cursorTime;
      } else if (startMs != null) {
        if (startMs >= closeTime(lastCandle, tfMs)) {
          throw new DataError(
            `Start date is after the last ${tfName} candle on ${label} (${fmtTime(lastCandle.t)}).`,
            next.source
          );
        }
        if (startMs < closeTime(first, tfMs)) {
          warning = `${label} only goes back to ${fmtTime(first.t)} on ${tfName}. Replay starts there.`;
        }
        count = initialCount(candles, tfMs, startMs);
        cursorTime = closeTime(candles[count - 1], tfMs);
        if (!warning && !reachesCursor(candles, count, tfMs, startMs, closes)) {
          warning = `${label} has no ${tfName} candles at that date. Replay starts at the last one before it, ${fmtTime(cursorTime)}.`;
        }
      } else {
        // "300 candles in" is measured on what was just downloaded, not on
        // older candles the session may also hold.
        const base = fetched ?? candles;
        cursorTime = closeTime(base[initialCount(base, tfMs, null) - 1], tfMs);
        count = visibleCount(candles, tfMs, cursorTime);
      }

      // The price at the cursor. If the last visible candle closes exactly at
      // the cursor, its close is that price. If it closes earlier (a higher
      // timeframe that is behind the cursor), the price already known for this
      // market is more recent than anything on this chart, so it is kept.
      const sameMarket = this.info?.coin === next.coin && this.info?.source === next.source;
      const known = keepCursor && sameMarket ? this.price : null;
      const price = priceAtCursor(candles[count - 1], tfMs, cursorTime, known);
      const forming = await this.#formingAt(next, cursorTime, sessionId);
      if (request !== this.#request) return false;

      if (fetched) void sessionData.saveCandles(sessionId, next, candles);
      this.#commit(next, candles, count, cursorTime, price, forming);

      if (offline) {
        this.notice = {
          kind: 'warn',
          text: `Could not reach ${label}. Showing the ${candles.length} candles saved in this session.`,
          hint: offline
        };
      } else if (warning) {
        this.notice = { kind: 'warn', text: warning };
      } else {
        const origin = fetched ? `from ${label}` : 'from this session';
        this.notice = {
          kind: 'info',
          text: `${candles.length} ${tfName} candles for ${coin} ${origin}.`,
          hint: keepCursor
            ? `Replay is at ${fmtTime(cursorTime)}.`
            : `Replay starts at ${fmtTime(cursorTime)}. Press → to step, Space to play.`
        };
      }
      return true;
    } catch (err) {
      if (request !== this.#request) return false;
      const message = err instanceof Error ? err.message : String(err);
      const other = otherSource(next.source);
      this.notice = {
        kind: 'error',
        text: keepCursor ? message : `Load failed: ${message}`,
        ...(other && { hint: `Try ${SOURCE_LABEL[other]} instead.`, suggest: { source: other, tf: next.tf, keepCursor } })
      };
      // A failed timeframe switch leaves the old chart up, so show its timeframe.
      if (keepCursor) this.#revertInputs();
      return false;
    } finally {
      if (request === this.#request) this.loading = false;
    }
  }

  dismissNotice(): void {
    this.notice = null;
  }

  /** Retries the last failed load against the other data source. */
  async trySuggestion(): Promise<void> {
    const suggest = this.notice?.suggest;
    if (!suggest) return;
    this.source = suggest.source;
    this.tf = suggest.tf;
    await this.load(suggest.keepCursor);
  }

  /** Switches timeframe. Mid-replay this reloads and keeps the cursor time. */
  async setTimeframe(tf: Timeframe): Promise<void> {
    if (tf === this.tf) return;
    this.tf = tf;
    const sameMarket = this.info != null && normalizeCoin(this.coinInput) === this.info.coin;
    if (sameMarket) await this.load(true);
  }

  /**
   * The candle forming at `cursorTime` on `dataset`'s timeframe, from the
   * lower-timeframe candles held for the same market: the loaded ones, then
   * the session's saved ones. Null on a candle boundary.
   */
  async #formingAt(dataset: Dataset, cursorTime: number, sessionId: string): Promise<Candle | null> {
    const tfMs = TF_MS[dataset.tf];
    // On a boundary nothing has formed, so there is nothing to read.
    if (cursorTime % tfMs === 0) return null;

    const sources: FineCandles[] = [];
    // Coarsest first: fewer candles to add up. Stop at the first that reaches the cursor.
    for (const tf of [...TIMEFRAMES].reverse()) {
      const fineMs = TF_MS[tf];
      if (fineMs >= tfMs) continue;
      const info = this.info;
      const loaded = info?.coin === dataset.coin && info.source === dataset.source && info.tf === tf;
      const candles = loaded ? this.candles : await sessionData.loadCandles(sessionId, { ...dataset, tf });
      if (!candles?.length) continue;
      sources.push({ candles, tfMs: fineMs });
      const seen = visibleCount(candles, fineMs, cursorTime);
      if (seen > 0 && closeTime(candles[seen - 1], fineMs) === cursorTime) break;
    }
    return formingCandle(sources, tfMs, cursorTime);
  }

  // ---- stepping ----

  /** True when a candle opening at `ms` is outside the chosen trading session. */
  #offSession(ms: number): boolean {
    const hours =
      this.sessionOnly === 'custom' ? this.customHours : MARKET_SESSIONS.find((s) => s.id === this.sessionOnly);
    return hours != null && !inSession(hours, ms, display.weekendSessions);
  }

  /** The session filter works on intraday candles only (see SESSION_MAX_TF_MS). */
  get sessionActive(): boolean {
    return this.sessionOnly != null && this.tfMs <= SESSION_MAX_TF_MS;
  }

  /** True while something (an open trade) needs the candles outside the session to be stepped through. */
  #held(): boolean {
    for (const hold of this.#holds.values()) if (hold()) return true;
    return false;
  }

  /**
   * Reveals the next candle. Returns false when there is nothing to reveal.
   *
   * With a trading session chosen, the candles between sessions are passed
   * over first: they are revealed in one go, each still shown to the trade, so
   * a stop or target hit overnight is not missed, but nothing pauses on them.
   * The step then ends on the session's first candle.
   *
   * Not while a trade is open: it is stepped through candle by candle, past
   * the end of the session, until it closes. The next step then skips ahead.
   */
  step(): boolean {
    if (this.sessionActive) {
      const halts = this.#halts;
      while (
        this.info &&
        this.candles[this.count] &&
        !this.#held() &&
        this.#offSession(this.candles[this.count].t)
      ) {
        if (!this.#stepOne() || this.#halts !== halts) return false;
      }
    }
    return this.#stepOne();
  }

  #stepOne(): boolean {
    if (!this.info || this.loading || this.count < 1) return false;
    const tfMs = TF_MS[this.info.tf];
    const previous = this.candles[this.count - 1];
    const candle = this.candles[this.count];

    // Out of candles, or a hole in them right after the cursor: ask the source
    // for what comes next before going any further (once per spot). A stock
    // market being closed overnight or for a weekend is not a hole.
    const gap = candle != null ? candle.t - previous.t : 0;
    const closed = marketCloses(this.info.source) && gap <= maxLag(tfMs, true);
    const hole = gap > tfMs && !closed;
    if ((!candle || hole) && !this.#askedAfter.has(previous.t)) {
      this.pause();
      void this.#loadAhead();
      return false;
    }
    if (!candle) {
      this.pause();
      this.notice = { kind: 'warn', text: 'End of data.', hint: 'You have reached the last candle there is.' };
      return false;
    }
    if (hole) {
      ui.toast(`No candles between ${fmtTime(previous.t + tfMs)} and ${fmtTime(candle.t)}. Skipped the gap.`, 'warn', 6000);
    }

    const from = this.cursorTime;
    const { cursorTime, overlap } = advance(from, candle, tfMs);
    this.count += 1;
    this.cursorTime = cursorTime;
    this.price = candle.c;
    // The cursor is now on this timeframe's candle boundary: nothing is forming.
    this.forming = null;

    const info: StepInfo = { candle, from, time: cursorTime, overlap };
    for (const fn of this.#onCandle.values()) fn(info);
    return true;
  }

  stepN(n: number): void {
    this.#halted = false;
    for (let i = 0; i < n; i++) {
      if (!this.step() || this.#halted) break;
    }
  }

  /** Stops playback and any multi-candle step that is in progress. */
  halt(): void {
    this.#halted = true;
    this.#halts += 1;
    this.pause();
  }

  play(): void {
    if (this.playing || !this.info) return;
    this.playing = true;
    this.#timer = setInterval(() => this.step(), SPEED_MS[this.speed]);
  }

  pause(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    this.playing = false;
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  setSpeed(speed: Speed): void {
    this.speed = speed;
    if (this.playing) {
      this.pause();
      this.play();
    }
  }

  /**
   * Downloads what comes after the last visible candle and merges it into the
   * session's candles. Called at the end of the data and at holes in it.
   */
  async #loadAhead(): Promise<void> {
    const info = this.info;
    const previous = this.candles[this.count - 1];
    if (!info || !previous) return;
    this.#askedAfter.add(previous.t);

    if (!canLoadMore(info.tf, previous.t)) {
      this.notice = { kind: 'warn', text: 'End of data.', hint: 'You have reached the present.' };
      return;
    }

    const sessionId = sessions.activeId;
    const request = ++this.#request;
    this.loading = true;
    this.notice = { kind: 'info', text: 'Loading more candles…' };
    try {
      const more = await loadMore(info.source, info.coin, info.tf, previous.t);
      if (request !== this.#request) return;

      const merged = mergeCandles(this.candles, more);
      const gained = merged.length - this.candles.length;
      if (gained === 0) {
        this.notice = { kind: 'warn', text: 'End of data.', hint: 'There are no newer candles yet.' };
        return;
      }
      // Everything new is after the cursor, so what is visible does not move.
      this.candles = merged;
      void sessionData.saveCandles(sessionId, info, merged);
      this.notice = { kind: 'info', text: `Loaded ${gained} more candles.`, hint: 'Press → to keep going.' };
    } catch (err) {
      if (request !== this.#request) return;
      this.notice = {
        kind: 'warn',
        text: 'Could not load more candles.',
        hint: err instanceof Error ? err.message : String(err)
      };
      // Let the next step try again rather than treating this as the end.
      this.#askedAfter.delete(previous.t);
    } finally {
      if (request === this.#request) this.loading = false;
    }
  }
}

export const replay = new ReplayStore();
