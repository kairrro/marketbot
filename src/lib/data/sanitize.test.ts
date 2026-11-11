import { describe, expect, it } from 'vitest';
import { normalizeCoin } from './index';
import { decimalsOf, mergeCandles, precisionOf, sanitize } from './sanitize';

const TF = 300_000;
const c = (t: number, close = 1) => ({ t, o: 1, h: 1, l: 1, c: close, v: 0 });

describe('sanitize', () => {
  it('drops the candle that is still forming', () => {
    const now = 3 * TF + 1000; // 1s into the 4th candle
    const out = sanitize([c(0), c(TF), c(2 * TF), c(3 * TF)], TF, now);
    expect(out.map((x) => x.t)).toEqual([0, TF, 2 * TF]);
  });

  it('keeps a candle that closed exactly now', () => {
    expect(sanitize([c(0)], TF, TF)).toHaveLength(1);
  });

  it('sorts, de-duplicates (last wins) and drops bad rows', () => {
    const out = sanitize([c(2 * TF), c(0), c(TF, 5), c(TF, 7), c(3 * TF, NaN)], TF, 100 * TF);
    expect(out.map((x) => [x.t, x.c])).toEqual([
      [0, 1],
      [TF, 7],
      [2 * TF, 1]
    ]);
  });
});

describe('mergeCandles', () => {
  it('keeps everything from both lists, in time order', () => {
    const saved = [c(0), c(TF), c(2 * TF)];
    const fresh = [c(2 * TF), c(3 * TF), c(4 * TF)];
    expect(mergeCandles(saved, fresh).map((x) => x.t)).toEqual([0, TF, 2 * TF, 3 * TF, 4 * TF]);
  });

  it('never drops saved candles the exchange no longer returns', () => {
    // Hyperliquid's window has slid forward: the old candles only exist in the session.
    const saved = [c(0, 5), c(TF, 6)];
    const fresh = [c(10 * TF, 7), c(11 * TF, 8)];
    expect(mergeCandles(saved, fresh).map((x) => [x.t, x.c])).toEqual([
      [0, 5],
      [TF, 6],
      [10 * TF, 7],
      [11 * TF, 8]
    ]);
  });

  it('prefers the fresh download where both have the candle', () => {
    expect(mergeCandles([c(0, 1), c(TF, 2)], [c(TF, 9)]).map((x) => x.c)).toEqual([1, 9]);
  });

  it('fills a hole in the middle and handles empty lists', () => {
    expect(mergeCandles([c(0), c(3 * TF)], [c(TF), c(2 * TF)]).map((x) => x.t)).toEqual([0, TF, 2 * TF, 3 * TF]);
    expect(mergeCandles([], [c(TF)])).toHaveLength(1);
    expect(mergeCandles([c(TF)], [])).toHaveLength(1);
  });

  it('does not modify its inputs', () => {
    const saved = [c(0)];
    const fresh = [c(TF)];
    mergeCandles(saved, fresh);
    expect(saved).toHaveLength(1);
    expect(fresh).toHaveLength(1);
  });
});

describe('precision', () => {
  it('counts the decimals a price needs', () => {
    // Binance sends "151.23000000"; once parsed, trailing zeros are gone.
    expect(decimalsOf(+'151.23000000')).toBe(2);
    expect(decimalsOf(64000)).toBe(0);
    expect(decimalsOf(0.1 + 0.2)).toBe(8);
    expect(decimalsOf(0.00001234)).toBe(8);
  });

  it('is judged on the given window of candles only', () => {
    const candles = [c(0, 99.123), c(TF, 151.2), c(2 * TF, 151.25), c(3 * TF, 151)];
    expect(precisionOf(candles, 1, 4)).toBe(2);
    expect(precisionOf(candles, 0, 4)).toBe(3);
    // Never reads past `to`, and tolerates a window that starts before the data.
    expect(precisionOf(candles, -50, 2)).toBe(3);
    expect(precisionOf(candles, 3, 4)).toBe(0);
  });
});

describe('normalizeCoin', () => {
  it('upper-cases and trims', () => {
    expect(normalizeCoin(' sol ')).toBe('SOL');
    expect(normalizeCoin('btc-usd')).toBe('BTCUSD');
  });

  it("keeps Hyperliquid's k-prefixed markets", () => {
    expect(normalizeCoin('kPEPE')).toBe('kPEPE');
  });
});
