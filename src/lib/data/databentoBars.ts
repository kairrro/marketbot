// The parts of the Databento futures source that need no network or secrets:
// which futures it serves, how a request is written and how its CSV is read.
// The request itself is in $lib/server/databento.ts.

import type { Candle } from '$lib/engine/types';

/** Where each future's history begins on Databento's CME dataset (GLBX.MDP3). Micros started in May 2019. */
export const DATABENTO_START: Record<string, number> = {
  NQ: Date.UTC(2010, 5, 7),
  MNQ: Date.UTC(2019, 4, 7),
  ES: Date.UTC(2010, 5, 7),
  MES: Date.UTC(2019, 4, 7),
  YM: Date.UTC(2010, 5, 7),
  RTY: Date.UTC(2010, 5, 7),
  GC: Date.UTC(2010, 5, 7),
  CL: Date.UTC(2010, 5, 7)
};

export const isDatabentoFuture = (coin: string) => Object.hasOwn(DATABENTO_START, coin);

export type DatabentoSchema = 'ohlcv-1m' | 'ohlcv-1h';

/**
 * The form fields that ask for `from` up to `to` of a future's candles. The
 * volume roll (v.0) follows the contract that traded the most the day before,
 * and prices are the raw ones, so there is a small jump on a roll day.
 */
export function barsRequest(coin: string, schema: DatabentoSchema, from: number, to: number): URLSearchParams {
  // Whole seconds, UTC, the way Databento's docs write them.
  const stamp = (ms: number) => new Date(ms).toISOString().slice(0, 19);
  return new URLSearchParams({
    dataset: 'GLBX.MDP3',
    symbols: `${coin}.v.0`,
    stype_in: 'continuous',
    schema,
    start: stamp(from),
    end: stamp(to),
    encoding: 'csv',
    pretty_px: 'true',
    pretty_ts: 'true'
  });
}

/** "2024-06-03T13:30:00.000000000Z" as ms: the fraction is cut to milliseconds, which every JS engine reads. */
function parseStamp(text: string): number {
  return Date.parse(text.replace(/\.(\d{3})\d*Z$/, '.$1Z'));
}

/**
 * Candles from a Databento OHLCV CSV, found by the names in its header row.
 * A bar's ts_event is when it opened. Rows that are not numbers are skipped.
 */
export function parseBars(csv: string): Candle[] {
  const lines = csv.split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length < 2) return [];
  const header = lines[0].split(',');
  const at = (name: string) => header.indexOf(name);
  const [t, o, h, l, c, v] = ['ts_event', 'open', 'high', 'low', 'close', 'volume'].map(at);
  if ([t, o, h, l, c].some((index) => index < 0)) return [];

  // An empty cell is not a price: Number('') would call it 0.
  const num = (cell: string | undefined) => (cell != null && cell.trim() !== '' ? Number(cell) : NaN);

  const out: Candle[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',');
    const candle = {
      t: parseStamp(cells[t] ?? ''),
      o: num(cells[o]),
      h: num(cells[h]),
      l: num(cells[l]),
      c: num(cells[c]),
      v: v >= 0 ? num(cells[v]) || 0 : 0
    };
    if ([candle.t, candle.o, candle.h, candle.l, candle.c].every(Number.isFinite)) out.push(candle);
  }
  return out;
}
