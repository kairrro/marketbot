// The numbers behind the P&L calendars (auto backtest and replay sessions): trades
// grouped into calendar days, and a month laid out in weeks.

export const DAY_MS = 86_400_000;

export interface CalendarEntry {
  /** When the trade closed. */
  time: number;
  r: number;
  /** What it made in $ and in % of the account. */
  usd: number;
  pct: number;
  /** "BTC long": what the hover over a day lists. */
  label: string;
}

export interface CalendarDay {
  /** The calendar day, counted from 1970-01-01. */
  day: number;
  r: number;
  usd: number;
  pct: number;
  /** The trades that closed that day, in the order they closed. */
  entries: CalendarEntry[];
}

/** The UTC day `ms` falls on, counted from 1970-01-01. */
export const utcDay = (ms: number): number => Math.floor(ms / DAY_MS);

/** Adds up the entries of each day, `dayOf` saying which day a time falls on. Days with no entry are left out. */
export function groupDays(entries: readonly CalendarEntry[], dayOf: (ms: number) => number): Map<number, CalendarDay> {
  const days = new Map<number, CalendarDay>();
  for (const entry of [...entries].sort((a, b) => a.time - b.time)) {
    const day = dayOf(entry.time);
    const own = days.get(day) ?? { day, r: 0, usd: 0, pct: 0, entries: [] };
    own.r += entry.r;
    own.usd += entry.usd;
    own.pct += entry.pct;
    own.entries.push(entry);
    days.set(day, own);
  }
  return days;
}

/** A calendar month as one number: year × 12 + month, with 0 for January. */
export function monthOfDay(day: number): number {
  const date = new Date(day * DAY_MS);
  return date.getUTCFullYear() * 12 + date.getUTCMonth();
}

/** The weeks of a month, Monday first, as day numbers, with null before the 1st and after the last day. */
export function monthWeeks(month: number): (number | null)[][] {
  const year = Math.floor(month / 12);
  const index = month % 12;
  const first = Date.UTC(year, index, 1) / DAY_MS;
  const count = new Date(Date.UTC(year, index + 1, 0)).getUTCDate();
  const lead = (new Date(first * DAY_MS).getUTCDay() + 6) % 7;
  const cells: (number | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: count }, (_, i) => first + i)
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, week) => cells.slice(week * 7, week * 7 + 7));
}
