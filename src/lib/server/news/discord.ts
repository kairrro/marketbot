// Sends the brief and alerts to Discord. Uses NEWS_DISCORD_WEBHOOK_URL when it is
// set in .env, and the app's main webhook (DISCORD_WEBHOOK_URL) when it is not.

import { env } from '$env/dynamic/private';
import { CONFIG } from '$lib/config';
import { alertText, briefText, moveAlertText } from '$lib/news/format';
import type { MoveAlertRecord } from '$lib/news/moves';
import type { Summary } from '$lib/news/summary';
import type { Brief, HeadlineItem } from '$lib/news/types';

const url = (): string => env.NEWS_DISCORD_WEBHOOK_URL || env.DISCORD_WEBHOOK_URL || CONFIG.discord.webhookUrl;

export const discordReady = (): boolean => Boolean(url());

const BLUE = 0x4c8dff;
const COLORS = { high: 0xe5565b, medium: 0xd9a441, low: 0x8e8e8e } as const;
/** Discord allows 4096 characters in an embed description. */
const LIMIT = 3900;

async function post(body: unknown): Promise<void> {
  const target = url();
  if (!target) throw new Error('No Discord webhook is set (NEWS_DISCORD_WEBHOOK_URL or DISCORD_WEBHOOK_URL in .env).');
  const res = await fetch(target, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000)
  });
  if (!res.ok) throw new Error(`Discord answered ${res.status}`);
}

/** Splits at line breaks so no piece goes over the limit. */
function chunks(text: string): string[] {
  if (text.length <= LIMIT) return [text];
  const out: string[] = [];
  let cur = '';
  for (const line of text.split('\n')) {
    if (cur.length + line.length + 1 > LIMIT) {
      out.push(cur);
      cur = '';
    }
    cur += (cur ? '\n' : '') + line;
  }
  if (cur) out.push(cur);
  return out;
}

export async function sendBrief(brief: Brief, showLow: boolean, summary?: Summary): Promise<void> {
  const { title, body } = briefText(brief, showLow, summary);
  const parts = chunks(body);
  for (let i = 0; i < parts.length; i++) {
    await post({
      embeds: [
        {
          title: i === 0 ? title : undefined,
          description: parts[i],
          color: BLUE,
          footer: i === parts.length - 1 && brief.model ? { text: `Model: ${brief.model}` } : undefined,
          timestamp: i === 0 ? new Date(brief.generatedAt).toISOString() : undefined
        }
      ]
    });
  }
}

export async function sendAlert(alert: HeadlineItem, prices?: Record<string, number>): Promise<void> {
  const { title, body } = alertText(alert, prices);
  await post({ embeds: [{ title, description: body.slice(0, LIMIT), color: COLORS[alert.impact], timestamp: new Date().toISOString() }] });
}

export async function sendMoveAlert(alert: MoveAlertRecord, prices?: Record<string, number>): Promise<void> {
  const { title, body } = moveAlertText(alert, prices);
  await post({ embeds: [{ title, description: body.slice(0, LIMIT), color: 0xd9a441, timestamp: new Date().toISOString() }] });
}

export async function sendTest(): Promise<void> {
  await post({ content: '✅ News brief connected. Info only, never a trade signal.' });
}
