import { describe, expect, it } from 'vitest';
import { planMetrics } from '$lib/engine/rules';
import { moveStop, openTrade } from '$lib/engine/trade';
import { draftView, openView } from './positionView';

// Entry 100, stop 99, $10 risk -> 10 SOL. Fees 0.1% per side.
const trade = openTrade({ side: 'long', entry: 100, stop: 99, target: 102, riskUsd: 10, feePct: 0.1, time: 0 });
const ctx = { coin: 'SOL', precision: 2, fromLogical: 0 };

describe('open position labels', () => {
  it('shows live R and $ after fees on the entry line', () => {
    // At 101: +$10 gross, $1.00 + $1.01 fees.
    expect(openView(trade, 101, ctx).labels.entry).toBe('Long 100.00 · +0.80R · +$7.99 · 3/3 open');
  });

  it('spells out the stop only while it is dragged', () => {
    expect(openView(trade, 101, ctx).labels.stop).toBe('Stop 99.00');
    expect(openView(trade, 101, { ...ctx, draggingStop: true }).labels.stop).toBe(
      'Stop 99.00 · −1.00% · risk $10.00 · size 10.000 SOL'
    );
  });

  it('says what a stop past entry locks in', () => {
    const trailed = moveStop(trade, 100.5);
    expect(openView(trailed, 101.5, { ...ctx, draggingStop: true }).labels.stop).toBe(
      'Stop 100.50 · +0.50% · locks $5.00 · size 10.000 SOL'
    );
  });

  it('carries the tight-stop warning', () => {
    expect(openView(trade, 101, { ...ctx, stopWarning: 'too tight' }).labels.stopWarning).toBe('too tight');
    expect(openView(trade, 101, ctx).labels.stopWarning).toBeUndefined();
  });
});

describe('draft labels', () => {
  const draft = { side: 'long' as const, entry: 100, stop: 99.7, target: 100.6 };
  const metrics = planMetrics(100, 99.7, 100.6, 5, 0.05);

  it('shows risk, stop % and size on the stop while it is dragged', () => {
    const view = draftView(draft, metrics, { ...ctx, takeProfit: false, draggingStop: true });
    expect(view.labels.stop).toBe('Stop 99.70 · −0.30% · risk $5.00 · size 16.667 SOL');
    expect(view.labels.entry).toContain('risk $5.00 · size 16.667 SOL');
  });
});
