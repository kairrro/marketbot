import { describe, expect, it } from 'vitest';
import { zonedDay } from '../timezone';
import { DAY_MS, groupDays, monthOfDay, monthWeeks, utcDay, type CalendarEntry } from './calendar';

const entry = (time: number, r: number, usd = r * 5): CalendarEntry => ({ time, r, usd, pct: usd / 10, label: 'BTC long' });
const day = (year: number, month: number, date: number) => Date.UTC(year, month, date) / DAY_MS;

describe('grouping trades into days', () => {
  it('adds up what closed on each day and leaves out the days with nothing', () => {
    const days = groupDays(
      [entry(Date.UTC(2026, 0, 5, 23), -1), entry(Date.UTC(2026, 0, 5, 1), 2.5), entry(Date.UTC(2026, 0, 7, 12), -1)],
      utcDay
    );
    expect([...days.keys()]).toEqual([day(2026, 0, 5), day(2026, 0, 7)]);
    const fifth = days.get(day(2026, 0, 5))!;
    expect(fifth).toMatchObject({ r: 1.5, usd: 7.5, pct: 0.75 });
    // In the order they closed, whatever the order they came in.
    expect(fifth.entries.map((e) => e.r)).toEqual([2.5, -1]);
  });

  it('counts the days in the zone it is told to', () => {
    // 23:30 in New York on 5 Jan is already 6 Jan in UTC.
    const late = entry(Date.UTC(2026, 0, 6, 4, 30), 1);
    expect([...groupDays([late], utcDay).keys()]).toEqual([day(2026, 0, 6)]);
    expect([...groupDays([late], (ms) => zonedDay(ms, 'America/New_York')).keys()]).toEqual([day(2026, 0, 5)]);
  });
});

describe('zonedDay', () => {
  it('is the UTC day in UTC and moves with the zone and daylight saving', () => {
    expect(zonedDay(Date.UTC(2026, 0, 5, 12), 'UTC')).toBe(day(2026, 0, 5));
    // Tokyo is nine hours ahead: 20:00 UTC is already the next day there.
    expect(zonedDay(Date.UTC(2026, 0, 5, 20), 'Asia/Tokyo')).toBe(day(2026, 0, 6));
    // New York is five hours behind in January, four in July.
    expect(zonedDay(Date.UTC(2026, 0, 6, 4, 30), 'America/New_York')).toBe(day(2026, 0, 5));
    expect(zonedDay(Date.UTC(2026, 6, 6, 4, 30), 'America/New_York')).toBe(day(2026, 6, 6));
    expect(zonedDay(Date.UTC(2026, 6, 6, 3, 59), 'America/New_York')).toBe(day(2026, 6, 5));
  });
});

describe('months', () => {
  it('numbers a month from the day', () => {
    expect(monthOfDay(day(2026, 10, 30))).toBe(2026 * 12 + 10);
    expect(monthOfDay(day(2027, 0, 1))).toBe(2027 * 12);
  });

  it('lays out November 2026 (the 1st is a Sunday) as six weeks starting on Monday', () => {
    const weeks = monthWeeks(2026 * 12 + 10);
    expect(weeks).toHaveLength(6);
    expect(weeks.every((week) => week.length === 7)).toBe(true);
    expect(weeks[0]).toEqual([null, null, null, null, null, null, day(2026, 10, 1)]);
    expect(weeks[5]).toEqual([day(2026, 10, 30), null, null, null, null, null, null]);
    expect(weeks.flat().filter((d) => d != null)).toHaveLength(30);
  });

  it('starts a month that begins on a Monday with no blanks, and fits February in four weeks', () => {
    // 1 June 2026 is a Monday; February 2027 starts on a Monday and has 28 days.
    expect(monthWeeks(2026 * 12 + 5)[0][0]).toBe(day(2026, 5, 1));
    const february = monthWeeks(2027 * 12 + 1);
    expect(february).toHaveLength(4);
    expect(february.flat().every((d) => d != null)).toBe(true);
  });
});
