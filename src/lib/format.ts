// Display formatting. Uses a real minus sign (−) so negative numbers line up
// with positive ones in tabular figures.

import { intlZone, LOCAL, offsetMinutes, zonedTime, type TimeZone } from './timezone';

const MINUS = '−';

/** Sensible decimals for a price when the market's own precision is unknown. */
function fallbackPrecision(price: number): number {
  const abs = Math.abs(price);
  return abs >= 1000 ? 2 : abs >= 10 ? 3 : abs >= 1 ? 4 : 6;
}

export function fmtPrice(price: number | null | undefined, precision?: number): string {
  if (price == null || !Number.isFinite(price)) return '–';
  return price.toFixed(precision ?? fallbackPrecision(price));
}

export function roundTo(value: number, precision: number): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

const usd = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function fmtMoney(value: number, signed = false): string {
  const sign = value < 0 ? MINUS : signed && value > 0 ? '+' : '';
  return `${sign}$${usd.format(Math.abs(value))}`;
}

const compactUsd = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

/** "$1.2B", "$350K". */
export function fmtCompactMoney(value: number): string {
  return `$${compactUsd.format(value)}`;
}

export function fmtSigned(value: number, digits = 2): string {
  return `${value < 0 ? MINUS : '+'}${Math.abs(value).toFixed(digits)}`;
}

export function fmtR(r: number, digits = 2): string {
  return `${fmtSigned(r, digits)}R`;
}

export function fmtPct(pct: number, digits = 2, signed = false): string {
  return `${signed ? fmtSigned(pct, digits) : pct.toFixed(digits)}%`;
}

/** Position size in coin units: enough digits to be meaningful at any price. */
export function fmtQty(qty: number): string {
  const abs = Math.abs(qty);
  const digits = abs >= 1000 ? 0 : abs >= 100 ? 1 : abs >= 1 ? 3 : abs >= 0.01 ? 4 : 6;
  return qty.toFixed(digits);
}

interface DateParts {
  weekday: string;
  month: string;
  day: string;
  year: string;
  hour: string;
  minute: string;
}

// Dates are formatted constantly (every journal row, every replay step), and
// building a formatter is slow, so one is kept per zone.
const dateFormats = new Map<string, Intl.DateTimeFormat>();

function dateParts(ms: number, zone: TimeZone): DateParts {
  let format = dateFormats.get(zone);
  if (!format) {
    format = new Intl.DateTimeFormat(undefined, {
      timeZone: intlZone(zone),
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    });
    dateFormats.set(zone, format);
  }
  const parts: Record<string, string> = {};
  for (const part of format.formatToParts(ms)) parts[part.type] = part.value;
  return {
    weekday: parts.weekday ?? '',
    month: parts.month ?? '',
    day: parts.day ?? '',
    year: parts.year ?? '',
    hour: (parts.hour ?? '').padStart(2, '0'),
    minute: (parts.minute ?? '').padStart(2, '0')
  };
}

/** "Mon Feb 26 '25 09:30" in the given zone (the browser's own by default). */
export function fmtDateTime(ms: number, zone: TimeZone = LOCAL): string {
  const p = dateParts(ms, zone);
  return `${p.weekday} ${p.month} ${p.day} '${p.year} ${p.hour}:${p.minute}`;
}

/** "Feb 26 '25 09:30" in the given zone: fmtDateTime without the weekday, for tight columns. */
export function fmtShortDateTime(ms: number, zone: TimeZone = LOCAL): string {
  const p = dateParts(ms, zone);
  return `${p.month} ${p.day} '${p.year} ${p.hour}:${p.minute}`;
}

/** "Feb 26 '25" in the given zone. */
export function fmtDate(ms: number, zone: TimeZone = LOCAL): string {
  const p = dateParts(ms, zone);
  return `${p.month} ${p.day} '${p.year}`;
}

/** "Mon 26 09:30" in the given zone. */
export function fmtDayTime(ms: number, zone: TimeZone = LOCAL): string {
  const p = dateParts(ms, zone);
  return `${p.weekday} ${p.day} ${p.hour}:${p.minute}`;
}

/** "Mon 26": a day on the chart's time axis. */
export function fmtWeekday(ms: number, zone: TimeZone = LOCAL): string {
  const p = dateParts(ms, zone);
  return `${p.weekday} ${p.day}`;
}

export function fmtDuration(ms: number): string {
  const minutes = Math.round(Math.abs(ms) / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** ms -> value for <input type="datetime-local">, as the wall time in `zone`. */
export function toLocalInput(ms: number, zone: TimeZone = LOCAL): string {
  const d = new Date(ms + offsetMinutes(ms, zone) * 60_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/**
 * Value of an <input type="datetime-local"> -> ms, or null when empty/invalid.
 * The value is read as a wall time in `zone` (the browser's own by default).
 */
export function parseLocalInput(value: string, zone: TimeZone = LOCAL): number | null {
  if (!value) return null;
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  const ms = parts
    ? zonedTime(zone, +parts[1], +parts[2] - 1, +parts[3], +parts[4], +parts[5])
    : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

export function sign(value: number): 'pos' | 'neg' | '' {
  return value > 0 ? 'pos' : value < 0 ? 'neg' : '';
}
