import { describe, expect, it } from 'vitest';
import { matchCoins, type CoinInfo } from './coins';

const coins: CoinInfo[] = [
  { coin: 'SOL', volume: 900 },
  { coin: 'BTC', volume: 5000 },
  { coin: 'SOLV', volume: 50 },
  { coin: 'kPEPE', volume: 300 },
  { coin: 'PEPE', volume: 400 },
  { coin: 'ASOL', volume: 2000 }
];
const names = (list: CoinInfo[]) => list.map((c) => c.coin);

describe('matchCoins', () => {
  it('puts coins that start with the text first, then ones that contain it, each by volume', () => {
    expect(names(matchCoins(coins, 'sol'))).toEqual(['SOL', 'SOLV', 'ASOL']);
  });

  it('ignores case, so case-sensitive tickers are still found', () => {
    expect(names(matchCoins(coins, 'kpe'))).toEqual(['kPEPE']);
    expect(names(matchCoins(coins, 'PEPE'))).toEqual(['PEPE', 'kPEPE']);
  });

  it('lists the busiest coins when nothing is typed', () => {
    expect(names(matchCoins(coins, '  ', 3))).toEqual(['BTC', 'ASOL', 'SOL']);
  });

  it('finds nothing for text no coin contains', () => {
    expect(matchCoins(coins, 'xyz')).toEqual([]);
  });
});
