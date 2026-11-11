// Databento bills by the data downloaded, so every UTC day that comes back is
// kept and never asked for again. Plain logic over a store and a fetch function,
// so it can be tested without the disk or the network (see $lib/server/databento.ts).

import type { Candle } from '$lib/engine/types';

const DAY_MS = 86_400_000;
/** Days this recent are not kept: the newest data may not be complete at Databento yet. */
export const FRESH_MS = 2 * DAY_MS;
/** Days asked for in one request, so no download is huge. */
export const MAX_RUN_DAYS = 60;

export interface DayStore {
  /** The kept candles of the UTC day starting at `day`, or null when that day is not kept. */
  read(day: number): Candle[] | null;
  write(day: number, candles: Candle[]): void;
}

/** Consecutive days in runs of at most `max`. `days` is in order. */
export function runsOf(days: readonly number[], max = MAX_RUN_DAYS): number[][] {
  const runs: number[][] = [];
  for (const day of days) {
    const run = runs[runs.length - 1];
    if (run && day - run[run.length - 1] === DAY_MS && run.length < max) run.push(day);
    else runs.push([day]);
  }
  return runs;
}

/**
 * The candles that open from `from` up to `to`. Whole days are fetched, and each
 * one that is old enough is kept (empty ones too: weekends and holidays have no
 * candles and should not be asked for again). `fetchRange(start, end)` returns
 * the candles that open from `start` up to `end`, in order.
 */
export async function loadDays(
  from: number,
  to: number,
  now: number,
  store: DayStore,
  fetchRange: (start: number, end: number) => Promise<Candle[]>
): Promise<Candle[]> {
  const days: number[] = [];
  for (let day = Math.floor(from / DAY_MS) * DAY_MS; day < to; day += DAY_MS) days.push(day);

  const have = new Map<number, Candle[]>();
  const missing: number[] = [];
  for (const day of days) {
    const kept = store.read(day);
    if (kept) have.set(day, kept);
    else missing.push(day);
  }

  for (const run of runsOf(missing)) {
    const start = run[0];
    const end = Math.min(run[run.length - 1] + DAY_MS, now);
    const bars = end > start ? await fetchRange(start, end) : [];
    let next = 0;
    for (const day of run) {
      const candles: Candle[] = [];
      while (next < bars.length && bars[next].t < day + DAY_MS) {
        if (bars[next].t >= day) candles.push(bars[next]);
        next++;
      }
      have.set(day, candles);
      if (day + DAY_MS <= now - FRESH_MS) store.write(day, candles);
    }
  }

  return days.flatMap((day) => have.get(day) ?? []).filter((c) => c.t >= from && c.t < to);
}
