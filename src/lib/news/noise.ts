// Cuts the noise before anything reaches the AI or an alert: duplicates, analyst
// chatter, listicles, anything that does not touch a tracked asset. Fewer, better
// alerts beat lots of alerts, and every headline kept out here is a call saved.

import type { TrackedAsset } from './types';

export interface RawHeadline {
  id: string;
  title: string;
  source: string;
  url: string;
  publishedAt: number;
}

/** Google News titles end with " - Source". Splits that off. */
export function splitSource(title: string, source?: string): { headline: string; source: string } {
  const clean = title.replace(/\s+/g, ' ').trim();
  const at = clean.lastIndexOf(' - ');
  if (at > 20) {
    const tail = clean.slice(at + 3);
    if (tail.length <= 40) return { headline: clean.slice(0, at).trim(), source: source || tail };
  }
  return { headline: clean, source: source ?? '' };
}

const STOP = new Set(
  'a an the of to in on at for and or but is are was were be been as by with from after before over under up down out new says say said will its it this that these those into amid vs about than more'.split(
    ' '
  )
);

/** Lowercase words of a title that carry meaning. */
export function tokens(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9$%.\s]/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^\.+|\.+$/g, ''))
    .filter((w) => w.length > 1 && !STOP.has(w));
}

export function similarity(a: string, b: string): number {
  const x = new Set(tokens(a));
  const y = new Set(tokens(b));
  if (x.size === 0 || y.size === 0) return 0;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / (x.size + y.size - both);
}

/** Whether `title` is about the same story as anything in `others`. */
export function isDuplicate(title: string, others: readonly string[], threshold = 0.5): boolean {
  return others.some((o) => similarity(title, o) >= threshold);
}

/** Drops repeats inside `items` and anything that matches a title already seen. Keeps the earliest of a repeat. */
export function dedupeHeadlines<T extends { title: string; publishedAt: number }>(
  items: readonly T[],
  seen: readonly string[] = []
): T[] {
  const out: T[] = [];
  const titles = [...seen];
  for (const item of [...items].sort((a, b) => a.publishedAt - b.publishedAt)) {
    if (isDuplicate(item.title, titles)) continue;
    out.push(item);
    titles.push(item.title);
  }
  return out;
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const matchers = new Map<string, RegExp>();

/** A keyword as a regex. Short capitalised ones (Fed, CPI, NVDA) must match case; the rest ignore case. */
function keywordRegex(keyword: string): RegExp {
  let re = matchers.get(keyword);
  if (!re) {
    const caseSensitive = keyword.length <= 4 && /^[A-Z]/.test(keyword);
    re = new RegExp(`(?<![A-Za-z0-9])${escapeRegex(keyword)}(?![A-Za-z0-9])`, caseSensitive ? '' : 'i');
    matchers.set(keyword, re);
  }
  return re;
}

/** The tracked assets a piece of text is about. */
export function matchAssets(text: string, assets: readonly TrackedAsset[]): TrackedAsset[] {
  return assets.filter((a) => {
    if (!a.enabled) return false;
    const words = a.keywords.length > 0 ? a.keywords : [a.symbol];
    return words.some((k) => k.trim() && keywordRegex(k.trim()).test(text));
  });
}

const JUNK = new RegExp(
  [
    'stocks? to buy',
    'should you buy',
    'buy now',
    'best stocks?',
    'top \\d+',
    '\\d+ (?:best|top|reasons|things|stocks)',
    'price target',
    'analysts? (?:say|rate|raise|cut|lift|initiate|predict|expect|see|sees)',
    '(?:upgrade|downgrade)[sd]?\\b',
    'initiates? coverage',
    'reiterates?',
    'motley fool',
    'zacks',
    'investor\'?s business daily',
    'here\'?s why',
    'what to know',
    'things to know',
    'what you need to know',
    'opinion',
    'horoscope',
    'podcast',
    'webinar',
    'sponsored',
    'sweepstakes',
    'how to (?:invest|buy)',
    'is it a buy',
    'wall street (?:says|expects|thinks)',
    'could (?:make you|turn)',
    'millionaire',
    'dividend (?:stock|king|aristocrat)',
    'passive income'
  ].join('|'),
  'i'
);

/** Analyst chatter, listicles and clickbait. */
export const isJunk = (title: string): boolean => JUNK.test(title);

const BIG: RegExp[] = [
  /\b(?:emergency|unscheduled)\b/i,
  /\b(?:rate\s+(?:cut|hike|decision)|cuts?\s+rates|raises?\s+rates|holds?\s+rates|FOMC|Powell|Federal Reserve|Fed\s+(?:chair|governor|official|minutes))\b/,
  /\b(?:invasion|invades?|airstrike|air strike|missile|drone strike|attack(?:s|ed)?|bomb(?:s|ing)?|blockade|ceasefire|cease-fire|troops|war)\b/i,
  /\b(?:sanctions?|embargo|tariffs?|trade war|export (?:ban|controls?)|chip ban)\b/i,
  /\b(?:OPEC\+?|output cut|production cut|Hormuz|pipeline|refinery|oil (?:supply|inventories|stocks))\b/i,
  /\b(?:resigns?|steps? down|fired|ousted|indicted?|arrested|subpoena|criminal|fraud|scandal|investigation|probe|affair|divorce|infidelity|cheat(?:ed|ing)|allegations?|accused|harassment|misconduct)\b/i,
  /\b(?:antitrust|lawsuit|sues?|sued|fine[sd]?|ban(?:s|ned)?|recall|breach|outage|shutdown|halts?)\b/i,
  /\b(?:acquires?|acquisition|merger|takeover|buyout|spin-?off|stake|billion deal|\$\d+(?:\.\d+)?\s*(?:billion|bn)\b)/i,
  /\b(?:earnings|guidance|revenue forecast|profit warning|warns?)\b/i,
  /\b(?:bankruptcy|default|downgrade of|debt ceiling|government shutdown)\b/i,
  /\b(?:CPI|PPI|PCE|payrolls|jobs report|unemployment)\b/
];

/** Signals that something is out of the ordinary: each one counts for an extra point. */
const CRITICAL = /\b(?:emergency|unscheduled|invasion|invades?|declares? war|airstrike|missile strike|bankruptcy|defaults?)\b/i;

/** How many "this might be big" signals a headline carries, 0 to 4. */
export function bigHint(title: string): number {
  let n = 0;
  for (const re of BIG) if (re.test(title)) n++;
  if (n > 0 && CRITICAL.test(title)) n++;
  return Math.min(4, n);
}

const TOP_SOURCES =
  /reuters|bloomberg|associated press|\bap\b|wall street journal|\bwsj\b|financial times|\bft\b|cnbc|marketwatch|barron|the economist|bbc|axios|politico|federal reserve|treasury|white house|sec\.gov|eia\b/i;

/** 1 for a major outlet, 0 for the rest. */
export const sourceRank = (source: string): number => (TOP_SOURCES.test(source) ? 1 : 0);

export interface Candidate extends RawHeadline {
  headline: string;
  matched: TrackedAsset[];
  score: number;
}

/**
 * The headlines worth asking the AI about: about a tracked asset, not junk,
 * carrying at least one big-news signal. Best first, capped at `limit`.
 */
export function pickCandidates(
  items: readonly RawHeadline[],
  assets: readonly TrackedAsset[],
  limit = 6,
  /** When false, a headline needs no big-news signal (looking up one stock, say). */
  requireBig = true
): Candidate[] {
  const out: Candidate[] = [];
  for (const item of items) {
    const { headline, source } = splitSource(item.title, item.source);
    if (isJunk(headline)) continue;
    const matched = matchAssets(headline, assets);
    if (matched.length === 0) continue;
    const hint = bigHint(headline);
    if (requireBig && hint === 0) continue;
    const score = hint + sourceRank(source) + Math.min(1, matched.length - 1) * 0.5;
    out.push({ ...item, source, headline, matched, score });
  }
  return out.sort((a, b) => b.score - a.score || b.publishedAt - a.publishedAt).slice(0, limit);
}
