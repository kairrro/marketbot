// The active trade: first a draft (the position tool, before Confirm), then an
// open trade. With a limit entry there is a step between: the order rests
// until a candle trades at its price. The engine stops a trade out, and takes
// profit at the target only when the session is set to; otherwise profits are
// taken by hand.

import { tick } from 'svelte';
import { limitLabel } from '$lib/chart/positionView';
import { futuresFor, snapToTick } from '$lib/engine/instruments';
import { toRecord, type TradeMeta } from '$lib/engine/journal';
import {
  defaultPlan,
  planMetrics,
  planWarnings,
  stopTooTight,
  TARGET_R,
  targetAt,
  tightStopMessage,
  TIME_RULE_MS
} from '$lib/engine/rules';
import {
  applyCandle,
  fillLimit,
  isValidStop,
  isValidTarget,
  livePnl,
  moveStop,
  moveTarget,
  openTrade,
  takePartial,
  targetR,
  upgradeTrade,
  widensRisk,
  type Contract,
  type LimitOrder,
  type OpenTrade,
  type StepResult
} from '$lib/engine/trade';
import type { Side } from '$lib/engine/types';
import { fmtMoney, fmtPrice, fmtR, roundTo } from '$lib/format';
import { atr } from './atr.svelte';
import { chartBridge } from './chartBridge';
import { quick } from './quickJournal.svelte';
import { replay, type StepInfo } from './replay.svelte';
import { sessions, uid, type EntryOrder } from './sessions.svelte';
import { screenshots } from './storage.svelte';
import { ui } from './ui.svelte';

export interface Draft {
  side: Side;
  entry: number;
  /** Cursor time the entry price was taken at. */
  time: number;
  stop: number;
  target: number;
  /** False until the target is dragged; until then it follows the stop at 1R. */
  targetTouched: boolean;
}

export type TradeLine = 'entry' | 'stop' | 'target';

const dirOf = (side: Side) => (side === 'long' ? 1 : -1);

/**
 * Where a limit for `side` can rest given the last price: at it or better. A
 * buy limit above the price (or a sell limit below it) would fill at once.
 */
const restingPrice = (side: Side, price: number, last: number) =>
  side === 'long' ? Math.min(price, last) : Math.max(price, last);

class TradeStore {
  draft = $state.raw<Draft | null>(null);
  /** A placed limit entry that has not filled yet. `meta` is its trade's. */
  pending = $state.raw<LimitOrder | null>(null);
  open = $state.raw<OpenTrade | null>(null);
  meta = $state.raw<TradeMeta | null>(null);
  /** A trade that has just closed, kept on the chart until its screenshot is taken. */
  closing = $state.raw<OpenTrade | null>(null);

  /** The line being dragged on the chart, if any. */
  dragging = $state<TradeLine | null>(null);

  /** The next trade is entered with a limit order rather than at market. */
  limitEntry = $derived(sessions.settings.entryOrder === 'limit');

  /** Set while the chart is a futures contract (NQ, MNQ…): trades are whole contracts with a commission. */
  contract = $derived.by<Contract | null>(() => {
    const future = futuresFor(replay.info?.source, replay.info?.coin);
    if (!future) return null;
    const { commissionFull, commissionMicro, maxContractsFull, maxContractsMicro } = sessions.settings;
    return {
      multiplier: future.pointValue,
      commission: future.micro ? commissionMicro : commissionFull,
      maxQty: future.micro ? maxContractsMicro : maxContractsFull
    };
  });

  /** The futures market on the chart (NQ, MNQ…), or null. */
  future = $derived(futuresFor(replay.info?.source, replay.info?.coin));

  /** The stop, in points, that a new futures trade starts with: the last one used, else the market's default. */
  stopPoints = $derived(this.future ? (sessions.settings.stopPts[this.future.symbol] ?? this.future.defaultStop) : null);

  /** The tightest stop (as a % of price) that is not flagged. Not used for futures, which are sized in points and dollars. */
  minStopPct = $derived(this.contract ? 0 : sessions.settings.minStopPct);

  draftMetrics = $derived(
    this.draft
      ? planMetrics(
          this.draft.entry,
          this.draft.stop,
          this.draft.target,
          sessions.riskUsd,
          sessions.settings.feePct,
          this.limitEntry ? sessions.settings.makerFeePct : sessions.settings.feePct,
          this.contract
        )
      : null
  );
  draftWarnings = $derived(
    this.draftMetrics ? planWarnings(this.draftMetrics, this.minStopPct) : []
  );
  pendingMetrics = $derived.by(() => {
    const order = this.pending;
    return order
      ? planMetrics(order.entry, order.stop, order.target, order.riskUsd, order.feePct, order.entryFeePct, order.contract)
      : null;
  });
  pendingWarnings = $derived(
    this.pendingMetrics ? planWarnings(this.pendingMetrics, this.minStopPct) : []
  );

  live = $derived(this.open && replay.price != null ? livePnl(this.open, replay.price) : null);
  /** The open trade's stop is on the losing side and closer to entry than the minimum. */
  tightStop = $derived.by(() => {
    const open = this.open;
    if (!open || !(open.dir * (open.entry - open.stop) > 0)) return null;
    const pct = (Math.abs(open.entry - open.stop) / open.entry) * 100;
    const min = this.minStopPct;
    return stopTooTight(pct, min) ? tightStopMessage(pct, min) : null;
  });
  elapsedMs = $derived(this.open ? Math.max(0, replay.cursorTime - this.open.entryTime) : 0);
  /** The time rule: price has not touched +1R within an hour of candle time. */
  slow = $derived(this.open != null && !this.open.reached1R && this.elapsedMs >= TIME_RULE_MS);
  /** The stop sits further from entry than the one the trade was sized on. */
  riskWidened = $derived(
    this.open != null && widensRisk(this.open.side, this.open.initialStop, this.open.stop)
  );

  #dragFrom: number | null = null;
  #overlapWarned = false;

  constructor() {
    // Registered by name, so a store re-created by a development reload
    // replaces this one's listeners rather than running alongside them.
    replay.addGuard('trade', (next) => {
      if (!(this.open || this.pending) || !this.meta) return null;
      const what = this.open ? 'Close the open trade' : 'Cancel the limit order';
      if (next.coin !== this.meta.coin) return `${what} before switching coins.`;
      if (!next.keepCursor) return `${what} before reloading the chart.`;
      return null;
    });
    replay.onCandle('trade', (info) => this.#onCandle(info));
    // A reload changes the last close, so a draft's entry price is stale.
    replay.onLoaded('trade', () => {
      this.draft = null;
    });
  }

  /** Puts back a trade (or limit order) that was open when the session was last saved, or clears it. */
  restore(open: OpenTrade | null, meta: TradeMeta | null, pending: LimitOrder | null = null): void {
    const usable = open != null && meta != null && !open.closed;
    const waiting = !usable && pending != null && meta != null;
    this.open = usable ? upgradeTrade(open) : null;
    this.pending = waiting ? pending : null;
    this.meta = usable || waiting ? meta : null;
    this.draft = null;
    this.closing = null;
    this.#dragFrom = null;
    this.#overlapWarned = false;
  }

  // ---- draft (position tool) ----

  /** Opens the position tool at the current price (the price at the replay cursor). */
  begin(side: Side): void {
    const entry = replay.price;
    if (!replay.info || entry == null) return ui.toast('Load data first.', 'warn');
    if (this.open) return ui.toast('Close the open trade first.', 'warn');
    if (this.pending) return ui.toast('Cancel your limit order first.', 'warn');

    replay.pause();
    this.draft = {
      side,
      entry,
      time: replay.cursorTime,
      ...defaultPlan(side, entry, replay.precision, this.stopPoints ?? undefined),
      targetTouched: false
    };
    ui.tab = 'trade';
    ui.tool = 'none';
  }

  /** Puts the draft's stop `points` from its entry (target follows at 1R unless it was dragged). */
  setDraftStopPoints(points: number): void {
    const draft = this.draft;
    if (!draft || !(points > 0)) return;
    const raw = draft.entry - dirOf(draft.side) * points;
    this.setDraftStop(this.future ? snapToTick(raw, this.future.tick) : roundTo(raw, replay.precision));
  }

  /** Puts the draft's stop `mult` ATRs from its entry. Does nothing while the ATR is off or has no reading yet. */
  setDraftStopAtr(mult: number): void {
    const reading = atr.reading;
    if (reading) this.setDraftStopPoints(reading.value * mult);
  }

  /** Remembers the stop distance of a placed futures trade, so the next one starts there. */
  #rememberStop(draft: Draft): void {
    const future = this.future;
    if (!future) return;
    const points = snapToTick(Math.abs(draft.entry - draft.stop), future.tick);
    if (points > 0) sessions.updateSettings({ stopPts: { ...sessions.settings.stopPts, [future.symbol]: points } });
  }

  /** Where the target sits until it is dragged: 1R from entry, on the market's tick. */
  #targetFor(side: Side, entry: number, stop: number): number {
    return targetAt(side, entry, stop, TARGET_R, replay.precision);
  }

  setDraftStop(price: number): void {
    const draft = this.draft;
    if (!draft || !Number.isFinite(price)) return;
    if (!(dirOf(draft.side) * (draft.entry - price) > 0)) return;
    const target = draft.targetTouched ? draft.target : this.#targetFor(draft.side, draft.entry, price);
    this.draft = { ...draft, stop: price, target };
  }

  setDraftTarget(price: number): void {
    const draft = this.draft;
    if (!draft || !Number.isFinite(price)) return;
    if (!(dirOf(draft.side) * (price - draft.entry) > 0)) return;
    this.draft = { ...draft, target: price, targetTouched: true };
  }

  /** Moves a limit draft's entry. It stops at the current price: past it, a limit would fill at once. */
  setDraftEntry(price: number): void {
    const draft = this.draft;
    const last = replay.price;
    if (!draft || !this.limitEntry || last == null || !Number.isFinite(price)) return;
    const dir = dirOf(draft.side);
    const entry = restingPrice(draft.side, price, last);
    if (!(dir * (entry - draft.stop) > 0)) return;
    if (draft.targetTouched && !(dir * (draft.target - entry) > 0)) return;
    const target = draft.targetTouched ? draft.target : this.#targetFor(draft.side, entry, draft.stop);
    this.draft = { ...draft, entry, target };
  }

  /** Market or limit for the next entry. A draft switched to market goes back to the current price. */
  setEntryOrder(order: EntryOrder): void {
    sessions.updateSettings({ entryOrder: order });
    const draft = this.draft;
    const last = replay.price;
    if (order !== 'market' || !draft || last == null || draft.entry === last) return;
    const targetOk = draft.targetTouched && dirOf(draft.side) * (draft.target - last) > 0;
    this.draft = {
      ...draft,
      entry: last,
      time: replay.cursorTime,
      target: targetOk ? draft.target : this.#targetFor(draft.side, last, draft.stop),
      targetTouched: targetOk
    };
  }

  cancel(): void {
    this.draft = null;
  }

  /**
   * Places the drafted trade: opened at market, or as a limit order that waits
   * for price. Rule warnings do not block it.
   */
  confirm(): void {
    const draft = this.draft;
    const info = replay.info;
    if (!draft || !info) return;

    const settings = sessions.settings;
    const limit = this.limitEntry;
    const params = {
      side: draft.side,
      entry: draft.entry,
      stop: draft.stop,
      target: draft.target,
      riskUsd: sessions.riskUsd,
      feePct: settings.feePct,
      makerFeePct: settings.makerFeePct,
      entryFeePct: limit ? settings.makerFeePct : settings.feePct,
      scaleOut: settings.scaleOut,
      contract: this.contract
    };
    try {
      const last = replay.price;
      if (limit && last != null && restingPrice(draft.side, draft.entry, last) !== draft.entry) {
        throw new Error(`A ${limitLabel(draft.side).toLowerCase()} must be ${draft.side === 'long' ? 'at or below' : 'at or above'} the current price.`);
      }
      // Checks the prices and the risk, for a limit too.
      const trade = openTrade({ ...params, time: draft.time });
      const warnings = this.draftWarnings;

      this.meta = {
        id: uid(),
        coin: info.coin,
        tf: info.tf,
        source: info.source,
        precision: replay.precision,
        brokeRules: warnings.length > 0
      };
      if (limit) this.pending = { ...params, placedAt: replay.cursorTime };
      else this.open = trade;
      this.#rememberStop(draft);
      this.draft = null;
      this.#overlapWarned = false;

      const at = fmtPrice(draft.entry, replay.precision);
      const what = limit ? `${limitLabel(draft.side)} placed at ${at}` : `${draft.side === 'long' ? 'Long' : 'Short'} opened at ${at}`;
      if (warnings.length > 0) {
        ui.toast(`${what}, but it breaks your rules. ${warnings.map((w) => w.message).join(' ')}`, 'warn', 6000);
      } else {
        ui.toast(`${what} · risk ${fmtMoney(trade.riskUsd)}${limit ? '. It fills when price trades there.' : ''}`);
      }
    } catch (err) {
      ui.toast(err instanceof Error ? err.message : String(err), 'warn');
    }
  }

  /** Cancels a limit order that has not filled. Nothing is journaled. */
  cancelPending(): void {
    if (!this.pending) return;
    this.pending = null;
    this.meta = null;
    ui.toast('Limit order cancelled.');
  }

  /**
   * Stepping with the tool open keeps a market entry on the latest close. A
   * limit stays where it was put, unless price has gone past it: then it moves
   * to the close, the best place it can rest now.
   */
  #reanchor(info: StepInfo): void {
    const draft = this.draft;
    if (!draft) return;
    const dir = dirOf(draft.side);
    const entry = this.limitEntry ? restingPrice(draft.side, draft.entry, info.candle.c) : info.candle.c;
    const stopOk = dir * (entry - draft.stop) > 0;
    const targetOk = !draft.targetTouched || dir * (draft.target - entry) > 0;
    if (!stopOk || !targetOk) {
      this.draft = null;
      ui.toast('Position tool cancelled: price moved through your stop or target.', 'warn');
      return;
    }
    const target = draft.targetTouched ? draft.target : this.#targetFor(draft.side, entry, draft.stop);
    this.draft = { ...draft, entry, time: info.time, target };
  }

  // ---- open trade ----

  #onCandle(info: StepInfo): void {
    this.#reanchor(info);
    if (this.pending) {
      this.#tryFill(info);
      return;
    }
    const open = this.open;
    if (!open) return;

    if (info.overlap && !this.#overlapWarned) {
      this.#overlapWarned = true;
      ui.toast(
        'This candle began before your last step, so the stop check inside it is approximate. Stay on one timeframe for exact exits.',
        'warn',
        7000
      );
    }
    this.#apply(applyCandle(open, info.candle, info.time));
  }

  /** A resting limit fills once a candle trades at its price. Playback stops so the fill is seen. */
  #tryFill(info: StepInfo): void {
    const order = this.pending;
    if (!order) return;
    const result = fillLimit(order, info.candle, Math.max(info.candle.t, info.from), info.time);
    if (!result) return;
    this.pending = null;
    replay.halt();
    const precision = this.meta?.precision ?? replay.precision;
    ui.toast(`${limitLabel(order.side)} filled at ${fmtPrice(order.entry, precision)} · risk ${fmtMoney(result.trade.riskUsd)}`);
    this.#apply(result);
  }

  /** Takes the engine's answer on board and tells the trader what happened. */
  #apply(result: StepResult): void {
    const precision = this.meta?.precision ?? replay.precision;
    const { trade } = result;
    if (trade.closed) {
      void this.#finalize(trade);
      return;
    }
    this.open = trade;

    for (const fill of result.fills) {
      const r = fmtR(fill.pnl / trade.riskUsd);
      ui.toast(`Took ${fill.pieces}/${trade.pieces} at ${fmtPrice(fill.price, precision)} (${r})`, fill.pnl >= 0 ? 'good' : 'bad');
    }
    // These are the moments a decision is due, so playback stops for them.
    // The stop is never moved for you: +1R is where you decide about breakeven.
    // When +1R is the target itself, the target's own message says it all.
    if (result.reached1R && !result.reachedTarget) {
      replay.halt();
      ui.toast(
        trade.takeProfit
          ? '+1R reached. Move your stop to breakeven? Use "Stop to entry" or drag the line.'
          : '+1R reached. Take profit or move your stop to breakeven: both are up to you.',
        'info',
        7000
      );
    }
    // With a take-profit order the target closes the trade, so there is nothing to decide.
    if (result.reachedTarget && !trade.takeProfit) {
      replay.halt();
      ui.toast(`Target reached (${targetR(trade).toFixed(1)}R). Taking profit is up to you.`);
    }
  }

  /**
   * Closes `pieces` pieces (thirds) of the position at the current price. That is the
   * price at the cursor, not the last candle on screen — on a higher timeframe
   * the two can differ, and a fill must not depend on which chart is showing.
   */
  takePartial(pieces = 1): void {
    const price = replay.price;
    if (!this.open || price == null) return;
    this.#apply(takePartial(this.open, pieces, price, replay.cursorTime));
  }

  closeMarket(): void {
    if (this.open) this.takePartial(this.open.piecesLeft);
  }

  #setStop(price: number): boolean {
    const open = this.open;
    const last = replay.price;
    if (!open || last == null || !isValidStop(open, price, last)) return false;
    this.open = moveStop(open, price);
    return true;
  }

  #announceStop(from: number): void {
    const open = this.open;
    if (!open || open.stop === from) return;
    const price = fmtPrice(open.stop, this.meta?.precision);
    if (widensRisk(open.side, from, open.stop)) ui.toast(`Stop moved away to ${price}. Risk is wider.`, 'warn');
    else ui.toast(`Stop moved to ${price}.`);
  }

  /** Moves the stop to the entry price (breakeven). Only possible once price is past entry. */
  stopToEntry(): void {
    const open = this.open;
    if (!open) return;
    const from = open.stop;
    if (!this.#setStop(open.entry)) {
      ui.toast(`Price has to be ${open.dir > 0 ? 'above' : 'below'} entry to put the stop there.`, 'warn');
      return;
    }
    this.#announceStop(from);
  }

  /** One-shot stop move, from the "Move stop" button followed by a chart click. */
  clickStop(price: number): void {
    const open = this.open;
    if (!open) return;
    const from = open.stop;
    if (!this.#setStop(price)) {
      ui.toast(`The stop must be ${open.dir > 0 ? 'below' : 'above'} the current price.`, 'warn');
      return;
    }
    this.#announceStop(from);
  }

  // Dragging a line on the chart. Works on the draft and on the open trade.

  beginDrag(line: TradeLine): void {
    this.dragging = line;
    this.#dragFrom = line === 'stop' && this.open ? this.open.stop : null;
  }

  drag(line: TradeLine, price: number): void {
    if (this.draft) {
      if (line === 'entry') this.setDraftEntry(price);
      else if (line === 'stop') this.setDraftStop(price);
      else this.setDraftTarget(price);
      return;
    }
    if (this.pending) {
      this.movePending(line, price);
      return;
    }
    const open = this.open;
    if (!open) return;
    if (line === 'stop') this.#setStop(price);
    else if (line === 'target' && isValidTarget(open, price)) this.open = moveTarget(open, price);
  }

  /**
   * Moves one price of a resting limit order. The $ risk stays as placed, so
   * the size follows the stop. The entry stops at the current price.
   */
  movePending(line: TradeLine, price: number): void {
    const order = this.pending;
    const last = replay.price;
    if (!order || last == null || !Number.isFinite(price)) return;
    const dir = dirOf(order.side);
    const entry = line === 'entry' ? restingPrice(order.side, price, last) : order.entry;
    const stop = line === 'stop' ? price : order.stop;
    const target = line === 'target' ? price : order.target;
    if (dir * (entry - stop) > 0 && dir * (target - entry) > 0) this.pending = { ...order, entry, stop, target };
  }

  endDrag(line: TradeLine): void {
    if (line === 'stop' && this.#dragFrom != null) this.#announceStop(this.#dragFrom);
    this.#dragFrom = null;
    this.dragging = null;
  }

  // ---- closing ----

  async #finalize(closed: OpenTrade): Promise<void> {
    const meta = this.meta;
    if (!meta) return;
    replay.halt();

    const record = toRecord(closed, meta);
    this.open = null;
    this.meta = null;
    this.closing = closed;
    sessions.addTrade(record);
    ui.tool = 'none';
    ui.toast(`Trade closed ${fmtR(record.r)} (${fmtMoney(record.pnl, true)})`, record.r >= 0 ? 'good' : 'bad', 5000);
    // Up at once, so the tags can be pressed while the screenshot is taken (it only photographs the chart).
    quick.begin(record.id);

    // Let the chart draw the last candle, the exit marker and the position
    // itself, then photograph it before the position is taken off the chart.
    await tick();
    let blob: Blob | null = null;
    try {
      blob = (await chartBridge.capture?.()) ?? null;
    } catch {
      blob = null;
    }
    this.closing = null;
    if (blob && (await screenshots.save(record.id, blob))) {
      sessions.updateTrade(record.id, { hasScreenshot: true });
    }
  }
}

export const trade = new TradeStore();
