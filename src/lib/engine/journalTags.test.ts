import { describe, expect, it } from 'vitest';
import { exitReasonFromFills, exitReasonOf, normalizeSetupType, type ExitFill } from './journal';
import { heldOutcome } from './whatIf';
import type { Candle } from './types';

const fill = (kind: ExitFill['kind']): ExitFill => ({ kind, price: 100, pieces: 1, time: 1000 });

describe('exitReasonFromFills', () => {
  it('names the take profit "Target"', () => {
    expect(exitReasonFromFills([fill('TP')])).toBe('Target');
  });

  it('names a stop, and a stop at breakeven, "Stopped"', () => {
    expect(exitReasonFromFills([fill('Stop')])).toBe('Stopped');
    expect(exitReasonFromFills([fill('BE')])).toBe('Stopped');
  });

  it('names closing by hand "Cut early"', () => {
    expect(exitReasonFromFills([fill('Manual')])).toBe('Cut early');
    expect(exitReasonFromFills([fill('Partial'), fill('Manual')])).toBe('Cut early');
  });

  it('names a hand close after the target was touched "Target"', () => {
    expect(exitReasonFromFills([fill('Manual')], true)).toBe('Target');
  });

  it('goes by the fill that closed the trade', () => {
    expect(exitReasonFromFills([fill('Partial'), fill('Stop')])).toBe('Stopped');
  });

  it('is null with no fills', () => {
    expect(exitReasonFromFills([])).toBeNull();
  });

  it('falls back to the fills for trades saved before the reason existed', () => {
    expect(exitReasonOf({ exits: [fill('Stop')] })).toBe('Stopped');
    expect(exitReasonOf({ exits: [fill('Stop')], exitReason: 'Cut early' })).toBe('Cut early');
  });
});

describe('normalizeSetupType', () => {
  it('keeps trend and range, drops anything else', () => {
    expect(normalizeSetupType('trend')).toBe('trend');
    expect(normalizeSetupType('range')).toBe('range');
    expect(normalizeSetupType('bounce')).toBeNull();
    expect(normalizeSetupType(undefined)).toBeNull();
  });
});

describe('heldOutcome', () => {
  const candle = (t: number, l: number, h: number): Candle => ({ t, o: l, h, l, c: h, v: 1 });
  const long = { side: 'long' as const, stop: 95, target: 110, exitTime: 1000 };

  it('reports the target when price gets there first', () => {
    expect(heldOutcome(long, [candle(1000, 99, 105), candle(2000, 104, 111)])).toBe('target');
  });

  it('reports the stop when price gets there first', () => {
    expect(heldOutcome(long, [candle(1000, 99, 105), candle(2000, 94, 108)])).toBe('stop');
  });

  it('gives the stop the candle that touches both', () => {
    expect(heldOutcome(long, [candle(1000, 94, 111)])).toBe('stop');
  });

  it('ignores candles from before the exit', () => {
    expect(heldOutcome(long, [candle(0, 90, 120), candle(1000, 99, 105)])).toBe('unknown');
  });

  it('works for shorts', () => {
    const short = { side: 'short' as const, stop: 105, target: 90, exitTime: 1000 };
    expect(heldOutcome(short, [candle(1000, 92, 100), candle(2000, 89, 98)])).toBe('target');
    expect(heldOutcome(short, [candle(1000, 92, 106)])).toBe('stop');
  });

  it('is unknown with no candles after the exit', () => {
    expect(heldOutcome(long, [])).toBe('unknown');
  });
});
