import { describe, expect, it } from 'vitest';
import { fmtDateTime, fmtWeekday, parseLocalInput } from './format';
import { isTimeZone, offsetLabel, offsetMinutes, zonedTime } from './timezone';

const JAN = Date.UTC(2026, 0, 14, 12);
const JUL = Date.UTC(2026, 6, 15, 12);

describe('time zones', () => {
  it('knows the UTC offset of a zone at an instant, daylight saving included', () => {
    expect(offsetMinutes(JAN, 'America/New_York')).toBe(-300);
    expect(offsetMinutes(JUL, 'America/New_York')).toBe(-240);
    expect(offsetMinutes(JAN, 'Europe/London')).toBe(0);
    expect(offsetMinutes(JUL, 'Europe/London')).toBe(60);
    expect(offsetMinutes(JUL, 'Asia/Kolkata')).toBe(330);
    expect(offsetMinutes(JUL, 'UTC')).toBe(0);
  });

  it('finds the instant a wall time happens in a zone', () => {
    expect(zonedTime('America/New_York', 2026, 0, 14, 9, 30)).toBe(Date.UTC(2026, 0, 14, 14, 30));
    // The Monday after clocks go forward (Sunday 8 March 2026).
    expect(zonedTime('America/New_York', 2026, 2, 9, 9, 30)).toBe(Date.UTC(2026, 2, 9, 13, 30));
    expect(zonedTime('Asia/Tokyo', 2026, 0, 14, 9)).toBe(Date.UTC(2026, 0, 14, 0));
  });

  it('labels offsets the way TradingView does', () => {
    expect(offsetLabel(0)).toBe('UTC');
    expect(offsetLabel(120)).toBe('UTC+2');
    expect(offsetLabel(-240)).toBe('UTC−4');
    expect(offsetLabel(330)).toBe('UTC+5:30');
  });

  it('only accepts zones that exist', () => {
    expect(isTimeZone('local')).toBe(true);
    expect(isTimeZone('Europe/London')).toBe(true);
    expect(isTimeZone('Mars/Olympus_Mons')).toBe(false);
    expect(isTimeZone(42)).toBe(false);
  });

  it('formats dates with the day of the week and a short year', () => {
    // Wednesday 26 February 2025, 09:30 in New York.
    const ms = Date.UTC(2025, 1, 26, 14, 30);
    const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone: 'UTC' }).format(ms);
    const month = new Intl.DateTimeFormat(undefined, { month: 'short', timeZone: 'UTC' }).format(ms);
    expect(fmtDateTime(ms, 'America/New_York')).toBe(`${weekday} ${month} 26 '25 09:30`);
    expect(fmtWeekday(ms, 'America/New_York')).toBe(`${weekday} 26`);
    // Late evening in New York is already the next day in Tokyo.
    expect(fmtDateTime(Date.UTC(2025, 1, 27, 2), 'America/New_York')).toContain("26 '25 21:00");
    expect(fmtDateTime(Date.UTC(2025, 1, 27, 2), 'Asia/Tokyo')).toContain("27 '25 11:00");
  });

  it('formats and reads dates in a chosen zone', () => {
    const open = Date.UTC(2026, 0, 14, 14, 30);
    expect(fmtDateTime(open, 'America/New_York')).toContain('09:30');
    expect(fmtDateTime(open, 'UTC')).toContain('14:30');
    expect(parseLocalInput('2026-01-14T09:30', 'America/New_York')).toBe(open);
    expect(parseLocalInput('2026-01-14T14:30', 'UTC')).toBe(open);
    expect(parseLocalInput('')).toBeNull();
  });
});
