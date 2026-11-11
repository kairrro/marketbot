import { describe, expect, it } from 'vitest';
import { DEFAULT_ASSETS, DEFAULT_SETTINGS } from './defaults';
import { rateHeadlines, writeMood, type Ask } from './ai';
import { pollForAlerts, type AlertDeps } from './alerts';
import { buildMorningBrief, buildWeeklyBrief, type BriefDeps } from './brief';
import { briefText } from './format';
import { findBanned } from './guard';
import { pickCandidates, type RawHeadline } from './noise';
import { ctAt } from './time';
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

const NOW = ctAt('2025-03-12', '08:00');
const head = (id: string, title: string, minutesAgo = 5): RawHeadline => ({
  id,
  title,
  source: '',
  url: `https://example.com/${id}`,
  publishedAt: NOW - minutesAgo * 60_000
});

/** A fake model: answers in order from `replies`, and remembers what it was asked. */
function fakeModel(replies: unknown[]): { ask: Ask; calls: { system: string; user: string }[] } {
  const calls: { system: string; user: string }[] = [];
  let n = 0;
  return {
    calls,
    ask: async (args) => {
      calls.push(args);
      return replies[Math.min(n++, replies.length - 1)];
    }
  };
}

const rating = (extra: object = {}) => ({
  i: 0,
  relevant: true,
  what: 'Regulators opened a probe into the company.',
  assets: ['NVDA', 'NQ'],
  impact: 'high',
  volatility: 'elevated',
  pause_minutes: 15,
  ...extra
});

describe('headline rating', () => {
  const candidates = () => pickCandidates([head('a', 'Nvidia hit with antitrust probe in EU - Reuters')], assets);

  it('turns a rating into an item with a source, assets, impact and pause', async () => {
    const { ask } = fakeModel([{ items: [rating()] }]);
    const [item] = await rateHeadlines(ask, candidates(), assets, NOW);
    expect(item).toMatchObject({
      what: 'Regulators opened a probe into the company.',
      assets: ['NVDA', 'NQ'],
      impact: 'high',
      volatility: 'elevated',
      pauseMinutes: 15,
      source: 'Reuters'
    });
  });

  it('sends wording with direction back once, and uses the clean rewrite', async () => {
    const { ask, calls } = fakeModel([
      { items: [rating({ what: 'Nvidia stock will go down on the probe' })] },
      { items: [rating({ what: 'Regulators opened a probe into Nvidia.' })] }
    ]);
    const [item] = await rateHeadlines(ask, candidates(), assets, NOW);
    expect(calls).toHaveLength(2);
    expect(calls[1].user).toContain('not allowed');
    expect(item.what).toBe('Regulators opened a probe into Nvidia.');
  });

  it('replaces wording that still has direction after the retry, so none ever gets out', async () => {
    const { ask } = fakeModel([{ items: [rating({ what: 'Bullish for chips' })] }, { items: [rating({ what: 'Bearish outlook' })] }]);
    const [item] = await rateHeadlines(ask, candidates(), assets, NOW);
    expect(findBanned(item.what)).toBeNull();
    expect(item.what).toContain('Major headline');
  });

  it('drops what the model says is not relevant, and tidies inconsistent ratings', async () => {
    const { ask } = fakeModel([{ items: [rating({ relevant: false })] }]);
    expect(await rateHeadlines(ask, candidates(), assets, NOW)).toEqual([]);

    const { ask: ask2 } = fakeModel([{ items: [rating({ impact: 'low', volatility: 'extreme', pause_minutes: 30, assets: ['ZZZ'] })] }]);
    const [low] = await rateHeadlines(ask2, candidates(), assets, NOW);
    expect(low.volatility).toBe('normal');
    expect(low.pauseMinutes).toBe(0);
    // Unknown assets are ignored; the ones the headline matched are used instead.
    expect(low.assets).toEqual(['NVDA']);

    const { ask: askMed } = fakeModel([{ items: [rating({ impact: 'medium', volatility: 'normal', pause_minutes: 5 })] }]);
    const [medium] = await rateHeadlines(askMed, candidates(), assets, NOW);
    expect(medium.volatility).toBe('elevated');

    const { ask: ask3 } = fakeModel([{ items: [rating({ pause_minutes: 0, volatility: 'normal' })] }]);
    const [high] = await rateHeadlines(ask3, candidates(), assets, NOW);
    expect(high.pauseMinutes).toBeGreaterThanOrEqual(10);
    expect(high.volatility).toBe('elevated');
  });

  it('adds the swing to expect for the markets a headline touches, and none for Low', async () => {
    const { ask } = fakeModel([{ items: [rating({ assets: ['NVDA'] })] }]);
    const [high] = await rateHeadlines(ask, candidates(), assets, NOW);
    // Only about a stock: measured on NQ.
    expect(Object.keys(high.swing ?? {})).toEqual(['NQ']);
    expect(high.swing?.NQ.pct).toBeGreaterThan(0.5);

    const { ask: askLow } = fakeModel([{ items: [rating({ impact: 'low', volatility: 'normal', pause_minutes: 0 })] }]);
    const [low] = await rateHeadlines(askLow, candidates(), assets, NOW);
    expect(low.swing).toEqual({});
  });

  it('keeps the system prompt free of any ask for direction', async () => {
    const { ask, calls } = fakeModel([{ items: [] }]);
    await rateHeadlines(ask, candidates(), assets, NOW);
    expect(calls[0].system).toMatch(/never say which way/i);
  });
});

describe('mood', () => {
  it('uses the state and clean lines', async () => {
    const { ask } = fakeModel([{ state: 'risk-off', lines: ['Tariff headlines overnight.', 'Oil headlines are active.'] }]);
    const mood = await writeMood(ask, { events: [], overnight: [], moves: [{ symbol: 'NQ', changePct: -0.8 }] });
    expect(mood).toEqual({ state: 'risk-off', lines: ['Tariff headlines overnight.', 'Oil headlines are active.'] });
  });

  it('drops lines with direction and falls back to the facts', async () => {
    const { ask } = fakeModel([{ state: 'risk-on', lines: ['Nasdaq will rally today.'] }, { state: 'risk-on', lines: ['Markets are bullish.'] }]);
    const mood = await writeMood(ask, { events: [], overnight: [], moves: [] });
    expect(mood.lines.every((l) => findBanned(l) === null)).toBe(true);
    expect(mood.lines[0]).toMatch(/no major/i);
  });
});

describe('morning brief', () => {
  const cpi = (): RawEvent[] =>
    ['Core Inflation Rate MoM', 'Inflation Rate MoM'].map((title) => ({
      id: title,
      title,
      country: 'US',
      timeMs: ctAt('2025-03-12', '07:30'),
      importance: 1,
      period: 'Feb. 2025',
      forecast: '0.3',
      previous: '0.4'
    }));

  const deps = (over: Partial<BriefDeps> = {}): BriefDeps => ({
    assets,
    calendar: async () => cpi(),
    earnings: async (date) => (date === '2025-03-11' ? [{ symbol: 'NVDA', name: 'Nvidia', time: 'post', date }] : []),
    ...over
  });

  it('lists today\'s events with times and the no-trade window, with no AI at all', async () => {
    const brief = await buildMorningBrief('2025-03-12', NOW, deps({ headlines: async () => ({ items: [], failed: [] }) }));
    expect(brief.events.map((e) => e.title)).toEqual(['CPI · Feb', 'NVDA reported last night']);
    expect(brief.noTrade).toEqual([
      { startMs: ctAt('2025-03-12', '07:25'), endMs: ctAt('2025-03-12', '08:15') },
      { startMs: ctAt('2025-03-12', '08:27'), endMs: ctAt('2025-03-12', '08:40') }
    ]);
    expect(brief.model).toBeNull();
    expect(brief.notes.join(' ')).toMatch(/AI is off/);
    expect(brief.mood?.lines[0]).toMatch(/high-impact/);
    expect(brief.incomplete).toBe(false);
  });

  it('writes the Discord message with the swing and the stay-out window, free of direction words', async () => {
    const brief = await buildMorningBrief('2025-03-12', NOW, deps({ headlines: async () => ({ items: [], failed: [] }) }));
    brief.prices = { NQ: 25000, GC: 4000, CL: 70 };
    const { title, body } = briefText(brief);
    expect(title).toContain('Morning brief');
    expect(body).toContain('Stay out 7:25–8:15 AM CT');
    expect(body).toContain('NQ ~1.0% (≈ 260 pts, 3.5× a normal hour)');
    // The footer says "not a direction" on purpose; everything above it must be clean.
    expect(findBanned(body.split('_Info only')[0])).toBeNull();
  });

  it('adds rated overnight news and a mood when the model is on', async () => {
    const { ask } = fakeModel([
      { items: [rating()] },
      { state: 'mixed', lines: ['CPI at 7:30.', 'Nvidia reported last night.'] }
    ]);
    const brief = await buildMorningBrief(
      '2025-03-12',
      NOW,
      deps({
        ask,
        model: 'test/model',
        headlines: async () => ({ items: [head('a', 'Nvidia hit with antitrust probe in EU - Reuters', 300)], failed: [] })
      })
    );
    expect(brief.overnight).toHaveLength(1);
    expect(brief.overnight[0].assets).toContain('NVDA');
    expect(brief.mood).toEqual({ state: 'mixed', lines: ['CPI at 7:30.', 'Nvidia reported last night.'] });
    expect(brief.model).toBe('test/model');
  });

  it('never uses a headline from after the time it is written for', async () => {
    const { ask, calls } = fakeModel([{ items: [] }, { state: 'quiet', lines: ['Quiet.'] }]);
    await buildMorningBrief(
      '2025-03-12',
      NOW,
      deps({
        ask,
        headlines: async () => ({ items: [head('later', 'Fed announces emergency rate cut - Bloomberg', -30)], failed: [] })
      })
    );
    expect(JSON.stringify(calls)).not.toContain('emergency');
  });

  it('says so, and marks the brief incomplete, when the calendar is down', async () => {
    const brief = await buildMorningBrief(
      '2025-03-12',
      NOW,
      deps({
        calendar: async () => {
          throw new Error('feed down');
        }
      })
    );
    expect(brief.incomplete).toBe(true);
    expect(brief.notes.join(' ')).toMatch(/calendar could not be read/);
  });

  it('builds the weekly preview from medium and high events only', async () => {
    const week: RawEvent[] = [
      ...cpi(),
      { id: 'c', title: 'Initial Jobless Claims', country: 'US', timeMs: ctAt('2025-03-13', '07:30'), importance: 0 }
    ];
    const brief = await buildWeeklyBrief('2025-03-10', NOW, deps({ calendar: async () => week, earnings: async () => [] }));
    expect(brief.kind).toBe('weekly');
    expect(brief.events.map((e) => e.family)).toEqual(['cpi']);
  });
});

describe('live alerts', () => {
  function alertDeps(over: Partial<AlertDeps> & { items?: RawHeadline[]; replies?: unknown[] } = {}) {
    const seen = new Set<string>();
    const titles: string[] = [];
    const model = fakeModel(over.replies ?? [{ items: [rating()] }]);
    const d: AlertDeps = {
      assets,
      settings: DEFAULT_SETTINGS,
      now: NOW,
      ask: model.ask,
      headlines: async () => ({ items: over.items ?? [], failed: [] }),
      seen: (ids) => new Set(ids.filter((i) => seen.has(i))),
      markSeen: (list) => list.forEach((i) => (seen.add(i.key), titles.push(i.title))),
      recentTitles: () => titles,
      alertsInLastHour: () => 0,
      ...over
    };
    return { d, model, seen };
  }

  it('alerts on a big, fresh headline about a tracked asset', async () => {
    const { d } = alertDeps({ items: [head('a', 'Nvidia hit with antitrust probe in EU - Reuters')] });
    const out = await pollForAlerts(d);
    expect(out.alerts).toHaveLength(1);
    expect(out.alerts[0].pauseMinutes).toBe(15);
  });

  it('does not alert twice on the same headline, or on the same story from another outlet', async () => {
    const { d, model } = alertDeps({
      items: [head('a', 'Nvidia hit with antitrust probe in EU - Reuters'), head('b', 'Nvidia hit with antitrust probe in EU - CNBC')]
    });
    const first = await pollForAlerts(d);
    expect(first.alerts).toHaveLength(1);
    const again = await pollForAlerts(d);
    expect(again.alerts).toHaveLength(0);
    expect(model.calls).toHaveLength(1);
  });

  it('keeps noise away from the AI: junk, untracked and unremarkable headlines', async () => {
    const { d, model } = alertDeps({
      items: [
        head('a', '3 stocks to buy before Nvidia earnings - Motley Fool'),
        head('b', 'Local bakery opens new store - Patch'),
        head('c', 'Nvidia unveils new brand colors - Blog')
      ]
    });
    const out = await pollForAlerts(d);
    expect(out.candidates).toBe(0);
    expect(model.calls).toHaveLength(0);
  });

  it('skips anything older than the fresh window', async () => {
    const { d } = alertDeps({ items: [head('old', 'Nvidia hit with antitrust probe in EU - Reuters', 120)] });
    expect((await pollForAlerts(d)).fresh).toBe(0);
  });

  it('only lets through what is rated high enough, within the hourly limit', async () => {
    const replies = [{ items: [rating({ impact: 'medium', pause_minutes: 5 })] }];
    const { d } = alertDeps({ items: [head('a', 'Nvidia hit with antitrust probe in EU - Reuters')], replies });
    expect((await pollForAlerts(d)).alerts).toHaveLength(0);

    const { d: capped } = alertDeps({
      items: [head('a', 'Nvidia hit with antitrust probe in EU - Reuters')],
      alertsInLastHour: () => 3
    });
    const out = await pollForAlerts(capped);
    expect(out.alerts).toHaveLength(0);
    expect(out.heldBack).toBe(1);
  });

  it('tries a candidate again next time when the model failed', async () => {
    const { d, seen } = alertDeps({
      items: [head('a', 'Nvidia hit with antitrust probe in EU - Reuters')],
      ask: async () => {
        throw new Error('model down');
      }
    });
    await expect(pollForAlerts(d)).rejects.toThrow('model down');
    expect(seen.has('a')).toBe(false);
  });
});
