import { describe, expect, it } from 'vitest';
import type { Candle } from '$lib/engine/types';
import { DEFAULT_ASSETS } from './defaults';
import { QUIET_BELOW, measureReaction, median, summarize, type Sample } from './evaluate';
import { bannedIn, cleanText, findBanned, isClean } from './guard';
import {
  bigHint,
  dedupeHeadlines,
  isDuplicate,
  isJunk,
  matchAssets,
  pickCandidates,
  similarity,
  splitSource
} from './noise';
import { PROFILES, classifyEvent, exposureOf } from './profiles';
import { fmtPct, fmtRatio, fmtSize } from './swing';
import { earningsOpenItems, earningsReleaseItems, rateEvents } from './rate';
import {
  addDays,
  ctAt,
  ctParts,
  fmtRange,
  fmtTime,
  inAlertWindow,
  mergeWindows,
  nextMonday,
  previousWeekday,
  windowAround
} from './time';
import type { AlertWindow, RawEvent, TrackedAsset } from './types';

const assets: TrackedAsset[] = DEFAULT_ASSETS.map((a, i) => ({
  id: i + 1,
  kind: a.kind,
  symbol: a.symbol,
  name: a.name,
  keywords: [...a.keywords],
  enabled: true,
  builtin: true
}));

const WINDOWS: AlertWindow[] = [
  { start: '08:30', end: '10:00' },
  { start: '12:00', end: '15:00' }
];

describe('Central time', () => {
  it('reads wall-clock parts in Chicago, with daylight saving', () => {
    // 2025-03-12 12:30 UTC: DST started on Mar 9, so Chicago is UTC-5 -> 7:30 AM.
    const p = ctParts(Date.UTC(2025, 2, 12, 12, 30));
    expect([p.dateKey, p.hour, p.minute, p.weekday]).toEqual(['2025-03-12', 7, 30, 3]);
    // The same UTC time in winter is 6:30 AM.
    expect(ctParts(Date.UTC(2025, 0, 15, 12, 30)).hour).toBe(6);
  });

  it('builds an instant from a Chicago clock time', () => {
    expect(ctAt('2025-03-12', '07:30')).toBe(Date.UTC(2025, 2, 12, 12, 30));
    expect(ctAt('2025-01-15', '08:00')).toBe(Date.UTC(2025, 0, 15, 14, 0));
  });

  it('formats times and ranges', () => {
    const t = ctAt('2025-03-12', '07:30');
    expect(fmtTime(t)).toBe('7:30 AM');
    expect(fmtRange(t - 5 * 60_000, t + 15 * 60_000)).toBe('7:25–7:45 AM');
    expect(fmtRange(ctAt('2025-03-12', '11:55'), ctAt('2025-03-12', '12:20'))).toBe('11:55 AM–12:20 PM');
  });

  it('moves between days', () => {
    expect(addDays('2025-03-31', 1)).toBe('2025-04-01');
    expect(previousWeekday('2025-03-17')).toBe('2025-03-14'); // Monday -> Friday
    expect(nextMonday('2025-03-16')).toBe('2025-03-17'); // Sunday
  });

  it('knows the alert windows, and not on weekends', () => {
    expect(inAlertWindow(ctAt('2025-03-12', '08:29'), WINDOWS)).toBe(false);
    expect(inAlertWindow(ctAt('2025-03-12', '08:30'), WINDOWS)).toBe(true);
    expect(inAlertWindow(ctAt('2025-03-12', '10:00'), WINDOWS)).toBe(false);
    expect(inAlertWindow(ctAt('2025-03-12', '13:00'), WINDOWS)).toBe(true);
    expect(inAlertWindow(ctAt('2025-03-15', '13:00'), WINDOWS)).toBe(false); // Saturday
  });

  it('merges windows that overlap or nearly touch', () => {
    const t = ctAt('2025-03-12', '13:00');
    const merged = mergeWindows([windowAround(t, 5, 25), windowAround(t + 30 * 60_000, 2, 30)]);
    expect(merged).toHaveLength(1);
    expect(merged[0].startMs).toBe(t - 5 * 60_000);
    expect(merged[0].endMs).toBe(t + 60 * 60_000);
  });
});

describe('direction guard', () => {
  it.each([
    'bullish for tech',
    'This is bearish',
    'NQ could rally after CPI',
    'Price will go up',
    'prices are going down',
    'Oil expected to rise',
    'Nvidia stock surges',
    'a sharp drop is likely to drop prices',
    'Sell the rip',
    'Buy the dip',
    'go long on gold',
    'positive for tech',
    'Gold prices rise',
    'markets are down'
  ])('rejects %s', (text) => {
    expect(isClean(text)).toBe(false);
  });

  it.each([
    'CPI at 7:30. Wider swings likely, stay out 7:25–7:45.',
    'Nvidia reports after the close. The next open can be jumpy.',
    'Oil headlines are coming fast. Volatility is elevated.',
    'Fed chair speaks. Off-script lines can move things.',
    'Risk-off mood, tech weak, oil volatile.',
    'A short pause is smart here.'
  ])('allows %s', (text) => {
    expect(findBanned(text)).toBeNull();
  });

  it('falls back and lists what it found', () => {
    expect(cleanText('Nvidia soars', 'Nvidia news')).toBe('Nvidia news');
    expect(cleanText('Nvidia reports', 'x')).toBe('Nvidia reports');
    expect(bannedIn(['fine', 'bullish', 'sell the dip'])).toEqual(['bullish', 'sell']);
  });

  it('every profile note and label is itself clean', () => {
    for (const p of PROFILES) {
      expect(findBanned(p.note), p.id).toBeNull();
      expect(findBanned(p.label), p.id).toBeNull();
    }
  });
});

describe('scheduled event rating', () => {
  const at = (hhmm: string, date = '2025-03-12') => ctAt(date, hhmm);
  const row = (title: string, hhmm: string, extra: Partial<RawEvent> = {}): RawEvent => ({
    id: `${title}${hhmm}`,
    title,
    country: 'US',
    timeMs: at(hhmm),
    importance: 1,
    period: 'Feb. 2025',
    ...extra
  });

  it('classifies calendar rows', () => {
    expect(classifyEvent('Core Inflation Rate MoM', 'US')?.id).toBe('cpi');
    expect(classifyEvent('Inflation Rate YoY', 'US')?.id).toBe('cpi');
    expect(classifyEvent('Non Farm Payrolls', 'US')?.id).toBe('nfp');
    expect(classifyEvent('Fed Interest Rate Decision', 'US')?.id).toBe('fomc-decision');
    expect(classifyEvent('FOMC Minutes', 'US')?.id).toBe('fomc-minutes');
    expect(classifyEvent('Initial Jobless Claims', 'US')?.id).toBe('claims');
    expect(classifyEvent('EIA Crude Oil Stocks Change', 'US')?.id).toBe('eia-crude');
    // Noise rows from the same calendar are dropped.
    expect(classifyEvent('CPI-W', 'US')).toBeNull();
    expect(classifyEvent('USDA Corn Net Export Sales', 'US')).toBeNull();
    expect(classifyEvent('Cleveland Fed CPI MoM', 'US')).toBeNull();
    expect(classifyEvent('Inflation Rate MoM', 'CN')).toBeNull();
  });

  it('groups the rows of one release into one item and gives it a no-trade window', () => {
    const items = rateEvents(
      [
        row('Core Inflation Rate MoM', '07:30', { forecast: '0.3', previous: '0.4' }),
        row('Inflation Rate MoM', '07:30', { forecast: '0.3', previous: '0.4' }),
        row('Inflation Rate YoY', '07:30', { forecast: '2.9', previous: '3' }),
        row('USDA Corn Net Export Sales', '07:30', { importance: -1 })
      ],
      assets
    );
    expect(items).toHaveLength(1);
    const [cpi] = items;
    expect(cpi.title).toBe('CPI · Feb');
    expect(cpi.impact).toBe('high');
    expect(cpi.volatility).toBe('extreme');
    expect(cpi.perAsset).toEqual({ NQ: 'high', GC: 'high', CL: 'medium' });
    expect(cpi.assets).toEqual(['NQ', 'GC', 'CL']);
    // Tuned on past data: NQ stays about twice as jumpy as usual for a good while after CPI.
    expect(cpi.noTrade).toEqual({ startMs: at('07:25'), endMs: at('08:15') });
  });

  it('rates oil inventories as an oil event only', () => {
    const [eia] = rateEvents([row('EIA Crude Oil Stocks Change', '09:30', { importance: 0, period: 'w/o Mar. 3, 2025' })], assets);
    expect(eia.perAsset).toEqual({ NQ: 'low', GC: 'low', CL: 'medium' });
    expect(eia.impact).toBe('medium');
    expect(eia.assets).toEqual(['CL']);
    expect(eia.noTrade).toEqual({ startMs: at('09:28'), endMs: at('09:40') });
  });

  it('gives a low event no window and a normal volatility', () => {
    const [claims] = rateEvents([row('Initial Jobless Claims', '07:30', { importance: 0 })], assets);
    expect(claims.impact).toBe('low');
    expect(claims.volatility).toBe('normal');
    expect(claims.noTrade).toBeNull();
  });

  it('only rates for the markets that are tracked', () => {
    const onlyNq = assets.map((a) => ({ ...a, enabled: a.symbol === 'NQ' || a.kind !== 'market' }));
    const [cpi] = rateEvents([row('Inflation Rate MoM', '07:30')], onlyNq);
    expect(Object.keys(cpi.perAsset)).toEqual(['NQ']);
    expect(rateEvents([row('Inflation Rate MoM', '07:30')], assets.map((a) => ({ ...a, enabled: false })))).toEqual([]);
  });

  it('rates earnings for tracked stocks and the open that follows', () => {
    const rows = [
      { symbol: 'NVDA', name: 'Nvidia', time: 'post' as const, date: '2025-03-12' },
      { symbol: 'AAPL', name: 'Apple', time: 'unknown' as const, date: '2025-03-12' },
      { symbol: 'XYZ', name: 'Not tracked', time: 'post' as const, date: '2025-03-12' }
    ];
    const release = earningsReleaseItems(rows, assets);
    expect(release.map((r) => r.title)).toEqual([
      'NVDA earnings, after the close',
      'AAPL earnings, after the close'
    ]);
    expect(release[0].impact).toBe('high');
    expect(release[0].assets).toContain('NVDA');
    expect(release[0].outsideHours).toBe(true);

    expect(release[1].impact).toBe('high');
    expect(release[1].noTrade).not.toBeNull();

    // At the next open only NVDA is busier than a normal open; Apple's is a Low item with no window.
    const open = earningsOpenItems(rows, assets, '2025-03-13');
    expect(open).toHaveLength(2);
    expect(open[0].timeMs).toBe(ctAt('2025-03-13', '08:30'));
    expect(open[0].impact).toBe('medium');
    expect(open[0].noTrade).toEqual({ startMs: ctAt('2025-03-13', '08:27'), endMs: ctAt('2025-03-13', '08:40') });
    expect(open[1].impact).toBe('low');
    expect(open[1].noTrade).toBeNull();
  });

  it('gives each event the swing to expect: a size, never a direction', () => {
    const [cpi] = rateEvents([row('Inflation Rate MoM', '07:30')], assets);
    expect(cpi.swing.NQ).toEqual({ pct: 1.03, ratio: 3.5 });
    expect(cpi.swing.GC).toEqual({ pct: 0.94, ratio: 2 });
    // Oil is Medium for CPI and CPI has no oil numbers of its own, so it falls back to Medium for oil.
    expect(cpi.swing.CL.pct).toBeGreaterThan(1);

    const [eia] = rateEvents([row('EIA Crude Oil Stocks Change', '09:30', { importance: 0 })], assets);
    expect(Object.keys(eia.swing)).toEqual(['CL']);

    const [claims] = rateEvents([row('Initial Jobless Claims', '07:30', { importance: 0 })], assets);
    expect(claims.swing).toEqual({});

    const [nvda] = earningsReleaseItems([{ symbol: 'NVDA', name: 'Nvidia', time: 'post', date: '2025-03-12' }], assets);
    expect(nvda.swing.NQ).toEqual({ pct: 1.17, ratio: 9 });
    expect(nvda.swing.GC).toBeUndefined();
  });

  it('writes swings in plain words that pass the direction check', () => {
    expect(fmtRatio(3.5)).toBe('3.5× a normal hour');
    expect(fmtRatio(3.1)).toBe('3× a normal hour');
    expect(fmtRatio(7.7)).toBe('8× a normal hour');
    expect(fmtRatio(1.1)).toBe('about a normal hour');
    expect(fmtPct(0.96)).toBe('1.0%');
    expect(fmtSize('NQ', 1, 25000)).toBe('≈ 250 pts');
    expect(fmtSize('GC', 1.1, 4300)).toBe('≈ $47');
    expect(fmtSize('CL', 1.39, 62)).toBe('≈ $0.86');
    expect(fmtSize('NQ', 1, undefined)).toBe('');
    for (const r of [1.1, 2, 3.5, 9]) expect(findBanned(`NQ ~${fmtPct(1)} ${fmtRatio(r)}`)).toBeNull();
  });

  it('maps symbols to an exposure', () => {
    expect(exposureOf('NQ')).toBe('index');
    expect(exposureOf('mgc')).toBe('gold');
    expect(exposureOf('CL')).toBe('oil');
    expect(exposureOf('ES')).toBe('index');
  });
});

describe('noise filter', () => {
  it('splits the source off a Google News title', () => {
    expect(splitSource('Fed holds rates steady, signals patience - Reuters')).toEqual({
      headline: 'Fed holds rates steady, signals patience',
      source: 'Reuters'
    });
    expect(splitSource('Short - X').headline).toBe('Short - X');
  });

  it('spots repeats of one story', () => {
    expect(similarity('Fed holds rates steady', 'Fed holds rates steady again')).toBeGreaterThan(0.6);
    expect(isDuplicate('Fed holds rates steady today', ['Fed holds rates steady'])).toBe(true);
    expect(isDuplicate('Nvidia faces antitrust probe in EU', ['Fed holds rates steady'])).toBe(false);
    const out = dedupeHeadlines(
      [
        { title: 'Fed holds rates steady - Reuters', publishedAt: 2 },
        { title: 'Fed holds rates steady - CNBC', publishedAt: 1 },
        { title: 'Nvidia faces antitrust probe', publishedAt: 3 }
      ],
      []
    );
    expect(out.map((o) => o.publishedAt)).toEqual([1, 3]);
  });

  it('throws out analyst chatter and listicles', () => {
    expect(isJunk('3 stocks to buy now before the Fed meets')).toBe(true);
    expect(isJunk('Analyst raises Nvidia price target to $200')).toBe(true);
    expect(isJunk('Nvidia upgraded to buy at Morgan Stanley')).toBe(true);
    expect(isJunk('Nvidia faces antitrust probe in the EU')).toBe(false);
  });

  it('finds which tracked assets a headline is about', () => {
    const names = (t: string) => matchAssets(t, assets).map((a) => a.symbol);
    expect(names('Nvidia faces antitrust probe in the EU')).toContain('NVDA');
    expect(names('OPEC+ agrees surprise output cut')).toEqual(expect.arrayContaining(['CL', 'OPEC']));
    expect(names('Fed chair Powell says rates on hold')).toContain('FED');
    // "Fed" is only the Fed when capitalised; "fed" the verb is not.
    expect(names('The crowd was fed up with delays')).not.toContain('FED');
    expect(names('Local bakery opens new store')).toEqual([]);
  });

  it('keeps only big, tracked, non-junk headlines, best first', () => {
    const now = Date.now();
    const items = [
      { id: '1', title: 'Local bakery opens new store - Patch', source: '', url: '', publishedAt: now },
      { id: '2', title: 'Nvidia hit with antitrust probe in EU - Reuters', source: '', url: '', publishedAt: now },
      { id: '3', title: 'Analyst raises Nvidia price target - Zacks', source: '', url: '', publishedAt: now },
      { id: '4', title: 'Nvidia unveils new brand colors - Blog', source: '', url: '', publishedAt: now },
      { id: '5', title: 'Fed announces emergency rate cut - Bloomberg', source: '', url: '', publishedAt: now }
    ];
    const picked = pickCandidates(items, assets);
    expect(picked.map((p) => p.id)).toEqual(['5', '2']);
    expect(picked[0].source).toBe('Bloomberg');
    expect(bigHint('Nvidia unveils new brand colors')).toBe(0);
  });
});

describe('reaction measure', () => {
  // 1-minute candles, price flat at 100 until minute 10, then a +1% jump, then a drift.
  const candles: Candle[] = [];
  for (let i = 0; i < 120; i++) {
    const t = i * 60_000;
    const price = i < 10 ? 100 : 101;
    candles.push({ t, o: price, h: price + (i === 10 ? 0.5 : 0.05), l: price - 0.05, c: price, v: 1 });
  }

  it('measures the range and net move after an event', () => {
    const r = measureReaction(candles, 10 * 60_000, 60_000)!;
    // Before the event the last close was 100; after, 101. The jump candle's high is 101.5.
    expect(r.net30).toBeCloseTo(1, 5);
    expect(r.range60).toBeCloseTo(1.5, 5);
  });

  it('refuses when there is no recent price or the window has holes', () => {
    expect(measureReaction(candles, 0, 60_000)).toBeNull();
    expect(measureReaction(candles, 200 * 60_000, 60_000)).toBeNull();
    // Only 35 minutes after the event exist: not enough for a 60-minute window.
    expect(measureReaction(candles.slice(0, 45), 10 * 60_000, 60_000)).toBeNull();
  });

  it('summarises by tier and picks out the worst misses', () => {
    const sample = (tier: 'low' | 'medium' | 'high', range60: number, ratio: number, label = ''): Sample => ({
      family: 'x',
      label: label || `${tier}${range60}`,
      asset: 'NQ',
      tier,
      timeMs: 0,
      reaction: { range30: range60 / 2, range60, net30: range60 / 3, net60: range60 / 2 },
      baseline: range60 / ratio,
      ratio
    });
    const s = summarize([
      sample('low', 0.2, 1),
      sample('low', 0.5, 2.5, 'low spike'),
      sample('medium', 0.5, 1.4),
      sample('high', 1.2, 3),
      sample('high', 0.3, 1.1, 'high quiet')
    ]);
    expect(s.byTier.map((t) => t.n)).toEqual([2, 1, 2]);
    expect(s.byTier[2].quietPct).toBe(50);
    expect(s.byTier[0].spikePct).toBe(50);
    expect(s.highQuiet.map((x) => x.label)).toEqual(['high quiet']);
    expect(s.lowSpike.map((x) => x.label)).toEqual(['low spike']);
    expect(s.ordered).toBe(true);
    expect(QUIET_BELOW).toBeGreaterThan(1);
    expect(median([3, 1, 2])).toBe(2);
  });
});
