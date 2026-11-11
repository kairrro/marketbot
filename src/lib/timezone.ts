// Time zones. 'local' means whatever the browser is set to; anything else is an
// IANA zone name. Pure functions, so the engine and its tests can use them too.

export type TimeZone = string;

export const LOCAL: TimeZone = 'local';

/** The zones offered in the time zone menus, roughly west to east. */
export const TIME_ZONES: readonly { id: TimeZone; label: string }[] = [
  { id: LOCAL, label: 'Local' },
  { id: 'UTC', label: 'UTC' },
  { id: 'America/Los_Angeles', label: 'Los Angeles' },
  { id: 'America/Chicago', label: 'Chicago' },
  { id: 'America/New_York', label: 'New York' },
  { id: 'Europe/London', label: 'London' },
  { id: 'Europe/Berlin', label: 'Berlin' },
  { id: 'Asia/Dubai', label: 'Dubai' },
  { id: 'Asia/Singapore', label: 'Singapore' },
  { id: 'Asia/Hong_Kong', label: 'Hong Kong' },
  { id: 'Asia/Tokyo', label: 'Tokyo' },
  { id: 'Australia/Sydney', label: 'Sydney' }
];

const MINUS = '−';

/** The `timeZone` option for Intl: undefined means the browser's own zone. */
export function intlZone(zone: TimeZone): string | undefined {
  return zone === LOCAL ? undefined : zone;
}

export function isTimeZone(value: unknown): value is TimeZone {
  if (typeof value !== 'string' || !value) return false;
  if (value === LOCAL) return true;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

// Building a formatter is slow and the offset is asked for often, so one is
// kept per zone.
const formats = new Map<string, Intl.DateTimeFormat>();

function wallClock(zone: string): Intl.DateTimeFormat {
  let format = formats.get(zone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric'
    });
    formats.set(zone, format);
  }
  return format;
}

/** UTC offset in minutes at the instant `ms` (positive east of Greenwich). */
export function offsetMinutes(ms: number, zone: TimeZone): number {
  if (zone === LOCAL) return -new Date(ms).getTimezoneOffset();
  if (zone === 'UTC') return 0;
  const parts: Record<string, number> = {};
  for (const part of wallClock(zone).formatToParts(ms)) parts[part.type] = Number(part.value);
  const wall = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return Math.round((wall - Math.floor(ms / 1000) * 1000) / 60_000);
}

/**
 * The instant the clock in `zone` reads the given wall time. Months are
 * 0-based and out-of-range values roll over, as with Date.UTC.
 */
export function zonedTime(zone: TimeZone, year: number, month: number, day: number, hour = 0, minute = 0): number {
  if (zone === LOCAL) return new Date(year, month, day, hour, minute).getTime();
  const wall = Date.UTC(year, month, day, hour, minute);
  // The offset is looked up twice: the first guess can land on the other side
  // of a daylight-saving change from the answer.
  const guess = wall - offsetMinutes(wall, zone) * 60_000;
  return wall - offsetMinutes(guess, zone) * 60_000;
}

/** "UTC", "UTC+2", "UTC−4", "UTC+5:30". */
export function offsetLabel(minutes: number): string {
  if (minutes === 0) return 'UTC';
  const abs = Math.abs(minutes);
  const rest = abs % 60;
  return `UTC${minutes < 0 ? MINUS : '+'}${Math.floor(abs / 60)}${rest ? `:${String(rest).padStart(2, '0')}` : ''}`;
}

/** The browser's own zone, e.g. "Europe/Berlin" (empty if it cannot be told). */
export function localZoneName(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
  } catch {
    return '';
  }
}

/** How a zone is named in the UI: "New York", or "Local (Europe/Berlin)". */
export function zoneLabel(zone: TimeZone): string {
  const known = TIME_ZONES.find((z) => z.id === zone);
  if (zone === LOCAL) {
    const name = localZoneName();
    return name ? `Local (${name.replace(/_/g, ' ')})` : 'Local';
  }
  return known?.label ?? zone.replace(/_/g, ' ');
}
