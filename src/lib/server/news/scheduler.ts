// The news bot's clock. Runs while Marketbot runs: the morning brief at 8:00 AM
// Central (and, if the app was off then, as soon as it is on, until 3 PM), live
// alert checks inside the trading windows, and the weekly preview on Sunday
// evening. What has been sent is remembered, so a restart never repeats a brief.

import { env } from '$env/dynamic/private';
import { addDays, clockMinutes, ctAt, ctParts, isWeekday, nextMonday } from '$lib/news/time';
import { discordReady } from './discord';
import { checkMoveAlerts, generateFeed, generateMorning, generateSummary, generateWeekly, lastFeed, runAlertCheck, sendStoredBrief } from './service';
import { getBrief, getSettings, stateRead, stateSet } from './store';

const TICK_MS = 30_000;
/** Retry a brief whose calendar could not be read this many times before sending it as it is. */
const MAX_TRIES = 4;
const RETRY_GAP_MS = 5 * 60_000;

let busy = false;
let lastPoll = 0;

function fail(stage: string, err: unknown) {
  const message = `${stage}: ${err instanceof Error ? err.message : String(err)}`;
  console.error(`News bot: ${message}`);
  stateSet('lastError', { at: Date.now(), message });
}

async function morning(now: number): Promise<void> {
  const settings = getSettings();
  const date = ctParts(now).dateKey;
  if (!isWeekday(date)) return;
  // From the brief time until the last trading window ends. After that a late brief is no use.
  if (now < ctAt(date, settings.morningTime) || now >= ctAt(date, Math.max(...settings.alertWindows.map((w) => clockMinutes(w.end))))) return;

  let stored = getBrief('morning', date);
  const tries = stateRead<number>(`morningTries:${date}`, 0);
  const retry = stored?.brief.incomplete && tries < MAX_TRIES && now - stored.brief.generatedAt >= RETRY_GAP_MS;
  if (!stored || retry) {
    stateSet(`morningTries:${date}`, tries + 1);
    await generateMorning(date);
    stored = getBrief('morning', date);
    console.log(`News bot: morning brief for ${date} ${stored?.brief.incomplete ? 'written (calendar missing, will retry)' : 'written'}.`);
  }
  const settled = stored && (!stored.brief.incomplete || tries + 1 >= MAX_TRIES);
  if (stored && settled && !stored.discordSentAt && settings.discordBrief && discordReady()) {
    // The short version goes on top, so make it fresh first. The brief still goes without it if that fails.
    await generateSummary().catch((err) => fail('summary', err));
    await sendStoredBrief('morning', date);
    console.log('News bot: morning brief sent to Discord.');
  }
}

async function weekly(now: number): Promise<void> {
  const settings = getSettings();
  const p = ctParts(now);
  if (p.weekday !== settings.weeklyDay || now < ctAt(p.dateKey, settings.weeklyTime)) return;
  const monday = nextMonday(addDays(p.dateKey, 1));
  let stored = getBrief('weekly', monday);
  if (!stored) {
    await generateWeekly(monday);
    stored = getBrief('weekly', monday);
    console.log(`News bot: weekly preview for the week of ${monday} written.`);
  }
  if (stored && !stored.discordSentAt && settings.discordWeekly && discordReady()) {
    await sendStoredBrief('weekly', monday);
    console.log('News bot: weekly preview sent to Discord.');
  }
}

async function alerts(now: number): Promise<void> {
  const settings = getSettings();
  if (now - lastPoll < settings.pollMinutes * 60_000) return;
  lastPoll = now;
  const run = await runAlertCheck(false);
  if (run.skipped) return;
  if (run.alerts.length > 0) console.log(`News bot: ${run.alerts.length} alert(s), ${run.sent} sent to Discord.`);
}

let lastMoveCheck = 0;

/** Looks for a tracked symbol having a big day with a story to go with it, every five minutes in the session. */
async function moves(now: number): Promise<void> {
  if (now - lastMoveCheck < 5 * 60_000) return;
  lastMoveCheck = now;
  const run = await checkMoveAlerts();
  if (run.found.length > 0) console.log(`News bot: ${run.found.length} move alert(s), ${run.sent} sent to Discord.`);
}

/** Keeps the news feed fresh: about once an hour from 6 AM to 10 PM Central. */
async function feed(now: number): Promise<void> {
  const hour = ctParts(now).hour;
  if (hour < 6 || hour >= 22) return;
  const last = lastFeed();
  if (last && now - last.generatedAt < 60 * 60_000) return;
  await generateFeed();
}

async function tick(): Promise<void> {
  if (busy) return;
  busy = true;
  const now = Date.now();
  try {
    for (const [stage, job] of [
      ['morning brief', morning],
      ['weekly preview', weekly],
      ['alert check', alerts],
      ['move alerts', moves],
      ['news feed', feed]
    ] as const) {
      try {
        await job(now);
      } catch (err) {
        fail(stage, err);
      }
    }
  } finally {
    busy = false;
  }
}

// Kept on globalThis like the other watchers, so a hot reload in dev does not start a second clock.
export function startNewsBot(): void {
  if (globalThis.__newsBotIntervalId) return;
  // NEWS_BOT=off in .env keeps the clock from starting (the News page still works by hand).
  if (env.NEWS_BOT === 'off') {
    console.log('News bot is off (NEWS_BOT=off).');
    return;
  }
  void tick();
  globalThis.__newsBotIntervalId = setInterval(tick, TICK_MS);
  console.log('News bot started (morning brief, live alerts, weekly preview).');
}
