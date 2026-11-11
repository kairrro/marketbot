// The bulky, fast-changing parts of a session, stored beside it rather than in
// it: the candles it has downloaded and where its replay was left.
//
// Candles are kept per market and timeframe, and only ever grow. That matters
// most on Hyperliquid, which forgets everything older than ~5000 candles: once
// a session has seen a candle, it keeps it.

import type { Source } from '$lib/data';
import type { TradeMeta } from '$lib/engine/journal';
import type { LimitOrder, OpenTrade } from '$lib/engine/trade';
import type { Candle, Timeframe } from '$lib/engine/types';
import { storage } from './storage.svelte';

export interface Dataset {
  source: Source;
  coin: string;
  tf: Timeframe;
}

/** Where a session's replay was left, so it can be picked up again. */
export interface SavedView extends Dataset {
  cursorTime: number;
  startInput: string;
  /** The price at the cursor. */
  price?: number | null;
  /** A trade that was still open, with what is needed to journal it when it closes. */
  open: OpenTrade | null;
  meta: TradeMeta | null;
  /** A limit entry that had not filled yet (`meta` is its trade's). Missing in views saved before limits. */
  pending?: LimitOrder | null;
  /** When this was written. Used to pick the newer of the two stored copies. */
  savedAt?: number;
}

/** Candles as written to an exported file: [t, o, h, l, c, v] per candle. */
export type CandleRows = number[][];

/** The session data part of an exported file. */
export interface SessionDataFile {
  view?: SavedView | null;
  /** Keyed by "source:coin:tf". */
  candles?: Record<string, CandleRows>;
}

const viewKey = (sessionId: string) => `view:${sessionId}`;
const candlePrefix = (sessionId: string) => `candles:${sessionId}:`;
const datasetId = (d: Dataset) => `${d.source}:${d.coin}:${d.tf}`;
const candleKey = (sessionId: string, d: Dataset) => candlePrefix(sessionId) + datasetId(d);

// The replay position is tiny and changes constantly, and the moment it matters
// most is when the tab is being closed — exactly when an IndexedDB write may
// not get to finish. So it is also written to localStorage, which is
// synchronous. On the way back in, the newer of the two copies is used.
const backupKey = (sessionId: string) => `backtester:view:${sessionId}`;

function readBackup(sessionId: string): SavedView | null {
  try {
    const raw = localStorage.getItem(backupKey(sessionId));
    const view = raw ? (JSON.parse(raw) as SavedView) : null;
    return view && typeof view.coin === 'string' && Number.isFinite(view.cursorTime) ? view : null;
  } catch {
    return null;
  }
}

function writeBackup(sessionId: string, view: SavedView | null): void {
  try {
    if (view) localStorage.setItem(backupKey(sessionId), JSON.stringify(view));
    else localStorage.removeItem(backupKey(sessionId));
  } catch {
    // Full or blocked: IndexedDB still has it.
  }
}

const toRow = (c: Candle): number[] => [c.t, c.o, c.h, c.l, c.c, c.v];
const fromRow = (row: number[]): Candle => ({ t: row[0], o: row[1], h: row[2], l: row[3], c: row[4], v: row[5] ?? 0 });

/** A copied view keeps its open trade (or limit order), but under a new trade id. */
function reIdTrade(view: SavedView, tradeId: string): SavedView {
  return (view.open || view.pending) && view.meta
    ? { ...view, meta: { ...view.meta, id: tradeId } }
    : { ...view, open: null, pending: null, meta: null };
}

function isCandleRows(value: unknown): value is CandleRows {
  return Array.isArray(value) && value.every((row) => Array.isArray(row) && row.length >= 5 && row.every(Number.isFinite));
}

export const sessionData = {
  loadCandles: (sessionId: string, dataset: Dataset) => storage.get<Candle[]>(candleKey(sessionId, dataset)),

  saveCandles: (sessionId: string, dataset: Dataset, candles: Candle[]) =>
    storage.set(candleKey(sessionId, dataset), candles),

  /** The most recently saved replay position, from whichever store has the newer copy. */
  async loadView(sessionId: string): Promise<SavedView | undefined> {
    const stored = await storage.get<SavedView>(viewKey(sessionId));
    const backup = readBackup(sessionId);
    if (!stored || !backup) return stored ?? backup ?? undefined;
    return (backup.savedAt ?? 0) > (stored.savedAt ?? 0) ? backup : stored;
  },

  saveView(sessionId: string, view: SavedView): Promise<boolean> {
    const stamped = { ...view, savedAt: Date.now() };
    writeBackup(sessionId, stamped);
    return storage.set(viewKey(sessionId), stamped);
  },

  /** Deletes everything stored for a session. */
  async remove(sessionId: string): Promise<void> {
    writeBackup(sessionId, null);
    const keys = await storage.keys(candlePrefix(sessionId));
    await Promise.all([storage.del(viewKey(sessionId)), ...keys.map((key) => storage.del(key))]);
  },

  /**
   * Copies candles and replay position to another session (used by Duplicate).
   * `tradeId` is given to the copy's open trade, if it has one, so the two
   * sessions never journal a trade under the same id.
   */
  async copy(fromId: string, toId: string, tradeId: string): Promise<void> {
    const prefix = candlePrefix(fromId);
    for (const key of await storage.keys(prefix)) {
      const candles = await storage.get<Candle[]>(key);
      if (candles) await storage.set(candlePrefix(toId) + key.slice(prefix.length), candles);
    }
    const view = await sessionData.loadView(fromId);
    if (view) await sessionData.saveView(toId, reIdTrade(view, tradeId));
  },

  async export(sessionId: string): Promise<SessionDataFile> {
    const prefix = candlePrefix(sessionId);
    const candles: Record<string, CandleRows> = {};
    for (const key of await storage.keys(prefix)) {
      const list = await storage.get<Candle[]>(key);
      if (list?.length) candles[key.slice(prefix.length)] = list.map(toRow);
    }
    return { view: (await sessionData.loadView(sessionId)) ?? null, candles };
  },

  /** Stores the session data found in an imported file under `sessionId`. */
  async import(sessionId: string, file: SessionDataFile, tradeId: string): Promise<void> {
    const candles = file.candles && typeof file.candles === 'object' ? file.candles : {};
    for (const [id, rows] of Object.entries(candles)) {
      if (isCandleRows(rows)) await storage.set(candlePrefix(sessionId) + id, rows.map(fromRow));
    }
    const view = file.view;
    if (view && typeof view.coin === 'string' && Number.isFinite(view.cursorTime)) {
      await sessionData.saveView(sessionId, reIdTrade(view, tradeId));
    }
  }
};
