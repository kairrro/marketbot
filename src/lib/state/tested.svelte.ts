// Which stretches of each coin's history have been replayed, across every
// session, so tested data is never reused. Only what a step reveals counts,
// not the history shown before a start date. Kept in the same IndexedDB as the
// sessions, one record per coin.

import { historyStart, normalizeCoin } from '$lib/data';
import { addRange, DAY_MS, isTested, overlapping, pickUntested, RUNWAY_MS, type Range } from '$lib/engine/tested';
import { toLocalInput } from '$lib/format';
import { display, fmtTime } from './display.svelte';
import { replay, type StepInfo } from './replay.svelte';
import { storage } from './storage.svelte';
import { ui } from './ui.svelte';

const PREFIX = 'tested:';
const SAVE_EVERY_MS = 500;
/** History a random start keeps before it, so the chart is not empty. */
const CONTEXT_MS = 2 * DAY_MS;

const fmtRange = ([a, b]: Range) => `${fmtTime(a)} – ${fmtTime(b)}`;

function fmtRanges(ranges: readonly Range[]): string {
  const shown = ranges.slice(0, 3).map(fmtRange).join(', ');
  return ranges.length > 3 ? `${shown} and ${ranges.length - 3} more` : shown;
}

class TestedStore {
  /** Tested ranges by coin. */
  byCoin = $state.raw<Record<string, Range[]>>({});
  /** What had been tested when this replay arrived where it is. */
  #before = $state.raw<Range[]>([]);
  /** coin@cursor, to tell a jump in time from a timeframe switch at the same instant. */
  #place = '';
  #dirty = new Set<string>();
  #timer: ReturnType<typeof setTimeout> | null = null;
  #loaded = false;

  /** The replay is on data that was tested before this replay got there. */
  reused = $derived(replay.info != null && isTested(this.#before, replay.cursorTime));

  constructor() {
    replay.onLoaded('tested', (info) => this.#arrive(info.coin));
    replay.onCandle('tested', (step) => this.#reveal(step));
  }

  async init(): Promise<void> {
    if (this.#loaded) return;
    this.#loaded = true;
    const keys = await storage.keys(PREFIX);
    const entries = await Promise.all(
      keys.map(async (key) => [key.slice(PREFIX.length), (await storage.get<Range[]>(key)) ?? []] as const)
    );
    this.byCoin = Object.fromEntries(entries);
    window.addEventListener('pagehide', () => this.flush());
  }

  /** After a load: warns when the next week of replay holds tested data. */
  #arrive(coin: string): void {
    const place = `${coin}@${replay.cursorTime}`;
    if (place === this.#place) return;
    this.#place = place;
    const ranges = this.byCoin[coin] ?? [];
    this.#before = ranges;
    const ahead = overlapping(ranges, replay.cursorTime, replay.cursorTime + RUNWAY_MS);
    if (ahead.length > 0) {
      ui.toast(`${coin} was already tested in the week ahead: ${fmtRanges(ahead)}. Pick another date.`, 'warn', 10_000);
    }
  }

  #reveal(step: StepInfo): void {
    const coin = replay.info?.coin;
    if (!coin) return;
    this.byCoin = { ...this.byCoin, [coin]: addRange(this.byCoin[coin] ?? [], step.from, step.time) };
    this.#place = `${coin}@${step.time}`;

    const entered = this.#before.find(([a, b]) => a < step.time && b > step.from);
    if (entered && !isTested(this.#before, step.from - 1)) {
      ui.toast(`Stepping into data you already tested: ${fmtRange(entered)}.`, 'warn', 8000);
    }

    this.#dirty.add(coin);
    this.#timer ??= setTimeout(() => this.flush(), SAVE_EVERY_MS);
  }

  flush(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    for (const coin of this.#dirty) void storage.set(PREFIX + coin, this.byCoin[coin]);
    this.#dirty.clear();
  }

  /** Loads the top bar's coin at a random start with a week of untested data after it. */
  async randomStart(): Promise<void> {
    const coin = normalizeCoin(replay.coinInput);
    if (!coin) return ui.toast('Enter a coin.', 'warn');
    let first: number;
    try {
      first = await historyStart(replay.source, coin, replay.tf);
    } catch (err) {
      return ui.toast(err instanceof Error ? err.message : String(err), 'warn');
    }
    const start = pickUntested(this.byCoin[coin] ?? [], first + CONTEXT_MS, Date.now() - RUNWAY_MS, RUNWAY_MS);
    if (start == null) return ui.toast(`No untested week left for ${coin} on this source.`, 'warn');
    replay.startInput = toLocalInput(start, display.timeZone);
    await replay.load();
  }
}

export const tested = new TestedStore();
