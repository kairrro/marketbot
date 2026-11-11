import { describe, expect, it } from 'vitest';
import {
  CHART_AFTER,
  CHART_BEFORE,
  exitsText,
  normalizeSetup,
  setupLabel,
  toCsv,
  toRecord,
  tradeWindow,
  uniqueTrades
} from './journal';
import { defaultPlan, planMetrics, planWarnings, stopTooTight, targetAt } from './rules';
import { computeStats } from './stats';
import { closeAtMarket, moveStop, openTrade, takePartial } from './trade';

const trades = (...rs: number[]) => rs.map((r) => ({ r, pnl: r * 10 }));

describe('computeStats', () => {
  it('is empty-safe', () => {
    const stats = computeStats([]);
    expect(stats).toMatchObject({ trades: 0, winRate: null, avgR: null, profitFactor: null, totalR: 0, netPnl: 0 });
    expect(stats.equity).toEqual([0]);
  });

  it('summarises wins and losses', () => {
    const stats = computeStats(trades(2, -1, -1, 1.5, -1));
    expect(stats.trades).toBe(5);
    expect(stats.wins).toBe(2);
    expect(stats.winRate).toBe(40);
    expect(stats.totalR).toBeCloseTo(0.5, 10);
    expect(stats.avgR).toBeCloseTo(0.1, 10);
    expect(stats.avgWinR).toBeCloseTo(1.75, 10);
    expect(stats.avgLossR).toBeCloseTo(-1, 10);
    expect(stats.profitFactor).toBeCloseTo(35 / 30, 10);
    expect(stats.netPnl).toBeCloseTo(5, 10);
  });

  it('tracks drawdown from the equity peak and the worst losing streak', () => {
    const stats = computeStats(trades(2, -1, -1, 1.5, -1, -1, -1, 3));
    expect(stats.equity).toEqual([0, 2, 1, 0, 1.5, 0.5, -0.5, -1.5, 1.5]);
    expect(stats.maxDrawdownR).toBeCloseTo(3.5, 10);
    expect(stats.worstLosingStreak).toBe(3);
  });

  it('reports an infinite profit factor with no losses', () => {
    expect(computeStats(trades(1, 2)).profitFactor).toBe(Infinity);
  });
});

describe('plan rules', () => {
  it('defaults to a 1% stop and a 1R target', () => {
    expect(defaultPlan('long', 200)).toEqual({ stop: 198, target: 202 });
    expect(defaultPlan('short', 200)).toEqual({ stop: 202, target: 198 });
  });

  it('is exactly 1R on the tick, so the default plan never breaks the 1R rule', () => {
    // 1% of 117.56 is 1.1756: rounding stop and target separately can land a tick off 1R.
    for (const [side, entry, precision] of [
      ['short', 117.56, 2],
      ['long', 117.56, 2],
      ['long', 64123.5, 1],
      ['short', 0.034567, 6],
      ['long', 3.2177, 4]
    ] as const) {
      const plan = defaultPlan(side, entry, precision);
      const metrics = planMetrics(entry, plan.stop, plan.target, 5);
      expect(metrics.rr).toBeCloseTo(1, 6);
      expect(planWarnings(metrics, 0.5)).toEqual([]);
      // Both prices sit on the market's tick.
      expect(Number(plan.stop.toFixed(precision))).toBe(plan.stop);
      expect(Number(plan.target.toFixed(precision))).toBe(plan.target);
    }
    expect(defaultPlan('short', 117.56, 2)).toEqual({ stop: 118.74, target: 116.38 });
  });

  it('puts a target any number of R away', () => {
    expect(targetAt('long', 100, 99)).toBe(101);
    expect(targetAt('short', 100, 101, 3)).toBe(97);
    expect(targetAt('long', 117.56, 116.38, 2, 2)).toBe(119.92);
  });

  it('sizes the position from the $ risk', () => {
    const metrics = planMetrics(200, 198, 204, 5);
    expect(metrics).toMatchObject({ dist: 2, stopPct: 1, rr: 2, qty: 2.5, notional: 500, feesUsd: 0 });
  });

  it('expresses round-trip fees in $ and R', () => {
    // $500 notional × 0.05% × 2 sides = $0.50, on $5 risk.
    const metrics = planMetrics(200, 198, 204, 5, 0.05);
    expect(metrics.feesUsd).toBeCloseTo(0.5, 10);
    expect(metrics.feesR).toBeCloseTo(0.1, 10);
    // Half the stop distance doubles the size, and so the fees in R.
    expect(planMetrics(200, 199, 202, 5, 0.05).feesR).toBeCloseTo(0.2, 10);
  });

  it('passes the default plan', () => {
    const { stop, target } = defaultPlan('long', 151.37);
    expect(planWarnings(planMetrics(151.37, stop, target, 5), 0.5)).toEqual([]);
  });

  it('warns about a stop under the minimum, and has no rule on the target R', () => {
    const warnings = planWarnings(planMetrics(200, 199.4, 200.9, 5), 0.5);
    expect(warnings.map((w) => w.code)).toEqual(['min-stop']);
    expect(warnings[0].message).toContain('0.30%');
    expect(planWarnings(planMetrics(200, 198, 201, 5), 0.5)).toEqual([]);
    expect(planWarnings(planMetrics(200, 198, 206, 5), 0.5)).toEqual([]);
  });

  it('only calls a stop too tight below the minimum at display precision', () => {
    expect(stopTooTight(0.499, 0.5)).toBe(false);
    expect(stopTooTight(0.494, 0.5)).toBe(true);
    expect(stopTooTight(0.5, 0.5)).toBe(false);
  });
});

describe('journal records', () => {
  const meta = { id: 't1', coin: 'SOL', tf: '5m', source: 'hyperliquid', precision: 2, brokeRules: false } as const;
  const open = openTrade({ side: 'long', entry: 100, stop: 99, target: 102, riskUsd: 10, feePct: 0, time: 1000 });
  const closed = closeAtMarket(takePartial(open, 1, 101, 1500).trade, 102, 2000).trade;
  const record = toRecord(closed, meta);

  it('captures the result of a closed trade', () => {
    expect(record).toMatchObject({ coin: 'SOL', side: 'long', entry: 100, stop: 99, target: 102, exitTime: 2000 });
    expect(record.r).toBeCloseTo(5 / 3, 10);
    expect(exitsText(record.exits, record.precision)).toBe('Partial 1/3 @ 101.00, Manual @ 102.00');
  });

  it('leaves the setup empty and only suggests the rest', () => {
    expect(record).toMatchObject({ setup: null, followedRules: null, tags: [] });
    const sloppy = toRecord(closeAtMarket(moveStop(open, 98.5), 100.5, 2000).trade, { ...meta, brokeRules: true });
    expect(sloppy).toMatchObject({ followedRules: false, tags: ['moved stop'], stop: 99 });
  });

  it('keeps only the first copy of a trade journaled twice', () => {
    const copy = { ...record, notes: 'second copy' };
    const other = { ...record, id: 't2' };
    expect(uniqueTrades([record, copy, other])).toEqual([record, other]);
  });

  it('still prints exits recorded before partials were manual', () => {
    const legacy = [
      { kind: 'TP1', price: 101, pieces: 1, time: 1 },
      { kind: 'BE', price: 100, pieces: 2, time: 2 }
    ] as const;
    expect(exitsText(legacy, 1)).toBe('TP1 @ 101.0, BE @ 100.0');
  });

  it('exports CSV with quoted fields', () => {
    const csv = toCsv([{ ...record, setup: 'bounce', notes: 'clean sweep, "textbook"' }, record]);
    const [head, row, bare] = csv.split('\n');
    expect(head.startsWith('#,coin,tf,setup,side')).toBe(true);
    expect(row).toContain('1,SOL,5m,Bounce,long');
    expect(row).toContain('"Partial 1/3 @ 101.00, Manual @ 102.00"');
    expect(row).toContain('"clean sweep, ""textbook"""');
    // No setup journaled: the column is simply empty.
    expect(bare).toContain('2,SOL,5m,,long');
  });
});

describe('tradeWindow', () => {
  const M5 = 300_000;
  const T0 = Date.UTC(2025, 0, 6);
  // 200 5m candles; the trade is seen at the close of candle 100 and exits at the close of candle 110.
  const candles = Array.from({ length: 200 }, (_, i) => ({ t: T0 + i * M5, o: i, h: i + 1, l: i - 1, c: i, v: 1 }));
  const trade = { entryTime: T0 + 101 * M5, exitTime: T0 + 111 * M5 };

  it('shows context before the entry, the trade, and nothing past the replay clock', () => {
    const shown = tradeWindow(candles, M5, trade, trade.exitTime)!;
    expect(shown[0].t).toBe(T0 + (100 - CHART_BEFORE) * M5);
    expect(shown.at(-1)!.t).toBe(T0 + 110 * M5);
  });

  it('adds what came after the exit once the replay has been past it, up to a limit', () => {
    expect(tradeWindow(candles, M5, trade, T0 + 116 * M5)!.at(-1)!.t).toBe(T0 + 115 * M5);
    expect(tradeWindow(candles, M5, trade, T0 + 199 * M5)!.at(-1)!.t).toBe(T0 + (110 + CHART_AFTER) * M5);
  });

  it('is null when the candles are from another stretch of time', () => {
    expect(tradeWindow(candles.slice(0, 50), M5, trade, trade.exitTime)).toBeNull();
    expect(tradeWindow(candles.slice(150), M5, trade, trade.exitTime)).toBeNull();
  });
});

describe('setups', () => {
  it('maps the old strategy ids onto the three setups', () => {
    expect(normalizeSetup('A')).toBe('sweep');
    expect(normalizeSetup('B')).toBe('breakout');
    expect(normalizeSetup('SR')).toBe('bounce');
  });

  it('keeps current ids and treats anything else as not set', () => {
    expect(normalizeSetup('breakout')).toBe('breakout');
    expect(normalizeSetup('nope')).toBeNull();
    expect(normalizeSetup(undefined)).toBeNull();
    expect(setupLabel(null)).toBe('');
    expect(setupLabel('sweep')).toBe('Sweep');
  });
});
