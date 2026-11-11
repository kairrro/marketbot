// The summary, the per-coin table and the CSV of an automatic run.

import { csvCell } from '../journal';
import { ct } from './clock';
import type { ExitReason, Trade } from './types';

const DAY_MS = 86_400_000;
const MONTH_MS = 30 * DAY_MS;

export interface AutoStats {
  trades: number;
  wins: number;
  losses: number;
  /** Wins out of all trades, 0–100. Null with no trades. */
  winRate: number | null;
  /** After fees. */
  totalR: number;
  grossR: number;
  /** Fees paid, in R. */
  feeR: number;
  avgR: number | null;
  tradesPerMonth: number;
  /** Most losing trades in a row. */
  losingStreak: number;
  /** Biggest fall in total R from a high point, in R. */
  maxDrawdownR: number;
  /** The worst UTC day (the prop firms' day), by the R of the trades that closed in it. 0 if no day lost. */
  worstDayR: number;
  /** UTC months tested, how many closed above 0R, and the worst month's R (0 if none lost). */
  months: number;
  monthsUp: number;
  worstMonthR: number;
  /** Total R after each trade (in the order they closed), from 0 before the first. */
  equity: number[];
  /** Total R of the trades entered in the first and second half of the window. */
  firstHalfR: number;
  secondHalfR: number;
  exits: Record<ExitReason, number>;
}

export interface Month {
  year: number;
  /** 0 is January. */
  month: number;
  /** Total R of the trades that closed in that UTC month. */
  r: number;
}

/** Every UTC month of [from, to), months with no trade closing in them included. */
export function monthly(trades: readonly Trade[], from: number, to: number): Month[] {
  const key = (ms: number) => new Date(ms).getUTCFullYear() * 12 + new Date(ms).getUTCMonth();
  const first = key(from);
  const months: Month[] = Array.from({ length: Math.max(0, key(to - 1) - first + 1) }, (_, i) => ({
    year: Math.floor((first + i) / 12),
    month: (first + i) % 12,
    r: 0
  }));
  for (const trade of trades) {
    const month = months[key(trade.exitTime) - first];
    if (month) month.r += trade.r;
  }
  return months;
}

/** Stats for `trades` (any order) tested over [from, to). */
export function autoStats(trades: readonly Trade[], from: number, to: number): AutoStats {
  const closed = [...trades].sort((a, b) => a.exitTime - b.exitTime || a.entryTime - b.entryTime);
  const equity = [0];
  let peak = 0;
  let maxDrawdownR = 0;
  let streak = 0;
  let losingStreak = 0;
  const exits: Record<ExitReason, number> = { stop: 0, trail: 0, end: 0 };
  const days = new Map<number, number>();
  for (const trade of closed) {
    const total = equity[equity.length - 1] + trade.r;
    equity.push(total);
    peak = Math.max(peak, total);
    maxDrawdownR = Math.max(maxDrawdownR, peak - total);
    streak = trade.r <= 0 ? streak + 1 : 0;
    losingStreak = Math.max(losingStreak, streak);
    exits[trade.exitReason] += 1;
    const day = Math.floor(trade.exitTime / DAY_MS);
    days.set(day, (days.get(day) ?? 0) + trade.r);
  }
  const wins = trades.filter((t) => t.r > 0).length;
  const sum = (list: readonly Trade[], pick: (t: Trade) => number) => list.reduce((total, t) => total + pick(t), 0);
  const mid = from + (to - from) / 2;
  const totalR = equity[equity.length - 1];
  const byMonth = monthly(trades, from, to);
  return {
    trades: trades.length,
    wins,
    losses: trades.length - wins,
    winRate: trades.length ? (wins / trades.length) * 100 : null,
    totalR,
    grossR: sum(trades, (t) => t.grossR),
    feeR: sum(trades, (t) => t.feeR),
    avgR: trades.length ? totalR / trades.length : null,
    tradesPerMonth: to > from ? (trades.length / (to - from)) * MONTH_MS : 0,
    losingStreak,
    maxDrawdownR,
    worstDayR: Math.min(0, ...days.values()),
    months: byMonth.length,
    monthsUp: byMonth.filter((m) => m.r > 0).length,
    worstMonthR: Math.min(0, ...byMonth.map((m) => m.r)),
    equity,
    firstHalfR: sum(trades.filter((t) => t.entryTime < mid), (t) => t.r),
    secondHalfR: sum(trades.filter((t) => t.entryTime >= mid), (t) => t.r),
    exits
  };
}

export interface PropRules {
  /** Account % gained to pass, % it may fall from the start, % it may lose in one UTC day (0: no daily limit). */
  targetPct: number;
  maxDrawdownPct: number;
  dailyLossPct: number;
  /** % of the account risked per trade: a trade of R is R × this. */
  riskPct: number;
}

export interface Challenge {
  /** Challenges started, one each week. */
  starts: number;
  passed: number;
  failed: number;
  /** Neither passed nor failed by the end of the time allowed. */
  open: number;
  medianDaysToPass: number | null;
  horizonDays: number;
}

/**
 * Odds of passing a prop challenge with these trades: start one every week and
 * follow the closed trades entered after the start, at `riskPct` each. Passed
 * on reaching the target; failed on falling the max drawdown from the start, or
 * the daily loss in one UTC day. Counts closed trades only, so a trade that
 * dips before it closes would have been worse. Null when the dates are too short.
 */
export function challenge(trades: readonly Trade[], from: number, to: number, rules: PropRules): Challenge | null {
  const horizonDays = Math.min(365, Math.floor((to - from) / DAY_MS / 2));
  if (horizonDays < 30) return null;
  const closed = [...trades].sort((a, b) => a.exitTime - b.exitTime);
  let passed = 0;
  let failed = 0;
  let starts = 0;
  const days: number[] = [];
  for (let start = from; start + horizonDays * DAY_MS <= to; start += 7 * DAY_MS) {
    starts += 1;
    let total = 0;
    let day = -1;
    let today = 0;
    for (const trade of closed) {
      if (trade.entryTime < start) continue;
      if (trade.exitTime > start + horizonDays * DAY_MS) break;
      const utcDay = Math.floor(trade.exitTime / DAY_MS);
      if (utcDay !== day) {
        day = utcDay;
        today = 0;
      }
      const pct = trade.r * rules.riskPct;
      total += pct;
      today += pct;
      if (total <= -rules.maxDrawdownPct || (rules.dailyLossPct > 0 && today <= -rules.dailyLossPct)) {
        failed += 1;
        break;
      }
      if (total >= rules.targetPct) {
        passed += 1;
        days.push((trade.exitTime - start) / DAY_MS);
        break;
      }
    }
  }
  days.sort((a, b) => a - b);
  return { starts, passed, failed, open: starts - passed - failed, medianDaysToPass: days.length ? days[Math.floor(days.length / 2)] : null, horizonDays };
}

export interface FundedRules {
  /** The account's size in $, and the share of each payout that is yours, in %. */
  accountSize: number;
  splitPct: number;
  /** % the account may fall from its start, and % it may lose in one UTC day (0: no daily limit). */
  maxDrawdownPct: number;
  dailyLossPct: number;
  /** % of the account risked per trade: a trade of R is R × this. */
  riskPct: number;
}

export interface Funded {
  /** Funded accounts started, one each week, each followed for `horizonDays`. */
  starts: number;
  horizonDays: number;
  /** Paid out to you per 30 days on average, over every start, blown accounts included ($). */
  perMonth: number;
  /** Total paid out over the horizon for the middle start, the worst tenth and the best tenth ($). */
  median: number;
  low: number;
  high: number;
  /** % of starts where the account was blown within the horizon. */
  blown: number;
  /** % of months, over every start, in which a payout was made. */
  monthsPaid: number;
}

/**
 * What a funded account would have paid you: start one every week and follow
 * the closed trades entered after the start, at `riskPct` each. At the end of
 * every UTC month any profit is withdrawn (your split of it is the payout) and
 * the account goes back to its starting balance. The account is blown on
 * falling the max drawdown from its start, or the daily loss in one UTC day;
 * after that it pays nothing. Closed trades only, so a trade that dips before
 * it closes would have been worse. Null when the dates are too short.
 */
export function funded(trades: readonly Trade[], from: number, to: number, rules: FundedRules): Funded | null {
  const horizonDays = Math.min(365, Math.floor((to - from) / DAY_MS / 2));
  if (horizonDays < 30) return null;
  const closed = [...trades].sort((a, b) => a.exitTime - b.exitTime);
  const monthOf = (ms: number) => new Date(ms).getUTCFullYear() * 12 + new Date(ms).getUTCMonth();
  const dollars = (pct: number) => (pct / 100) * rules.accountSize * (rules.splitPct / 100);
  const totals: number[] = [];
  let blown = 0;
  let payouts = 0;
  for (let start = from; start + horizonDays * DAY_MS <= to; start += 7 * DAY_MS) {
    let equity = 0;
    let paid = 0;
    let month = -1;
    let day = -1;
    let today = 0;
    let dead = false;
    for (const trade of closed) {
      if (trade.entryTime < start) continue;
      if (trade.exitTime > start + horizonDays * DAY_MS) break;
      const m = monthOf(trade.exitTime);
      if (month >= 0 && m !== month && equity > 0) {
        paid += dollars(equity);
        payouts += 1;
        equity = 0;
      }
      month = m;
      const utcDay = Math.floor(trade.exitTime / DAY_MS);
      if (utcDay !== day) {
        day = utcDay;
        today = 0;
      }
      const pct = trade.r * rules.riskPct;
      equity += pct;
      today += pct;
      if (equity <= -rules.maxDrawdownPct || (rules.dailyLossPct > 0 && today <= -rules.dailyLossPct)) {
        dead = true;
        break;
      }
    }
    if (!dead && equity > 0) {
      paid += dollars(equity);
      payouts += 1;
    }
    if (dead) blown += 1;
    totals.push(paid);
  }
  totals.sort((a, b) => a - b);
  const starts = totals.length;
  const months = horizonDays / 30.4;
  return {
    starts,
    horizonDays,
    perMonth: totals.reduce((sum, t) => sum + t, 0) / starts / months,
    median: totals[Math.floor(starts * 0.5)],
    low: totals[Math.floor(starts * 0.1)],
    high: totals[Math.min(starts - 1, Math.floor(starts * 0.9))],
    blown: (blown / starts) * 100,
    monthsPaid: Math.min(100, (payouts / (starts * months)) * 100)
  };
}

export const EXIT_LABEL: Record<ExitReason, string> = {
  stop: 'Stop',
  trail: 'Trailing stop',
  end: 'End of data'
};

const pad = (n: number) => String(n).padStart(2, '0');

/** "2026-03-05 14:31" in CT. */
export function ctStamp(ms: number): string {
  const { day, minute } = ct(ms);
  return `${new Date(day * DAY_MS).toISOString().slice(0, 10)} ${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;
}

/** One row per trade, in the order they were entered. Times in CT. */
export function autoCsv(trades: readonly Trade[]): string {
  const head = [
    '#',
    'coin',
    'side',
    'entry_time_ct',
    'entry',
    'stop',
    'exit_time_ct',
    'exit_price',
    'partial_price',
    'exit_reason',
    'R_after_fees',
    'R_before_fees',
    'fees_R',
    'breakout_level'
  ];
  const rows = trades.map((t) => {
    // A few more decimals than the market quotes drop the float noise.
    const price = (x: number) => Number(x.toFixed(t.precision + 3));
    return [
      t.id,
      t.coin,
      t.side,
      ctStamp(t.entryTime),
      price(t.entry),
      price(t.stop),
      ctStamp(t.exitTime),
      price(t.exitPrice),
      t.partial ? price(t.partial.price) : '',
      EXIT_LABEL[t.exitReason],
      t.r.toFixed(3),
      t.grossR.toFixed(3),
      t.feeR.toFixed(3),
      price(t.breakoutLevel)
    ];
  });
  return [head, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
}
