// The news brief's tables, beside the rest of the app's SQLite data.

import { db } from '../db';
import { DEFAULT_ASSETS, DEFAULT_SETTINGS } from '$lib/news/defaults';
import type {
  AlertRecord,
  AssetKind,
  Brief,
  BriefKind,
  HeadlineItem,
  Impact,
  NewsSettings,
  TrackedAsset
} from '$lib/news/types';

db.exec(`
  CREATE TABLE IF NOT EXISTS news_assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL CHECK(kind IN ('market','stock','topic')),
    symbol TEXT NOT NULL,
    name TEXT NOT NULL,
    keywords TEXT NOT NULL DEFAULT '[]',
    enabled INTEGER NOT NULL DEFAULT 1,
    builtin INTEGER NOT NULL DEFAULT 0,
    sort INTEGER NOT NULL DEFAULT 0,
    UNIQUE(kind, symbol)
  );
  CREATE TABLE IF NOT EXISTS news_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS news_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS news_briefs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    for_date TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    payload TEXT NOT NULL,
    discord_sent_at INTEGER,
    UNIQUE(kind, for_date)
  );
  CREATE TABLE IF NOT EXISTS news_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at INTEGER NOT NULL,
    payload TEXT NOT NULL,
    discord_sent_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_news_alerts_created ON news_alerts (created_at);
  CREATE TABLE IF NOT EXISTS news_seen (key TEXT PRIMARY KEY, title TEXT NOT NULL, seen_at INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS idx_news_seen_at ON news_seen (seen_at);
  CREATE TABLE IF NOT EXISTS news_cache (key TEXT PRIMARY KEY, fetched_at INTEGER NOT NULL, body TEXT NOT NULL);
`);

// ---- tracked assets ----

interface AssetRow {
  id: number;
  kind: AssetKind;
  symbol: string;
  name: string;
  keywords: string;
  enabled: number;
  builtin: number;
}

const toAsset = (r: AssetRow): TrackedAsset => ({
  id: r.id,
  kind: r.kind,
  symbol: r.symbol,
  name: r.name,
  keywords: JSON.parse(r.keywords) as string[],
  enabled: r.enabled === 1,
  builtin: r.builtin === 1
});

const stmtAssets = db.prepare('SELECT id, kind, symbol, name, keywords, enabled, builtin FROM news_assets ORDER BY sort, id');
const stmtInsertAsset = db.prepare(`
  INSERT INTO news_assets (kind, symbol, name, keywords, enabled, builtin, sort)
  VALUES (?, ?, ?, ?, 1, ?, ?)
  ON CONFLICT(kind, symbol) DO NOTHING
`);

function stateGet(key: string): string | null {
  const row = db.prepare('SELECT value FROM news_state WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function stateSet(key: string, value: unknown): void {
  db.prepare('INSERT INTO news_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    key,
    JSON.stringify(value)
  );
}

export function stateRead<T>(key: string, fallback: T): T {
  const raw = stateGet(key);
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Puts the starting set in on first use. After that the user's list is theirs. */
function seed(): void {
  if (stateGet('assetsSeeded')) return;
  restoreDefaultAssets();
  stateSet('assetsSeeded', true);
}

/** Adds back any starting asset that is missing. Does not touch the rest. */
export function restoreDefaultAssets(): number {
  const before = (stmtAssets.all() as AssetRow[]).length;
  DEFAULT_ASSETS.forEach((a, i) => stmtInsertAsset.run(a.kind, a.symbol, a.name, JSON.stringify(a.keywords), 1, i));
  return (stmtAssets.all() as AssetRow[]).length - before;
}

export function listAssets(): TrackedAsset[] {
  seed();
  return (stmtAssets.all() as AssetRow[]).map(toAsset);
}

export interface NewAsset {
  kind: AssetKind;
  symbol: string;
  name?: string;
  keywords?: string[];
}

export function addAsset(input: NewAsset): TrackedAsset {
  seed();
  const symbol = input.symbol.trim().toUpperCase().slice(0, 24);
  if (!symbol) throw new Error('A symbol or topic name is required.');
  const name = (input.name ?? '').trim() || symbol;
  const keywords = [...new Set((input.keywords ?? []).map((k) => k.trim()).filter(Boolean))];
  // A plain ticker or name always counts as a keyword, so adding "AMD" tracks AMD.
  if (!keywords.some((k) => k.toLowerCase() === symbol.toLowerCase())) keywords.unshift(input.kind === 'topic' ? name : symbol);
  const max = (db.prepare('SELECT COALESCE(MAX(sort), 0) AS m FROM news_assets').get() as { m: number }).m;
  const existing = db.prepare('SELECT id FROM news_assets WHERE kind = ? AND symbol = ?').get(input.kind, symbol) as
    | { id: number }
    | undefined;
  if (existing) {
    db.prepare('UPDATE news_assets SET enabled = 1, name = ?, keywords = ? WHERE id = ?').run(name, JSON.stringify(keywords), existing.id);
    return toAsset(db.prepare('SELECT * FROM news_assets WHERE id = ?').get(existing.id) as AssetRow);
  }
  stmtInsertAsset.run(input.kind, symbol, name, JSON.stringify(keywords), 0, max + 1);
  return toAsset(db.prepare('SELECT * FROM news_assets WHERE kind = ? AND symbol = ?').get(input.kind, symbol) as AssetRow);
}

export function updateAsset(id: number, patch: { enabled?: boolean; name?: string; keywords?: string[] }): void {
  if (patch.enabled != null) db.prepare('UPDATE news_assets SET enabled = ? WHERE id = ?').run(patch.enabled ? 1 : 0, id);
  if (patch.name != null && patch.name.trim()) db.prepare('UPDATE news_assets SET name = ? WHERE id = ?').run(patch.name.trim(), id);
  if (patch.keywords) {
    const keywords = [...new Set(patch.keywords.map((k) => k.trim()).filter(Boolean))];
    db.prepare('UPDATE news_assets SET keywords = ? WHERE id = ?').run(JSON.stringify(keywords), id);
  }
}

export function removeAsset(id: number): void {
  db.prepare('DELETE FROM news_assets WHERE id = ?').run(id);
}

// ---- settings ----

export function getSettings(): NewsSettings {
  const rows = db.prepare('SELECT key, value FROM news_settings').all() as { key: string; value: string }[];
  const stored: Record<string, unknown> = {};
  for (const r of rows) {
    try {
      stored[r.key] = JSON.parse(r.value);
    } catch {
      // A value that cannot be read is a value not set.
    }
  }
  return sanitizeSettings({ ...DEFAULT_SETTINGS, ...stored });
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const IMPACT_VALUES: Impact[] = ['low', 'medium', 'high'];

export function sanitizeSettings(raw: Record<string, unknown>): NewsSettings {
  const d = DEFAULT_SETTINGS;
  const time = (v: unknown, fb: string) => (typeof v === 'string' && HHMM.test(v) ? v : fb);
  const int = (v: unknown, fb: number, min: number, max: number) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fb;
  };
  const windows = Array.isArray(raw.alertWindows)
    ? (raw.alertWindows as { start?: unknown; end?: unknown }[])
        .filter((w) => typeof w?.start === 'string' && typeof w?.end === 'string' && HHMM.test(w.start) && HHMM.test(w.end) && w.start < w.end)
        .map((w) => ({ start: w.start as string, end: w.end as string }))
    : d.alertWindows;
  return {
    model: typeof raw.model === 'string' && raw.model.trim() ? raw.model.trim().slice(0, 120) : d.model,
    morningTime: time(raw.morningTime, d.morningTime),
    weeklyDay: int(raw.weeklyDay, d.weeklyDay, 0, 6),
    weeklyTime: time(raw.weeklyTime, d.weeklyTime),
    alertWindows: windows.length > 0 ? windows.slice(0, 4) : d.alertWindows,
    alertMinImpact: IMPACT_VALUES.includes(raw.alertMinImpact as Impact) ? (raw.alertMinImpact as Impact) : d.alertMinImpact,
    maxAlertsPerHour: int(raw.maxAlertsPerHour, d.maxAlertsPerHour, 1, 12),
    pollMinutes: int(raw.pollMinutes, d.pollMinutes, 1, 15),
    freshMinutes: int(raw.freshMinutes, d.freshMinutes, 5, 180),
    discordBrief: raw.discordBrief !== false,
    discordAlerts: raw.discordAlerts !== false,
    discordWeekly: raw.discordWeekly !== false,
    moveAlerts: raw.moveAlerts !== false,
    moveAlertRatio: Math.min(5, Math.max(1.5, Number(raw.moveAlertRatio) || d.moveAlertRatio)),
    showLow: raw.showLow === true
  };
}

export function saveSettings(patch: Partial<NewsSettings>): NewsSettings {
  const next = sanitizeSettings({ ...getSettings(), ...patch });
  const put = db.prepare('INSERT INTO news_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const [key, value] of Object.entries(next)) put.run(key, JSON.stringify(value));
  return next;
}

// ---- briefs ----

interface BriefRow {
  kind: BriefKind;
  for_date: string;
  created_at: number;
  payload: string;
  discord_sent_at: number | null;
}

export interface StoredBrief {
  brief: Brief;
  discordSentAt: number | null;
}

const toStored = (r: BriefRow): StoredBrief => ({ brief: JSON.parse(r.payload) as Brief, discordSentAt: r.discord_sent_at });

export function saveBrief(brief: Brief): void {
  db.prepare(
    `INSERT INTO news_briefs (kind, for_date, created_at, payload) VALUES (?, ?, ?, ?)
     ON CONFLICT(kind, for_date) DO UPDATE SET created_at = excluded.created_at, payload = excluded.payload`
  ).run(brief.kind, brief.forDate, brief.generatedAt, JSON.stringify(brief));
}

export function getBrief(kind: BriefKind, forDate: string): StoredBrief | null {
  const row = db.prepare('SELECT * FROM news_briefs WHERE kind = ? AND for_date = ?').get(kind, forDate) as BriefRow | undefined;
  return row ? toStored(row) : null;
}

export function latestBrief(kind: BriefKind): StoredBrief | null {
  const row = db.prepare('SELECT * FROM news_briefs WHERE kind = ? ORDER BY for_date DESC LIMIT 1').get(kind) as BriefRow | undefined;
  return row ? toStored(row) : null;
}

export function listBriefDates(kind: BriefKind, limit = 14): string[] {
  return (db.prepare('SELECT for_date FROM news_briefs WHERE kind = ? ORDER BY for_date DESC LIMIT ?').all(kind, limit) as { for_date: string }[]).map(
    (r) => r.for_date
  );
}

export function markBriefSent(kind: BriefKind, forDate: string): void {
  db.prepare('UPDATE news_briefs SET discord_sent_at = ? WHERE kind = ? AND for_date = ?').run(Date.now(), kind, forDate);
}

// ---- alerts ----

interface AlertRow {
  id: number;
  created_at: number;
  payload: string;
  discord_sent_at: number | null;
}

const toAlert = (r: AlertRow): AlertRecord => ({
  ...(JSON.parse(r.payload) as HeadlineItem),
  createdAt: r.created_at,
  discordSentAt: r.discord_sent_at
});

export function addAlert(item: HeadlineItem, createdAt = Date.now()): number {
  return Number(db.prepare('INSERT INTO news_alerts (created_at, payload) VALUES (?, ?)').run(createdAt, JSON.stringify(item)).lastInsertRowid);
}

export function markAlertSent(id: number): void {
  db.prepare('UPDATE news_alerts SET discord_sent_at = ? WHERE id = ?').run(Date.now(), id);
}

export function recentAlerts(sinceMs: number, limit = 50): AlertRecord[] {
  return (db.prepare('SELECT * FROM news_alerts WHERE created_at >= ? ORDER BY created_at DESC LIMIT ?').all(sinceMs, limit) as AlertRow[]).map(toAlert);
}

// ---- headlines already looked at ----

export function seenKeys(keys: string[]): Set<string> {
  if (keys.length === 0) return new Set();
  const found = new Set<string>();
  const stmt = db.prepare('SELECT key FROM news_seen WHERE key = ?');
  for (const k of keys) if (stmt.get(k)) found.add(k);
  return found;
}

export function seenTitles(sinceMs: number): string[] {
  return (db.prepare('SELECT title FROM news_seen WHERE seen_at >= ?').all(sinceMs) as { title: string }[]).map((r) => r.title);
}

export function markSeen(items: { key: string; title: string }[], at = Date.now()): void {
  const put = db.prepare('INSERT INTO news_seen (key, title, seen_at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING');
  const tx = db.transaction((list: { key: string; title: string }[]) => {
    for (const i of list) put.run(i.key, i.title, at);
  });
  tx(items);
}

export function pruneSeen(olderThanMs: number): void {
  db.prepare('DELETE FROM news_seen WHERE seen_at < ?').run(olderThanMs);
}

// ---- fetch cache ----

export function cacheGet(key: string, ttlMs: number): string | null {
  const row = db.prepare('SELECT fetched_at, body FROM news_cache WHERE key = ?').get(key) as { fetched_at: number; body: string } | undefined;
  if (!row) return null;
  return Date.now() - row.fetched_at <= ttlMs ? row.body : null;
}

export function cachePut(key: string, body: string): void {
  db.prepare('INSERT INTO news_cache (key, fetched_at, body) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET fetched_at = excluded.fetched_at, body = excluded.body').run(
    key,
    Date.now(),
    body
  );
}
