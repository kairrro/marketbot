// What the past-data test reports. Shared with the News page, which draws it.

import type { Impact } from './types';
import type { TierStats } from './evaluate';

export interface SampleView {
  date: string;
  timeMs: number;
  label: string;
  family: string;
  asset: string;
  tier: Impact;
  range30: number;
  range60: number;
  net30: number;
  net60: number;
  /** What the same clock window does on a day with nothing scheduled, %. */
  baseline: number;
  ratio: number;
}

export interface SummaryView {
  total: number;
  byTier: TierStats[];
  ordered: boolean;
  highQuiet: SampleView[];
  lowSpike: SampleView[];
}

/** One kind of event for one market: how it was rated and how the market reacted. */
export interface FamilyRow {
  family: string;
  label: string;
  asset: string;
  /** The impact the rules gave it. */
  tier: Impact;
  n: number;
  avgRange60: number;
  medianRatio: number;
  avgRatio: number;
  quietPct: number;
  spikePct: number;
  /** The same, split at the tuning date: events up to it, and events after it. */
  tuneN: number;
  tuneRatio: number;
  holdN: number;
  holdRatio: number;
}

export interface WindowRow {
  family: string;
  label: string;
  n: number;
  /** Minutes after the event until NQ was back to its usual range for that time (median and 80th percentile). */
  medianCalm: number;
  p80Calm: number;
  /** Minutes after the event the no-trade window lasts now. */
  after: number;
  /** Share of events that were calm before the window ended. */
  coveredPct: number;
  /** The 80th percentile, rounded up to 5 minutes. */
  suggested: number;
}

export interface Coverage {
  asset: string;
  source: string;
  from: string;
  to: string;
  days: number;
}

export interface BacktestResult {
  version: 1;
  ranAt: number;
  durationMs: number;
  coverage: Coverage[];
  /** Events on or before this date were used to tune the rules; later ones are the held-out check. */
  tuneUntil: string;
  /** Events before this instant tuned the rules; events from it on are the held-out check. */
  splitMs: number;
  overall: SummaryView;
  tune: SummaryView;
  hold: SummaryView;
  perAsset: Record<string, SummaryView>;
  families: FamilyRow[];
  windows: WindowRow[];
  /** Every event and market that was measured, oldest first. */
  samples: SampleView[];
  /** Events left out because a bigger one was within the same window. */
  excluded: number;
  notes: string[];
}

export interface BacktestProgress {
  running: boolean;
  phase: string;
  done: number;
  total: number;
  startedAt: number | null;
  error: string | null;
}
