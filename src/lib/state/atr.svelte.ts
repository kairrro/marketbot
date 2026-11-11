// The ATR on the chart's own closed candles at the replay cursor, so it follows
// whatever timeframe is showing. Switched on and off in Settings (display.atr).

import { atrReading, stopInAtr, type AtrReading } from '$lib/engine/atr';
import { display } from './display.svelte';
import { replay } from './replay.svelte';

class AtrStore {
  /** The latest reading, or null when ATR is off, nothing is loaded, or fewer than a period of candles have closed. */
  reading = $derived.by<AtrReading | null>(() => {
    if (!display.atr || !replay.info) return null;
    return atrReading(replay.candles, replay.count, display.atrPeriod);
  });

  /** A stop `distance` away from entry, in ATRs. Null while there is no reading. */
  multiple(distance: number): number | null {
    const reading = this.reading;
    return reading ? stopInAtr(distance, reading.value) : null;
  }
}

export const atr = new AtrStore();
