import { describe, expect, it } from 'vitest';
import { describeStock, writeSummary, type Ask } from './ai';
import { DEFAULT_ASSETS } from './defaults';
import type { Feed, FeedItem } from './feed';
import { findBanned } from './guard';
import { buildLookup } from './lookup';
import { earningsReleaseItems, rateEvents } from './rate';
import { buildBoard, buildSummary, gatherFacts, movePhrase, plainSummary, riskLevel, type SummaryInput } from './summary';
import { HOUR, ctAt } from './time';
import type { RawEvent, TrackedAsset } from './types';

const assets: TrackedAsset[] = DEFAULT_ASSETS.map((a, i) => ({
  id: i + 1,
  kind: a.kind,
  symbol: a.symbol,
  name: a.name,
  keywords: [...a.keywords],
  enabled: true,
  builtin: true
}));

const NOW = ctAt('2025-03-12', '06:00');
const row = (title: string, hhmm: string, date = '2025-03-12', importance = 1): RawEvent => ({
  id: title + hhmm,
  title,
  country: 'US',
  timeMs: ctAt(date, hhmm),
  importance,
  period: 'Feb. 2025'
});

const cpi = () => rateEvents([row('Inflation Rate MoM', '07:30')], assets);
const claims = () => rateEvents([row('Initial Jobless Claims', '07:30', '2025-03-12', 0)], assets);
const ppi = () => rateEvents([row('PPI MoM', '07:30')], assets);

const story = (over: Partial<FeedItem> = {}): FeedItem => ({
  id: 's',
  what: 'Reports raised questions about the personal life of the head of Nvidia.',
  headline: 'h',
  source: 'Axios',
  url: 'https://example.com/s',
  publishedAt: NOW - 12 * HOUR,
  moves: [{ symbol: 'NVDA', pct: -4.3, ratio: 1.6, hours: 22 }],
  described: true,
  ...over
});

const feed = (items: FeedItem[]): Feed => ({ generatedAt: NOW, days: 7, model: null, items, notes: [] });

const input = (over: Partial<SummaryInput> = {}): SummaryInput => ({
  assets,
  now: NOW,
  date: '2025-03-12',
  events: cpi(),
  feed: feed([story()]),
  quotes: { NQ: { price: 25000, changePct: -0.8 }, NVDA: { price: 120, changePct: 1.2 } },
  typical: { NQ: 1.6, NVDA: 2.6 },
  stayOut: cpi()[0].noTrade ? [cpi()[0].noTrade!] : [],
  ...over
});

describe('risk level', () => {
  it('is big with a high-impact event ahead', () => {
    expect(riskLevel(cpi(), null, NOW)).toBe('big');
  });

  it('is careful with a medium event, or a story that moved a price a lot', () => {
    expect(riskLevel(ppi(), null, NOW)).toBe('careful');
    expect(riskLevel([], feed([story({ moves: [{ symbol: 'NVDA', pct: -6, ratio: 2.3, hours: 22 }] })]), NOW)).toBe('careful');
  });

  it('is quiet when nothing big is ahead, and an event that is over does not count', () => {
    expect(riskLevel(claims(), null, NOW)).toBe('quiet');
    expect(riskLevel(cpi(), null, ctAt('2025-03-12', '12:00'))).toBe('quiet');
    expect(riskLevel([], feed([story()]), NOW)).toBe('quiet');
  });
});

describe('the board', () => {
  it('shows each market and stock with what is next and what moved it', () => {
    const board = buildBoard(input());
    const nq = board.find((l) => l.symbol === 'NQ')!;
    expect(nq).toMatchObject({ price: 25000, changePct: -0.8, typicalMove: 1.6 });
    expect(nq.next?.title).toBe('CPI · Feb');
    const nvda = board.find((l) => l.symbol === 'NVDA')!;
    expect(nvda.story?.move.pct).toBe(-4.3);
    expect(nvda.next).toBeNull();
    // Topics are not on the board.
    expect(board.find((l) => l.symbol === 'FED')).toBeUndefined();
  });

  it('puts an earnings report next for the stock that reports', () => {
    const events = earningsReleaseItems([{ symbol: 'NVDA', name: 'Nvidia', time: 'post', date: '2025-03-12' }], assets);
    expect(buildBoard(input({ events })).find((l) => l.symbol === 'NVDA')!.next?.title).toMatch(/NVDA earnings/);
  });

  it('ignores a story that is too old or that moved the price only a little', () => {
    const old = story({ publishedAt: NOW - 5 * 24 * HOUR });
    const small = story({ moves: [{ symbol: 'NVDA', pct: -1, ratio: 1.1, hours: 22 }] });
    expect(buildBoard(input({ feed: feed([old]) })).find((l) => l.symbol === 'NVDA')!.story).toBeNull();
    expect(buildBoard(input({ feed: feed([small]) })).find((l) => l.symbol === 'NVDA')!.story).toBeNull();
  });
});

describe('the summary', () => {
  it('has a plain version made from facts, with the swing and the stay-out window and no direction', () => {
    const facts = gatherFacts(input(), 'big', { NQ: 25000, GC: 4000, CL: 70 });
    const plain = plainSummary(facts);
    expect(plain.headline).toMatch(/^Big day: CPI · Feb at 7:30 AM Central\./);
    expect(plain.bullets[0]).toContain('NQ ~1.0% (≈ 260 pts, 3.5× a normal hour)');
    expect(plain.bullets[0]).toContain('Stay out 7:25–8:15 AM');
    expect(plain.bullets.some((b) => b.includes('NVDA −4.3%'))).toBe(true);
    for (const text of [plain.headline, ...plain.bullets]) expect(findBanned(text), text).toBeNull();
  });

  it('says it is quiet when it is', () => {
    const plain = plainSummary(gatherFacts(input({ events: [], feed: null, stayOut: [] }), 'quiet', {}));
    expect(plain.headline).toMatch(/^Quiet/);
    expect(plain.bullets).toEqual(['Nothing to stay out of.']);
  });

  it('uses the AI wording when it is on, and the plain version when it fails or is off', async () => {
    const phrased = await buildSummary({
      input: input(),
      prices: {},
      model: 'test/model',
      phrase: async () => ({ headline: 'Big day: CPI at 7:30.', bullets: ['NQ ~1.0% swing, stay out 7:25–8:15.'] })
    });
    expect(phrased.headline).toBe('Big day: CPI at 7:30.');
    expect(phrased.model).toBe('test/model');
    expect(phrased.level).toBe('big');
    expect(phrased.stayOut).toHaveLength(1);

    const failed = await buildSummary({
      input: input(),
      prices: {},
      phrase: async () => {
        throw new Error('model down');
      }
    });
    expect(failed.model).toBeNull();
    expect(failed.headline).toMatch(/^Big day/);
    expect(failed.notes.join(' ')).toMatch(/model down/);

    const off = await buildSummary({ input: input(), prices: {} });
    expect(off.notes.join(' ')).toMatch(/AI is off/);
  });

  it('writes measured moves signed, as facts', () => {
    expect(movePhrase({ symbol: 'NVDA', pct: -4.27, ratio: 1.6, hours: 22 })).toBe('NVDA −4.3% (1.6× a normal day)');
    expect(movePhrase({ symbol: 'GC', pct: 1.2, ratio: 1.1, hours: 22 })).toBe('GC +1.2% (a normal day)');
  });
});

function fakeModel(replies: unknown[]): { ask: Ask; calls: () => number } {
  let n = 0;
  return { ask: async () => replies[Math.min(n++, replies.length - 1)], calls: () => n };
}

describe('AI wording of the summary and the stock lines', () => {
  it('sends direction words back once and accepts the clean rewrite', async () => {
    const m = fakeModel([
      { headline: 'Big day: CPI at 7:30.', bullets: ['NQ will rally after CPI.'] },
      { headline: 'Big day: CPI at 7:30.', bullets: ['NQ ~1.0% swing expected. Stay out 7:25–8:15.'] }
    ]);
    const out = await writeSummary(m.ask, {});
    expect(m.calls()).toBe(2);
    expect(out.bullets[0]).toMatch(/Stay out/);
  });

  it('refuses wording that stays directional, so the plain version is used', async () => {
    const m = fakeModel([{ headline: 'Bullish day', bullets: ['x'] }, { headline: 'Bearish day', bullets: ['y'] }]);
    await expect(writeSummary(m.ask, {})).rejects.toThrow(/direction/);
    const stock = fakeModel([{ bullets: ['Shares will go down'] }, { bullets: ['Sell the dip'] }]);
    await expect(describeStock(stock.ask, {})).rejects.toThrow(/direction/);
  });

  it('limits length: at most five bullets', async () => {
    const m = fakeModel([{ headline: 'Quiet.', bullets: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }]);
    expect((await writeSummary(m.ask, {})).bullets).toHaveLength(5);
  });
});

describe('the stock finder', () => {
  const lookupFeed = feed([story(), story({ id: 'other', moves: [{ symbol: 'AAPL', pct: 2, ratio: 1.6, hours: 20 }] })]);
  const base = {
    symbol: 'NVDA',
    name: 'Nvidia',
    now: NOW,
    quote: { price: 120, changePct: 1.2 },
    typicalMove: 2.6,
    earnings: { date: '2025-03-18', time: 'post' as const },
    feed: lookupFeed
  };

  it('gives plain lines from price, stories and the next earnings', async () => {
    const out = await buildLookup(base);
    expect(out.stories.map((s) => s.id)).toEqual(['s']);
    expect(out.bullets[0]).toBe('Today +1.2%. A normal day is about 2.6%.');
    expect(out.bullets[1]).toContain('NVDA −4.3%');
    expect(out.bullets[2]).toMatch(/Next earnings: Tue Mar 18 after the close\. NQ ~1\.2% in the hour after a report\./);
    expect(out.earningsSwing?.pct).toBe(1.17);
    for (const b of out.bullets) expect(findBanned(b), b).toBeNull();
  });

  it('says so when no story moved the price', async () => {
    const out = await buildLookup({ ...base, feed: feed([]), earnings: null });
    expect(out.bullets[1]).toBe('No story this week was followed by a clear move.');
    expect(out.bullets).toHaveLength(2);
  });

  it('uses the AI lines, and the plain ones with a note when it fails', async () => {
    const ok = await buildLookup({ ...base, model: 'm', phrase: async () => ['Line one.', 'Line two.'] });
    expect(ok.bullets).toEqual(['Line one.', 'Line two.']);
    expect(ok.model).toBe('m');
    const bad = await buildLookup({
      ...base,
      phrase: async () => {
        throw new Error('nope');
      }
    });
    expect(bad.model).toBeNull();
    expect(bad.notes.join(' ')).toMatch(/nope/);
  });
});
