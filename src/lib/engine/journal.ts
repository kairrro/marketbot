// What a closed trade looks like once it is saved, plus CSV export.

import { reachesCursor, visibleCount } from './replay';
import { PIECES, tradeResult, type FillKind, type OpenTrade } from './trade';
import { type Candle, type Side, type Timeframe } from './types';

/**
 * One strategy, three ways price can behave at a level. Only the automatic
 * backtester still tags its trades with one; the journal no longer asks.
 */
export const SETUPS = [
  { id: 'bounce', label: 'Bounce' },
  { id: 'sweep', label: 'Sweep' },
  { id: 'breakout', label: 'Breakout' }
] as const;

export type SetupId = (typeof SETUPS)[number]['id'];

/** Ids used before the three setups were folded into one strategy. */
const LEGACY_SETUPS: Record<string, SetupId> = { A: 'sweep', B: 'breakout', SR: 'bounce' };

export const TAGS = [
  'with trend',
  'against trend',
  'early entry',
  'late entry',
  'moved stop',
  'FOMO',
  'perfect'
] as const;

/** The quick tag asked when a trade closes: what the market was doing. Separate from the old `setup`. */
export const SETUP_TYPES = [
  { id: 'trend', label: 'Trend' },
  { id: 'range', label: 'Range' }
] as const;

export type SetupType = (typeof SETUP_TYPES)[number]['id'];

export function setupTypeLabel(id: SetupType | null | undefined): string {
  return SETUP_TYPES.find((type) => type.id === id)?.label ?? '';
}

/** Accepts only the two current ids; anything else means "not set". */
export function normalizeSetupType(value: unknown): SetupType | null {
  return SETUP_TYPES.some((type) => type.id === value) ? (value as SetupType) : null;
}

/** Why a trade ended, filled in by the app. */
export type ExitReason = 'Target' | 'Stopped' | 'Cut early';

/**
 * The last fill closed the trade: the take profit is "Target", a stop (or a
 * stop at breakeven) is "Stopped", and closing by hand is "Cut early" — unless
 * price had already touched the target, when it is "Target". Null with no fills.
 */
export function exitReasonFromFills(exits: readonly ExitFill[], reachedTarget = false): ExitReason | null {
  const last = exits[exits.length - 1];
  if (!last) return null;
  if (last.kind === 'TP' || last.kind === 'TP1' || last.kind === 'TP2') return 'Target';
  if (last.kind === 'Stop' || last.kind === 'BE') return 'Stopped';
  return reachedTarget ? 'Target' : 'Cut early';
}

/** The saved exit reason, or one worked out from the fills for trades saved before it existed. */
export function exitReasonOf(trade: Pick<TradeRecord, 'exits' | 'exitReason'>): ExitReason | null {
  return trade.exitReason ?? exitReasonFromFills(trade.exits);
}

/** Accepts current and legacy setup ids; anything else means "not set". */
export function normalizeSetup(value: unknown): SetupId | null {
  if (typeof value !== 'string') return null;
  if (SETUPS.some((setup) => setup.id === value)) return value as SetupId;
  return LEGACY_SETUPS[value] ?? null;
}

export function setupLabel(id: SetupId | null | undefined): string {
  return SETUPS.find((setup) => setup.id === id)?.label ?? '';
}

export interface ExitFill {
  kind: FillKind;
  price: number;
  pieces: number;
  time: number;
}

export interface TradeRecord {
  id: string;
  coin: string;
  tf: Timeframe;
  source: string;
  /** Bounce, Sweep or Breakout from the automatic backtester; null for trades taken by hand. */
  setup: SetupId | null;
  /** Quick tag from the popup when the trade closed: Trend or Range. Missing on older trades. */
  setupType?: SetupType | null;
  /** Target, Stopped or Cut early, set by the app when the trade closes. Missing on older trades. */
  exitReason?: ExitReason | null;
  side: Side;
  entryTime: number;
  exitTime: number;
  entry: number;
  /** The initial stop — what the trade risked when it was placed. */
  stop: number;
  target: number;
  exits: ExitFill[];
  r: number;
  /** Net P&L in $ after fees. */
  pnl: number;
  fees: number;
  riskUsd: number;
  qty: number;
  /** Price decimals of the market, for display. */
  precision: number;
  followedRules: boolean | null;
  tags: string[];
  notes: string;
  hasScreenshot: boolean;
}

/** What is known about a trade while it is open, beyond the engine's own state. */
export interface TradeMeta {
  id: string;
  coin: string;
  tf: Timeframe;
  source: string;
  precision: number;
  /** The trade was placed with rule warnings showing. */
  brokeRules: boolean;
}

export function toRecord(trade: OpenTrade, meta: TradeMeta): TradeRecord {
  const result = tradeResult(trade);
  return {
    id: meta.id,
    coin: meta.coin,
    tf: meta.tf,
    source: meta.source,
    setup: null,
    setupType: null,
    exitReason: exitReasonFromFills(trade.fills, trade.reachedTarget),
    side: trade.side,
    entryTime: trade.entryTime,
    exitTime: trade.exitTime ?? trade.entryTime,
    entry: trade.entry,
    stop: trade.initialStop,
    target: trade.target,
    exits: trade.fills.map(({ kind, price, pieces, time }) => ({ kind, price, pieces, time })),
    r: result.r,
    pnl: result.pnl,
    fees: result.fees,
    riskUsd: trade.riskUsd,
    qty: trade.qty,
    precision: meta.precision,
    // Suggestions only: both can be changed in the journal.
    followedRules: meta.brokeRules ? false : null,
    tags: trade.stopMoved ? ['moved stop'] : [],
    notes: '',
    hasScreenshot: false
  };
}

/** Candles of context shown before a journaled trade's entry, and at most this many after its exit. */
export const CHART_BEFORE = 60;
export const CHART_AFTER = 20;

/**
 * The candles to chart a journaled trade on: context before the entry, the
 * trade itself, and a little of what came next — but only candles that had
 * closed by `seenUntil` (the replay's clock), since saved candles reach past
 * it. Null when `candles` do not hold the trade (another stretch of time, or
 * a timeframe the trade was not on).
 */
export function tradeWindow(
  candles: readonly Candle[],
  tfMs: number,
  trade: Pick<TradeRecord, 'entryTime' | 'exitTime'>,
  seenUntil: number,
  marketCloses = false
): Candle[] | null {
  const entryCount = visibleCount(candles, tfMs, trade.entryTime);
  const seen = visibleCount(candles, tfMs, Math.max(seenUntil, trade.exitTime));
  if (!reachesCursor(candles, entryCount, tfMs, trade.entryTime, marketCloses)) return null;
  if (!reachesCursor(candles, seen, tfMs, trade.exitTime, marketCloses)) return null;
  // Candles opened before the exit: the one it happened in is the last.
  const exitEnd = Math.min(seen, visibleCount(candles, tfMs, trade.exitTime + tfMs - 1));
  return candles.slice(Math.max(0, entryCount - 1 - CHART_BEFORE), Math.min(seen, exitEnd + CHART_AFTER));
}

/**
 * Drops any trade whose id was already seen, keeping the first. A trade can
 * only be journaled once; duplicates came from a development reload that
 * left two trade stores closing the same trade.
 */
export function uniqueTrades<T extends { id: string }>(trades: readonly T[]): T[] {
  const seen = new Set<string>();
  return trades.filter((trade) => !seen.has(trade.id) && seen.add(trade.id));
}

function exitLabel(exit: ExitFill): string {
  return exit.kind === 'Partial' ? `Partial ${exit.pieces}/${PIECES}` : exit.kind;
}

/** "Partial 1/3 @ 151.20, Stop @ 149.80" or "TP @ 152.00" */
export function exitsText(exits: readonly ExitFill[], precision: number): string {
  return exits.map((exit) => `${exitLabel(exit)} @ ${exit.price.toFixed(precision)}`).join(', ');
}

export function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const CSV_HEAD = [
  '#',
  'coin',
  'tf',
  'setup',
  'side',
  'entry_time',
  'exit_time',
  'entry',
  'stop',
  'target',
  'exits',
  'R',
  'pnl_usd',
  'fees_usd',
  'followed_rules',
  'tags',
  'notes'
];

/** A column added after the journal's own. */
export interface CsvColumn<T> {
  head: string;
  cell: (trade: T) => string | number;
}

/** Trades in the order they were taken, one row each, with any `extra` columns at the end. */
export function toCsv<T extends TradeRecord>(trades: readonly T[], extra: readonly CsvColumn<T>[] = []): string {
  const rows = trades.map((trade, i) => [
    i + 1,
    trade.coin,
    trade.tf,
    setupLabel(trade.setup),
    trade.side,
    new Date(trade.entryTime).toISOString(),
    new Date(trade.exitTime).toISOString(),
    trade.entry,
    trade.stop,
    Number.isFinite(trade.target) ? trade.target : '',
    exitsText(trade.exits, trade.precision),
    trade.r.toFixed(3),
    trade.pnl.toFixed(2),
    trade.fees.toFixed(2),
    trade.followedRules == null ? '' : trade.followedRules ? 'Y' : 'N',
    trade.tags.join('; '),
    trade.notes,
    ...extra.map((column) => column.cell(trade))
  ]);
  const head = [...CSV_HEAD, ...extra.map((column) => column.head)];
  return [head, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
}
