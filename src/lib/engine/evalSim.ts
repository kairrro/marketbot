// Odds of passing a prop firm's evaluation with your own trades, at different risks per trade.
// Whole trading days are drawn at random from the days you traded (so a bad day stays a bad day,
// with its losses in a row), and played through the firm's rules until the account passes, is
// blown, or the days run out. Counts closed trades only: a trade that dips before it closes
// would have been worse, so the real drawdown is a little tighter.

export interface EvalRules {
  /** The account's size in $. The target and the limits are % of it. */
  accountSize: number;
  /** Profit to pass, in % of the account. */
  targetPct: number;
  /** The most the account may fall, in % of its size. */
  maxDrawdownPct: number;
  /** The limit follows the highest balance and stops at the starting balance (true), or is fixed below the start (false). */
  trailing: boolean;
  /** The most it may lose in one trading day, in %. 0: no daily limit. */
  dailyLossPct: number;
}

export const DEFAULT_EVAL_RULES: EvalRules = {
  accountSize: 50_000,
  targetPct: 6,
  maxDrawdownPct: 4,
  trailing: true,
  dailyLossPct: 0
};

export interface EvalOdds {
  runs: number;
  /** Shares of the runs, 0 to 1: passed, blown, and neither by the last day. */
  passed: number;
  blown: number;
  open: number;
  /** Trading days the runs that passed took, median. Null if none passed. */
  medianDays: number | null;
}

/** Trading days that count in one run before it is left "not done". */
export const EVAL_DAYS = 60;
export const EVAL_RUNS = 2000;

/** The R of each trade, by day traded, in the order the days and trades came. `dayOf` says which day a time falls on. */
export function tradingDays(trades: readonly { exitTime: number; r: number }[], dayOf: (ms: number) => number): number[][] {
  const byDay = new Map<number, number[]>();
  for (const trade of [...trades].sort((a, b) => a.exitTime - b.exitTime)) {
    const day = dayOf(trade.exitTime);
    const list = byDay.get(day);
    if (list) list.push(trade.r);
    else byDay.set(day, [trade.r]);
  }
  return [...byDay.entries()].sort((a, b) => a[0] - b[0]).map(([, list]) => list);
}

/** A small seeded random number generator: the same seed gives the same odds every time. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Plays `days` (the R of each trade, by day) through `rules` at `riskUsd` a trade, `runs` times. */
export function simulateEval(
  days: readonly (readonly number[])[],
  riskUsd: number,
  rules: EvalRules,
  options: { runs?: number; maxDays?: number; seed?: number } = {}
): EvalOdds {
  const runs = options.runs ?? EVAL_RUNS;
  const maxDays = options.maxDays ?? EVAL_DAYS;
  const empty: EvalOdds = { runs, passed: 0, blown: 0, open: 1, medianDays: null };
  if (days.length === 0 || !(riskUsd > 0) || !(rules.accountSize > 0)) return empty;

  const target = (rules.targetPct / 100) * rules.accountSize;
  const drawdown = (rules.maxDrawdownPct / 100) * rules.accountSize;
  const dailyLimit = (rules.dailyLossPct / 100) * rules.accountSize;
  const random = mulberry32(options.seed ?? 1);

  let passed = 0;
  let blown = 0;
  const took: number[] = [];

  for (let run = 0; run < runs; run++) {
    let profit = 0;
    let peak = 0;
    let result: 'passed' | 'blown' | 'open' = 'open';
    let day = 0;
    for (; day < maxDays && result === 'open'; day++) {
      const trades = days[Math.floor(random() * days.length)];
      const dayStart = profit;
      for (const r of trades) {
        profit += r * riskUsd;
        peak = Math.max(peak, profit);
        // Trailing: the floor rises with the best balance, and stops at the starting balance.
        const floor = rules.trailing ? Math.min(0, peak - drawdown) : -drawdown;
        if (profit <= floor || (dailyLimit > 0 && profit - dayStart <= -dailyLimit)) {
          result = 'blown';
          break;
        }
        if (profit >= target) {
          result = 'passed';
          break;
        }
      }
    }
    if (result === 'passed') {
      passed += 1;
      took.push(day);
    } else if (result === 'blown') blown += 1;
  }

  took.sort((a, b) => a - b);
  return {
    runs,
    passed: passed / runs,
    blown: blown / runs,
    open: (runs - passed - blown) / runs,
    medianDays: took.length ? took[Math.floor(took.length / 2)] : null
  };
}
