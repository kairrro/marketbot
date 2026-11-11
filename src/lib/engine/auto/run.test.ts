import { describe, expect, it } from 'vitest';
import { TF_MS, type Candle } from '../types';
import { autoCsv, autoStats, challenge, funded, monthly, type FundedRules, type PropRules } from './report';
import { runBreakout, type CoinCandles, type RunWindow } from './run';
import { DEFAULTS, type BreakoutSettings, type Trade } from './types';

const TF = TF_MS['4h'];
// 00:00 UTC on a Monday: candle n closes at 4n + 4 hours UTC, which is 18:00 CT for n = 5.
const BASE = Date.UTC(2026, 0, 5);
// Short lookbacks, and none of the filters or limits: each test turns on what it checks.
const SMALL: BreakoutSettings = { ...DEFAULTS, tf: '4h', entryLen: 5, exitLen: 3, minStopPct: 0, feePct: 0, shorts: true, windowOn: false, maxOpen: 0, maxPerSide: 0, monthlyStopR: 0 };

type Row = [o: number, h: number, l: number, c: number];
const toCandles = (rows: Row[]): Candle[] => rows.map(([o, h, l, c], i) => ({ t: BASE + i * TF, o, h, l, c, v: 1 }));
/** The same market upside down: breakouts up become breakouts down. */
const flip = (rows: Row[]): Row[] => rows.map(([o, h, l, c]) => [200 - o, 200 - l, 200 - h, 200 - c]);
const closeOf = (i: number) => BASE + (i + 1) * TF;
const window = (candles: readonly Candle[], from = BASE, to = candles[candles.length - 1].t + TF): RunWindow => ({ from, to });
const coin = (name: string, rows: Row[]): CoinCandles => ({ coin: name, candles: toCandles(rows), precision: 2 });
const runCoins = (coins: CoinCandles[], s: Partial<BreakoutSettings> = {}, w: Partial<RunWindow> = {}) =>
  runBreakout(coins, { ...SMALL, ...s }, { ...window(coins[0].candles), ...w });
const run = (rows: Row[], s: Partial<BreakoutSettings> = {}, w: Partial<RunWindow> = {}) => runCoins([coin('TEST', rows)], s, w);

/** Five quiet candles (highs 101, lows 99), then a breakout candle closing at 103. */
const QUIET: Row[] = Array.from({ length: 5 }, () => [100, 101, 99, 100] as Row);
const BREAKOUT: Row = [100, 104, 100, 103];
// Entry 103 at the close of candle 5. Stop: the lowest low of candles 3–5, 99. 1R = 4.
const START: Row[] = [...QUIET, BREAKOUT];

/** The trailing stop rises 99 → 100 → 102, then a candle trades down through it. */
const TRAIL: Row[] = [
  ...START,
  [103, 105, 102, 104], // lowest low of 4–6 is 99: no move
  [104, 108, 103, 107], // lowest low of 5–7 is 100: stop to 100
  [107, 109, 105, 108], // lowest low of 6–8 is 102: stop to 102
  [108, 108, 101, 103] // low 101 reaches 102: out at 102
];

describe('long breakout', () => {
  it('enters at the close of a candle that closed above the highest high of the 5 before it', () => {
    const [t] = run(START).trades;
    expect(t).toMatchObject({ side: 'long', entry: 103, entryTime: closeOf(5), signalTime: BASE + 5 * TF, breakoutLevel: 101, stop: 99 });
    expect(t.exitReason).toBe('end');
  });

  it('needs a close above, not a wick above or a close equal to the high', () => {
    expect(run([...QUIET, [100, 104, 100, 100.5]]).trades).toHaveLength(0);
    expect(run([...QUIET, [100, 104, 100, 101]]).trades).toHaveLength(0);
    expect(run([...QUIET, [100, 104, 100, 101.01]]).trades).toHaveLength(1);
  });

  it('puts the stop at the lowest low of the last 3 candles, the breakout candle included', () => {
    const rows: Row[] = [...QUIET.slice(0, 4), [100, 101, 99, 100], [100, 104, 98.5, 103]];
    expect(run(rows).trades[0].stop).toBe(98.5);
  });

  it('is stopped out at the stop for -1R', () => {
    const [t] = run([...START, [103, 104, 98.5, 100]]).trades;
    expect(t).toMatchObject({ exitReason: 'stop', exitPrice: 99, exitTime: closeOf(6), grossR: -1, trail: [] });
  });

  it('fills a candle that gaps through the stop at its open', () => {
    const [t] = run([...START, [97, 98, 96, 97.5]]).trades;
    expect(t).toMatchObject({ exitReason: 'stop', exitPrice: 97, grossR: -1.5 });
  });

  it('trails the stop up to the lowest low of the last 3 candles, and exits at the trailing stop', () => {
    const [t] = run(TRAIL).trades;
    expect(t.trail).toEqual([
      { time: closeOf(7), stop: 100 },
      { time: closeOf(8), stop: 102 }
    ]);
    expect(t).toMatchObject({ exitReason: 'trail', exitPrice: 102, exitTime: closeOf(9), stop: 99, grossR: -0.25 });
  });

  it('never moves the stop back down', () => {
    // Candle 9 has the lowest low of the window rising again, then a lower candle: stop stays at its highest.
    const [t] = run([...TRAIL.slice(0, 8), [108, 108, 104, 105], [105, 106, 103, 104]]).trades;
    const stops = t.trail.map((x) => x.stop);
    expect(stops).toEqual([...stops].sort((a, b) => a - b));
  });

  it("checks a candle against the stop as it stood when the candle opened, not the one its own low would set", () => {
    // Candle 7 trades down to 99.5, above the stop of 99, so the trade survives; it only then trails to 99.5.
    const out = run([...START, [103, 105, 102, 104], [104, 108, 99.5, 107]]).trades[0];
    expect(out.exitReason).toBe('end');
    expect(out.trail).toEqual([{ time: closeOf(7), stop: 99.5 }]);
  });

  it('takes one trade at a time, and can enter again after the exit', () => {
    const more: Row[] = [[103, 103, 102, 102.5], [102.5, 103, 102, 102.5], [102.5, 103, 102, 102.5], [102.5, 103, 102, 102.5], [102.5, 103, 102, 102.5], [102.5, 112, 102.5, 111]];
    const trades = run([...TRAIL, ...more]).trades;
    expect(trades).toHaveLength(2);
    expect(trades[0].exitTime).toBeLessThan(trades[1].entryTime);
    expect(trades[1]).toMatchObject({ side: 'long', entry: 111 });
    // While the first was open, candles 6–8 closed higher still: no second entry.
    expect(trades.filter((t) => t.signalTime < BASE + 9 * TF)).toHaveLength(1);
  });

  it('closes a trade still open at the end of the window at the last close', () => {
    const [t] = run(TRAIL, {}, { to: closeOf(8) }).trades;
    expect(t).toMatchObject({ exitReason: 'end', exitPrice: 108, exitTime: closeOf(8), grossR: 1.25 });
  });

  it('does not enter before the window starts, but uses the earlier candles to look back', () => {
    const [t] = run(TRAIL, {}, { from: closeOf(5) }).trades;
    // Candle 5 is before `from`; candle 7 is the next close above the 5 before it.
    expect(t).toMatchObject({ signalTime: BASE + 7 * TF, entry: 107, breakoutLevel: 105 });
  });
});

describe('short breakout is the exact mirror', () => {
  it('enters on a close below the lowest low, trails the stop down, exits at it', () => {
    const [t] = run(flip(TRAIL)).trades;
    expect(t).toMatchObject({ side: 'short', entry: 97, stop: 101, breakoutLevel: 99, exitReason: 'trail', exitPrice: 98, grossR: -0.25 });
    expect(t.trail.map((x) => x.stop)).toEqual([100, 98]);
  });

  it('can be turned off', () => {
    expect(run(flip(TRAIL), { shorts: false })).toMatchObject({ trades: [], skipped: {} });
    expect(run(TRAIL, { shorts: false }).trades).toHaveLength(1);
  });
});

describe('skips', () => {
  it('skips a stop under the minimum % of price', () => {
    // 1R is 4, 3.88% of 103.
    expect(run(START, { minStopPct: 5 })).toMatchObject({ trades: [], skipped: { 'tiny stop': 1 } });
    expect(run(START, { minStopPct: 3 }).trades).toHaveLength(1);
  });

  it('only enters when the entry candle closes in the trading hours (CT)', () => {
    // Candle 5 closes at 18:00 CT.
    expect(run(START, { windowOn: true, windowFrom: 10, windowTo: 22 }).trades).toHaveLength(1);
    expect(run(START, { windowOn: true, windowFrom: 8, windowTo: 12 })).toMatchObject({ trades: [], skipped: { 'outside hours': 1 } });
    expect(run(START, { windowOn: true, windowFrom: 18, windowTo: 19 }).trades).toHaveLength(1);
    expect(run(START, { windowOn: true, windowFrom: 17, windowTo: 18 }).trades).toHaveLength(0);
    // A window that runs past midnight wraps.
    expect(run(START, { windowOn: true, windowFrom: 16, windowTo: 4 }).trades).toHaveLength(1);
    expect(run(START, { windowOn: true, windowFrom: 20, windowTo: 4 }).trades).toHaveLength(0);
  });
});

describe('open trade limits, across coins', () => {
  const up = (name: string) => coin(name, TRAIL);
  const down = (name: string) => coin(name, flip(TRAIL));

  it('lets every coin trade when there is no limit', () => {
    expect(runCoins([up('A'), up('B'), up('C')]).trades.map((t) => t.coin)).toEqual(['A', 'B', 'C']);
  });

  it('stops entering at the most open trades, the first coin given first', () => {
    const { trades, skipped } = runCoins([up('A'), up('B'), up('C')], { maxOpen: 2 });
    expect(trades.map((t) => t.coin)).toEqual(['A', 'B']);
    // C breaks out at candle 5 and again at candle 7, while A and B are still open: two breakouts skipped.
    expect(skipped).toEqual({ 'too many open': 2 });
  });

  it('limits one direction on its own: coins moving the same way count as one move', () => {
    const { trades, skipped } = runCoins([up('A'), up('B'), down('C')], { maxPerSide: 1 });
    expect(trades.map((t) => [t.coin, t.side])).toEqual([['A', 'long'], ['C', 'short']]);
    // B, a second long, is skipped at both of its breakouts (candles 5 and 7).
    expect(skipped).toEqual({ 'too many open': 2 });
  });

  it('counts a trade as open until the candle that exits it closes, then frees the slot', () => {
    // A's trade exits in candle 9. B breaks out in that same candle: A's exit comes first, so the slot is free.
    const late = coin('B', [...Array.from({ length: 9 }, () => [100, 101, 99, 100] as Row), BREAKOUT]);
    const result = runCoins([up('A'), late], { maxOpen: 1 });
    expect(result.trades.map((t) => t.coin)).toEqual(['A', 'B']);
    expect(result.trades[1].entryTime).toBe(closeOf(9));
    expect(result.trades[0].exitTime).toBe(closeOf(9));
  });

  it('numbers the trades in entry order and works out each coin on its own candles', () => {
    const { trades } = runCoins([down('A'), up('B')]);
    expect(trades.map((t) => [t.id, t.coin, t.side])).toEqual([[1, 'A', 'short'], [2, 'B', 'long']]);
    const [head, row] = autoCsv(trades).split('\n');
    expect(head.split(',')).toContain('exit_reason');
    expect(row.split(',').length).toBe(head.split(',').length);
  });
});

describe('calm mode: a third off at the partial target', () => {
  // TRAIL: entry 103, stop 99, 1R = 4. Candle 7 reaches 108 (1R is 107), candle 9 trades down through the entry.
  it('takes a third off at the target and moves the stop to the entry, so a return to entry still pays a third of the target', () => {
    const [t] = run(TRAIL, { partialR: 1 }).trades;
    expect(t.partial).toEqual({ time: closeOf(7), price: 107 });
    expect(t.trail[0]).toEqual({ time: closeOf(7), stop: 103 });
    expect(t).toMatchObject({ exitPrice: 103, exitReason: 'trail', exitTime: closeOf(9) });
    expect(t.grossR).toBeCloseTo(1 / 3, 12);
    expect(t.r).toBeGreaterThan(0);
  });

  it('is off at 0: the same trade then exits at the trailing stop for a loss', () => {
    const [t] = run(TRAIL).trades;
    expect(t.partial).toBeNull();
    expect(t.grossR).toBe(-0.25);
  });

  it('counts a candle that reaches both the stop and the target as a stop-out', () => {
    const [t] = run([...START, [103, 108, 98.5, 100]], { partialR: 1 }).trades;
    expect(t).toMatchObject({ partial: null, exitReason: 'stop', exitPrice: 99, grossR: -1 });
  });

  it('fills a candle that gaps past the target at its open', () => {
    // Candle 6 opens at 110, past the 107 target; the window ends there at the close, 111.
    const [t] = run([...START, [110, 112, 109, 111]], { partialR: 1 }).trades;
    expect(t.partial?.price).toBe(110);
    expect(t.grossR).toBeCloseTo(((110 / 3 + (2 * 111) / 3) - 103) / 4, 12);
  });

  it('runs a short as the mirror', () => {
    const [t] = run(flip(TRAIL), { partialR: 1 }).trades;
    expect(t.partial).toEqual({ time: closeOf(7), price: 93 });
    expect(t).toMatchObject({ side: 'short', exitPrice: 97 });
    expect(t.grossR).toBeCloseTo(1 / 3, 12);
  });

  it('charges the fee on the whole position at its average exit', () => {
    const [t] = run(TRAIL, { partialR: 1, feePct: 0.1 }).trades;
    const left = 107 / 3 + (2 * 103) / 3;
    expect(t.feeR).toBeCloseTo((0.001 * (103 + left)) / 4, 12);
    expect(t.r).toBeCloseTo(t.grossR - t.feeR, 12);
  });

  it('takes the partial once, however far the trade runs', () => {
    const [t] = run([...TRAIL.slice(0, 8), [107, 120, 106, 118]], { partialR: 1 }).trades;
    expect(t.partial?.price).toBe(107);
  });
});

describe('monthly loss stop', () => {
  const QUIETER: Row = [100, 101, 99.5, 100];
  const quiet = (n: number): Row[] => Array.from({ length: n }, () => QUIETER);
  // Candle 5 breaks out (entry 103, stop 99) and candle 6 stops it out for -1R, in January.
  const LOSS: Row[] = [...START, [103, 104, 98.5, 100]];
  // Five quiet candles later, another breakout, still in January: candle 12 closes at 105 above the 5 before it.
  const SAME_MONTH: Row[] = [...LOSS, ...quiet(5), [100, 106, 100, 105]];

  it('skips a breakout once the month is down that many R, and trades it with the stop off or higher', () => {
    expect(run(SAME_MONTH, { monthlyStopR: 0 }).trades).toHaveLength(2);
    expect(run(SAME_MONTH, { monthlyStopR: 2 }).trades).toHaveLength(2);
    const stopped = run(SAME_MONTH, { monthlyStopR: 1 });
    expect(stopped.trades).toHaveLength(1);
    expect(stopped.skipped).toEqual({ 'monthly stop': 1 });
  });

  it('is down by R after fees', () => {
    // The -1R stop-out plus a 0.1% fee on both fills is -1.0505R.
    expect(run(SAME_MONTH, { monthlyStopR: 1.06, feePct: 0.1 }).trades).toHaveLength(2);
    expect(run(SAME_MONTH, { monthlyStopR: 1.05, feePct: 0.1 }).trades).toHaveLength(1);
  });

  it('starts again with the first candle that closes in the next UTC month', () => {
    // Candle 160 closes at 20:00 on Jan 31, candle 161 at 00:00 on Feb 1.
    const january: Row[] = [...LOSS, ...quiet(153), [100, 106, 100, 105]];
    const february: Row[] = [...LOSS, ...quiet(154), [100, 106, 100, 105]];
    expect(new Date(toCandles(january)[160].t + TF).getUTCMonth()).toBe(0);
    expect(new Date(toCandles(february)[161].t + TF).getUTCMonth()).toBe(1);
    expect(run(january, { monthlyStopR: 1 })).toMatchObject({ skipped: { 'monthly stop': 1 } });
    expect(run(january, { monthlyStopR: 1 }).trades).toHaveLength(1);
    expect(run(february, { monthlyStopR: 1 }).trades).toHaveLength(2);
  });

  it('counts the trades of every coin together', () => {
    const a = coin('A', LOSS);
    // B breaks out 12 candles in, after A lost 1R in the same month. B goes first so its candles set the window.
    const b = coin('B', [...quiet(12), [100, 106, 100, 105]]);
    expect(runCoins([b, a], { monthlyStopR: 1 }).skipped).toEqual({ 'monthly stop': 1 });
    expect(runCoins([b, a], { monthlyStopR: 0 }).trades.map((t) => t.coin).sort()).toEqual(['A', 'B']);
  });
});

describe('fees', () => {
  it('take the fee on the entry and the exit off every trade, in R', () => {
    const [t] = run(TRAIL, { feePct: 0.1 }).trades;
    // 0.1% of the position at 103 in and 102 out, over 1R = 4.
    expect(t.feeR).toBeCloseTo((0.001 * (103 + 102)) / 4, 12);
    expect(t.grossR).toBe(-0.25);
    expect(t.r).toBeCloseTo(-0.25 - t.feeR, 12);
  });

  it('cost a stop-out more than 1R', () => {
    const [t] = run([...START, [103, 104, 98.5, 100]], { feePct: 0.045 }).trades;
    expect(t.r).toBeLessThan(-1);
  });
});

describe('prop challenge odds', () => {
  const DAY = 86_400_000;
  const from = Date.UTC(2026, 0, 1);
  const to = from + 365 * DAY;
  const rules: PropRules = { targetPct: 8, maxDrawdownPct: 6, dailyLossPct: 4, riskPct: 1 };
  /** One trade a day, entered at midnight and closed at noon. */
  const daily = (r: number, days = 365): Trade[] =>
    Array.from({ length: days }, (_, i) => ({ r, entryTime: from + i * DAY, exitTime: from + i * DAY + DAY / 2 }) as Trade);

  it('passes on reaching the target: four +2R trades at 1% risk, in three and a half days', () => {
    const result = challenge(daily(2), from, to, rules)!;
    expect(result).toMatchObject({ horizonDays: 182, passed: result.starts, failed: 0, open: 0, medianDaysToPass: 3.5 });
    expect(result.starts).toBe(27);
  });

  it('fails on falling the max drawdown from the start', () => {
    // -3% a day: the second day takes it to -6%.
    const result = challenge(daily(-1), from, to, { ...rules, riskPct: 3 })!;
    expect(result).toMatchObject({ passed: 0, failed: result.starts, open: 0, medianDaysToPass: null });
  });

  it('fails on the daily loss limit, adding the trades that closed on the same UTC day', () => {
    const twoLosses = daily(-1).flatMap((t) => [t, { ...t, exitTime: t.exitTime + 1000 }]);
    // -2.5% twice in one day is -5%: past the 4% daily limit though only 5% down overall.
    // With the overall drawdown out of the way, one -2.5% trade a day is fine and two a day is not.
    const one = challenge(daily(-1), from, to, { ...rules, riskPct: 2.5, maxDrawdownPct: 100_000, dailyLossPct: 4 })!;
    expect(one.failed).toBe(0);
    const two = challenge(twoLosses, from, to, { ...rules, riskPct: 2.5, maxDrawdownPct: 100_000, dailyLossPct: 4 })!;
    expect(two.failed).toBe(two.starts);
  });

  it('only counts trades entered after each start, and leaves it open when nothing decides it', () => {
    expect(challenge([], from, to, rules)).toMatchObject({ passed: 0, failed: 0, open: 27 });
    // One big win entered before the second start does not count for it.
    const early = [{ r: 8, entryTime: from + DAY, exitTime: from + 2 * DAY } as Trade];
    const result = challenge(early, from, to, rules)!;
    expect(result.passed).toBe(1);
    expect(result.open).toBe(26);
  });

  it('gives nothing when the dates are too short to see a challenge through', () => {
    expect(challenge(daily(1, 40), from, from + 40 * DAY, rules)).toBeNull();
  });
});

describe('funded account payouts', () => {
  const DAY = 86_400_000;
  const from = Date.UTC(2026, 0, 1);
  const to = Date.UTC(2028, 0, 1);
  const rules: FundedRules = { accountSize: 50_000, splitPct: 80, maxDrawdownPct: 6, dailyLossPct: 4, riskPct: 1 };
  /** One trade on the 15th of each of 24 months, entered at midnight and closed at noon. */
  const monthly15th = (r: number): Trade[] =>
    Array.from({ length: 24 }, (_, i) => ({ r, entryTime: Date.UTC(2026, i, 15), exitTime: Date.UTC(2026, i, 15, 12) }) as Trade);

  it('pays your split of each month: +3R a month at 1% risk on $50,000 is $1,200 a month', () => {
    const result = funded(monthly15th(3), from, to, rules)!;
    expect(result.horizonDays).toBe(365);
    // 12 payouts of 3% of $50,000 at 80% over 365 days.
    expect(result.median).toBe(14_400);
    expect(result.low).toBe(14_400);
    expect(result.high).toBe(14_400);
    expect(result.perMonth).toBeGreaterThan(1_190);
    expect(result.perMonth).toBeLessThan(1_210);
    expect(result).toMatchObject({ blown: 0 });
    expect(result.monthsPaid).toBeGreaterThan(99);
  });

  it('scales with the account size and the split', () => {
    const big = funded(monthly15th(3), from, to, { ...rules, accountSize: 100_000, splitPct: 90 })!;
    expect(big.median).toBe(32_400);
  });

  it('blows the account on the max drawdown, and pays nothing after that', () => {
    // -3% on the 15th of two months in a row is -6%.
    const result = funded(monthly15th(-1), from, to, { ...rules, riskPct: 3 })!;
    expect(result).toMatchObject({ blown: 100, perMonth: 0, median: 0, monthsPaid: 0 });
  });

  it('blows it on the daily loss, adding the trades that closed on one UTC day, unless there is no daily limit', () => {
    const pairs = monthly15th(-1).flatMap((t) => [t, { ...t, exitTime: t.exitTime + 3_600_000 }]);
    // -2.5% twice in one day is -5%: past a 4% daily limit, inside a 100% drawdown.
    const limited = funded(pairs, from, to, { ...rules, riskPct: 2.5, maxDrawdownPct: 100, dailyLossPct: 4 })!;
    expect(limited.blown).toBe(100);
    const unlimited = funded(pairs, from, to, { ...rules, riskPct: 2.5, maxDrawdownPct: 100, dailyLossPct: 0 })!;
    expect(unlimited.blown).toBe(0);
  });

  it('pays only on profit, and not when there are no trades', () => {
    expect(funded([], from, to, rules)).toMatchObject({ blown: 0, perMonth: 0, median: 0 });
    expect(funded(monthly15th(-0.5), from, to, { ...rules, riskPct: 0.1 })).toMatchObject({ blown: 0, perMonth: 0 });
  });

  it('also lets the challenge odds run with no daily limit', () => {
    const odds = challenge(monthly15th(-1), from, to, { targetPct: 8, maxDrawdownPct: 100_000, dailyLossPct: 0, riskPct: 2.5 })!;
    expect(odds.failed).toBe(0);
  });

  it('gives nothing when the dates are too short', () => {
    expect(funded(monthly15th(3), from, from + 40 * DAY, rules)).toBeNull();
  });
});

// ---- a random market ----

/** A seeded random walk of 4h candles with trends that change now and then. */
function walk(count: number, seed = 5): Candle[] {
  let s = seed;
  const rand = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const normal = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());
  const round = (x: number) => Math.round(x * 100) / 100;
  const out: Candle[] = [];
  let price = 100;
  let drift = 0;
  for (let i = 0; i < count; i++) {
    if (i % 60 === 0) drift = (rand() - 0.5) * 0.012;
    const o = price;
    const c = round(o * (1 + drift + normal() * 0.012));
    out.push({ t: BASE + i * TF, o, h: round(Math.max(o, c) * (1 + Math.abs(normal()) * 0.004)), l: round(Math.min(o, c) * (1 - Math.abs(normal()) * 0.004)), c, v: 1 });
    price = c;
  }
  return out;
}

describe('every trade on a random market follows the rules', () => {
  const candles = walk(2500);
  const s: BreakoutSettings = { ...DEFAULTS, tf: '4h', entryLen: 20, exitLen: 10, minStopPct: 0.5, maxOpen: 0, maxPerSide: 0, monthlyStopR: 0 };
  const w: RunWindow = { from: candles[60].t, to: candles[candles.length - 1].t + TF };
  const { trades } = runBreakout([{ coin: 'TEST', candles, precision: 2 }], s, w);
  const at = new Map(candles.map((c, i) => [c.t, i]));
  const hi = (a: number, b: number) => Math.max(...candles.slice(a, b + 1).map((c) => c.h));
  const lo = (a: number, b: number) => Math.min(...candles.slice(a, b + 1).map((c) => c.l));

  it('finds trades of both sides to check', () => {
    expect(trades.length).toBeGreaterThan(40);
    expect(trades.some((t) => t.side === 'long') && trades.some((t) => t.side === 'short')).toBe(true);
    expect(new Set(trades.map((t) => t.exitReason))).toContain('trail');
  });

  it('enters at the close of a candle past the 20 before it, with the stop at the extreme of the last 10', () => {
    for (const t of trades) {
      const i = at.get(t.signalTime)!;
      const long = t.side === 'long';
      expect(t.entry).toBe(candles[i].c);
      expect(t.entryTime).toBe(candles[i].t + TF);
      expect(t.breakoutLevel).toBe(long ? hi(i - 20, i - 1) : lo(i - 20, i - 1));
      expect(long ? t.entry > t.breakoutLevel : t.entry < t.breakoutLevel).toBe(true);
      expect(t.stop).toBe(long ? lo(i - 9, i) : hi(i - 9, i));
      expect((Math.abs(t.entry - t.stop) / t.entry) * 100).toBeGreaterThanOrEqual(0.5);
    }
  });

  it('keeps the stop where the last 10 candles put it, never moving it back', () => {
    for (const t of trades) {
      const long = t.side === 'long';
      const j = at.get(t.entryTime)!; // the first candle after entry
      let stop = t.stop;
      for (const move of t.trail) {
        const k = at.get(move.time - TF)!;
        expect(move.stop).toBe(long ? lo(k - 9, k) : hi(k - 9, k));
        expect(long ? move.stop > stop : move.stop < stop).toBe(true);
        stop = move.stop;
      }
      // Replay the stop by hand: no candle before the exit touched it, and the exit candle did.
      let level = t.stop;
      for (let k = j; k < candles.length; k++) {
        const c = candles[k];
        if (c.t + TF > t.exitTime) break;
        const hit = long ? c.l <= level : c.h >= level;
        if (c.t + TF === t.exitTime && t.exitReason !== 'end') {
          expect(hit, `#${t.id} exit candle`).toBe(true);
          expect(t.exitPrice).toBe(long ? Math.min(level, c.o) : Math.max(level, c.o));
        } else {
          expect(hit, `#${t.id} candle ${k}`).toBe(false);
        }
        level = [...t.trail].reverse().find((m) => m.time <= c.t + TF)?.stop ?? t.stop;
      }
    }
  });

  it('is never in two trades at once, and R is the move over the stop distance', () => {
    trades.forEach((t, i) => {
      if (i > 0) expect(t.entryTime).toBeGreaterThanOrEqual(trades[i - 1].exitTime);
      const risk = Math.abs(t.entry - t.stop);
      expect(t.grossR).toBeCloseTo(((t.side === 'long' ? 1 : -1) * (t.exitPrice - t.entry)) / risk, 10);
      expect(t.r).toBeCloseTo(t.grossR - t.feeR, 10);
      expect(t.feeR).toBeCloseTo((0.00045 * (t.entry + t.exitPrice)) / risk, 10);
    });
  });

  it('never looks ahead: cutting the data off changes no trade that closed before the cut', () => {
    for (const k of [300, 900, 1500, 2100]) {
      const cut = candles[k].t + TF;
      const early = runBreakout([{ coin: 'TEST', candles, precision: 2 }], s, { ...w, to: cut }).trades.filter((t) => t.exitReason !== 'end');
      expect(early).toEqual(trades.filter((t) => t.exitTime <= cut));
    }
  });
});

describe('every limit holds on random markets of several coins', () => {
  const coins: CoinCandles[] = [5, 6, 7, 8].map((seed, i) => ({ coin: `C${i}`, candles: walk(1500, seed), precision: 2 }));
  const s: BreakoutSettings = { ...DEFAULTS, tf: '4h', entryLen: 20, exitLen: 10, minStopPct: 0.5, maxOpen: 2, maxPerSide: 1, monthlyStopR: 0 };
  const w: RunWindow = { from: coins[0].candles[250].t, to: coins[0].candles[1499].t + TF };
  const { trades, skipped } = runBreakout(coins, s, w);

  /** Trades open at `time`: entered at or before it and not yet exited. */
  const openAt = (list: readonly Trade[], time: number) => list.filter((t) => t.entryTime <= time && t.exitTime > time);

  it('never has more than 2 trades open, or more than 1 in a direction', () => {
    expect(trades.length).toBeGreaterThan(20);
    expect(Object.keys(skipped)).toContain('too many open');
    for (const t of trades) {
      const open = openAt(trades, t.entryTime);
      expect(open.length).toBeLessThanOrEqual(2);
      expect(open.filter((o) => o.side === 'long').length).toBeLessThanOrEqual(1);
      expect(open.filter((o) => o.side === 'short').length).toBeLessThanOrEqual(1);
    }
  });

  it('with a monthly stop, never starts a trade in a month already down by the limit, and the stop does skip some', () => {
    // A 1R limit: this slow 4h market rarely loses 3R in a month.
    const stopped = runBreakout(coins, { ...s, monthlyStopR: 1 }, w);
    expect(stopped.skipped['monthly stop'] ?? 0).toBeGreaterThan(0);
    expect(stopped.trades.length).toBeLessThan(trades.length);
    const month = (ms: number) => new Date(ms).getUTCFullYear() * 12 + new Date(ms).getUTCMonth();
    for (const t of stopped.trades) {
      const soFar = stopped.trades.filter((x) => x.exitTime <= t.entryTime && month(x.exitTime) === month(t.entryTime));
      expect(soFar.reduce((sum, x) => sum + x.r, 0), `#${t.id}`).toBeGreaterThan(-1);
    }
  });

  it('is numbered in entry order, and never looks ahead', () => {
    expect(trades.map((t) => t.id)).toEqual(trades.map((_, i) => i + 1));
    for (let i = 1; i < trades.length; i++) expect(trades[i].entryTime).toBeGreaterThanOrEqual(trades[i - 1].entryTime);
    for (const k of [600, 900, 1200]) {
      const cut = coins[0].candles[k].t + TF;
      const early = runBreakout(coins, s, { ...w, to: cut }).trades.filter((t) => t.exitReason !== 'end');
      expect(early.map((t) => ({ ...t, id: 0 }))).toEqual(trades.filter((t) => t.exitTime <= cut).map((t) => ({ ...t, id: 0 })));
    }
  });
});

describe('summary', () => {
  const trade = (r: number, day: number, entryDay = day): Trade =>
    ({ id: 0, coin: 'X', r, grossR: r + 0.1, feeR: 0.1, entryTime: Date.UTC(2026, 0, entryDay), exitTime: Date.UTC(2026, 0, day, 12), exitReason: 'trail', precision: 2 }) as Trade;
  const from = Date.UTC(2026, 0, 1);
  const to = Date.UTC(2026, 0, 31);

  it('counts the longest losing streak, the biggest drawdown and the worst day in R', () => {
    const list = [2, -1, -1, 3, -1, -1, -1, 1].map((r, i) => trade(r, i + 2));
    const stats = autoStats(list, from, to);
    expect(stats).toMatchObject({ trades: 8, wins: 3, losses: 5, losingStreak: 3, winRate: 37.5 });
    // Peak +3 after the 4th trade, low point 0 after the 7th.
    expect(stats.maxDrawdownR).toBeCloseTo(3, 10);
    expect(stats.totalR).toBeCloseTo(1, 10);
    expect(stats.worstDayR).toBe(-1);
    expect(stats.equity).toEqual([0, 2, 1, 0, 3, 2, 1, 0, 1]);
    expect(stats.grossR).toBeCloseTo(1.8, 10);
    expect(stats.feeR).toBeCloseTo(0.8, 10);
  });

  it('adds the trades of one UTC day together, and gives trades per 30 days', () => {
    const stats = autoStats([trade(-1, 5), trade(-1.5, 5), trade(2, 6)], from, to);
    expect(stats.worstDayR).toBe(-2.5);
    expect(stats.tradesPerMonth).toBeCloseTo((3 / 30) * 30, 10);
  });

  it('adds up each UTC month by the R of the trades that closed in it, empty months included, and counts the months up', () => {
    const t = (r: number, y: number, m: number, d: number) => ({ ...trade(r, 2), exitTime: Date.UTC(y, m, d, 12) });
    const list = [t(2, 2026, 0, 15), t(-0.5, 2026, 0, 20), t(-2, 2026, 2, 3), t(5, 2026, 5, 1)];
    const months = monthly(list, Date.UTC(2026, 0, 1), Date.UTC(2026, 3, 1));
    expect(months.map((m) => [m.year, m.month, m.r])).toEqual([[2026, 0, 1.5], [2026, 1, 0], [2026, 2, -2]]);
    const stats = autoStats(list, Date.UTC(2026, 0, 1), Date.UTC(2026, 3, 1));
    expect(stats).toMatchObject({ months: 3, monthsUp: 1, worstMonthR: -2 });
  });

  it('splits the total R at the middle of the window by entry time', () => {
    const stats = autoStats([trade(1, 3), trade(2, 10), trade(-4, 20, 20), trade(0.5, 28, 28)], from, to);
    expect(stats).toMatchObject({ firstHalfR: 3, secondHalfR: -3.5 });
  });
});
