// IndexedDB access via idb-keyval. Every call is wrapped: if storage is
// blocked, full or missing, the app keeps working in memory and `storage.failed`
// flips so the UI can say that nothing is being saved.

import { createStore, del, get, keys, set, type UseStore } from 'idb-keyval';

const DB_NAME = 'replay-backtester';
const STORE_NAME = 'kv';

/**
 * Whether the browser has promised to keep this site's data.
 *  - persistent: it will not be cleared unless you clear it yourself.
 *  - best-effort: the browser may delete it without asking, for example when
 *    the disk runs low or the site has not been used for a while.
 */
export type Durability = 'unknown' | 'persistent' | 'best-effort';

let store: UseStore | null | undefined;
let failed = $state(false);
let durability = $state<Durability>('unknown');

function fail(action: string, err: unknown): void {
  failed = true;
  console.warn(`Backtester storage: ${action} failed`, err);
}

function getStore(): UseStore | null {
  if (store !== undefined) return store;
  try {
    store = createStore(DB_NAME, STORE_NAME);
  } catch (err) {
    fail('open', err);
    store = null;
  }
  return store;
}

export const storage = {
  /** True once any read or write has failed. */
  get failed() {
    return failed;
  },

  get durability() {
    return durability;
  },

  /**
   * Asks the browser to treat this site's data as persistent, so saved
   * sessions and candles are not evicted behind your back. Safe to call on
   * every start: it is a no-op once granted.
   */
  async requestPersistence(): Promise<void> {
    try {
      const manager = navigator.storage;
      if (!manager?.persist || !manager.persisted) return;
      durability = (await manager.persisted()) || (await manager.persist()) ? 'persistent' : 'best-effort';
    } catch {
      // Not supported here; saving still works.
    }
  },

  async get<T>(key: string): Promise<T | undefined> {
    try {
      const db = getStore();
      return db ? await get<T>(key, db) : undefined;
    } catch (err) {
      fail(`read ${key}`, err);
      return undefined;
    }
  },

  async set(key: string, value: unknown): Promise<boolean> {
    try {
      const db = getStore();
      if (!db) return false;
      await set(key, value, db);
      return true;
    } catch (err) {
      fail(`write ${key}`, err);
      return false;
    }
  },

  async del(key: string): Promise<void> {
    try {
      const db = getStore();
      if (db) await del(key, db);
    } catch (err) {
      fail(`delete ${key}`, err);
    }
  },

  /** Every stored key that starts with `prefix`. */
  async keys(prefix: string): Promise<string[]> {
    try {
      const db = getStore();
      if (!db) return [];
      const all = await keys<IDBValidKey>(db);
      return all.filter((key): key is string => typeof key === 'string' && key.startsWith(prefix));
    } catch (err) {
      fail(`list ${prefix}`, err);
      return [];
    }
  }
};

const shotKey = (tradeId: string) => `shot:${tradeId}`;

/** Chart screenshots, one per trade. */
export const screenshots = {
  save: (tradeId: string, blob: Blob) => storage.set(shotKey(tradeId), blob),
  load: (tradeId: string) => storage.get<Blob>(shotKey(tradeId)),
  remove: (tradeId: string) => storage.del(shotKey(tradeId))
};

export function blobToDataUrl(blob: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
}

export async function dataUrlToBlob(dataUrl: string): Promise<Blob | null> {
  try {
    // Only ever decode inline image data — never fetch a URL from an imported file.
    if (!dataUrl.startsWith('data:image/')) return null;
    return await (await fetch(dataUrl)).blob();
  } catch {
    return null;
  }
}
