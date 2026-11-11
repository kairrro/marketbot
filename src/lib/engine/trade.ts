// The exit engine. Pure functions over plain data: every call returns a new
// trade and never touches the one it was given, so it is trivial to test and
// safe to hold in UI state.
//
// Rules:
//   - A trade either scales out or takes profit at its target:
//       scaling out: the stop is the only exit that fills by itself. Profits
//         are taken by hand, a third of the position at a time (or all of
//         it), at market.
//       take profit: the target is an order too. Touching it closes the
//         whole position at the target price.
//     Either way, everything left can be closed by hand at any time.
//   - The stop only moves when the trader moves it. Nothing is moved to
//     breakeven automatically.
//   - Conservative fills: if the stop is inside a candle, it is assumed to hit
//     before anything else in that candle.
//   - A fee is charged on every fill, entry included: the maker fee on limit
//     orders (a limit entry, the take-profit order), the taker fee on
//     everything else (a market entry, the stop, closing by hand).
//   - A limit entry rests until a candle trades at its price, then fills at
//     exactly that price. In that candle only the stop can fill as well.
//   - R = net P&L after fees / $ risk.
//
// +1R is a reference price, and so is the target when scaling out: the engine
// reports the first time each is touched, and does nothing else with them.
//
// "1R" is always the distance from entry to the INITIAL stop. Moving the stop
// later does not change where +1R is.
//
// Futures: a trade can be sized in whole contracts (rounded down, so the risk is
// never above what was asked). A contract gains or loses `multiplier` $ per
// 1.00 of price, a flat commission is charged on every fill instead of a % fee,
// and the position is one piece: a contract cannot be split in thirds.

import type { Candle, Side } from './types';

/** A trade that scales out can be closed in this many equal pieces. */
export const PIECES = 3;

/** A futures contract, for sizing and fees. */
export interface Contract {
  /** $ one contract gains or loses per 1.00 of price. */
  multiplier: number;
  /** $ commission per contract, charged on every fill. */
  commission: number;
  /** The most contracts one trade may use. Unset or 0 means no limit. */
  maxQty?: number;
}

/**
 * The size of a position that risks `riskUsd` between `entry` and `stop`: coin
 * units, or whole contracts. `riskUsd` is returned as it really is: with whole
 * contracts it is what the contracts risk, which can be less than asked or zero,
 * or less because the contract's `maxQty` caps the size.
 */
export function sizePosition(
  entry: number,
  stop: number,
  riskUsd: number,
  contract?: Contract | null
): { qty: number; riskUsd: number } {
  const dist = Math.abs(entry - stop);
  if (!(dist > 0)) return { qty: 0, riskUsd };
  if (!contract) return { qty: riskUsd / dist, riskUsd };
  const wanted = Math.floor(riskUsd / (dist * contract.multiplier) + 1e-9);
  const qty = contract.maxQty ? Math.min(wanted, contract.maxQty) : wanted;
  return { qty, riskUsd: qty * dist * contract.multiplier };
}

/** TP1 and TP2 only appear in trades recorded before partials became manual. */
export type FillKind = 'Partial' | 'Manual' | 'Stop' | 'BE' | 'TP' | 'TP1' | 'TP2';

export interface Fill {
  kind: FillKind;
  price: number;
  pieces: number;
  qty: number;
  /** Close time of the candle the fill happened in. */
  time: number;
  /** Gross P&L of this fill, before fees. */
  pnl: number;
  fee: number;
}

export interface TradeParams {
  side: Side;
  entry: number;
  stop: number;
  target: number;
  /** $ lost if the whole position stops out at the initial stop, before fees. */
  riskUsd: number;
  /** Taker fee per side in percent (0.045 means 0.045%). */
  feePct: number;
  /** Maker fee on the take-profit fill, in percent. Defaults to `feePct`. */
  makerFeePct?: number;
  /** Fee on the entry fill, in percent. Defaults to `feePct` (a market entry). */
  entryFeePct?: number;
  /** Trade whole futures contracts: no % fees, a commission per contract, one piece. */
  contract?: Contract | null;
  time: number;
  /**
   * true (the default): take profit by hand, in thirds. false: one piece, and
   * the target is a take-profit order for all of it.
   */
  scaleOut?: boolean;
}

export interface OpenTrade {
  side: Side;
  dir: 1 | -1;
  entry: number;
  entryTime: number;
  initialStop: number;
  stop: number;
  /** The planned exit ("next level"). Only fills by itself when `takeProfit` is set. */
  target: number;
  /** The target is a take-profit order that closes everything left. */
  takeProfit: boolean;
  /** 1R in price terms: |entry - initial stop|. */
  dist: number;
  /** Price of +1R. */
  oneR: number;
  riskUsd: number;
  /** Coin units, or whole contracts when `contracts` is set. */
  qty: number;
  /** $ per 1.00 of price per unit of `qty`: 1 for coins, the contract's point value for futures. */
  multiplier: number;
  /** Commission in $ per unit of `qty` on every fill (futures). */
  feeFlat: number;
  /** The position is whole futures contracts. */
  contracts: boolean;
  feeRate: number;
  /** Fee rate on the take-profit fill. */
  makerFeeRate: number;
  /** Equal pieces the position is split into: PIECES when scaling out, 1 when not. */
  pieces: number;
  piecesLeft: number;
  /** Gross P&L of the pieces closed so far. */
  realized: number;
  /** Fees paid so far, entry included. */
  fees: number;
  fills: Fill[];
  /** Price has touched +1R at some point since entry. */
  reached1R: boolean;
  /** Close time of the candle that first touched +1R. */
  reached1RTime: number | null;
  /** Price has touched the current target. */
  reachedTarget: boolean;
  /** True once the stop has been moved by hand. */
  stopMoved: boolean;
  /** True if the stop was ever moved further away than the initial stop. */
  stopWidened: boolean;
  closed: boolean;
  exitTime: number | null;
}

export interface StepResult {
  trade: OpenTrade;
  /** Fills produced by this step, in the order they happened. */
  fills: Fill[];
  /** +1R was touched for the first time in this candle. */
  reached1R: boolean;
  /** The target was touched for the first time in this candle. */
  reachedTarget: boolean;
}

export interface TradeResult {
  /** Net P&L in $ after all fees. */
  pnl: number;
  gross: number;
  fees: number;
  r: number;
}

export function openTrade(params: TradeParams): OpenTrade {
  const dir = params.side === 'long' ? 1 : -1;
  const dist = dir * (params.entry - params.stop);
  if (!(dist > 0)) throw new Error(`Stop must be ${dir > 0 ? 'below' : 'above'} entry.`);
  if (!(dir * (params.target - params.entry) > 0)) {
    throw new Error(`Target must be ${dir > 0 ? 'above' : 'below'} entry.`);
  }
  if (!(params.riskUsd > 0)) throw new Error('Risk must be greater than zero.');

  const contract = params.contract ?? null;
  const sized = sizePosition(params.entry, params.stop, params.riskUsd, contract);
  if (contract && sized.qty < 1) {
    throw new Error(
      `One contract risks $${(dist * contract.multiplier).toFixed(2)} here, more than your $${params.riskUsd.toFixed(2)}. ` +
        'Tighten the stop, raise the risk, or trade the micro contract.'
    );
  }
  const qty = sized.qty;
  // Futures pay a commission, not a % of the position.
  const feeRate = contract ? 0 : params.feePct / 100;
  const scaleOut = (params.scaleOut ?? true) && !contract;
  const pieces = scaleOut ? PIECES : 1;
  const feeFlat = contract?.commission ?? 0;
  const multiplier = contract?.multiplier ?? 1;

  return {
    side: params.side,
    dir,
    entry: params.entry,
    entryTime: params.time,
    initialStop: params.stop,
    stop: params.stop,
    target: params.target,
    takeProfit: !scaleOut,
    dist,
    oneR: params.entry + dir * dist,
    riskUsd: sized.riskUsd,
    qty,
    multiplier,
    feeFlat,
    contracts: contract != null,
    feeRate,
    makerFeeRate: contract ? 0 : (params.makerFeePct ?? params.feePct) / 100,
    pieces,
    piecesLeft: pieces,
    realized: 0,
    fees: qty * (params.entry * multiplier * (contract ? 0 : (params.entryFeePct ?? params.feePct) / 100) + feeFlat),
    fills: [],
    reached1R: false,
    reached1RTime: null,
    reachedTarget: false,
    stopMoved: false,
    stopWidened: false,
    closed: false,
    exitTime: null
  };
}

/**
 * Brings an open trade saved by an older version up to the current shape.
 * Those all scaled out in thirds. When +1R was reached, or whether the stop
 * was ever widened, was not recorded: the current stop is the best guess.
 */
export function upgradeTrade(trade: OpenTrade): OpenTrade {
  return {
    ...trade,
    multiplier: trade.multiplier ?? 1,
    feeFlat: trade.feeFlat ?? 0,
    contracts: trade.contracts ?? false,
    pieces: trade.pieces ?? PIECES,
    takeProfit: trade.takeProfit ?? false,
    makerFeeRate: trade.makerFeeRate ?? trade.feeRate,
    reached1RTime: trade.reached1RTime ?? null,
    stopWidened: trade.stopWidened ?? widensRisk(trade.side, trade.initialStop, trade.stop)
  };
}

function copy(trade: OpenTrade): OpenTrade {
  return { ...trade, fills: [...trade.fills] };
}

function unchanged(trade: OpenTrade): StepResult {
  return { trade, fills: [], reached1R: false, reachedTarget: false };
}

/** Closes `pieces` pieces at `price`. Mutates `trade`, which must be a private copy. */
function fill(trade: OpenTrade, pieces: number, price: number, kind: FillKind, time: number, feeRate = trade.feeRate): Fill {
  const qty = (trade.qty * pieces) / trade.pieces;
  const result: Fill = {
    kind,
    price,
    pieces,
    qty,
    time,
    pnl: trade.dir * (price - trade.entry) * qty * trade.multiplier,
    fee: qty * (price * trade.multiplier * feeRate + trade.feeFlat)
  };
  trade.realized += result.pnl;
  trade.fees += result.fee;
  trade.piecesLeft -= pieces;
  trade.fills.push(result);
  if (trade.piecesLeft <= 0) {
    trade.closed = true;
    trade.exitTime = time;
  }
  return result;
}

/**
 * Runs one closed candle through the trade. `time` is the candle's close time.
 *
 * The stop can fill here, and so can the target when it is a take-profit
 * order (the stop wins if both are inside the candle). Otherwise reaching +1R
 * or the target is reported so the UI can say so, but taking profit is left
 * to the trader. So is moving the stop: the engine never moves it.
 */
export function applyCandle(trade: OpenTrade, candle: Candle, time: number): StepResult {
  if (trade.closed) return unchanged(trade);

  const next = copy(trade);
  const result: StepResult = { ...unchanged(next) };
  const long = next.dir > 0;
  const reached = (price: number) => (long ? candle.h >= price : candle.l <= price);
  const stopHit = long ? candle.l <= next.stop : candle.h >= next.stop;

  if (stopHit) {
    const kind: FillKind = next.stop === next.entry ? 'BE' : 'Stop';
    result.fills.push(fill(next, next.piecesLeft, next.stop, kind, time));
    return result;
  }

  if (!next.reached1R && reached(next.oneR)) {
    next.reached1R = true;
    next.reached1RTime = time;
    result.reached1R = true;
  }

  if (!next.reachedTarget && reached(next.target)) {
    next.reachedTarget = true;
    result.reachedTarget = true;
  }

  if (next.takeProfit && reached(next.target)) {
    result.fills.push(fill(next, next.piecesLeft, next.target, 'TP', time, next.makerFeeRate));
  }

  return result;
}

/** A limit entry waiting for price to come to it. `entry` is the limit price. */
export interface LimitOrder extends Omit<TradeParams, 'time'> {
  /** Cursor time the order was placed at. */
  placedAt: number;
}

/** A buy limit fills once price trades down to it, a sell limit once price trades up to it. */
export function limitReached(side: Side, price: number, candle: Candle): boolean {
  return side === 'long' ? candle.l <= price : candle.h >= price;
}

/**
 * Runs one closed candle past a resting limit entry. null while it has not
 * filled. Once it fills, the trade opens at the limit price at `entryTime`
 * (when the candle began, or the cursor if later). What happened first inside
 * the candle is unknown, so the worst case is assumed: the stop can still fill
 * in it (at `time`, the candle's close); +1R, the target and a take profit
 * only count from the next candle.
 */
export function fillLimit(order: LimitOrder, candle: Candle, entryTime: number, time: number): StepResult | null {
  if (!limitReached(order.side, order.entry, candle)) return null;
  const trade = openTrade({ ...order, time: entryTime });
  const stopHit = trade.dir > 0 ? candle.l <= trade.stop : candle.h >= trade.stop;
  if (!stopHit) return unchanged(trade);
  const next = copy(trade);
  return { ...unchanged(next), fills: [fill(next, next.piecesLeft, next.stop, 'Stop', time)] };
}

/**
 * Closes `pieces` pieces by hand at `price` (the current candle close).
 * Closing everything that is left ends the trade.
 */
export function takePartial(trade: OpenTrade, pieces: number, price: number, time: number): StepResult {
  if (trade.closed) return unchanged(trade);
  const next = copy(trade);
  const count = Math.max(1, Math.min(Math.round(pieces), next.piecesLeft));
  const kind: FillKind = count >= next.piecesLeft ? 'Manual' : 'Partial';
  return { ...unchanged(next), fills: [fill(next, count, price, kind, time)] };
}

/** Closes everything that is left at `price`. */
export function closeAtMarket(trade: OpenTrade, price: number, time: number): StepResult {
  return takePartial(trade, trade.piecesLeft, price, time);
}

/** True when moving the stop from `from` to `to` increases the possible loss. */
export function widensRisk(side: Side, from: number, to: number): boolean {
  return side === 'long' ? to < from : to > from;
}

/** A stop is only valid on the losing side of the last price, or it would fill instantly. */
export function isValidStop(trade: OpenTrade, stop: number, lastPrice: number): boolean {
  return trade.dir > 0 ? stop < lastPrice : stop > lastPrice;
}

/** A target only makes sense on the winning side of entry. */
export function isValidTarget(trade: OpenTrade, target: number): boolean {
  return trade.dir * (target - trade.entry) > 0;
}

export function moveStop(trade: OpenTrade, stop: number): OpenTrade {
  if (trade.closed || stop === trade.stop) return trade;
  const widened = trade.stopWidened || widensRisk(trade.side, trade.initialStop, stop);
  return { ...trade, stop, stopMoved: true, stopWidened: widened };
}

/** Moves the planned exit. A new target has, by definition, not been reached yet. */
export function moveTarget(trade: OpenTrade, target: number): OpenTrade {
  if (trade.closed || target === trade.target) return trade;
  return { ...trade, target, reachedTarget: false };
}

/** Coin units (or contracts) still open. */
export function openQty(trade: OpenTrade): number {
  return (trade.qty * trade.piecesLeft) / trade.pieces;
}

/** Gross P&L of the pieces still open, marked at `price`. */
export function unrealized(trade: OpenTrade, price: number): number {
  return trade.dir * (price - trade.entry) * openQty(trade) * trade.multiplier;
}

export interface LivePnl {
  /** Banked plus open P&L, before any fees. */
  gross: number;
  /** Fees paid so far plus the fee to close the rest at the price given. */
  fees: number;
  net: number;
  grossR: number;
  netR: number;
  feesR: number;
}

/** P&L if everything still open were closed at `price` right now. */
export function livePnl(trade: OpenTrade, price: number): LivePnl {
  const gross = trade.realized + unrealized(trade, price);
  const fees = trade.fees + openQty(trade) * (price * trade.multiplier * trade.feeRate + trade.feeFlat);
  const net = gross - fees;
  return { gross, fees, net, grossR: gross / trade.riskUsd, netR: net / trade.riskUsd, feesR: fees / trade.riskUsd };
}

/** $ lost before fees if what is still open stops out at `stop`. Negative once the stop locks in profit. */
export function riskAt(trade: OpenTrade, stop: number): number {
  return trade.dir * (trade.entry - stop) * openQty(trade) * trade.multiplier;
}

/** How far `price` is from entry, in R (positive = in profit). */
export function priceR(trade: Pick<OpenTrade, 'entry' | 'dist' | 'dir'>, price: number): number {
  return (trade.dir * (price - trade.entry)) / trade.dist;
}

/** Target expressed in R (using the initial stop distance). */
export function targetR(trade: Pick<OpenTrade, 'entry' | 'target' | 'dist'>): number {
  return Math.abs(trade.target - trade.entry) / trade.dist;
}

export function tradeResult(trade: OpenTrade): TradeResult {
  const pnl = trade.realized - trade.fees;
  return { pnl, gross: trade.realized, fees: trade.fees, r: pnl / trade.riskUsd };
}
