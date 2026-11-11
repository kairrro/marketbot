// Sessions: separate backtests, each with its own account settings, trades,
// levels and zones. Persisted to IndexedDB, one record per session. A session's
// candles and replay position live beside it (see sessionData.ts).

import { normalizeSetup, normalizeSetupType, uniqueTrades, type TradeRecord } from '$lib/engine/journal';
import { DEFAULT_SWING_SIZE } from '$lib/engine/swings';
import { sessionData, type SessionDataFile } from './sessionData';
import { blobToDataUrl, dataUrlToBlob, screenshots, storage } from './storage.svelte';

export interface SessionSettings {
  startBalance: number;
  /** Risk a % of the current balance per trade, or the same $ amount every trade. */
  riskMode: RiskMode;
  /** % of the current balance risked per trade, when riskMode is 'pct'. */
  riskPct: number;
  /** $ risked per trade, when riskMode is 'usd'. */
  riskFixedUsd: number;
  /** Taker fee % per side: market entries, stops, closing by hand. */
  feePct: number;
  /** Maker fee %: limit entries and take-profit orders. */
  makerFeePct: number;
  /** $ per full-size futures contract (NQ, ES…), per side, all fees in. Futures pay this instead of the % fees. */
  commissionFull: number;
  /** The same for a micro contract (MNQ, MES). */
  commissionMicro: number;
  /** The most full-size contracts (NQ, ES…) one trade may use; 0 for no limit. */
  maxContractsFull: number;
  /** The same for micro contracts (MNQ, MES). */
  maxContractsMicro: number;
  /** How the next trade is entered: at market now, or with a limit order that waits for price. */
  entryOrder: EntryOrder;
  minStopPct: number;
  /** The stop distance in points last picked for each futures symbol; a new trade starts with it. */
  stopPts: Record<string, number>;
  /**
   * Take profit by hand in thirds (true), or with the target as a take-profit
   * order for the whole position (false).
   */
  scaleOut: boolean;
  /** Candles on each side that a swing high or low must stand out from. */
  swingSize: number;
}

export type EntryOrder = 'market' | 'limit';
export type RiskMode = 'pct' | 'usd';

export interface Level {
  id: string;
  price: number;
}

/** The shape of a zone: a box in time and price. */
export interface ZoneShape {
  /** Open time (ms) of the candle the box starts on. */
  t1: number;
  /** Open time of the candle it ends on, or null to keep extending to the right. */
  t2: number | null;
  top: number;
  bottom: number;
}

export interface Zone extends ZoneShape {
  id: string;
}

export interface Session {
  id: string;
  name: string;
  createdAt: number;
  settings: SessionSettings;
  trades: TradeRecord[];
  /** Horizontal levels, keyed by coin. */
  levels: Record<string, Level[]>;
  /** Rectangle zones, keyed by coin. */
  zones: Record<string, Zone[]>;
}

/**
 * A session as written to a .json file. Screenshots travel as data URLs.
 * Version 2 added the session's candles and replay position.
 */
export interface SessionFile extends SessionDataFile {
  format: 'replay-backtester-session';
  version: 1 | 2;
  session: Session;
  screenshots: Record<string, string>;
}

export const DEFAULT_SETTINGS: SessionSettings = {
  startBalance: 1000,
  riskMode: 'pct',
  riskPct: 0.5,
  riskFixedUsd: 5,
  feePct: 0.045,
  makerFeePct: 0.015,
  // Half of Topstep's published round-turn cost with NFA and clearing fees in ($4.36 NQ, $1.42 MNQ). Set your firm's own.
  commissionFull: 2.18,
  commissionMicro: 0.71,
  maxContractsFull: 0,
  maxContractsMicro: 0,
  entryOrder: 'market',
  minStopPct: 0.5,
  stopPts: {},
  scaleOut: false,
  swingSize: DEFAULT_SWING_SIZE
};

const INDEX_KEY = 'sessions';
const ACTIVE_KEY = 'active-session';
/** Set once every session has been moved to a take-profit order at the 1R target. */
const ONE_R_KEY = 'migrated:1r-take-profit';
const sessionKey = (id: string) => `session:${id}`;

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function newSession(name: string, settings: SessionSettings = DEFAULT_SETTINGS): Session {
  return {
    id: uid(),
    name,
    createdAt: Date.now(),
    settings: { ...settings, stopPts: { ...settings.stopPts } },
    trades: [],
    levels: {},
    zones: {}
  };
}

const num = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const record = <T,>(value: unknown): Record<string, T[]> =>
  value && typeof value === 'object' ? (value as Record<string, T[]>) : {};

/** Brings a trade saved by an older version up to the current shape. */
function normalizeTrade(trade: TradeRecord): TradeRecord {
  // Trades saved while the coach existed carry its checks (`review`); they are dropped.
  const { review: _coachChecks, ...rest } = trade as TradeRecord & { review?: unknown };
  return {
    ...rest,
    setup: normalizeSetup(trade.setup),
    setupType: normalizeSetupType(trade.setupType),
    tags: Array.isArray(trade.tags) ? trade.tags : []
  };
}

function normalizeStopPts(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object') return {};
  const entries = Object.entries(value as Record<string, unknown>).filter(
    (entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]) && entry[1] > 0
  );
  return Object.fromEntries(entries);
}

/** Coerces anything read from disk or a file into a well-formed session. */
function normalize(raw: unknown): Session | null {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw as Partial<Session>;
  if (typeof src.id !== 'string' || !Array.isArray(src.trades)) return null;
  const settings: Partial<SessionSettings> = src.settings ?? {};
  return {
    id: src.id,
    name: typeof src.name === 'string' && src.name.trim() ? src.name : 'Untitled',
    createdAt: num(src.createdAt, Date.now()),
    settings: {
      startBalance: num(settings.startBalance, DEFAULT_SETTINGS.startBalance),
      riskMode: settings.riskMode === 'usd' ? 'usd' : 'pct',
      riskPct: num(settings.riskPct, DEFAULT_SETTINGS.riskPct),
      riskFixedUsd: num(settings.riskFixedUsd, DEFAULT_SETTINGS.riskFixedUsd),
      feePct: num(settings.feePct, DEFAULT_SETTINGS.feePct),
      makerFeePct: num(settings.makerFeePct, DEFAULT_SETTINGS.makerFeePct),
      commissionFull: num(settings.commissionFull, DEFAULT_SETTINGS.commissionFull),
      commissionMicro: num(settings.commissionMicro, DEFAULT_SETTINGS.commissionMicro),
      maxContractsFull: Math.max(0, Math.floor(num(settings.maxContractsFull, DEFAULT_SETTINGS.maxContractsFull))),
      maxContractsMicro: Math.max(0, Math.floor(num(settings.maxContractsMicro, DEFAULT_SETTINGS.maxContractsMicro))),
      entryOrder: settings.entryOrder === 'limit' ? 'limit' : 'market',
      minStopPct: num(settings.minStopPct, DEFAULT_SETTINGS.minStopPct),
      stopPts: normalizeStopPts(settings.stopPts),
      scaleOut: typeof settings.scaleOut === 'boolean' ? settings.scaleOut : DEFAULT_SETTINGS.scaleOut,
      swingSize: Math.max(1, Math.round(num(settings.swingSize, DEFAULT_SETTINGS.swingSize)))
    },
    trades: uniqueTrades(src.trades.filter((t) => t && typeof t.id === 'string' && Number.isFinite(t.r))).map(
      normalizeTrade
    ),
    levels: record<Level>(src.levels),
    zones: record<Zone>(src.zones)
  };
}

class SessionsStore {
  // Starts with an in-memory session so `active` is never undefined; init()
  // replaces it with whatever is on disk.
  list = $state<Session[]>([newSession('Default')]);
  activeId = $state('');
  ready = $state(false);

  active = $derived(this.list.find((session) => session.id === this.activeId) ?? this.list[0]);
  settings = $derived(this.active.settings);
  trades = $derived(this.active.trades);
  balance = $derived(this.settings.startBalance + this.trades.reduce((total, trade) => total + trade.pnl, 0));
  /** $ risked on the next trade. */
  riskUsd = $derived(
    this.settings.riskMode === 'usd' ? this.settings.riskFixedUsd : (this.balance * this.settings.riskPct) / 100
  );

  #saveTimers = new Map<string, ReturnType<typeof setTimeout>>();

  async init(): Promise<void> {
    if (this.ready) return;
    const ids = (await storage.get<string[]>(INDEX_KEY)) ?? [];
    const loaded = (await Promise.all(ids.map((id) => storage.get<unknown>(sessionKey(id)))))
      .map(normalize)
      .filter((session): session is Session => session !== null);

    if (loaded.length > 0) {
      // Trading moved from 2R with partials to a fixed 1R: once, every session
      // takes profit at the target. It can still be switched back on the ticket.
      if (!(await storage.get<boolean>(ONE_R_KEY))) {
        for (const session of loaded) {
          session.settings.scaleOut = false;
          this.#saveNow(session);
        }
        void storage.set(ONE_R_KEY, true);
      }
      this.list = loaded;
      const activeId = await storage.get<string>(ACTIVE_KEY);
      this.activeId = loaded.some((session) => session.id === activeId) ? activeId! : loaded[0].id;
    } else {
      this.activeId = this.list[0].id;
      this.#saveNow(this.list[0]);
      this.#saveIndex();
    }
    this.ready = true;
  }

  // ---- persistence ----

  #saveIndex(): void {
    void storage.set(INDEX_KEY, this.list.map((session) => session.id));
    void storage.set(ACTIVE_KEY, this.activeId);
  }

  #saveNow(session: Session): void {
    void storage.set(sessionKey(session.id), $state.snapshot(session));
  }

  /** Debounced, so dragging a level or typing in a field is one write. */
  #save(session: Session = this.active): void {
    const pending = this.#saveTimers.get(session.id);
    if (pending) clearTimeout(pending);
    this.#saveTimers.set(
      session.id,
      setTimeout(() => {
        this.#saveTimers.delete(session.id);
        if (this.list.some((s) => s.id === session.id)) this.#saveNow(session);
      }, 250)
    );
  }

  // ---- sessions ----

  #add(session: Session): Session {
    this.list.push(session);
    this.activeId = session.id;
    this.#saveNow(session);
    this.#saveIndex();
    return session;
  }

  #uniqueName(base: string): string {
    const names = new Set(this.list.map((session) => session.name));
    if (!names.has(base)) return base;
    let n = 2;
    while (names.has(`${base} ${n}`)) n++;
    return `${base} ${n}`;
  }

  create(name: string): Session {
    return this.#add(newSession(this.#uniqueName(name.trim() || 'New session'), this.settings));
  }

  rename(id: string, name: string): void {
    const session = this.list.find((s) => s.id === id);
    const trimmed = name.trim();
    if (!session || !trimmed) return;
    session.name = trimmed;
    this.#save(session);
  }

  switchTo(id: string): void {
    if (!this.list.some((session) => session.id === id)) return;
    this.activeId = id;
    this.#saveIndex();
  }

  /** Copies a session — trades, screenshots, candles and replay position — under new ids. */
  async duplicate(id: string): Promise<Session | null> {
    const source = this.list.find((s) => s.id === id);
    if (!source) return null;
    const copy = $state.snapshot(source) as Session;
    copy.id = uid();
    copy.name = this.#uniqueName(`${source.name} copy`);
    copy.createdAt = Date.now();
    for (const trade of copy.trades) {
      const oldId = trade.id;
      trade.id = uid();
      if (!trade.hasScreenshot) continue;
      const blob = await screenshots.load(oldId);
      trade.hasScreenshot = blob ? await screenshots.save(trade.id, blob) : false;
    }
    await sessionData.copy(source.id, copy.id, uid());
    return this.#add(copy);
  }

  /** Deletes a session with its screenshots and candles. There is always at least one session. */
  remove(id: string): void {
    const session = this.list.find((s) => s.id === id);
    if (!session) return;
    for (const trade of session.trades) void screenshots.remove(trade.id);
    void sessionData.remove(id);
    this.list = this.list.filter((s) => s.id !== id);
    void storage.del(sessionKey(id));
    if (this.list.length === 0) {
      this.#add(newSession('Default'));
      return;
    }
    if (this.activeId === id) this.activeId = this.list[0].id;
    this.#saveIndex();
  }

  updateSettings(patch: Partial<SessionSettings>): void {
    Object.assign(this.active.settings, patch);
    this.#save();
  }

  // ---- trades ----

  /** Journals a closed trade. A trade that is already in the journal is not added again. */
  addTrade(trade: TradeRecord): void {
    if (this.active.trades.some((t) => t.id === trade.id)) return;
    this.active.trades.push(trade);
    this.#save();
  }

  findTrade(id: string | null): TradeRecord | undefined {
    return id ? this.trades.find((trade) => trade.id === id) : undefined;
  }

  updateTrade(id: string, patch: Partial<TradeRecord>): void {
    const trade = this.trades.find((t) => t.id === id);
    if (!trade) return;
    Object.assign(trade, patch);
    this.#save();
  }

  deleteTrade(id: string): void {
    const session = this.active;
    session.trades = session.trades.filter((trade) => trade.id !== id);
    void screenshots.remove(id);
    this.#save(session);
  }

  resetTrades(): void {
    const session = this.active;
    for (const trade of session.trades) void screenshots.remove(trade.id);
    session.trades = [];
    this.#save(session);
  }

  // ---- levels ----

  levelsFor(coin: string | null | undefined): Level[] {
    return (coin && this.active.levels[coin]) || [];
  }

  addLevel(coin: string, price: number): Level {
    const level = { id: uid(), price };
    const levels = this.active.levels;
    levels[coin] = [...(levels[coin] ?? []), level];
    this.#save();
    return level;
  }

  moveLevel(coin: string, id: string, price: number): void {
    const level = this.active.levels[coin]?.find((l) => l.id === id);
    if (!level || level.price === price) return;
    level.price = price;
    this.#save();
  }

  removeLevel(coin: string, id: string): void {
    const levels = this.active.levels;
    if (!levels[coin]) return;
    levels[coin] = levels[coin].filter((level) => level.id !== id);
    this.#save();
  }

  // ---- zones ----

  zonesFor(coin: string | null | undefined): Zone[] {
    return (coin && this.active.zones[coin]) || [];
  }

  addZone(coin: string, shape: ZoneShape): Zone {
    const zone = { id: uid(), ...shape };
    const zones = this.active.zones;
    zones[coin] = [...(zones[coin] ?? []), zone];
    this.#save();
    return zone;
  }

  updateZone(coin: string, id: string, shape: ZoneShape): void {
    const zone = this.active.zones[coin]?.find((z) => z.id === id);
    if (!zone) return;
    Object.assign(zone, shape);
    this.#save();
  }

  removeZone(coin: string, id: string): void {
    const zones = this.active.zones;
    if (!zones[coin]) return;
    zones[coin] = zones[coin].filter((zone) => zone.id !== id);
    this.#save();
  }

  /** Removes every level and zone drawn on a coin. */
  clearDrawings(coin: string): void {
    delete this.active.levels[coin];
    delete this.active.zones[coin];
    this.#save();
  }

  // ---- import / export ----

  async exportFile(id: string = this.activeId): Promise<SessionFile | null> {
    const source = this.list.find((s) => s.id === id);
    if (!source) return null;
    const session = $state.snapshot(source) as Session;
    const shots: Record<string, string> = {};
    for (const trade of session.trades) {
      if (!trade.hasScreenshot) continue;
      const blob = await screenshots.load(trade.id);
      const dataUrl = blob ? await blobToDataUrl(blob) : null;
      if (dataUrl) shots[trade.id] = dataUrl;
    }
    return {
      format: 'replay-backtester-session',
      version: 2,
      session,
      screenshots: shots,
      ...(await sessionData.export(id))
    };
  }

  /** Adds a session from an exported file as a NEW session. Throws on a bad file. */
  async importFile(raw: unknown): Promise<Session> {
    const file = raw as Partial<SessionFile> | null;
    const session = file?.format === 'replay-backtester-session' ? normalize(file.session) : null;
    if (!file || !session) throw new Error('This is not a backtester session file.');

    const shots = file.screenshots && typeof file.screenshots === 'object' ? file.screenshots : {};
    session.id = uid();
    session.name = this.#uniqueName(session.name);
    for (const trade of session.trades) {
      const dataUrl = shots[trade.id];
      trade.id = uid();
      const blob = typeof dataUrl === 'string' ? await dataUrlToBlob(dataUrl) : null;
      trade.hasScreenshot = blob ? await screenshots.save(trade.id, blob) : false;
    }
    await sessionData.import(session.id, file, uid());
    return this.#add(session);
  }
}

export const sessions = new SessionsStore();
