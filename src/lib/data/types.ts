import type { Timeframe } from '$lib/engine/types';

export type Source = 'hyperliquid' | 'binance' | 'stocks';

export const SOURCES: readonly { id: Source; label: string; hint: string }[] = [
  { id: 'hyperliquid', label: 'Hyperliquid', hint: 'last 5000 candles' },
  { id: 'binance', label: 'Binance spot', hint: 'longer history' },
  {
    id: 'stocks',
    label: 'Stocks',
    hint: 'US stocks, indices and futures from Yahoo (1m for 30 days, 5m–30m for 60 days, 1h for 2 years, 1D for all); stocks and ETFs back to 2016 from Alpaca once its keys are in .env; NQ, ES and other CME futures back to 2010 from Databento once its key is in .env'
  }
];

export const SOURCE_LABEL: Record<Source, string> = {
  hyperliquid: 'Hyperliquid',
  binance: 'Binance spot',
  stocks: 'Stocks'
};

/** Stock markets close at night and on weekends, so their candles have gaps that crypto's do not. */
export const marketCloses = (source: Source) => source === 'stocks';

export const COIN_SUGGESTIONS = ['BTC', 'ETH', 'SOL', 'HYPE', 'NEAR', 'ZEC'] as const;

export interface CandleRequest {
  source: Source;
  coin: string;
  tf: Timeframe;
  /** Time the replay should be positioned at, if any (start date or current cursor). */
  anchor: number | null;
}

export class DataError extends Error {
  source: Source;

  constructor(message: string, source: Source) {
    super(message);
    this.name = 'DataError';
    this.source = source;
  }
}

/** The crypto source to try when one fails. Stocks have no second source. */
export function otherSource(source: Source): Source | null {
  if (source === 'stocks') return null;
  return source === 'hyperliquid' ? 'binance' : 'hyperliquid';
}
