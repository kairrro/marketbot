import { describe, expect, it } from 'vitest';
import type { Candle } from '$lib/engine/types';
import { describeHeadlines, type Ask } from './ai';
import { DEFAULT_ASSETS } from './defaults';
import { buildFeed, reaction, symbolsFor, type Bars } from './feed';
import { findBanned } from './guard';
import { pickCandidates, type RawHeadline } from './noise';
import { ctAt, HOUR } from './time';
import type { TrackedAsset } from './types';

const assets: TrackedAsset[] = DEFAULT_ASSETS.map((a, i) => ({
  id: i + 1,
  kind: a.kind,
  symbol: a.symbol,
  name: a.name,
  keywords: [...a.keywords],
  enabled: true,
  builtin: true
}));

const NOW = ctAt('2025-03-14', '20:00');
const T0 = ctAt('2025-03-10', '08:00');

/** Hourly candles from T0 to NOW, priced by `price(t)`. */
function bars(symbol: string, price: (t: number) => number, typicalMove = 2): Bars {
  const hourly: Candle[] = [];
  for (let t = T0; t + HOUR <= NOW; t += HOUR) {
    const p = price(t + HOUR);
    hourly.push({ t, o: p, h: p, l: p, c: p, v: 1 });
  }
  return { symbol, hourly, typicalMove };
}

const head = (id: string, title: string, at: number): RawHeadline => ({ id, title, source: '', url: `https://example.com/${id}`, publishedAt: at });

describe('price reaction', () => {
  const story = ctAt('2025-03-12', '16:30');
  // Flat at 100 until the story, then 4% lower a few hours later and onwards.
  const dropAfter = bars('NVDA', (t) => (t <= story + 2 * HOUR ? 100 : 96));

  it('measures the move from the last price before the story to about a day later', () => {
    const m = reaction(dropAfter, story, NOW)!;
    expect(m.symbol).toBe('NVDA');
    expect(m.pct).toBeCloseTo(-4, 5);
    expect(m.ratio).toBeCloseTo(2, 5);
    expect(m.hours).toBeGreaterThan(20);
    expect(m.hours).toBeLessThanOrEqual(24);
  });

  it('is signed, and only measures what happened', () => {
    const up = bars('GC', (t) => (t <= story ? 100 : 103), 1);
    expect(reaction(up, story, NOW)!.pct).toBeCloseTo(3, 5);
    expect(reaction(up, story, NOW)!.ratio).toBeCloseTo(3, 5);
  });

  it('gives nothing when there is no price before the story or it is under an hour old', () => {
    expect(reaction(dropAfter, T0 - 5 * HOUR, NOW)).toBeNull();
    expect(reaction(dropAfter, NOW - 30 * 60_000, NOW)).toBeNull();
    expect(reaction({ symbol: 'X', hourly: [], typicalMove: 1 }, story, NOW)).toBeNull();
  });

  it('does not use prices from after now', () => {
    const early = ctAt('2025-03-14', '14:00');
    const m = reaction(bars('NVDA', (t) => (t <= early ? 100 : 90)), early, early + 3 * HOUR)!;
    // Only 3 hours had passed: the read is at most that far on.
    expect(m.hours).toBeLessThanOrEqual(3);
  });
});

describe('which symbols a story could move', () => {
  it('uses the stocks and markets named, or every market for a macro story', () => {
    const [nvda] = pickCandidates([head('a', 'Nvidia CEO Jensen Huang faces scandal over affair', NOW - HOUR)], assets);
    expect(symbolsFor(nvda, assets)).toEqual(['NVDA']);
    const [macro] = pickCandidates([head('b', 'Trump announces new tariffs on imports', NOW - HOUR)], assets);
    expect(symbolsFor(macro, assets)).toEqual(['NQ', 'GC', 'CL']);
  });

  it('treats a personal scandal as a big story', () => {
    expect(pickCandidates([head('a', 'Nvidia CEO Jensen Huang accused of affair, report says', NOW - HOUR)], assets)).toHaveLength(1);
  });
});

describe('the feed', () => {
  const story = ctAt('2025-03-12', '16:30');
  const items = [
    head('jensen', 'Nvidia CEO Jensen Huang faces scandal over affair - Reuters', story),
    head('quiet', 'Apple faces antitrust probe in the EU - Bloomberg', story + 60_000),
    head('nvda2', 'Nvidia hit with lawsuit over chips - CNBC', story + 2 * 60_000),
    head('nvda3', 'Nvidia investigation widens, regulators say - Reuters', story + 3 * 60_000),
    head('nvda4', 'Nvidia fraud claims surface, sources say - Reuters', story + 4 * 60_000)
  ];
  const priced = async () => ({
    NVDA: bars('NVDA', (t) => (t <= story + 2 * HOUR ? 100 : 96)),
    AAPL: bars('AAPL', () => 100)
  });
  const base = {
    assets,
    now: NOW,
    days: 7,
    headlines: async () => ({ items, failed: [] as string[] }),
    bars: priced
  };

  it('keeps stories that were followed by a real move and leaves out the ones that were not', async () => {
    const feed = await buildFeed(base);
    const ids = feed.items.map((i) => i.id);
    expect(ids).not.toContain('quiet');
    expect(ids).toContain('jensen');
    const jensen = feed.items.find((i) => i.id === 'jensen')!;
    expect(jensen.moves[0]).toMatchObject({ symbol: 'NVDA' });
    expect(jensen.moves[0].pct).toBeCloseTo(-4, 5);
    expect(feed.notes.join(' ')).toMatch(/AI is off/);
    expect(jensen.what).toContain('Jensen Huang');
    expect(jensen.described).toBe(false);
  });

  it('asks a macro story for a much bigger move before pinning it on a market', async () => {
    const macro = [head('tariff', 'Trump announces new tariffs on imports - Reuters', story)];
    const move = (pct: number) => async () => ({
      NQ: bars('NQ', (t) => (t <= story + HOUR ? 100 : 100 + pct), 2),
      GC: bars('GC', () => 100, 2),
      CL: bars('CL', () => 100, 2)
    });
    // 3% on a 2% normal day is 1.5x: enough for a named stock, not for a macro story.
    expect((await buildFeed({ ...base, headlines: async () => ({ items: macro, failed: [] }), bars: move(3) })).items).toEqual([]);
    const big = await buildFeed({ ...base, headlines: async () => ({ items: macro, failed: [] }), bars: move(5) });
    expect(big.items).toHaveLength(1);
    expect(big.items[0].moves.map((m) => m.symbol)).toEqual(['NQ']);
  });

  it('keeps at most two stories for one stock on one day', async () => {
    const feed = await buildFeed(base);
    expect(feed.items.filter((i) => i.moves[0].symbol === 'NVDA')).toHaveLength(2);
  });

  it('uses the AI sentence, and drops what the AI leaves out', async () => {
    const feed = await buildFeed({
      ...base,
      model: 'test/model',
      describe: async (cs) => new Map([[cs[0].id, 'Reports raised questions about the personal life of the head of Nvidia.']])
    });
    expect(feed.items).toHaveLength(1);
    expect(feed.items[0].what).toMatch(/personal life/);
    expect(feed.items[0].described).toBe(true);
    expect(feed.model).toBe('test/model');
  });

  it('falls back to the headlines when the AI fails, and says so', async () => {
    const feed = await buildFeed({
      ...base,
      describe: async () => {
        throw new Error('model down');
      }
    });
    expect(feed.items.length).toBeGreaterThan(0);
    expect(feed.items[0].described).toBe(false);
    expect(feed.notes.join(' ')).toMatch(/model down/);
  });

  it('never lists a story from after the time it is built for', async () => {
    const feed = await buildFeed({ ...base, now: story - HOUR });
    expect(feed.items).toEqual([]);
  });

  it('says which prices were missing', async () => {
    const feed = await buildFeed({ ...base, bars: async () => ({}) });
    expect(feed.items).toEqual([]);
    expect(feed.notes.join(' ')).toMatch(/No prices for/);
  });
});

describe('describing stories', () => {
  const cands = () => pickCandidates([head('a', 'Nvidia CEO Jensen Huang faces scandal over affair - Reuters', NOW - HOUR)], assets);
  const model = (replies: unknown[]): { ask: Ask; calls: number } => {
    const state = { calls: 0 };
    return {
      get calls() {
        return state.calls;
      },
      ask: async () => replies[Math.min(state.calls++, replies.length - 1)]
    };
  };

  it('returns the clean sentence', async () => {
    const m = model([{ items: [{ i: 0, relevant: true, what: 'Nvidia CEO Jensen Huang is the subject of reports about his personal life.' }] }]);
    const out = await describeHeadlines(m.ask, cands(), NOW);
    expect(out.get(cands()[0].id)).toMatch(/Jensen Huang/);
  });

  it('sends direction wording back once and never lets it out', async () => {
    const bad = model([{ items: [{ i: 0, relevant: true, what: 'Nvidia stock plunges on scandal' }] }, { items: [{ i: 0, relevant: true, what: 'Nvidia shares will go down' }] }]);
    const out = await describeHeadlines(bad.ask, cands(), NOW);
    expect(bad.calls).toBe(2);
    expect(findBanned(out.get(cands()[0].id)!)).toBeNull();
  });

  it('leaves out stories the AI says are not news', async () => {
    const m = model([{ items: [{ i: 0, relevant: false, what: 'x' }] }]);
    expect((await describeHeadlines(m.ask, cands(), NOW)).size).toBe(0);
  });
});
