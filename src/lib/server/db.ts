import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const dbPath = process.env.DB_PATH ?? './data/market-bot.db';
mkdirSync(dirname(dbPath), { recursive: true });

// Exported for the news brief, which keeps its own tables beside these (see server/news/store.ts).
export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// Dropped along with the rest of the AI analysis feature — see analysis_cache below.
db.exec('DROP TABLE IF EXISTS token_cache');
db.exec('DROP TABLE IF EXISTS analysis_cache');
// Dropped along with the pump.fun migration feature.
db.exec('DROP TABLE IF EXISTS pump_migrations');

db.exec(`
  -- first_seen_at is the actual creation moment, only ever set once per
  -- symbol (see recordKnownSymbols) — this is what lets the screener answer
  -- "which coins are new," not just "which coins currently exist."
  CREATE TABLE IF NOT EXISTS kcex_tokens (
    symbol TEXT PRIMARY KEY,
    first_seen_at INTEGER NOT NULL
  );

  -- target_price/direction are nullable: a row can just mean "keep this
  -- symbol on my watchlist" with no price alert armed at all.
  CREATE TABLE IF NOT EXISTS perp_watchlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL,
    target_price REAL,
    direction TEXT CHECK(direction IS NULL OR direction IN ('ABOVE', 'BELOW')),
    armed INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    triggered_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_perp_watchlist_armed ON perp_watchlist (armed);
`);

// Dropped along with the backtest/replay feature.
db.exec('DROP TABLE IF EXISTS backtest_trades');
// Dropped along with the trade journal feature.
db.exec('DROP TABLE IF EXISTS journal_entries');

// One-off migrations for columns that predate the above (SQLite can't alter
// a column's NOT NULL/CHECK constraint in place, so this rebuilds the table
// when the old shape is detected — cheap, these tables are tiny).
const legacyKcexTokens = db.prepare("SELECT 1 FROM pragma_table_info('kcex_tokens') WHERE name = 'last_seen_at'").get();
if (legacyKcexTokens) {
  // last_seen_at was overwritten to "now" on every poll under the old schema,
  // so it carries no real first-seen information — backdate to 0 (never
  // "new") rather than treating the whole existing market as freshly listed.
  db.exec(`
    ALTER TABLE kcex_tokens RENAME TO kcex_tokens_old;
    CREATE TABLE kcex_tokens (symbol TEXT PRIMARY KEY, first_seen_at INTEGER NOT NULL);
    INSERT INTO kcex_tokens (symbol, first_seen_at) SELECT symbol, 0 FROM kcex_tokens_old;
    DROP TABLE kcex_tokens_old;
  `);
}

const legacyPerpWatchlist = db.prepare(
  "SELECT 1 FROM pragma_table_info('perp_watchlist') WHERE name = 'target_price' AND \"notnull\" = 1"
).get();
if (legacyPerpWatchlist) {
  db.exec(`
    ALTER TABLE perp_watchlist RENAME TO perp_watchlist_old;
    CREATE TABLE perp_watchlist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      target_price REAL,
      direction TEXT CHECK(direction IS NULL OR direction IN ('ABOVE', 'BELOW')),
      armed INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      triggered_at INTEGER
    );
    INSERT INTO perp_watchlist SELECT * FROM perp_watchlist_old;
    DROP TABLE perp_watchlist_old;
    CREATE INDEX IF NOT EXISTS idx_perp_watchlist_armed ON perp_watchlist (armed);
  `);
}

// --- Known symbols (new-listing detection + screener "is this new" lookups) ---

const stmtGetKnownSymbols = db.prepare('SELECT symbol FROM kcex_tokens');
const stmtUpsertKnownSymbol = db.prepare(`
  INSERT INTO kcex_tokens (symbol, first_seen_at) VALUES (?, ?)
  ON CONFLICT(symbol) DO NOTHING
`);
const stmtGetFirstSeenMap = db.prepare('SELECT symbol, first_seen_at FROM kcex_tokens');

export function getKnownSymbols(): Set<string> {
  const rows = stmtGetKnownSymbols.all() as { symbol: string }[];
  return new Set(rows.map((row) => row.symbol));
}

const recordKnownSymbolsTx = db.transaction((symbols: string[], now: number) => {
  for (const symbol of symbols) stmtUpsertKnownSymbol.run(symbol, now);
});

// Only inserts symbols we haven't seen before — existing symbols keep their
// original first_seen_at, which is what makes "new in the last 24h" queries possible.
export function recordKnownSymbols(symbols: string[]): void {
  recordKnownSymbolsTx(symbols, Date.now());
}

export function getSymbolFirstSeenMap(): Map<string, number> {
  const rows = stmtGetFirstSeenMap.all() as { symbol: string; first_seen_at: number }[];
  return new Map(rows.map((row) => [row.symbol, row.first_seen_at]));
}

// --- Perp watchlist (price target alerts) ---

export interface PerpWatch {
  id: number;
  symbol: string;
  targetPrice: number | null;
  direction: 'ABOVE' | 'BELOW' | null;
  armed: boolean;
  createdAt: number;
  triggeredAt: number | null;
}

type PerpWatchRow = {
  id: number;
  symbol: string;
  target_price: number | null;
  direction: 'ABOVE' | 'BELOW' | null;
  armed: number;
  created_at: number;
  triggered_at: number | null;
};

function mapPerpWatch(row: PerpWatchRow): PerpWatch {
  return {
    id: row.id,
    symbol: row.symbol,
    targetPrice: row.target_price,
    direction: row.direction,
    armed: row.armed === 1,
    createdAt: row.created_at,
    triggeredAt: row.triggered_at,
  };
}

const stmtGetPerpWatchlist = db.prepare(`
  SELECT id, symbol, target_price, direction, armed, created_at, triggered_at
  FROM perp_watchlist ORDER BY id DESC
`);
const stmtGetPerpWatchById = db.prepare(`
  SELECT id, symbol, target_price, direction, armed, created_at, triggered_at
  FROM perp_watchlist WHERE id = ?
`);
const stmtAddPerpWatch = db.prepare(`
  INSERT INTO perp_watchlist (symbol, target_price, direction, armed, created_at)
  VALUES (?, ?, ?, 1, ?)
`);
const stmtDeletePerpWatch = db.prepare('DELETE FROM perp_watchlist WHERE id = ?');
const stmtSetPerpWatchArmed = db.prepare(`
  UPDATE perp_watchlist
  SET armed = ?, triggered_at = CASE WHEN ? = 1 THEN NULL ELSE triggered_at END
  WHERE id = ?
`);
const stmtMarkPerpWatchTriggered = db.prepare('UPDATE perp_watchlist SET armed = 0, triggered_at = ? WHERE id = ?');

export function getPerpWatchlist(): PerpWatch[] {
  return (stmtGetPerpWatchlist.all() as PerpWatchRow[]).map(mapPerpWatch);
}

export function addPerpWatch(symbol: string, targetPrice: number | null, direction: 'ABOVE' | 'BELOW' | null): PerpWatch {
  const result = stmtAddPerpWatch.run(symbol, targetPrice, direction, Date.now());
  return mapPerpWatch(stmtGetPerpWatchById.get(Number(result.lastInsertRowid)) as PerpWatchRow);
}

export function deletePerpWatch(id: number): void {
  stmtDeletePerpWatch.run(id);
}

export function setPerpWatchArmed(id: number, armed: boolean): void {
  stmtSetPerpWatchArmed.run(armed ? 1 : 0, armed ? 1 : 0, id);
}

export function markPerpWatchTriggered(id: number): void {
  stmtMarkPerpWatchTriggered.run(Date.now(), id);
}
