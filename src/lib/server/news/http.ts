// Fetching for the news brief: one timeout, a polite gap per host, and a small
// cache so the page, the scheduler and the past-data test never ask the same
// free source twice in a row.

import { cacheGet, cachePut } from './store';

export class SourceError extends Error {
  constructor(
    message: string,
    readonly status = 502
  ) {
    super(message);
    this.name = 'SourceError';
  }
}

/** The shortest gap between two requests to a host, ms. */
const GAPS: Record<string, number> = {
  'api.nasdaq.com': 350,
  'api.gdeltproject.org': 5500,
  'news.google.com': 600,
  'economic-calendar.tradingview.com': 400
};

const lastAt = new Map<string, number>();
const queue = new Map<string, Promise<void>>();

/** Waits its turn for `host`, so requests to it go out one gap apart. */
function turn(host: string): Promise<void> {
  const gap = GAPS[host] ?? 0;
  if (gap === 0) return Promise.resolve();
  const prev = queue.get(host) ?? Promise.resolve();
  const next = prev.then(async () => {
    const wait = (lastAt.get(host) ?? 0) + gap - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastAt.set(host, Date.now());
  });
  queue.set(host, next);
  return next;
}

export interface GetOptions {
  /** How long a stored answer may be used, ms. Infinity keeps it for good (history does not change). */
  ttlMs?: number;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

const BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

/** The body of a GET, from the cache when fresh enough. */
export async function getText(url: string, opts: GetOptions = {}): Promise<string> {
  const ttl = opts.ttlMs ?? 0;
  if (ttl > 0) {
    const hit = cacheGet(url, ttl);
    if (hit != null) return hit;
  }
  const host = new URL(url).host;
  await turn(host);
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { 'User-Agent': BROWSER, Accept: '*/*', ...opts.headers },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000)
    });
  } catch (err) {
    throw new SourceError(`${host}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!res.ok) throw new SourceError(`${host} answered ${res.status}`, res.status);
  const body = await res.text();
  if (ttl > 0) cachePut(url, body);
  return body;
}

export async function getJson<T>(url: string, opts: GetOptions = {}): Promise<T> {
  const body = await getText(url, opts);
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new SourceError(`${new URL(url).host} sent something that is not JSON`);
  }
}
