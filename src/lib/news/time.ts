// Central time helpers. Everything in the news brief is read in Central time
// (the trader's clock), whatever zone the server or browser runs in.

import { zonedTime } from '$lib/timezone';
import type { AlertWindow, NoTradeWindow } from './types';

export const CT = 'America/Chicago';
export const MINUTE = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;

export interface CtParts {
  year: number;
  /** 1–12. */
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 0 is Sunday. */
  weekday: number;
  dateKey: string;
  minuteOfDay: number;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

let parts: Intl.DateTimeFormat | null = null;

export function ctParts(ms: number): CtParts {
  parts ??= new Intl.DateTimeFormat('en-US', {
    timeZone: CT,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    weekday: 'short'
  });
  const p: Record<string, string> = {};
  for (const part of parts.formatToParts(ms)) p[part.type] = part.value;
  const year = Number(p.year);
  const month = Number(p.month);
  const day = Number(p.day);
  const hour = Number(p.hour);
  const minute = Number(p.minute);
  return {
    year,
    month,
    day,
    hour,
    minute,
    weekday: WEEKDAYS[p.weekday] ?? 0,
    dateKey: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    minuteOfDay: hour * 60 + minute
  };
}

export const ctDateKey = (ms: number): string => ctParts(ms).dateKey;

/** "08:30" -> 510. */
export function clockMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** The instant it is `clock` (HH:MM or minutes after midnight) in Chicago on the given date. */
export function ctAt(dateKey: string, clock: string | number): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  const minutes = typeof clock === 'number' ? clock : clockMinutes(clock);
  return zonedTime(CT, y, m - 1, d, Math.floor(minutes / 60), minutes % 60);
}

/** The date key `n` days after `dateKey` (calendar days, no zone involved). */
export function addDays(dateKey: string, n: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

export function weekdayOf(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export const isWeekday = (dateKey: string): boolean => {
  const w = weekdayOf(dateKey);
  return w >= 1 && w <= 5;
};

/** The weekday before `dateKey` (skipping the weekend). */
export function previousWeekday(dateKey: string): string {
  let key = addDays(dateKey, -1);
  while (!isWeekday(key)) key = addDays(key, -1);
  return key;
}

/** The Monday on or after `dateKey`. */
export function nextMonday(dateKey: string): string {
  let key = dateKey;
  while (weekdayOf(key) !== 1) key = addDays(key, 1);
  return key;
}

/** "7:30 AM". */
export function fmtTime(ms: number): string {
  const p = ctParts(ms);
  const h12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  return `${h12}:${String(p.minute).padStart(2, '0')} ${p.hour < 12 ? 'AM' : 'PM'}`;
}

/** "7:25–7:45 AM", or "11:55 AM–12:20 PM" when it crosses noon. */
export function fmtRange(startMs: number, endMs: number): string {
  const a = fmtTime(startMs);
  const b = fmtTime(endMs);
  const [aClock, aMer] = a.split(' ');
  const [, bMer] = b.split(' ');
  return aMer === bMer ? `${aClock}–${b}` : `${a}–${b}`;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Tue Nov 11". */
export function fmtDay(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${DAY_NAMES[w]} ${MONTH_NAMES[m - 1]} ${d}`;
}

/** Minutes after midnight Central that `ms` falls on, for a given date (negative or over 1440 if another day). */
export function minutesOnDay(ms: number, dateKey: string): number {
  return Math.round((ms - ctAt(dateKey, 0)) / MINUTE);
}

/** Whether `ms` is on a weekday inside one of the alert windows (Central time). */
export function inAlertWindow(ms: number, windows: readonly AlertWindow[]): boolean {
  const p = ctParts(ms);
  if (p.weekday === 0 || p.weekday === 6) return false;
  return windows.some((w) => p.minuteOfDay >= clockMinutes(w.start) && p.minuteOfDay < clockMinutes(w.end));
}

/** Overlapping or nearly touching windows combined into one. */
export function mergeWindows(windows: readonly NoTradeWindow[], gapMs = 10 * MINUTE): NoTradeWindow[] {
  const sorted = [...windows].sort((a, b) => a.startMs - b.startMs);
  const out: NoTradeWindow[] = [];
  for (const w of sorted) {
    const last = out[out.length - 1];
    if (last && w.startMs <= last.endMs + gapMs) last.endMs = Math.max(last.endMs, w.endMs);
    else out.push({ ...w });
  }
  return out;
}

export function windowAround(timeMs: number, beforeMin: number, afterMin: number): NoTradeWindow {
  return { startMs: timeMs - beforeMin * MINUTE, endMs: timeMs + afterMin * MINUTE };
}
