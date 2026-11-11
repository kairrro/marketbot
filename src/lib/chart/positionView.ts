// Turns a draft or an open trade into what the position primitive draws,
// including the label text.

import { fmtMult } from '$lib/engine/atr';
import { fmtSize } from '$lib/engine/instruments';
import type { PlanMetrics } from '$lib/engine/rules';
import { livePnl, openQty, riskAt, targetR, type OpenTrade } from '$lib/engine/trade';
import type { Side } from '$lib/engine/types';
import { fmtMoney, fmtPct, fmtPrice, fmtR } from '$lib/format';
import type { PositionView } from './primitives/position';

export interface ViewContext {
  coin: string;
  /** The market is a futures contract, so sizes read as contracts. */
  contracts?: boolean;
  precision: number;
  /** Bar index of the entry candle. */
  fromLogical: number | null;
  /** The stop line is being dragged, so its label spells out what it risks. */
  draggingStop?: boolean;
  /** Shown in red under the stop label. */
  stopWarning?: string | null;
  /** One ATR in price, when the ATR is on: the planned stop's label also says how many ATRs it is. */
  atr?: number | null;
}

const sideLabel = (side: Side) => (side === 'long' ? 'Long' : 'Short');
/** A target that is a real order is called what it is. */
const targetLabel = (takeProfit: boolean) => (takeProfit ? 'Take profit' : 'Target');

/** " · −0.80% · risk $4.00 · size 0.333 SOL". A stop past entry locks in profit instead of risking any. */
function stopDetail(pct: number, risk: number, qty: number, coin: string, contracts = false): string {
  const money = risk >= 0 ? `risk ${fmtMoney(risk)}` : `locks ${fmtMoney(-risk)}`;
  return ` · ${fmtPct(pct, 2, true)} · ${money} · size ${fmtSize(qty, coin, contracts)}`;
}

export interface DraftLike {
  side: Side;
  entry: number;
  stop: number;
  target: number;
}

export interface DraftViewContext extends ViewContext {
  /** Whether the target will be (or is) a take-profit order. */
  takeProfit: boolean;
  /** The entry is a limit order, so its line can be dragged too. */
  limit?: boolean;
  /** The limit order has been placed and is waiting to fill. */
  placed?: boolean;
}

/** "Buy limit" / "Sell limit". */
export const limitLabel = (side: Side) => (side === 'long' ? 'Buy limit' : 'Sell limit');

/**
 * The position tool before the trade is filled: a draft, or a limit order
 * waiting for price. The stop and target can be dragged, and so can the entry
 * when it is a limit.
 */
export function draftView(draft: DraftLike, metrics: PlanMetrics, ctx: DraftViewContext): PositionView {
  const price = (value: number) => fmtPrice(value, ctx.precision);
  const dir = draft.side === 'long' ? 1 : -1;
  const limit = ctx.limit ?? false;
  const head = limit ? `${limitLabel(draft.side)} ${price(draft.entry)}` : sideLabel(draft.side);
  const plan = ctx.placed ? ' · waiting to fill' : ` · R:R ${metrics.rr.toFixed(2)} · stop ${fmtPct(metrics.stopPct)}`;
  const inAtr = ctx.atr && ctx.atr > 0 ? ` · ${fmtMult(metrics.dist / ctx.atr)} ATR` : '';
  return {
    side: draft.side,
    entry: draft.entry,
    stop: draft.stop,
    target: draft.target,
    oneR: draft.entry + dir * metrics.dist,
    fromLogical: ctx.fromLogical,
    draggable: { entry: limit, stop: true, target: true },
    targetIsOrder: ctx.takeProfit,
    entryPending: limit,
    format: price,
    labels: {
      entry: `${head}${plan} · risk ${fmtMoney(metrics.riskUsd)} · size ${fmtSize(metrics.qty, ctx.coin, ctx.contracts ?? false)}`,
      stop:
        `Stop ${price(draft.stop)}` +
        (ctx.draggingStop
          ? stopDetail(-metrics.stopPct, metrics.riskUsd, metrics.qty, ctx.coin, ctx.contracts)
          : ` · ${fmtPct(-metrics.stopPct, 2, true)}`) +
        inAtr,
      stopWarning: ctx.stopWarning ?? undefined,
      target:
        `${targetLabel(ctx.takeProfit)} ${price(draft.target)} · ${fmtPct(metrics.targetPct, 2, true)}` +
        ` · ${metrics.rr.toFixed(1)}R`,
      oneR: '+1R'
    }
  };
}

/**
 * A live (or just-closed) trade. The stop is an order, and so is the target
 * when the trade takes profit there. Otherwise +1R and the target are guides
 * for taking profit by hand, so they stay on the chart for the whole trade.
 */
export function openView(trade: OpenTrade, lastPrice: number | null, ctx: ViewContext): PositionView {
  const price = (value: number) => fmtPrice(value, ctx.precision);
  const pnl = lastPrice != null && !trade.closed ? livePnl(trade, lastPrice) : null;
  const live = pnl ? ` · ${fmtR(pnl.netR)} · ${fmtMoney(pnl.net, true)}` : '';
  const left = trade.pieces > 1 ? ` · ${trade.piecesLeft}/${trade.pieces} open` : '';
  const stopKind = trade.stop === trade.entry ? 'Stop (BE)' : 'Stop';
  const stopPct = (trade.dir * (trade.stop - trade.entry) * 100) / trade.entry;
  const detail = ctx.draggingStop ? stopDetail(stopPct, riskAt(trade, trade.stop), openQty(trade), ctx.coin, trade.contracts) : '';
  return {
    side: trade.side,
    entry: trade.entry,
    stop: trade.stop,
    target: trade.target,
    oneR: trade.oneR,
    fromLogical: ctx.fromLogical,
    draggable: { entry: false, stop: !trade.closed, target: !trade.closed },
    targetIsOrder: trade.takeProfit,
    format: price,
    labels: {
      entry: `${sideLabel(trade.side)} ${price(trade.entry)}${live}${left}`,
      stop: `${stopKind} ${price(trade.stop)}${detail}`,
      stopWarning: ctx.stopWarning ?? undefined,
      target: `${targetLabel(trade.takeProfit)} ${price(trade.target)} · ${targetR(trade).toFixed(1)}R`,
      oneR: '+1R'
    }
  };
}
