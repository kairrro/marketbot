// How big each kind of scheduled event is for each market, and how long to stay
// out around it. These are plain rules, not AI: the past-data test (see the News
// page, Past test) checks them against what NQ, GC and CL actually did, and
// this table is where the results are tuned.
//
// A profile is a "family" of events: every row the calendar publishes for the
// same release (CPI headline and core, y/y and m/m...) lands in one family and
// shows up as one item.

import type { Exposure, Impact, ScheduledKind } from './types';

export interface Profile {
  id: string;
  kind: ScheduledKind;
  /** Short name shown on the card. */
  label: string;
  /** One plain line on why it matters. No direction. */
  note: string;
  match: RegExp;
  exclude?: RegExp;
  /** Calendar country this applies to (US when left out). */
  country?: string;
  /** Impact on each market. */
  tiers: Record<Exposure, Impact>;
  /** A rare, very large mover: gets the "extreme" volatility tag when High. */
  top?: boolean;
  /** Minutes to stay out before and after, when the impact is Medium or High. */
  window?: Partial<Record<Impact, { before: number; after: number }>>;
  /** Show the period (Feb, Q3) next to the label. */
  period?: boolean;
}

const t = (index: Impact, gold: Impact, oil: Impact): Record<Exposure, Impact> => ({ index, gold, oil });

export const DEFAULT_WINDOW: Record<Impact, { before: number; after: number } | null> = {
  low: null,
  medium: { before: 3, after: 10 },
  high: { before: 5, after: 15 }
};

export const PROFILES: readonly Profile[] = [
  {
    id: 'fomc-decision',
    kind: 'fed',
    label: 'Fed rate decision',
    note: 'The Fed announces rates. A second wave often follows at the press conference.',
    // On the TradingView calendar the US decision is titled just "Interest Rate".
    match: /^interest\s+rate$|\b(fed(eral)?\s+(funds\s+)?(interest\s+)?rate\s+decision|interest\s+rate\s+decision|fomc\s+(statement|economic\s+projections|rate)|federal\s+funds\s+rate)\b/i,
    exclude: /minutes|reserve/i,
    tiers: t('high', 'high', 'medium'),
    top: true,
    // The press conference follows half an hour later, so the window runs through it.
    window: { high: { before: 5, after: 90 } }
  },
  {
    id: 'fomc-presser',
    kind: 'fed',
    label: 'Fed press conference',
    note: 'The Fed chair takes questions. Headlines can come fast.',
    match: /fomc\s+press\s+conference|fed\s+chair.*press\s+conference/i,
    tiers: t('high', 'high', 'medium'),
    window: { high: { before: 2, after: 30 } }
  },
  {
    id: 'fomc-minutes',
    kind: 'fed',
    label: 'Fed minutes',
    note: 'Notes from the last Fed meeting. Usually a smaller reaction.',
    match: /fomc\s+minutes|minutes\s+of\s+the\s+(fomc|federal)/i,
    tiers: t('medium', 'medium', 'low')
  },
  {
    id: 'fed-chair',
    kind: 'fed',
    label: 'Fed chair speaks',
    note: 'The Fed chair is speaking. Off-script lines can move things.',
    match: /(fed\s+chair|powell).*(speaks?|speech|testi|remarks)|(speech|testimony).*powell/i,
    tiers: t('medium', 'medium', 'low')
  },
  {
    id: 'fed-speaker',
    kind: 'fed',
    label: 'Fed speaker',
    note: 'A Fed official is speaking. Usually minor.',
    match: /\bfed\b.*\b(speaks?|speech|speaking)\b|\bfomc\s+member\b/i,
    exclude: /chair|powell|minutes/i,
    tiers: t('low', 'low', 'low')
  },
  {
    id: 'cpi',
    kind: 'economic',
    label: 'CPI',
    note: 'Inflation report. Rate bets reprice fast, so most markets can jump.',
    match: /^(core\s+)?inflation\s+rate\s+(mom|yoy)$|^(core\s+)?cpi\s+(m\/m|y\/y|mom|yoy)$/i,
    exclude: /nsa|cleveland|wage/i,
    tiers: t('high', 'high', 'medium'),
    top: true,
    // Past tests: NQ stays about twice as jumpy as usual for ~25 min (median), up to an hour.
    window: { high: { before: 5, after: 45 } },
    period: true
  },
  {
    id: 'ppi',
    kind: 'economic',
    label: 'PPI',
    note: 'Producer prices. A smaller inflation read that can still jolt things.',
    match: /^(core\s+)?ppi\s+(m\/m|y\/y|mom|yoy)$/i,
    tiers: t('medium', 'medium', 'low'),
    window: { medium: { before: 3, after: 25 } },
    period: true
  },
  {
    id: 'nfp',
    kind: 'economic',
    label: 'Jobs report',
    note: 'Monthly jobs data. One of the biggest scheduled movers.',
    match: /non[- ]?farm\s+(payrolls|employment\s+change)|^unemployment\s+rate$/i,
    exclude: /private|adp/i,
    tiers: t('high', 'high', 'medium'),
    top: true,
    window: { high: { before: 5, after: 50 } },
    period: true
  },
  {
    id: 'pce',
    kind: 'economic',
    label: 'PCE inflation',
    note: 'The Fed\'s preferred inflation gauge. Often already hinted by CPI.',
    match: /^(core\s+)?pce\s+price\s+index\s+(mom|yoy|m\/m|y\/y)$|^core\s+pce|^personal\s+(income|spending)\s+mom$/i,
    // Past tests: gold barely reacts to PCE, so it is Low there.
    tiers: t('medium', 'low', 'low'),
    window: { medium: { before: 3, after: 15 } },
    period: true
  },
  {
    id: 'gdp',
    kind: 'economic',
    label: 'GDP (first estimate)',
    note: 'First read on growth for the quarter.',
    match: /gdp\s+growth\s+rate\s+qoq\s+adv|gdp.*(advance|adv\b)|advance\s+gdp/i,
    tiers: t('medium', 'low', 'low'),
    window: { medium: { before: 3, after: 15 } },
    period: true
  },
  {
    id: 'ism',
    kind: 'economic',
    label: 'ISM',
    note: 'Business survey. Usually a modest reaction.',
    match: /ism\s+(manufacturing|services|non-manufacturing)\s+pmi/i,
    // Past tests: it moves NQ no more than a Low event does.
    tiers: t('low', 'low', 'low')
  },
  {
    id: 'retail-sales',
    kind: 'economic',
    label: 'Retail sales',
    note: 'Consumer spending report.',
    match: /^(core\s+)?retail\s+sales\s+(mom|m\/m)$/i,
    exclude: /control|ex/i,
    tiers: t('medium', 'low', 'low')
  },
  {
    id: 'jolts',
    kind: 'economic',
    label: 'Job openings (JOLTS)',
    note: 'Labour market survey. Usually modest.',
    match: /jolts\s+job\s+openings/i,
    tiers: t('low', 'low', 'low')
  },
  {
    id: 'adp',
    kind: 'economic',
    label: 'ADP jobs',
    note: 'Private payrolls estimate. Usually modest.',
    match: /adp\s+employment\s+change/i,
    tiers: t('low', 'low', 'low')
  },
  {
    id: 'claims',
    kind: 'economic',
    label: 'Jobless claims',
    note: 'Weekly jobs figure. Usually quiet.',
    match: /^(initial\s+jobless\s+claims|unemployment\s+claims)$/i,
    tiers: t('low', 'low', 'low')
  },
  {
    id: 'sentiment',
    kind: 'economic',
    label: 'Consumer sentiment',
    note: 'Survey of households. Usually quiet.',
    match: /michigan\s+consumer\s+sentiment|cb\s+consumer\s+confidence|^consumer\s+confidence$/i,
    tiers: t('low', 'low', 'low')
  },
  {
    id: 'eia-crude',
    kind: 'energy',
    label: 'Crude oil inventories (EIA)',
    note: 'Weekly US oil stocks. Oil can jump on it.',
    match: /^eia\s+crude\s+oil\s+stocks\s+change$|^crude\s+oil\s+inventories$/i,
    tiers: t('low', 'low', 'medium'),
    window: { medium: { before: 2, after: 10 } }
  },
  {
    id: 'opec',
    kind: 'energy',
    label: 'OPEC meeting',
    note: 'Oil producers decide on supply.',
    match: /\bopec\b/i,
    country: '*',
    tiers: t('low', 'low', 'high'),
    window: { high: { before: 5, after: 30 } }
  },
  {
    id: 'central-bank',
    kind: 'economic',
    label: 'Central bank decision',
    note: 'A major central bank sets rates.',
    match: /^interest\s+rate$|(ecb|boe|boj|bank\s+of\s+(england|japan))\s+(main\s+)?(interest\s+)?rate\s+decision|(ecb|boe|boj)\s+press\s+conference/i,
    country: '*',
    tiers: t('low', 'low', 'low')
  }
];

export interface Classified {
  profile: Profile;
}

/** The family a calendar row belongs to, or null when it is not one we rate. */
export function classifyEvent(title: string, country: string): Profile | null {
  const name = title.trim();
  for (const profile of PROFILES) {
    const want = profile.country ?? 'US';
    if (want !== '*' && country.toUpperCase() !== want) continue;
    if (!profile.match.test(name)) continue;
    if (profile.exclude?.test(name)) continue;
    return profile;
  }
  return null;
}

/** A market's exposure group, which is what the profiles are written for. */
export function exposureOf(symbol: string): Exposure {
  const s = symbol.toUpperCase();
  if (/^(GC|MGC|XAU|GLD|SI|SIL|XAG|SLV|PL|HG)$/.test(s)) return 'gold';
  if (/^(CL|MCL|BZ|NG|USO|XTI|WTI|BRENT|XLE|RB|HO)$/.test(s)) return 'oil';
  return 'index';
}

/**
 * How big a mega-cap's earnings release is for the Nasdaq. Past tests (2023 to
 * 2026): in the hour after the release NQ's range ran 2 to 9 times its usual
 * size for that hour, for all eight names. Any other stock the user tracks is
 * Low for the index.
 */
export const EARNINGS_NQ: Record<string, Impact> = {
  NVDA: 'high',
  AAPL: 'high',
  MSFT: 'high',
  AMZN: 'high',
  GOOGL: 'high',
  GOOG: 'high',
  META: 'high',
  TSLA: 'high',
  AVGO: 'high'
};

/**
 * The open that follows a report is a different question from the release: the
 * reaction has mostly happened by then. Past tests: only NVDA's open is clearly
 * busier than a normal open.
 */
export const EARNINGS_OPEN_NQ: Record<string, Impact> = { NVDA: 'medium' };

/** Window around an earnings release or the next open. */
export const EARNINGS_WINDOW: Record<Impact, { before: number; after: number } | null> = {
  low: null,
  medium: { before: 3, after: 10 },
  high: { before: 5, after: 45 }
};
