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
