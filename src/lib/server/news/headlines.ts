// Headlines from free feeds: Google News searches built from the tracked assets,
// plus a few direct feeds that are quick (the Fed's own releases, CNBC).

import { getText } from './http';
import { parseRss } from '$lib/news/rss';
import type { RawHeadline } from '$lib/news/noise';
import type { TrackedAsset } from '$lib/news/types';

const GOOGLE = 'https://news.google.com/rss/search';

const DIRECT_FEEDS: { url: string; source: string }[] = [
  { url: 'https://www.federalreserve.gov/feeds/press_all.xml', source: 'Federal Reserve' },
  { url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html', source: 'CNBC' },
  { url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10000664', source: 'CNBC' }
];

const quote = (k: string) => (/[\s+]/.test(k) ? `"${k}"` : k);

/** Search queries covering the tracked assets: markets together, stocks four at a time, topics together. */
export function buildQueries(assets: readonly TrackedAsset[]): string[] {
  const on = assets.filter((a) => a.enabled);
  const words = (list: TrackedAsset[]) => [...new Set(list.flatMap((a) => (a.keywords.length ? a.keywords : [a.symbol])))];
  const join = (list: string[]) => `(${list.map(quote).join(' OR ')})`;
  const queries: string[] = [];

  const markets = words(on.filter((a) => a.kind === 'market'));
  if (markets.length) queries.push(join(markets));

  const stocks = on.filter((a) => a.kind === 'stock');
  for (let i = 0; i < stocks.length; i += 4) queries.push(join(words(stocks.slice(i, i + 4))));

  const topics = on.filter((a) => a.kind === 'topic');
  for (let i = 0; i < topics.length; i += 3) queries.push(join(words(topics.slice(i, i + 3))));
  return queries;
}

export function googleUrl(query: string, range: { when?: string; after?: string; before?: string }): string {
  const parts = [query];
  if (range.when) parts.push(`when:${range.when}`);
  if (range.after) parts.push(`after:${range.after}`);
  if (range.before) parts.push(`before:${range.before}`);
  return `${GOOGLE}?q=${encodeURIComponent(parts.join(' '))}&hl=en-US&gl=US&ceid=US:en`;
}

export interface HeadlineFetch {
  items: RawHeadline[];
  /** Feeds that failed, for a plain note. The rest still counts. */
  failed: string[];
}

/** Hours back for Google's `when:` filter (it takes h or d). */
const whenFor = (ms: number) => (ms <= 36 * 3_600_000 ? `${Math.max(1, Math.ceil(ms / 3_600_000))}h` : `${Math.ceil(ms / 86_400_000)}d`);

/**
 * Recent headlines about the tracked assets, published after `sinceMs`. Used live
 * (and for the overnight list), so it only ever looks back from now.
 */
export async function fetchRecentHeadlines(
  assets: readonly TrackedAsset[],
  sinceMs: number,
  opts: { direct?: boolean; ttlMs?: number } = {}
): Promise<HeadlineFetch> {
  const now = Date.now();
  const ttlMs = opts.ttlMs ?? 60_000;
  const when = whenFor(Math.max(0, now - sinceMs) + 10 * 60_000);
  const failed: string[] = [];
  const all: RawHeadline[] = [];

  const jobs: Promise<void>[] = [];
  for (const q of buildQueries(assets)) {
    jobs.push(
      getText(googleUrl(q, { when }), { ttlMs })
        .then((xml) => void all.push(...parseRss(xml)))
        .catch((err) => void failed.push(`Google News: ${err instanceof Error ? err.message : err}`))
    );
  }
  if (opts.direct !== false) {
    for (const feed of DIRECT_FEEDS) {
      jobs.push(
        getText(feed.url, { ttlMs })
          .then((xml) => void all.push(...parseRss(xml, feed.source)))
          .catch((err) => void failed.push(`${feed.source}: ${err instanceof Error ? err.message : err}`))
      );
    }
  }
  await Promise.all(jobs);

  const seen = new Set<string>();
  const items = all.filter((h) => {
    if (h.publishedAt < sinceMs || h.publishedAt > now + 5 * 60_000 || seen.has(h.id)) return false;
    seen.add(h.id);
    return true;
  });
  return { items, failed };
}

/**
 * Headlines of the past days, one search per tracked asset so a story about a
 * single company is not drowned out by the others. Used by the news feed.
 */
export async function fetchFeedHeadlines(assets: readonly TrackedAsset[], sinceMs: number, ttlMs = 10 * 60_000): Promise<HeadlineFetch> {
  const now = Date.now();
  const when = whenFor(Math.max(0, now - sinceMs) + 2 * 3_600_000);
  const failed: string[] = [];
  const all: RawHeadline[] = [];
  await Promise.all(
    assets
      .filter((a) => a.enabled)
      .map((a) => {
        const words = a.keywords.length ? a.keywords : [a.symbol];
        const query = `(${words.map(quote).join(' OR ')})`;
        return getText(googleUrl(query, { when }), { ttlMs })
          .then((xml) => void all.push(...parseRss(xml)))
          .catch((err) => void failed.push(`Google News (${a.symbol}): ${err instanceof Error ? err.message : err}`));
      })
  );
  const seen = new Set<string>();
  const items = all.filter((h) => {
    if (h.publishedAt < sinceMs || h.publishedAt > now + 5 * 60_000 || seen.has(h.id)) return false;
    seen.add(h.id);
    return true;
  });
  return { items, failed };
}
