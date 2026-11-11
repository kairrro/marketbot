// The breakout strategy, run over every coin together with no choices and no
// lookahead. Time moves one candle at a time, all coins at once:
//   1. Each open trade's stop is checked first, where it stood when the candle
//      opened: a touch exits at the stop, or at the open when the candle gapped past.
//   2. If the trade survived, calm mode (when on) takes a third off at its
//      target and moves the stop to the entry, and the trailing stop moves up
//      (down for a short) to the extreme of the last `exitLen` candles including
//      this one. It never moves back.
//   3. Then every coin with no trade open is looked at for a breakout: a candle
//      that closed past the extreme of the `entryLen` candles before it. Enter
//      at its close, if the filters and limits allow.

import { TF_MS, type Candle } from '../types';
import { inHours } from './clock';
import { PARTIAL_SHARE, type BreakoutSettings, type Dir, type ExitReason, type RunResult, type Trade } from './types';

export interface CoinCandles {
  coin: string;
  candles: readonly Candle[];
  /** Price decimals, for display. */
  precision: number;
}

export interface RunWindow {
  /** Entries from here on. Candles before it only fill the lookbacks. */
  from: number;
  /** Everything is closed by here. */
  to: number;
}

interface Open {
  dir: Dir;
  signalTime: number;
  breakoutLevel: number;
  entryTime: number;
  entry: number;
  initialStop: number;
  /** Where the stop stands now. */
  stop: number;
  /** 1R in price. */
  risk: number;
  trail: Trade['trail'];
  partial: Trade['partial'];
}

interface Book {
  data: CoinCandles;
  /** Index of each candle by its open time. */
  at: Map<number, number>;
  open: Open | null;
  /** Index of the last candle this coin has been run through. */
  last: number;
}

/** The highest high (`high`) or lowest low of candles[from..to]. */
function extreme(candles: readonly Candle[], from: number, to: number, high: boolean): number {
  let value = high ? -Infinity : Infinity;
  for (let i = from; i <= to; i++) value = high ? Math.max(value, candles[i].h) : Math.min(value, candles[i].l);
  return value;
}

export function runBreakout(coins: readonly CoinCandles[], s: BreakoutSettings, w: RunWindow): RunResult {
  const tfMs = TF_MS[s.tf];
  const books: Book[] = coins.map((data) => ({ data, at: new Map(data.candles.map((c, i) => [c.t, i])), open: null, last: -1 }));
  /** Total R after fees of the trades closed so far in each UTC month (months counted from 1970). */
  const monthR = new Map<number, number>();
  const monthOf = (ms: number) => new Date(ms).getUTCFullYear() * 12 + new Date(ms).getUTCMonth();
  const trades: Trade[] = [];
  const skipped: RunResult['skipped'] = {};
  const skip = (reason: keyof RunResult['skipped']) => (skipped[reason] = (skipped[reason] ?? 0) + 1);

  const finish = (book: Book, price: number, time: number, reason: ExitReason) => {
    const pos = book.open!;
    // With a partial, the average price the whole position left at.
    const left = pos.partial ? PARTIAL_SHARE * pos.partial.price + (1 - PARTIAL_SHARE) * price : price;
    const gross = (pos.dir * (left - pos.entry)) / pos.risk;
    // The fee is a share of the position's value on each fill, so in R it is that over the risk.
    const feeR = ((s.feePct / 100) * (pos.entry + left)) / pos.risk;
    trades.push({
      id: 0,
      coin: book.data.coin,
      side: pos.dir > 0 ? 'long' : 'short',
      signalTime: pos.signalTime,
      breakoutLevel: pos.breakoutLevel,
      entryTime: pos.entryTime,
      entry: pos.entry,
      stop: pos.initialStop,
      trail: pos.trail,
      partial: pos.partial,
      exitTime: time,
      exitPrice: price,
      exitReason: reason,
      r: gross - feeR,
      grossR: gross,
      feeR,
      precision: book.data.precision
    });
    monthR.set(monthOf(time), (monthR.get(monthOf(time)) ?? 0) + gross - feeR);
    book.open = null;
  };

  /**
   * Moves an open trade through candle `i`: the stop first (a candle that
   * reaches both the stop and the partial target is a stop-out), then calm
   * mode's partial, then the trail. The stop moves count from the next candle.
   */
  const manage = (book: Book, i: number) => {
    const pos = book.open;
    if (!pos) return;
    const { candles } = book.data;
    const c = candles[i];
    const close = c.t + tfMs;
    if (pos.dir > 0 ? c.l <= pos.stop : c.h >= pos.stop) {
      // A gap through the stop fills at the open.
      finish(book, pos.dir > 0 ? Math.min(pos.stop, c.o) : Math.max(pos.stop, c.o), close, pos.trail.length > 0 ? 'trail' : 'stop');
      return;
    }
    if (s.partialR > 0 && !pos.partial) {
      const target = pos.entry + pos.dir * s.partialR * pos.risk;
      if (pos.dir * ((pos.dir > 0 ? c.h : c.l) - target) >= 0) {
        // A gap past the target fills at the open.
        pos.partial = { time: close, price: pos.dir > 0 ? Math.max(target, c.o) : Math.min(target, c.o) };
        if (pos.dir * (pos.entry - pos.stop) > 0) {
          pos.stop = pos.entry;
          pos.trail.push({ time: close, stop: pos.entry });
        }
      }
    }
    if (i + 1 >= s.exitLen) {
      const level = extreme(candles, i + 1 - s.exitLen, i, pos.dir < 0);
      if (pos.dir * (level - pos.stop) > 0) {
        pos.stop = level;
        pos.trail.push({ time: close, stop: level });
      }
    }
  };

  /** Looks at candle `i` of a coin with no trade open for a breakout to enter. */
  const look = (book: Book, i: number) => {
    const { candles } = book.data;
    const c = candles[i];
    if (c.t < w.from || i < s.entryLen || i + 1 < s.exitLen) return;
    const high = extreme(candles, i - s.entryLen, i - 1, true);
    const low = extreme(candles, i - s.entryLen, i - 1, false);
    const dir: Dir | 0 = c.c > high ? 1 : c.c < low && s.shorts ? -1 : 0;
    if (dir === 0) return;

    const close = c.t + tfMs;
    const stop = extreme(candles, i + 1 - s.exitLen, i, dir < 0);
    const risk = dir * (c.c - stop);
    const open = books.filter((b) => b.open);
    if (s.monthlyStopR > 0 && (monthR.get(monthOf(close)) ?? 0) <= -s.monthlyStopR) skip('monthly stop');
    else if (s.windowOn && !inHours(close, s.windowFrom, s.windowTo)) skip('outside hours');
    else if (!(risk > 0) || (risk / c.c) * 100 < s.minStopPct) skip('tiny stop');    else if ((s.maxOpen > 0 && open.length >= s.maxOpen) || (s.maxPerSide > 0 && open.filter((b) => b.open!.dir === dir).length >= s.maxPerSide)) skip('too many open');
    else {
      book.open = { dir, signalTime: c.t, breakoutLevel: dir > 0 ? high : low, entryTime: close, entry: c.c, initialStop: stop, stop, risk, trail: [], partial: null };
    }
  };

  const times = [...new Set(books.flatMap((b) => b.data.candles.map((c) => c.t)))].sort((a, b) => a - b);
  for (const t of times) {
    if (t + tfMs > w.to) break;
    const now = books.filter((b) => b.at.has(t));
    for (const book of now) {
      book.last = book.at.get(t)!;
      manage(book, book.last);
    }
    for (const book of now) if (!book.open) look(book, book.last);
  }

  for (const book of books) {
    if (book.open && book.last >= 0) finish(book, book.data.candles[book.last].c, book.data.candles[book.last].t + tfMs, 'end');
  }
  // In the order the trades were entered, coins in the order they were given.
  const order = new Map(coins.map((c, i) => [c.coin, i]));
  trades.sort((a, b) => a.entryTime - b.entryTime || order.get(a.coin)! - order.get(b.coin)!);
  trades.forEach((t, i) => (t.id = i + 1));
  return { trades, skipped, from: w.from, to: w.to };
}
