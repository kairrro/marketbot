// Plain-text versions of the brief and alerts, for Discord. The page draws its own
// cards from the same data; this is only the chat-message form.

import { fmtPct, fmtRatio, fmtSize, type Swing } from './swing';
import { fmtDay, fmtRange, fmtTime, addDays, ctDateKey } from './time';
import { IMPACT_RANK, type Brief, type HeadlineItem, type Impact, type ScheduledItem } from './types';

export const IMPACT_LABEL: Record<Impact, string> = { low: 'Low', medium: 'Medium', high: 'High' };
const DOT: Record<Impact, string> = { high: '🔴', medium: '🟠', low: '⚪' };

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "NQ ~1.0% (≈ 250 pts, 3.5× a normal hour) · GC ~0.9% (...)". A size, never a direction. */
export function swingText(swing: Record<string, Swing> | undefined, prices: Record<string, number> = {}): string {
  const parts = Object.entries(swing ?? {}).map(([symbol, sw]) => {
    const size = fmtSize(symbol, sw.pct, prices[symbol]);
    return `${symbol} ~${fmtPct(sw.pct)} (${size ? `${size}, ` : ''}${fmtRatio(sw.ratio)})`;
  });
  return parts.length ? `Swing to expect: ${parts.join(' · ')}` : '';
}

function eventLine(e: ScheduledItem, prices?: Record<string, number>): string[] {
  const lines = [`${DOT[e.impact]} **${fmtTime(e.timeMs)}** ${e.title} (${IMPACT_LABEL[e.impact]}, ${e.volatility} volatility)`];
  const swing = swingText(e.swing, prices);
  if (swing) lines.push(swing);
  if (e.noTrade) lines.push(`⛔ Stay out ${fmtRange(e.noTrade.startMs, e.noTrade.endMs)} CT`);
  return lines;
}

function headlineLine(h: HeadlineItem, prices?: Record<string, number>): string {
  const source = h.url ? `[${h.source || 'source'}](${h.url})` : h.source;
  const pause = h.pauseMinutes > 0 ? `, pause about ${h.pauseMinutes} min` : '';
  const swing = swingText(h.swing, prices);
  return [`${DOT[h.impact]} ${h.what} (${IMPACT_LABEL[h.impact]}${pause}) ${source}`.trim(), swing].filter(Boolean).join('\n');
}

/** The brief as Discord markdown. Low-impact events are left out unless asked for. */
export function briefText(brief: Brief, showLow = false): { title: string; body: string } {
  const events = brief.events.filter((e) => showLow || IMPACT_RANK[e.impact] >= 1);
  const out: string[] = [];

  if (brief.kind === 'morning') {
    if (brief.mood) {
      out.push(`**Mood:** ${cap(brief.mood.state)}`);
      out.push(...brief.mood.lines);
      out.push('');
    }
    out.push('**Today (Central time)**');
    if (events.length === 0) out.push('No major scheduled events.');
    for (const e of events) out.push(...eventLine(e, brief.prices));
    if (brief.overnight.length > 0) {
      out.push('', '**Overnight**');
      for (const h of brief.overnight) out.push(headlineLine(h, brief.prices));
    }
    if (brief.noTrade.length > 0) {
      out.push('', `**Stay out:** ${brief.noTrade.map((w) => fmtRange(w.startMs, w.endMs)).join(', ')} CT`);
    }
  } else {
    const days = new Map<string, ScheduledItem[]>();
    for (const e of events) {
      const day = ctDateKey(e.timeMs);
      days.set(day, [...(days.get(day) ?? []), e]);
    }
    if (days.size === 0) out.push('No major scheduled events.');
    for (const [day, list] of days) {
      out.push(`**${fmtDay(day)}**`);
      for (const e of list) out.push(...eventLine(e, brief.prices));
      out.push('');
    }
  }

  for (const note of brief.notes) out.push(`_${note}_`);
  out.push('', '_Info only. Swings are sizes, not a direction._');

  const title =
    brief.kind === 'morning'
      ? `☀️ Morning brief · ${fmtDay(brief.forDate)}`
      : `🗓️ Week ahead · ${fmtDay(brief.forDate)} to ${fmtDay(addDays(brief.forDate, 4))}`;
  return { title, body: out.join('\n') };
}

export function alertText(h: HeadlineItem, prices?: Record<string, number>): { title: string; body: string } {
  const where = h.assets.length ? h.assets.join(', ') : 'tracked assets';
  const pause = h.pauseMinutes > 0 ? `Pause for about ${h.pauseMinutes} minutes.` : 'No pause needed.';
  const source = h.url ? `[${h.source || 'Source'}](${h.url})` : h.source;
  return {
    title: `${DOT[h.impact]} ${IMPACT_LABEL[h.impact]} impact: ${where}`,
    body: [h.what, '', swingText(h.swing, prices), `**Volatility:** ${cap(h.volatility)}`, `**Pause:** ${pause}`, source ? `**Source:** ${source}` : '', '', '_Info only. Swings are sizes, not a direction._']
      .filter((l, i, a) => l !== '' || a[i - 1] !== '')
      .join('\n')
  };
}
