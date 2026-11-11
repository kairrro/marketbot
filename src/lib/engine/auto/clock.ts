// Central Time: the calendar the dates, trading hours and times shown are in.

import { offsetMinutes } from '$lib/timezone';
import { TIME_ZONE } from './types';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export interface CtTime {
  /** CT calendar day, counted from 1970-01-01. */
  day: number;
  /** Minutes after CT midnight. */
  minute: number;
}

// Offsets only change on the hour, and looking one up is slow, so one is kept per hour.
const offsets = new Map<number, number>();

export function ct(time: number): CtTime {
  const hour = Math.floor(time / HOUR_MS);
  let offset = offsets.get(hour);
  if (offset == null) {
    offset = offsetMinutes(time, TIME_ZONE) * 60_000;
    offsets.set(hour, offset);
  }
  const local = time + offset;
  const day = Math.floor(local / DAY_MS);
  return { day, minute: Math.floor((local - day * DAY_MS) / 60_000) };
}

/** Whether the CT hour at `time` is in [from, to). A window that runs past midnight (from 20, to 4) wraps. */
export function inHours(time: number, from: number, to: number): boolean {
  const hour = Math.floor(ct(time).minute / 60);
  return from < to ? hour >= from && hour < to : hour >= from || hour < to;
}
