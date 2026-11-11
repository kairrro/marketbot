// lightweight-charts draws every timestamp as UTC. To show another zone (the
// user's local time by default) we shift the timestamps by that zone's UTC
// offset before handing them over (the approach the library's own docs recommend).

import type { Time, UTCTimestamp } from 'lightweight-charts';
import { LOCAL, offsetMinutes, type TimeZone } from '$lib/timezone';

/** UTC offset of `zone` in seconds at the given instant (positive east of Greenwich). */
export function tzOffsetSec(ms: number, zone: TimeZone = LOCAL): number {
  return offsetMinutes(ms, zone) * 60;
}

export function toChartTime(ms: number, offsetSec: number): UTCTimestamp {
  return (Math.floor(ms / 1000) + offsetSec) as UTCTimestamp;
}

/**
 * A chart time back to ms. The offset is already baked in, so the result must
 * be formatted as UTC to read as the chart's own zone.
 */
export function chartMs(time: Time): number {
  if (typeof time === 'number') return time * 1000;
  if (typeof time === 'string') return Date.parse(time);
  return Date.UTC(time.year, time.month - 1, time.day);
}
