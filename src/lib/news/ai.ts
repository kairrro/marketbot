// What the AI is asked to do, and the checks on what it says. It rates how BIG and
// how RISKY a headline is, and when to stay out. It never says where a price is
// going. The model call is passed in (`Ask`), so this file has no network in it
// and every rule here can be tested with a fake model.

import { bannedIn, cleanText } from './guard';
import { IMPACT_RANK, type HeadlineItem, type Impact, type Mood, type MoodState, type ScheduledItem, type TrackedAsset, type Volatility } from './types';
import type { Candidate } from './noise';
import { swingForImpact, type Swing } from './swing';
import { fmtTime } from './time';

export type Ask = (args: { system: string; user: string; maxTokens?: number }) => Promise<unknown>;

const RULES = `You help a day trader who trades NQ (Nasdaq futures), GC (gold) and CL (crude oil) know when to be careful. You inform only. You never trade and you never predict.

HARD RULES
- Never say which way a price will move. Never use the words bullish, bearish, rally, surge, plunge, drop, crash, soar, rise, fall, up, down, higher, lower, buy, sell, long, short, upside, downside or any other call on direction. Do not say a headline is "good" or "bad" for a market.
- Describe what happened in plain facts. Say how BIG it is and how JUMPY the market may get. That is all.
- Short and plain. No hype, no jargon.`;

export const HEADLINE_SYSTEM = `${RULES}

You get numbered headlines. For each, decide if it is a big, fresh, real event for the tracked assets, and rate it.

Impact scale (how big):
- high: the kind of news that can move NQ, GC or CL by half a percent or more within the hour. A surprise central bank move, a war escalation, a major OPEC decision, a shock to a mega-cap Nasdaq stock (criminal charges, CEO exit, huge deal, regulator action). This is rare. Most headlines are NOT high.
- medium: can cause a quick jolt that fades.
- low: background noise.

Mark relevant=false for: analyst opinions, price targets, upgrades and downgrades, rumours, commentary, recycled or old news, small companies, lists, anything vague.

Volatility: normal, elevated or extreme.
pause_minutes: how long to stay out. 0 for low. 5 to 10 for medium. 10 to 30 for high.
"what": one plain sentence, 18 words at most, saying what happened. No direction words.
"assets": only symbols from the tracked list given.

Answer with JSON only, in this shape:
{"items":[{"i":0,"relevant":true,"what":"...","assets":["NQ","NVDA"],"impact":"high","volatility":"elevated","pause_minutes":15}]}`;

export const MOOD_SYSTEM = `${RULES}

Write the mood of the day in two or three short lines. Use the events and headlines given. You may say what the conditions are (for example "Risk-off mood. Tech weak overnight. Oil headlines are active.") and which events to be careful around. State facts about now and today, never a view on what happens next.

Pick one state: "risk-off", "risk-on", "mixed" or "quiet".

Answer with JSON only: {"state":"mixed","lines":["...","..."]}`;

const IMPACTS: Impact[] = ['low', 'medium', 'high'];
const VOLS: Volatility[] = ['normal', 'elevated', 'extreme'];
const MOODS: MoodState[] = ['risk-off', 'risk-on', 'mixed', 'quiet'];

interface RawRating {
  i?: number;
  relevant?: boolean;
  what?: string;
  assets?: unknown;
  impact?: string;
  volatility?: string;
  pause_minutes?: number;
}

const words = (s: string, n: number) => s.trim().split(/\s+/).slice(0, n).join(' ');

/** A neutral sentence for when the model's own wording had to be thrown out. */
function neutral(c: Candidate): string {
  const who = c.matched
    .filter((m) => m.kind !== 'topic')
    .map((m) => m.symbol)
    .slice(0, 3)
    .join(', ');
  return who ? `Major headline about ${who}. See the source.` : 'Major headline. See the source.';
}

/** One rating, checked and tidied. Null when the model said it is not relevant or the rating is unusable. */
function toItem(c: Candidate, r: RawRating, assets: readonly TrackedAsset[]): HeadlineItem | null {
  if (r.relevant === false) return null;
  const impact = IMPACTS.includes(r.impact as Impact) ? (r.impact as Impact) : null;
  if (!impact) return null;
  const symbols = new Set(assets.map((a) => a.symbol));
  const named = Array.isArray(r.assets) ? (r.assets as unknown[]).map((a) => String(a).toUpperCase()).filter((a) => symbols.has(a)) : [];
  const affected = [...new Set(named.length > 0 ? named : c.matched.filter((m) => m.kind !== 'topic').map((m) => m.symbol))];
  // Impact, volatility and the pause have to agree with each other.
  let volatility = VOLS.includes(r.volatility as Volatility) ? (r.volatility as Volatility) : impact === 'high' ? 'elevated' : impact === 'medium' ? 'elevated' : 'normal';
  if (impact === 'low') volatility = 'normal';
  if (impact !== 'low' && volatility === 'normal') volatility = 'elevated';
  let pause = Math.round(Number(r.pause_minutes) || 0);
  pause = impact === 'low' ? 0 : Math.min(45, Math.max(impact === 'high' ? 10 : 0, pause));
  // The swing is measured on the markets the headline touches (NQ when it is only about a stock).
  const markets = assets.filter((a) => a.kind === 'market').map((a) => a.symbol);
  const hit = affected.filter((a) => markets.includes(a));
  const swing: Record<string, Swing> = {};
  for (const symbol of hit.length > 0 ? hit : markets.slice(0, 1)) {
    const found = swingForImpact(impact, symbol);
    if (found) swing[symbol] = found;
  }
  return {
    id: c.id,
    what: cleanText(words(String(r.what ?? ''), 24), neutral(c)),
    headline: c.headline,
    source: c.source,
    url: c.url,
    publishedAt: c.publishedAt,
    assets: affected,
    impact,
    volatility,
    pauseMinutes: pause,
    swing
  };
}

const asList = (cs: readonly Candidate[], now: number) =>
  JSON.stringify(
    cs.map((c, i) => ({
      i,
      headline: c.headline,
      source: c.source,
      minutes_ago: Math.max(0, Math.round((now - c.publishedAt) / 60_000)),
      tracked_matches: c.matched.map((m) => m.symbol)
    }))
  );

/**
 * Rates headlines with the model. Wording that reads like a call on direction is
 * sent back once with the offending phrases named; what still fails is replaced
 * with a neutral sentence, so nothing directional ever leaves this function.
 */
export async function rateHeadlines(
  ask: Ask,
  candidates: readonly Candidate[],
  assets: readonly TrackedAsset[],
  now: number
): Promise<HeadlineItem[]> {
  if (candidates.length === 0) return [];
  const tracked = assets
    .filter((a) => a.enabled)
    .map((a) => `${a.symbol} (${a.name})`)
    .join(', ');
  const user = `Tracked assets: ${tracked}\n\nHeadlines:\n${asList(candidates, now)}`;

  let reply = (await ask({ system: HEADLINE_SYSTEM, user, maxTokens: 3000 })) as { items?: RawRating[] };
  const bad = bannedIn((reply.items ?? []).map((r) => String(r.what ?? '')));
  if (bad.length > 0) {
    reply = (await ask({
      system: HEADLINE_SYSTEM,
      user: `${user}\n\nYour last answer used words that are not allowed: ${bad.join(', ')}. Write every "what" again with no direction words at all. Just say what happened.`,
      maxTokens: 3000
    })) as { items?: RawRating[] };
  }

  const out: HeadlineItem[] = [];
  for (const r of reply.items ?? []) {
    const c = typeof r.i === 'number' ? candidates[r.i] : undefined;
    if (!c) continue;
    const item = toItem(c, r, assets);
    if (item) out.push(item);
  }
  return out;
}

export const FEED_SYSTEM = `${RULES}

You get numbered news stories that were each followed by a real price move in something a trader follows. Write what happened in one plain sentence, 22 words at most, as the story reports it. Name the people and companies. Say what happened, never what the price did or will do, and do not say why the price moved.

Mark relevant=false for anything that is not news, or that would not plausibly move the price of the stock or market it is about: analyst opinions, price targets, upgrades and downgrades, listicles, ads, recycled commentary, polls, rumours from suppliers or blogs, security patches and routine product or outage notes, and small side stories. Keep real company news (results, executives, lawsuits, regulators, big deals, scandals) and real macro news (central banks, inflation and jobs data, tariffs, war, oil supply).

Answer with JSON only: {"items":[{"i":0,"relevant":true,"what":"..."}]}`;

/**
 * One plain sentence per story, checked like everything else the AI writes:
 * direction words are sent back once, then replaced with a neutral line.
 * Returns the stories the AI kept, by headline id.
 */
export async function describeHeadlines(ask: Ask, candidates: readonly Candidate[], now: number): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (candidates.length === 0) return out;
  const user = `Stories:\n${asList(candidates, now)}`;

  type Reply = { items?: { i?: number; relevant?: boolean; what?: string }[] };
  let reply = (await ask({ system: FEED_SYSTEM, user, maxTokens: 3000 })) as Reply;
  const bad = bannedIn((reply.items ?? []).map((r) => String(r.what ?? '')));
  if (bad.length > 0) {
    reply = (await ask({
      system: FEED_SYSTEM,
      user: `${user}\n\nYour last answer used words that are not allowed: ${bad.join(', ')}. Write every "what" again with no direction words at all. Just say what happened.`,
      maxTokens: 3000
    })) as Reply;
  }

  for (const r of reply.items ?? []) {
    const c = typeof r.i === 'number' ? candidates[r.i] : undefined;
    if (!c || r.relevant === false) continue;
    out.set(c.id, cleanText(words(String(r.what ?? ''), 28), neutral(c)));
  }
  return out;
}

export const SUMMARY_SYSTEM = `${RULES}

You write the short version of the day for a trader who does not want to read news. All they care about is how big a swing to expect in what they trade, and when to stay out. You get the facts as JSON. Write:
- "headline": one sentence, 22 words at most. Start with the day level (Quiet, Be careful or Big day). Name the main thing and its time.
- "bullets": 3 to 5 short lines, 24 words at most each. Each is about one asset or one time. Say how big a swing to expect using only the swing numbers in the facts, and when to stay out. If a price already moved after a story, quote the measured move exactly as given (like "NVDA −4.3%") and say what the story was in a few words. Never use words like fell, rose, dropped or jumped.
- Use only numbers and times that are in the facts. Never invent any.
- Leave out anything that does not matter. On a quiet day, say so in one bullet.

Answer with JSON only: {"headline":"...","bullets":["..."]}`;

export interface PhrasedSummary {
  headline: string;
  bullets: string[];
}

/** Checks a model's lines for direction wording, asking once more before giving up. */
async function cleanLines<T>(ask: Ask, system: string, user: string, read: (reply: T) => string[], maxTokens: number): Promise<T> {
  let reply = (await ask({ system, user, maxTokens })) as T;
  const bad = bannedIn(read(reply));
  if (bad.length > 0) {
    reply = (await ask({
      system,
      user: `${user}\n\nYour last answer used words that are not allowed: ${bad.join(', ')}. Write it again with no direction words at all.`,
      maxTokens
    })) as T;
    if (bannedIn(read(reply)).length > 0) throw new Error('the wording kept using direction words');
  }
  return reply;
}

/** The headline and bullets for the day, phrased from the facts. Throws when the wording cannot be made clean. */
export async function writeSummary(ask: Ask, facts: unknown): Promise<PhrasedSummary> {
  type Reply = { headline?: string; bullets?: unknown };
  const user = `Facts:\n${JSON.stringify(facts)}`;
  const read = (r: Reply) => [String(r.headline ?? ''), ...(Array.isArray(r.bullets) ? (r.bullets as unknown[]).map(String) : [])];
  const reply = await cleanLines<Reply>(ask, SUMMARY_SYSTEM, user, read, 2000);
  const headline = words(String(reply.headline ?? ''), 30);
  const bullets = (Array.isArray(reply.bullets) ? (reply.bullets as unknown[]) : []).map((b) => words(String(b), 32)).filter(Boolean).slice(0, 5);
  if (!headline || bullets.length === 0) throw new Error('the model sent no summary');
  return { headline, bullets };
}

export const STOCK_SYSTEM = `${RULES}

You write three short bullets about one stock for a trader who does not want to read news. You get the facts as JSON: today's change, how far it normally moves in a day, the next earnings date, and recent stories with the price move that followed each.
- Bullet 1: what has been going on, in plain words (the stories that mattered).
- Bullet 2: what the price already did after those stories. Quote the measured moves exactly as given (like "−4.3%"). Never use words like fell, rose, dropped or jumped.
- Bullet 3: what is next (an earnings date, if there is one) and how big a swing to expect, using only the numbers given.
Each bullet is 28 words at most. Use only numbers and dates in the facts. If there is nothing to say, say that in one bullet.

Answer with JSON only: {"bullets":["...","..."]}`;

/** Three short bullets about one stock. Throws when the wording cannot be made clean. */
export async function describeStock(ask: Ask, facts: unknown): Promise<string[]> {
  type Reply = { bullets?: unknown };
  const user = `Facts:\n${JSON.stringify(facts)}`;
  const read = (r: Reply) => (Array.isArray(r.bullets) ? (r.bullets as unknown[]).map(String) : []);
  const reply = await cleanLines<Reply>(ask, STOCK_SYSTEM, user, read, 1500);
  const bullets = read(reply).map((b) => words(b, 34)).filter(Boolean).slice(0, 4);
  if (bullets.length === 0) throw new Error('the model sent nothing');
  return bullets;
}

/** What the mood is built from. Prices are the move since the last close, as context. */
export interface MoodInput {
  events: readonly ScheduledItem[];
  overnight: readonly HeadlineItem[];
  moves: { symbol: string; changePct: number }[];
}

export async function writeMood(ask: Ask, input: MoodInput): Promise<Mood> {
  const user = JSON.stringify({
    events_today: input.events
      .filter((e) => IMPACT_RANK[e.impact] >= 1)
      .map((e) => ({ title: e.title, time: fmtTime(e.timeMs), impact: e.impact, assets: e.assets })),
    overnight_news: input.overnight.map((h) => ({ what: h.what, assets: h.assets, impact: h.impact })),
    moves_since_last_close_percent: input.moves.map((m) => ({ symbol: m.symbol, change: Number(m.changePct.toFixed(2)) }))
  });
  const fallback = fallbackMood(input);

  let reply = (await ask({ system: MOOD_SYSTEM, user, maxTokens: 1500 })) as { state?: string; lines?: unknown };
  let lines = Array.isArray(reply.lines) ? (reply.lines as unknown[]).map((l) => String(l)) : [];
  const bad = bannedIn(lines);
  if (bad.length > 0) {
    reply = (await ask({
      system: MOOD_SYSTEM,
      user: `${user}\n\nYour last answer used words that are not allowed: ${bad.join(', ')}. Write the lines again with no direction words.`,
      maxTokens: 1500
    })) as { state?: string; lines?: unknown };
    lines = Array.isArray(reply.lines) ? (reply.lines as unknown[]).map((l) => String(l)) : [];
  }
  const clean = lines.map((l) => words(l, 22)).filter((l) => l && bannedIn([l]).length === 0).slice(0, 3);
  return {
    state: MOODS.includes(reply.state as MoodState) ? (reply.state as MoodState) : fallback.state,
    lines: clean.length > 0 ? clean : fallback.lines
  };
}

/** A mood from the facts alone, for when there is no AI or it failed. */
export function fallbackMood(input: MoodInput): Mood {
  const big = input.events.filter((e) => e.impact === 'high');
  const med = input.events.filter((e) => e.impact === 'medium');
  const lines: string[] = [];
  if (big.length > 0) lines.push(`${big.length} high-impact ${big.length === 1 ? 'event' : 'events'} today: ${big.slice(0, 3).map((e) => `${e.title} at ${fmtTime(e.timeMs)}`).join(', ')}.`);
  else if (med.length > 0) lines.push(`${med.length} medium-impact ${med.length === 1 ? 'event' : 'events'} today. Nothing major.`);
  else lines.push('No major scheduled events today.');
  if (input.overnight.length > 0) lines.push(`${input.overnight.length} notable overnight ${input.overnight.length === 1 ? 'headline' : 'headlines'}.`);
  return { state: big.length > 0 ? 'mixed' : 'quiet', lines };
}
