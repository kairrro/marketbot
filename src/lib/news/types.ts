// Shared shapes for the news brief. It only informs: nothing in here trades, and
// nothing predicts a direction. Impact is how BIG something is, volatility is how
// jumpy the market is likely to be, the no-trade window is WHEN to stay out.

import type { Swing } from './swing';

export type Impact = 'low' | 'medium' | 'high';
export type Volatility = 'normal' | 'elevated' | 'extreme';
export type AssetKind = 'market' | 'stock' | 'topic';

export const IMPACTS: readonly Impact[] = ['low', 'medium', 'high'];
export const IMPACT_RANK: Record<Impact, number> = { low: 0, medium: 1, high: 2 };

export const maxImpact = (a: Impact, b: Impact): Impact => (IMPACT_RANK[a] >= IMPACT_RANK[b] ? a : b);

/** What a tracked thing is: a market you trade, a stock that moves NQ, or a macro topic. */
export interface TrackedAsset {
  id: number;
  kind: AssetKind;
  /** NQ, NVDA, or a short key for a topic (FED). */
  symbol: string;
  name: string;
  /** Words that make a headline about this asset. */
  keywords: string[];
  enabled: boolean;
  /** One of the starting set (can still be removed, and restored with Reset). */
  builtin: boolean;
}

/** The three markets the impact ratings are written for. */
export type Exposure = 'index' | 'gold' | 'oil';

export interface NoTradeWindow {
  startMs: number;
  endMs: number;
}

export type ScheduledKind = 'economic' | 'fed' | 'earnings' | 'energy' | 'other';

/** One row from an economic calendar, before anything is rated. */
export interface RawEvent {
  id: string;
  title: string;
  country: string;
  timeMs: number;
  /** The calendar's own 3-step importance: 1 high, 0 medium, -1 low. */
  importance: number;
  period?: string | null;
  forecast?: string | null;
  previous?: string | null;
  /** The released number. Never used to rate anything: it is not known in advance. */
  actual?: string | null;
}

/** A scheduled event, rated. */
export interface ScheduledItem {
  id: string;
  kind: ScheduledKind;
  /** The family in profiles.ts this event belongs to (cpi, nfp, fomc-decision, ...). */
  family: string;
  title: string;
  /** One plain line on why it matters. */
  note: string;
  timeMs: number;
  /** The tracked assets it touches: markets first, then stocks. */
  assets: string[];
  /** Impact on each tracked market, by symbol. This is what the past-data test checks. */
  perAsset: Record<string, Impact>;
  impact: Impact;
  volatility: Volatility;
  noTrade: NoTradeWindow | null;
  /** How big a swing to expect in the hour after, by market. A size, never a direction. */
  swing: Record<string, Swing>;
  forecast?: string | null;
  previous?: string | null;
  /** Release timing is outside the day's trading windows (after the close, say). */
  outsideHours?: boolean;
}

/** A headline the AI looked at and thinks is worth knowing about. */
export interface HeadlineItem {
  id: string;
  /** One short plain sentence on what happened. No direction. */
  what: string;
  headline: string;
  source: string;
  url: string;
  publishedAt: number;
  assets: string[];
  impact: Impact;
  volatility: Volatility;
  /** Minutes to sit out. 0 means no pause is needed. */
  pauseMinutes: number;
  /** How big a swing to expect in the hour after, by market. Older saved alerts may not have it. */
  swing?: Record<string, Swing>;
}

export type MoodState = 'risk-off' | 'risk-on' | 'mixed' | 'quiet';

export interface Mood {
  state: MoodState;
  /** Two or three short plain lines. */
  lines: string[];
}

export type BriefKind = 'morning' | 'weekly';

export interface Brief {
  kind: BriefKind;
  /** The Central-time date the brief is for (weekly: the Monday it starts on). */
  forDate: string;
  generatedAt: number;
  /** The model that wrote the headline ratings and mood, or null when AI was off. */
  model: string | null;
  events: ScheduledItem[];
  /** Notable overnight news (morning brief only). */
  overnight: HeadlineItem[];
  mood: Mood | null;
  /** Merged no-trade windows for the day. */
  noTrade: NoTradeWindow[];
  /** Plain notes about what could not be done (no key, a source down). */
  notes: string[];
  /** The calendar could not be read, so the events list may be missing things. */
  incomplete?: boolean;
  /** Latest price of each tracked market when it was written, to show a swing in points or dollars. */
  prices?: Record<string, number>;
}

export interface AlertRecord extends HeadlineItem {
  createdAt: number;
  discordSentAt: number | null;
}

export interface AlertWindow {
  /** "08:30" in Central time. */
  start: string;
  end: string;
}

export interface NewsSettings {
  /** OpenRouter model id. */
  model: string;
  /** Morning brief time, Central. */
  morningTime: string;
  /** Weekly preview: 0 is Sunday. */
  weeklyDay: number;
  weeklyTime: string;
  alertWindows: AlertWindow[];
  /** Lowest impact that gets an alert. */
  alertMinImpact: Impact;
  maxAlertsPerHour: number;
  pollMinutes: number;
  /** A headline older than this many minutes is not an alert any more. */
  freshMinutes: number;
  discordBrief: boolean;
  discordAlerts: boolean;
  discordWeekly: boolean;
  /** Show Low-impact scheduled events in the brief. */
  showLow: boolean;
}

/** What the sidebar and the News page show about the bot. */
export interface NewsStatus {
  aiReady: boolean;
  discordReady: boolean;
  model: string;
  now: number;
  /** Today's date in Central time. */
  today: string;
  /** Inside one of the live-alert windows right now. */
  windowOpen: boolean;
  lastError: { at: number; message: string } | null;
  lastAlertRun: { at: number; fetched: number; candidates: number; alerts: number; skipped?: string } | null;
  botRunning: boolean;
}

export interface BriefWithSent extends Brief {
  discordSentAt: number | null;
}

/** Everything the News page loads in one request. */
export interface NewsPayload {
  status: NewsStatus;
  settings: NewsSettings;
  assets: TrackedAsset[];
  morning: BriefWithSent | null;
  weekly: BriefWithSent | null;
  morningDates: string[];
  weeklyDates: string[];
  alerts: AlertRecord[];
  /** Latest price of each tracked market, to turn a % swing into points or dollars. */
  prices: Record<string, number>;
}
