import { describe, expect, it } from 'vitest';
import { DEFAULT_ASSETS } from './defaults';
import type { Feed, FeedItem } from './feed';
import { moveAlertText } from './format';
import { findBanned } from './guard';
import { findMoveAlerts, moveKey, toRecord, type MoveInput } from './moves';
import { HOUR, ctAt } from './time';
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

const NOW = ctAt('2025-03-12', '10:00');

const story = (over: Partial<FeedItem> = {}): FeedItem => ({
  id: 's',
  what: 'Reports raised questions about the personal life of the head of Nvidia.',
  headline: 'h',
  source: 'Axios',
  url: 'https://example.com/s',
  publishedAt: NOW - 5 * HOUR,
  moves: [{ symbol: 'NVDA', pct: -2, ratio: 1.1, hours: 4 }],
  described: true,
  ...over
});

const feed = (items: FeedItem[]): Feed => ({ generatedAt: NOW, days: 7, model: null, items, notes: [] });

const input = (over: Partial<MoveInput> = {}): MoveInput => ({
  assets,
  now: NOW,
  quotes: { NVDA: { price: 120, changePct: -6.2 }, AAPL: { price: 200, changePct: 0.4 }, NQ: { price: 25000, changePct: -0.3 } },
  typical: { NVDA: 2.6, AAPL: 1.2, NQ: 1.6 },
  feed: feed([story()]),
  minRatio: 2,
  sent: new Set<string>(),
  ...over
});

describe('move alerts', () => {
  it('pings when a stock has a big day and a story went with it', () => {
    const [a] = findMoveAlerts(input());
    expect(a).toMatchObject({ symbol: 'NVDA', key: moveKey('NVDA', NOW) });
    expect(a.pct).toBe(-6.2);
    expect(a.ratio).toBeCloseTo(2.38, 1);
    expect(a.story.id).toBe('s');
  });

  it('does not ping for a big move with no story, or a story with an ordinary move', () => {
    expect(findMoveAlerts(input({ feed: feed([]) }))).toEqual([]);
    expect(findMoveAlerts(input({ feed: null }))).toEqual([]);
    expect(findMoveAlerts(input({ quotes: { NVDA: { price: 120, changePct: -3 } } }))).toEqual([]);
  });

  it('leaves out a story that is too old, and one that is about another symbol', () => {
    expect(findMoveAlerts(input({ feed: feed([story({ publishedAt: NOW - 40 * HOUR })]) }))).toEqual([]);
    expect(findMoveAlerts(input({ feed: feed([story({ moves: [{ symbol: 'AAPL', pct: 2, ratio: 1.5, hours: 4 }] })]) }))).toEqual([]);
  });

  it('pings a symbol once a day', () => {
    expect(findMoveAlerts(input({ sent: new Set([moveKey('NVDA', NOW)]) }))).toEqual([]);
    // The next day it can ping again.
    expect(findMoveAlerts(input({ now: NOW + 24 * HOUR, sent: new Set([moveKey('NVDA', NOW)]), feed: feed([story({ publishedAt: NOW + 20 * HOUR })]) }))).toHaveLength(1);
  });

  it('uses the newest story, and respects the size the user asked for', () => {
    const older = story({ id: 'old', publishedAt: NOW - 20 * HOUR });
    const newer = story({ id: 'new', publishedAt: NOW - 2 * HOUR });
    expect(findMoveAlerts(input({ feed: feed([older, newer]) }))[0].story.id).toBe('new');
    expect(findMoveAlerts(input({ minRatio: 3 }))).toEqual([]);
    expect(findMoveAlerts(input({ minRatio: 1.5, quotes: { NVDA: { price: 120, changePct: 4.4 } } }))).toHaveLength(1);
  });

  it('works for a market with a macro story, and skips paused assets and topics', () => {
    const macro = story({ id: 'm', moves: [{ symbol: 'NQ', pct: -4, ratio: 2.5, hours: 20 }] });
    const alerts = findMoveAlerts(input({ feed: feed([macro]), quotes: { NQ: { price: 25000, changePct: -3.6 } } }));
    expect(alerts.map((a) => a.symbol)).toEqual(['NQ']);
    const paused = assets.map((a) => (a.symbol === 'NVDA' ? { ...a, enabled: false } : a));
    expect(findMoveAlerts(input({ assets: paused }))).toEqual([]);
  });

  it('gives the biggest move first', () => {
    const both = feed([story(), story({ id: 'a', moves: [{ symbol: 'AAPL', pct: 3, ratio: 2.5, hours: 4 }] })]);
    const alerts = findMoveAlerts(input({ feed: both, quotes: { NVDA: { price: 1, changePct: -6.2 }, AAPL: { price: 1, changePct: 4.5 } } }));
    expect(alerts.map((a) => a.symbol)).toEqual(['AAPL', 'NVDA']);
  });
});

describe('the Discord message', () => {
  it('states the measured move and the story, never a call on direction', () => {
    const [a] = findMoveAlerts(input());
    const { title, body } = moveAlertText(toRecord(a, NOW), { NVDA: 120 });
    expect(title).toBe('⚡ NVDA −6.2% today (2.4× a normal day)');
    expect(body).toContain('Reports raised questions');
    expect(body).toContain('Axios');
    expect(findBanned(title)).toBeNull();
    // The footer says "not a prediction"; the rest is what happened.
    expect(findBanned(body.split('_Measured')[0])).toBeNull();
  });
});
