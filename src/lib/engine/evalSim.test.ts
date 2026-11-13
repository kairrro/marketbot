import { describe, expect, it } from 'vitest';
import { DEFAULT_EVAL_RULES, simulateEval, tradingDays, type EvalRules } from './evalSim';

const DAY = 86_400_000;
// $50,000, pass at +6% ($3,000), blown at -4% ($2,000), trailing, no daily limit.
const rules: EvalRules = { ...DEFAULT_EVAL_RULES };
const sim = (days: number[][], riskUsd: number, r: Partial<EvalRules> = {}, runs = 200) =>
  simulateEval(days, riskUsd, { ...rules, ...r }, { runs });

describe('trading days', () => {
  it('groups the trades of each day in the order they closed, days in order', () => {
    const t = (day: number, hour: number, r: number) => ({ exitTime: day * DAY + hour * 3_600_000, r });
    const days = tradingDays([t(5, 3, -1), t(2, 9, 2), t(2, 1, 0.5), t(5, 1, 1)], (ms) => Math.floor(ms / DAY));
    expect(days).toEqual([
      [0.5, 2],
      [1, -1]
    ]);
  });
});

describe('the evaluation', () => {
  it('passes on reaching the target: +1R days at $1,000 a trade take three days to $3,000', () => {
    expect(sim([[1]], 1000)).toEqual({ runs: 200, passed: 1, blown: 0, open: 0, medianDays: 3 });
  });

  it('is blown on falling the maximum drawdown: -1R days at $1,000 are out on the second day', () => {
    expect(sim([[-1]], 1000)).toMatchObject({ passed: 0, blown: 1, open: 0, medianDays: null });
  });

  it('leaves it not done when the days run out before either', () => {
    expect(sim([[0.1]], 100)).toMatchObject({ passed: 0, blown: 0, open: 1 });
  });

  it('trails the drawdown behind the best balance, but only up to the starting balance', () => {
    // +1.5R, -1.5R, -1.5R, +1.5R at $1,000: up $1,500, back to 0, down $1,500, back to 0 (a flat day).
    const day = [[1.5, -1.5, -1.5, 1.5]];
    // Trailing: the floor rose to -$500 with the $1,500 peak, so -$1,500 is out.
    expect(sim(day, 1000, { targetPct: 10 })).toMatchObject({ blown: 1 });
    // Fixed at -$2,000 from the start: -$1,500 is survived every day, and the account never gets anywhere.
    expect(sim(day, 1000, { targetPct: 10, trailing: false })).toMatchObject({ blown: 0, open: 1 });
  });

  it('is blown on the daily loss limit alone, adding a day trade by trade', () => {
    // Two -1R trades at $600 are -$1,200 in a day: past a 2% ($1,000) limit, far inside a drawdown too big to reach.
    expect(sim([[-1, -1]], 600, { maxDrawdownPct: 10_000, dailyLossPct: 2 })).toMatchObject({ blown: 1 });
    expect(sim([[-1, -1]], 600, { maxDrawdownPct: 10_000, dailyLossPct: 0 })).toMatchObject({ blown: 0, open: 1 });
  });

  it('gives the same odds every time, and nothing for no days or no risk', () => {
    const days = [[1, -1, 1], [-1, -1], [2], [-0.5, 1]];
    expect(simulateEval(days, 500, rules)).toEqual(simulateEval(days, 500, rules));
    expect(simulateEval([], 500, rules)).toMatchObject({ passed: 0, blown: 0, open: 1 });
    expect(simulateEval(days, 0, rules)).toMatchObject({ passed: 0, blown: 0, open: 1 });
  });

  it('adds up: every run passes, is blown, or is not done', () => {
    const days = [[1, -1, 1], [-1, -1], [2], [-0.5, 1], [0.3]];
    for (const risk of [100, 500, 1500]) {
      const odds = simulateEval(days, risk, rules);
      expect(odds.passed + odds.blown + odds.open).toBeCloseTo(1, 10);
    }
  });

  it('is a hump: too little risk is not done, a lot of risk is blown', () => {
    const days = [[1, -1, 1], [-1, -1], [2], [-0.5, 1], [0.3], [1.2, -1], [0.8]];
    const tiny = simulateEval(days, 20, rules);
    const huge = simulateEval(days, 2500, rules);
    expect(tiny.open).toBeGreaterThan(0.9);
    expect(huge.blown).toBeGreaterThan(tiny.blown);
  });
});
