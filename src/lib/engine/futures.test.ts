import { describe, expect, it } from 'vitest';
import { FUTURES, fmtSize, futuresFor, snapToTick } from './instruments';
import { defaultPlan, planMetrics } from './rules';
import {
  applyCandle,
  livePnl,
  openTrade,
  riskAt,
  sizePosition,
  tradeResult,
  upgradeTrade,
  type Contract,
  type OpenTrade,
  type TradeParams
} from './trade';
import type { Candle } from './types';

const MIN = 60_000;
const NQ: Contract = { multiplier: 20, commission: 1 };

function candle(high: number, low: number, i = 1): Candle {
  return { t: i * MIN, o: (high + low) / 2, h: high, l: low, c: (high + low) / 2, v: 0 };
}

// Long NQ at 21000 with a 10 point stop: one contract risks 10 x $20 = $200.
function nq(overrides: Partial<TradeParams> = {}): OpenTrade {
  return openTrade({
    side: 'long',
    entry: 21000,
    stop: 20990,
    target: 21010,
    riskUsd: 650,
    feePct: 0.045,
    contract: NQ,
    time: 0,
    ...overrides
  });
}

describe('max contracts', () => {
  it('caps the size, and the risk follows the contracts actually used', () => {
    // $650 at 10 points would be 3 NQ contracts.
    expect(sizePosition(21000, 20990, 650, { ...NQ, maxQty: 2 })).toEqual({ qty: 2, riskUsd: 400 });
  });

  it('does nothing when the size is already under the cap, or the cap is 0', () => {
    expect(sizePosition(21000, 20990, 650, { ...NQ, maxQty: 5 })).toEqual({ qty: 3, riskUsd: 600 });
    expect(sizePosition(21000, 20990, 650, { ...NQ, maxQty: 0 })).toEqual({ qty: 3, riskUsd: 600 });
  });

  it('opens a trade at the capped size', () => {
    const trade = nq({ contract: { ...NQ, maxQty: 1 } });
    expect(trade.riskUsd).toBe(200);
  });
});

describe('sizePosition', () => {
  it('sizes coins fractionally, as before', () => {
    expect(sizePosition(100, 99, 10)).toEqual({ qty: 10, riskUsd: 10 });
  });

  it('rounds contracts down, so the risk never goes above what was asked', () => {
    expect(sizePosition(21000, 20990, 650, NQ)).toEqual({ qty: 3, riskUsd: 600 });
  });

  it('counts a risk that is exactly one contract as one contract', () => {
    expect(sizePosition(21000, 20990, 200, NQ).qty).toBe(1);
    expect(sizePosition(100, 99.7, 0.3 * 20, { multiplier: 20, commission: 0 }).qty).toBe(1);
  });

  it('is zero contracts when one would risk more than asked', () => {
    expect(sizePosition(21000, 20990, 199, NQ)).toEqual({ qty: 0, riskUsd: 0 });
  });
});

describe('a futures trade', () => {
  it('is whole contracts that risk at most what was asked', () => {
    const trade = nq();
    expect(trade.qty).toBe(3);
    expect(trade.riskUsd).toBe(600);
    expect(trade.contracts).toBe(true);
    expect(trade.multiplier).toBe(20);
  });

  it('pays a commission per contract instead of a % fee', () => {
    const trade = nq();
    expect(trade.feeRate).toBe(0);
    expect(trade.fees).toBe(3);
  });

  it('is one piece with a take-profit order, even if scaling out was asked for', () => {
    const trade = nq({ scaleOut: true });
    expect(trade.pieces).toBe(1);
    expect(trade.takeProfit).toBe(true);
  });

  it('loses the risk plus commission at the stop', () => {
    const trade = applyCandle(nq(), candle(21001, 20989), 2 * MIN).trade;
    const result = tradeResult(trade);
    expect(result.gross).toBe(-600);
    expect(result.fees).toBe(6);
    expect(result.r).toBeCloseTo(-606 / 600, 10);
  });

  it('banks points x contracts x point value at the target, less commission', () => {
    const trade = applyCandle(nq(), candle(21011, 20999), 2 * MIN).trade;
    const result = tradeResult(trade);
    expect(trade.closed).toBe(true);
    expect(result.gross).toBe(600);
    expect(result.fees).toBe(6);
    expect(result.r).toBeCloseTo(594 / 600, 10);
  });

  it('marks the open position in dollars, with the commission to close it', () => {
    const live = livePnl(nq(), 21005);
    expect(live.gross).toBe(300);
    expect(live.fees).toBe(6);
    expect(live.net).toBe(294);
    expect(riskAt(nq(), 20990)).toBe(600);
  });

  it('refuses a stop that is too wide for one contract', () => {
    expect(() => nq({ stop: 20900, target: 21100 })).toThrow(/One contract risks \$2000\.00/);
  });

  it('leaves a coin trade alone', () => {
    const trade = openTrade({ side: 'long', entry: 100, stop: 99, target: 103, riskUsd: 10, feePct: 0.1, time: 0 });
    expect(trade.qty).toBe(10);
    expect(trade.multiplier).toBe(1);
    expect(trade.feeFlat).toBe(0);
    expect(trade.contracts).toBe(false);
    expect(trade.fees).toBeCloseTo(1, 10);
  });

  it('upgrades a trade saved before futures to a coin trade', () => {
    const { multiplier, feeFlat, contracts, ...legacy } = nq();
    void multiplier;
    void feeFlat;
    void contracts;
    const upgraded = upgradeTrade(legacy as OpenTrade);
    expect(upgraded.multiplier).toBe(1);
    expect(upgraded.feeFlat).toBe(0);
    expect(upgraded.contracts).toBe(false);
  });
});

describe('planMetrics for futures', () => {
  it('shows contracts, the risk they really carry and the commission in and out', () => {
    const m = planMetrics(21000, 20990, 21010, 650, 0.045, 0.045, NQ);
    expect(m.qty).toBe(3);
    expect(m.riskUsd).toBe(600);
    expect(m.notional).toBe(3 * 21000 * 20);
    expect(m.feesUsd).toBe(6);
    expect(m.feesR).toBeCloseTo(0.01, 10);
  });

  it('shows zero contracts when one is too big', () => {
    const m = planMetrics(21000, 20990, 21010, 100, 0.045, 0.045, NQ);
    expect(m.qty).toBe(0);
    expect(m.riskUsd).toBe(0);
  });
});

describe('scalping stops', () => {
  it('starts a new NQ trade a fixed number of points from entry, with the target at 1R', () => {
    expect(defaultPlan('long', 21000.25, 2, 15)).toEqual({ stop: 20985.25, target: 21015.25 });
    expect(defaultPlan('short', 21000, 2, 12.5)).toEqual({ stop: 21012.5, target: 20987.5 });
  });

  it('snaps prices to the tick', () => {
    expect(snapToTick(21000.1, 0.25)).toBe(21000);
    expect(snapToTick(21000.13, 0.25)).toBe(21000.25);
    expect(snapToTick(2500.04, 0.1)).toBe(2500);
    expect(snapToTick(71.234, 0.01)).toBe(71.23);
  });

  it('has a default stop and one-click sizes for every future', () => {
    for (const future of FUTURES) {
      expect(future.stops).toContain(future.defaultStop);
    }
  });
});

describe('instruments', () => {
  it('knows the Nasdaq contracts, on the Stocks source only', () => {
    expect(futuresFor('stocks', 'NQ')?.pointValue).toBe(20);
    expect(futuresFor('stocks', 'MNQ')?.pointValue).toBe(2);
    expect(futuresFor('binance', 'NQ')).toBeNull();
    expect(futuresFor('stocks', 'QQQ')).toBeNull();
  });

  it('tells micro contracts from full-size ones, for the commission', () => {
    expect(futuresFor('stocks', 'NQ')?.micro).toBe(false);
    expect(futuresFor('stocks', 'MNQ')?.micro).toBe(true);
    expect(futuresFor('stocks', 'MES')?.micro).toBe(true);
    expect(futuresFor('stocks', 'ES')?.micro).toBe(false);
  });

  it('writes sizes as contracts for futures and as units for coins', () => {
    expect(fmtSize(1, 'NQ', true)).toBe('1 contract');
    expect(fmtSize(3, 'NQ', true)).toBe('3 contracts');
    expect(fmtSize(1 / 3, 'SOL', false)).toBe('0.3333 SOL');
  });
});
