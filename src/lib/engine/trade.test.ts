import { describe, expect, it } from 'vitest';
import {
  applyCandle,
  closeAtMarket,
  fillLimit,
  isValidStop,
  isValidTarget,
  limitReached,
  livePnl,
  moveStop,
  moveTarget,
  openTrade,
  priceR,
  riskAt,
  takePartial,
  tradeResult,
  upgradeTrade,
  widensRisk,
  type LimitOrder,
  type OpenTrade,
  type TradeParams
} from './trade';
import type { Candle } from './types';

const MIN = 60_000;

/** A candle that only matters for its high and low. */
function candle(high: number, low: number, i = 1): Candle {
  return { t: i * MIN, o: (high + low) / 2, h: high, l: low, c: (high + low) / 2, v: 0 };
}

// Entry 100, stop 99 (1R = 1.00), target 103 (3R). $10 risk -> 10 units.
function long(overrides: Partial<TradeParams> = {}): OpenTrade {
  return openTrade({
    side: 'long',
    entry: 100,
    stop: 99,
    target: 103,
    riskUsd: 10,
    feePct: 0,
    time: 0,
    ...overrides
  });
}

/** Runs candles through a trade in order and returns the final trade. */
function run(trade: OpenTrade, candles: Candle[]): OpenTrade {
  return candles.reduce((t, c, i) => applyCandle(t, c, (i + 2) * MIN).trade, trade);
}

const kinds = (trade: OpenTrade) => trade.fills.map((f) => f.kind);

/** Reflects a price around `entry`: what a long sees going up, the short sees going down. */
const mirror = (price: number, entry = 100) => 2 * entry - price;
const mirrorCandle = (c: Candle): Candle => ({ ...c, o: mirror(c.o), h: mirror(c.l), l: mirror(c.h), c: mirror(c.c) });

describe('openTrade', () => {
  it('sizes the position so a full stop-out loses exactly the risk', () => {
    const trade = long();
    expect(trade.qty).toBe(10);
    expect(trade.dist).toBe(1);
    expect(trade.oneR).toBe(101);
    expect(trade.piecesLeft).toBe(3);
  });

  it('rejects a stop or target on the wrong side of entry', () => {
    expect(() => long({ stop: 101 })).toThrow(/below entry/);
    expect(() => long({ target: 99.5 })).toThrow(/above entry/);
    expect(() => long({ side: 'short' })).toThrow(/above entry/);
    expect(() => long({ riskUsd: 0 })).toThrow(/Risk/);
  });
});

describe('stop', () => {
  it('hits first when the stop and the target are inside the same candle', () => {
    // This candle trades through +1R, the target AND the stop.
    const { trade, fills, reached1R, reachedTarget } = applyCandle(long(), candle(103.5, 98.5), MIN);
    expect(trade.closed).toBe(true);
    expect(fills).toHaveLength(1);
    expect(fills[0]).toMatchObject({ kind: 'Stop', price: 99, pieces: 3 });
    // Nothing good is credited from a candle that stopped the trade out.
    expect({ reached1R, reachedTarget }).toEqual({ reached1R: false, reachedTarget: false });
    expect(tradeResult(trade).r).toBeCloseTo(-1, 10);
  });

  it('is a full -1R loss when nothing else filled', () => {
    const trade = run(long(), [candle(100.5, 99.6), candle(100.2, 98)]);
    expect(kinds(trade)).toEqual(['Stop']);
    expect(tradeResult(trade).pnl).toBeCloseTo(-10, 10);
    expect(trade.exitTime).toBe(3 * MIN);
  });

  it('fills when price only touches it', () => {
    expect(applyCandle(long(), candle(100.4, 99), MIN).trade.closed).toBe(true);
  });

  it('only closes the pieces that are still open', () => {
    const partial = takePartial(long(), 1, 101, MIN).trade;
    const { trade, fills } = applyCandle(partial, candle(100.5, 98.9), 2 * MIN);
    expect(fills[0]).toMatchObject({ kind: 'Stop', pieces: 2 });
    // +1R banked on a third, -1R on the other two thirds.
    expect(tradeResult(trade).r).toBeCloseTo(1 / 3 - 2 / 3, 10);
  });
});

describe('profit is never taken automatically', () => {
  it('leaves the whole position open at +1R', () => {
    const { trade, fills, reached1R } = applyCandle(long(), candle(101.2, 100.2), MIN);
    expect(fills).toEqual([]);
    expect(trade.piecesLeft).toBe(3);
    expect(trade.closed).toBe(false);
    // ...but it does say that +1R was touched.
    expect(reached1R).toBe(true);
    expect(trade.reached1R).toBe(true);
  });

  it('leaves the whole position open at the target', () => {
    const { trade, fills, reachedTarget } = applyCandle(long(), candle(103.4, 100.2), MIN);
    expect(fills).toEqual([]);
    expect(trade.piecesLeft).toBe(3);
    expect(trade.realized).toBe(0);
    expect(reachedTarget).toBe(true);
  });

  it('reports +1R and the target once each, on first touch', () => {
    const first = applyCandle(long(), candle(101.2, 100.2), MIN);
    const again = applyCandle(first.trade, candle(101.6, 100.9), 2 * MIN);
    expect(again.reached1R).toBe(false);
    expect(again.trade.reached1R).toBe(true);

    const hit = applyCandle(again.trade, candle(103.1, 101), 3 * MIN);
    expect(hit.reachedTarget).toBe(true);
    expect(applyCandle(hit.trade, candle(103.5, 102), 4 * MIN).reachedTarget).toBe(false);
  });

  it('can turn a winner into a full loss if nothing is done', () => {
    // Up through the target, then all the way back down to the original stop.
    const trade = run(long(), [candle(103.4, 100.2), candle(102, 98.9)]);
    expect(kinds(trade)).toEqual(['Stop']);
    expect(tradeResult(trade).r).toBeCloseTo(-1, 10);
  });
});

describe('taking partials by hand', () => {
  it('closes one third at the given price', () => {
    const { trade, fills } = takePartial(long(), 1, 101, MIN);
    expect(fills).toHaveLength(1);
    expect(fills[0]).toMatchObject({ kind: 'Partial', price: 101, pieces: 1, time: MIN });
    expect(fills[0].qty).toBeCloseTo(10 / 3, 10);
    expect(fills[0].pnl).toBeCloseTo(10 / 3, 10);
    expect(trade.piecesLeft).toBe(2);
    expect(trade.closed).toBe(false);
  });

  it('follows the plan when the trader takes a third at +1R, a third at the target, and runs the rest', () => {
    let trade = run(long(), [candle(101.2, 100.2)]);
    trade = takePartial(trade, 1, 101, 2 * MIN).trade;
    trade = run(trade, [candle(103.2, 101)]);
    trade = takePartial(trade, 1, 103, 4 * MIN).trade;
    expect(trade.piecesLeft).toBe(1);
    // The stop stays where it was until the trader moves it.
    expect(trade.stop).toBe(99);

    const done = closeAtMarket(trade, 106, 9 * MIN).trade;
    expect(kinds(done)).toEqual(['Partial', 'Partial', 'Manual']);
    expect(done.exitTime).toBe(9 * MIN);
    // 1R, 3R and 6R on a third each.
    expect(tradeResult(done).r).toBeCloseTo((1 + 3 + 6) / 3, 10);
  });

  it('can take a partial at a loss', () => {
    const { trade } = takePartial(long(), 1, 99.4, MIN);
    expect(tradeResult(trade).r).toBeCloseTo(-0.6 / 3, 10);
    expect(trade.piecesLeft).toBe(2);
  });

  it('closes two thirds at once', () => {
    const { trade, fills } = takePartial(long(), 2, 102, MIN);
    expect(fills[0]).toMatchObject({ kind: 'Partial', pieces: 2 });
    expect(trade.piecesLeft).toBe(1);
  });

  it('ends the trade when the last piece is taken', () => {
    const one = takePartial(takePartial(long(), 1, 101, MIN).trade, 1, 102, 2 * MIN).trade;
    const { trade, fills } = takePartial(one, 1, 103, 3 * MIN);
    expect(fills[0].kind).toBe('Manual');
    expect(trade.closed).toBe(true);
    expect(trade.piecesLeft).toBe(0);
    expect(tradeResult(trade).r).toBeCloseTo((1 + 2 + 3) / 3, 10);
  });

  it('never closes more than is open', () => {
    const { trade, fills } = takePartial(long(), 7, 101, MIN);
    expect(fills[0]).toMatchObject({ kind: 'Manual', pieces: 3 });
    expect(trade.closed).toBe(true);
  });
});

describe('take profit at the target (no partials)', () => {
  const tp = (overrides: Partial<TradeParams> = {}) => long({ scaleOut: false, ...overrides });

  it('is one piece with the target as an order', () => {
    const trade = tp();
    expect(trade.pieces).toBe(1);
    expect(trade.piecesLeft).toBe(1);
    expect(trade.takeProfit).toBe(true);
    expect(trade.qty).toBe(10);
  });

  it('scales out in thirds by default', () => {
    expect(long()).toMatchObject({ pieces: 3, takeProfit: false });
  });

  it('closes the whole position at the target price when touched', () => {
    const { trade, fills, reachedTarget } = applyCandle(tp(), candle(103.4, 100.2), MIN);
    expect(fills).toHaveLength(1);
    expect(fills[0]).toMatchObject({ kind: 'TP', price: 103, pieces: 1, qty: 10, time: MIN });
    expect(reachedTarget).toBe(true);
    expect(trade.closed).toBe(true);
    expect(trade.exitTime).toBe(MIN);
    expect(tradeResult(trade).r).toBeCloseTo(3, 10);
  });

  it('does nothing at +1R', () => {
    const { trade, fills, reached1R } = applyCandle(tp(), candle(101.5, 100.2), MIN);
    expect(fills).toEqual([]);
    expect(reached1R).toBe(true);
    expect(trade.closed).toBe(false);
  });

  it('still lets the stop win when both are inside one candle', () => {
    const { trade } = applyCandle(tp(), candle(103.5, 98.5), MIN);
    expect(kinds(trade)).toEqual(['Stop']);
    expect(tradeResult(trade).r).toBeCloseTo(-1, 10);
  });

  it('fills at a moved target', () => {
    const moved = moveTarget(tp(), 101.5);
    const { trade } = applyCandle(moved, candle(101.6, 100.4), MIN);
    expect(trade.fills[0]).toMatchObject({ kind: 'TP', price: 101.5 });
    expect(tradeResult(trade).r).toBeCloseTo(1.5, 10);
  });

  it('can still be closed early by hand', () => {
    const { trade, fills } = closeAtMarket(tp(), 101.2, MIN);
    expect(fills[0]).toMatchObject({ kind: 'Manual', pieces: 1 });
    expect(tradeResult(trade).r).toBeCloseTo(1.2, 10);
  });

  it('takes profit on a short when price falls to the target', () => {
    const short = tp({ side: 'short', stop: 101, target: 97 });
    const { trade } = applyCandle(short, candle(99.8, 96.9), MIN);
    expect(trade.fills[0]).toMatchObject({ kind: 'TP', price: 97 });
    expect(tradeResult(trade).r).toBeCloseTo(3, 10);
  });

  it('charges the exit fee on the take-profit fill', () => {
    const { trade, fills } = applyCandle(tp({ feePct: 0.1 }), candle(103.1, 100.2), MIN);
    expect(fills[0].fee).toBeCloseTo(10 * 103 * 0.001, 10);
    expect(tradeResult(trade).pnl).toBeCloseTo(30 - 1 - 1.03, 10);
  });

  it('charges the maker fee on the take-profit fill and the taker fee on a stop', () => {
    const maker = () => tp({ feePct: 0.1, makerFeePct: 0.02 });
    expect(applyCandle(maker(), candle(103.1, 100.2), MIN).fills[0].fee).toBeCloseTo(10 * 103 * 0.0002, 10);
    expect(applyCandle(maker(), candle(100.5, 98.9), MIN).fills[0].fee).toBeCloseTo(10 * 99 * 0.001, 10);
  });

  it('marks open P&L on the whole position', () => {
    expect(livePnl(tp(), 101.5).netR).toBeCloseTo(1.5, 10);
  });

  it('treats an open trade saved before this existed as scaling out', () => {
    const old: Partial<OpenTrade> = long();
    delete old.pieces;
    delete old.takeProfit;
    const trade = upgradeTrade(old as OpenTrade);
    expect(trade).toMatchObject({ pieces: 3, takeProfit: false });
    expect(applyCandle(trade, candle(103.4, 100.2), MIN).fills).toEqual([]);
  });
});

describe('breakeven is up to the trader', () => {
  it('never moves the stop by itself, however far price runs', () => {
    const trade = run(long(), [candle(101.5, 100.5), candle(102.5, 101), candle(104, 102)]);
    expect(trade.stop).toBe(99);
    expect(trade.stopMoved).toBe(false);
  });

  it('exits at entry once the trader has moved the stop there, labelled BE', () => {
    const atOneR = run(long(), [candle(101.2, 100.5)]);
    const banked = moveStop(takePartial(atOneR, 1, 101, 3 * MIN).trade, 100);
    const trade = run(banked, [candle(100.8, 99.9)]);
    expect(kinds(trade)).toEqual(['Partial', 'BE']);
    expect(trade.fills[1]).toMatchObject({ price: 100, pieces: 2 });
    // Only the partial made money.
    expect(tradeResult(trade).r).toBeCloseTo(1 / 3, 10);
  });
});

describe('fees', () => {
  // 0.1% per side keeps the numbers easy to check by hand.
  const withFees = () => long({ feePct: 0.1 });

  it('charges the entry straight away', () => {
    const trade = withFees();
    expect(trade.fees).toBeCloseTo(10 * 100 * 0.001, 10);
  });

  it('marks live P&L as if closed now, exit fee included', () => {
    // Entry fee $1.00, exit fee at 101: 10 × 101 × 0.1% = $1.01.
    const live = livePnl(withFees(), 101);
    expect(live.gross).toBeCloseTo(10, 10);
    expect(live.fees).toBeCloseTo(2.01, 10);
    expect(live.net).toBeCloseTo(7.99, 10);
    expect(live.grossR).toBeCloseTo(1, 10);
    expect(live.netR).toBeCloseTo(0.799, 10);
    expect(live.feesR).toBeCloseTo(0.201, 10);
    // A flat market is already a loss of both fees.
    expect(livePnl(withFees(), 100).netR).toBeCloseTo(-0.2, 10);
  });

  it('agrees with the journal once the trade is closed at that price', () => {
    const open = takePartial(withFees(), 1, 101, MIN).trade;
    const closed = closeAtMarket(open, 102, 2 * MIN).trade;
    expect(livePnl(open, 102).net).toBeCloseTo(tradeResult(closed).pnl, 10);
  });

  it('only charges the exit fee on what is still open', () => {
    const open = takePartial(withFees(), 2, 101, MIN).trade;
    const paid = open.fees;
    expect(livePnl(open, 101).fees).toBeCloseTo(paid + (10 / 3) * 101 * 0.001, 10);
  });

  it('charges every partial on its own notional', () => {
    const piece = 10 / 3;
    const first = takePartial(withFees(), 1, 101, MIN);
    const second = takePartial(first.trade, 2, 102, 2 * MIN);
    expect(first.fills[0].fee).toBeCloseTo(piece * 101 * 0.001, 10);
    expect(second.fills[0].fee).toBeCloseTo(2 * piece * 102 * 0.001, 10);

    const fees = 1 + piece * 101 * 0.001 + 2 * piece * 102 * 0.001;
    const gross = piece * 1 + 2 * piece * 2;
    const result = tradeResult(second.trade);
    expect(result.fees).toBeCloseTo(fees, 10);
    expect(result.gross).toBeCloseTo(gross, 10);
    expect(result.pnl).toBeCloseTo(gross - fees, 10);
  });

  it('R is net P&L after fees divided by the $ risk', () => {
    const { trade } = closeAtMarket(withFees(), 102, MIN);
    const result = tradeResult(trade);
    expect(result.r).toBeCloseTo(result.pnl / 10, 10);
    expect(result.r).toBeLessThan(2);
  });

  it('makes a stop-out worse than -1R', () => {
    const { trade } = applyCandle(withFees(), candle(100.2, 98.5), MIN);
    // -$10 gross, $1 entry fee, $0.99 exit fee.
    expect(tradeResult(trade).pnl).toBeCloseTo(-10 - 1 - 0.99, 10);
    expect(tradeResult(trade).r).toBeCloseTo(-1.199, 10);
  });

  it('charges the full close too', () => {
    const { trade, fills } = closeAtMarket(withFees(), 100.5, MIN);
    expect(fills[0].fee).toBeCloseTo(10 * 100.5 * 0.001, 10);
    expect(tradeResult(trade).pnl).toBeCloseTo(5 - 1 - 1.005, 10);
  });
});

describe('shorts mirror longs', () => {
  const short = (overrides: Partial<TradeParams> = {}) =>
    long({ side: 'short', stop: mirror(99), target: mirror(103), ...overrides });

  // Each path is candles interleaved with hand-taken partials (as [pieces, price]).
  type Step = Candle | [pieces: number, price: number];
  const paths: Record<string, Step[]> = {
    'stop first': [candle(103.5, 98.5)],
    'straight stop-out': [candle(100.5, 99.6), candle(100.2, 98)],
    'partial at +1R then stopped': [candle(101.2, 100.2), [1, 101], candle(100.5, 98.9)],
    'thirds at 1R and target, then stopped': [candle(101.3, 100.1), [1, 101], candle(103.2, 101), [1, 103], candle(102, 98.8)],
    'no profit taken, back to the stop': [candle(103.4, 100.2), candle(102, 98.9)],
    'closed by hand in profit': [candle(101.8, 100.4), [3, 101.5]]
  };

  function play(trade: OpenTrade, steps: Step[], flip: boolean): OpenTrade {
    return steps.reduce((t, step, i) => {
      const time = (i + 1) * MIN;
      if (Array.isArray(step)) return takePartial(t, step[0], flip ? mirror(step[1]) : step[1], time).trade;
      return applyCandle(t, flip ? mirrorCandle(step) : step, time).trade;
    }, trade);
  }

  for (const [name, steps] of Object.entries(paths)) {
    it(name, () => {
      const longTrade = play(long(), steps, false);
      const shortTrade = play(short(), steps, true);

      expect(kinds(shortTrade)).toEqual(kinds(longTrade));
      expect(shortTrade.fills.map((f) => f.pieces)).toEqual(longTrade.fills.map((f) => f.pieces));
      expect(shortTrade.fills.map((f) => f.price)).toEqual(longTrade.fills.map((f) => mirror(f.price)));
      expect(shortTrade.closed).toBe(longTrade.closed);
      expect(shortTrade.piecesLeft).toBe(longTrade.piecesLeft);
      expect(shortTrade.stop).toBe(mirror(longTrade.stop));
      expect(shortTrade.reached1R).toBe(longTrade.reached1R);
      expect(shortTrade.reachedTarget).toBe(longTrade.reachedTarget);
      expect(tradeResult(shortTrade).r).toBeCloseTo(tradeResult(longTrade).r, 10);
    });
  }

  it('has mirrored levels', () => {
    const trade = short();
    expect(trade.dir).toBe(-1);
    expect(trade.oneR).toBe(99);
    expect(trade.qty).toBe(10);
  });

  it('stops out when price trades UP through the stop', () => {
    const { trade } = applyCandle(short(), candle(101.4, 99.5), MIN);
    expect(kinds(trade)).toEqual(['Stop']);
    expect(tradeResult(trade).r).toBeCloseTo(-1, 10);
  });

  it('pays fees on the lower exit prices', () => {
    const trade = takePartial(takePartial(short({ feePct: 0.1 }), 1, 99, MIN).trade, 2, 98, 2 * MIN).trade;
    const piece = 10 / 3;
    expect(tradeResult(trade).fees).toBeCloseTo(1 + piece * 99 * 0.001 + 2 * piece * 98 * 0.001, 10);
  });
});

describe('managing an open trade', () => {
  it('closes everything at market', () => {
    const { trade, fills } = closeAtMarket(long(), 100.5, 5 * MIN);
    expect(fills[0]).toMatchObject({ kind: 'Manual', price: 100.5, pieces: 3 });
    expect(trade.closed).toBe(true);
    expect(tradeResult(trade).r).toBeCloseTo(0.5, 10);
  });

  it('moves the stop without changing where 1R is', () => {
    const trade = moveStop(long(), 99.5);
    expect(trade.stop).toBe(99.5);
    expect(trade.stopMoved).toBe(true);
    expect(trade.initialStop).toBe(99);
    expect(trade.oneR).toBe(101);
    // Stopped at the tighter stop: half the planned loss.
    expect(tradeResult(applyCandle(trade, candle(100.2, 99.4), MIN).trade).r).toBeCloseTo(-0.5, 10);
  });

  it('knows when a stop move widens risk', () => {
    expect(widensRisk('long', 99, 98.5)).toBe(true);
    expect(widensRisk('long', 99, 99.5)).toBe(false);
    expect(widensRisk('short', 101, 101.5)).toBe(true);
    expect(widensRisk('short', 101, 100.5)).toBe(false);
  });

  it('only accepts a stop on the losing side of the last price', () => {
    expect(isValidStop(long(), 100.4, 100.5)).toBe(true);
    expect(isValidStop(long(), 100.6, 100.5)).toBe(false);
    const short = long({ side: 'short', stop: 101, target: 98 });
    expect(isValidStop(short, 99.6, 99.5)).toBe(true);
    expect(isValidStop(short, 99.4, 99.5)).toBe(false);
  });

  it('only accepts a target on the winning side of entry', () => {
    expect(isValidTarget(long(), 103)).toBe(true);
    expect(isValidTarget(long(), 99.5)).toBe(false);
  });

  it('moving the target re-arms the "target reached" report', () => {
    const hit = applyCandle(long(), candle(103.2, 100.2), MIN).trade;
    expect(hit.reachedTarget).toBe(true);
    const moved = moveTarget(hit, 105);
    expect(moved.target).toBe(105);
    expect(moved.reachedTarget).toBe(false);
    expect(applyCandle(moved, candle(105.1, 103), 2 * MIN).reachedTarget).toBe(true);
  });

  it('leaves a closed trade alone', () => {
    const closed = closeAtMarket(long(), 100.5, MIN).trade;
    expect(applyCandle(closed, candle(110, 90), 2 * MIN).trade).toBe(closed);
    expect(closeAtMarket(closed, 105, 2 * MIN).trade).toBe(closed);
    expect(takePartial(closed, 1, 105, 2 * MIN).trade).toBe(closed);
    expect(moveStop(closed, 99.9)).toBe(closed);
  });

  it('does not mutate the trade it is given', () => {
    const trade = long();
    const before = JSON.stringify(trade);
    applyCandle(trade, candle(103.5, 100.1), MIN);
    takePartial(trade, 1, 101, MIN);
    closeAtMarket(trade, 101, MIN);
    moveStop(trade, 99.5);
    moveTarget(trade, 104);
    expect(JSON.stringify(trade)).toBe(before);
  });

  it('reports live R from banked and open pieces', () => {
    const trade = takePartial(long(), 1, 101, MIN).trade;
    // 1R banked on one third, two thirds open at +0.5R.
    expect(livePnl(trade, 100.5).netR).toBeCloseTo(1 / 3 + (2 / 3) * 0.5, 10);
  });

  it('reports the $ at risk at a stop, on what is still open', () => {
    expect(riskAt(long(), 99)).toBeCloseTo(10, 10);
    expect(riskAt(long(), 99.5)).toBeCloseTo(5, 10);
    // Past entry the stop locks in profit.
    expect(riskAt(long(), 100.5)).toBeCloseTo(-5, 10);
    expect(riskAt(takePartial(long(), 1, 101, MIN).trade, 99)).toBeCloseTo(20 / 3, 10);
    expect(riskAt(long({ side: 'short', stop: 101, target: 97 }), 100.5)).toBeCloseTo(5, 10);
  });

  it('expresses a price in R', () => {
    expect(priceR(long(), 101.5)).toBeCloseTo(1.5, 10);
    expect(priceR(long({ side: 'short', stop: 101, target: 97 }), 98)).toBeCloseTo(2, 10);
  });
});

describe('entry fees', () => {
  it('charges the entry its own fee, and the taker fee on the way out', () => {
    // 10 units at 100: $1000 in. 0.015% maker in = $0.15; 0.045% taker out at 99 = $0.4455.
    const trade = long({ feePct: 0.045, makerFeePct: 0.015, entryFeePct: 0.015 });
    expect(trade.fees).toBeCloseTo(0.15, 10);
    const stopped = applyCandle(trade, candle(100, 98.5), MIN).trade;
    expect(tradeResult(stopped).fees).toBeCloseTo(0.15 + 0.4455, 10);
  });

  it('charges a market entry the taker fee when no entry fee is given', () => {
    expect(long({ feePct: 0.045 }).fees).toBeCloseTo(0.45, 10);
  });
});

describe('fillLimit', () => {
  // Buy limit at 100, stop 99, target 103.
  const order = (overrides: Partial<LimitOrder> = {}): LimitOrder => ({
    side: 'long',
    entry: 100,
    stop: 99,
    target: 103,
    riskUsd: 10,
    feePct: 0.045,
    makerFeePct: 0.015,
    entryFeePct: 0.015,
    placedAt: 0,
    ...overrides
  });
  const bar = (o: number, h: number, l: number, c: number): Candle => ({ t: MIN, o, h, l, c, v: 0 });

  it('waits until a candle trades down to a buy limit (or up to a sell limit)', () => {
    expect(fillLimit(order(), bar(101, 102, 100.01, 101), MIN, 2 * MIN)).toBeNull();
    expect(limitReached('long', 100, bar(101, 102, 100, 101))).toBe(true);
    const sell = order({ side: 'short', entry: 100, stop: 101, target: 97 });
    expect(fillLimit(sell, bar(99, 99.99, 98, 99), MIN, 2 * MIN)).toBeNull();
    expect(fillLimit(sell, bar(99, 100, 98, 99), MIN, 2 * MIN)?.trade.entry).toBe(100);
  });

  it('fills at the limit price, with the maker fee, at the time given', () => {
    const result = fillLimit(order(), bar(101, 101.5, 99.5, 100.5), MIN, 2 * MIN)!;
    expect(result.trade.entry).toBe(100);
    expect(result.trade.entryTime).toBe(MIN);
    expect(result.trade.qty).toBeCloseTo(10, 10);
    expect(result.trade.fees).toBeCloseTo(0.15, 10);
    expect(result.trade.closed).toBe(false);
    expect(result.fills).toEqual([]);
  });

  it('assumes the worst inside the fill candle: the stop can fill, the target cannot', () => {
    const stopped = fillLimit(order(), bar(101, 101, 98.5, 99.5), MIN, 2 * MIN)!;
    expect(stopped.trade.closed).toBe(true);
    expect(stopped.fills.map((f) => [f.kind, f.price, f.time])).toEqual([['Stop', 99, 2 * MIN]]);
    expect(tradeResult(stopped.trade).r).toBeCloseTo(-1 - (0.15 + 0.4455) / 10, 10);

    const tp = order({ scaleOut: false });
    const wide = fillLimit(tp, bar(101, 104, 99.5, 103.5), MIN, 2 * MIN)!;
    expect(wide.trade.closed).toBe(false);
    expect(wide.trade.reached1R).toBe(false);
    expect(wide.trade.reachedTarget).toBe(false);
    // From the next candle on it is an ordinary trade.
    expect(applyCandle(wide.trade, bar(103, 104, 102, 103), 3 * MIN).fills.map((f) => f.kind)).toEqual(['TP']);
  });
});
