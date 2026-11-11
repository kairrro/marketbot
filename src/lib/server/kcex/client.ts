// All exchange-specific networking lives here.

import type { Candle } from '$lib/strategy/types';

const CONTRACT_TICKER_URL = 'https://www.kcex.com/fapi/v1/contract/ticker';

interface KcexTicker {
  symbol: string;
  lastPrice?: string | number;
  last?: string | number;
  price?: string | number;
  // `riseFallRate` looks like a 24h change but isn't — it's change since
  // midnight in the "UTC+8" zone named in riseFallRates (a calendar-day
  // change, not a rolling 24h window), confirmed by comparing against
  // KCEX's own site: it showed -1.13% for BTC while riseFallRate read
  // +0.12% at the same moment. riseFallRatesOfTimezone[0] matched the
  // site exactly, so that's the real rolling 24h change.
  riseFallRatesOfTimezone?: number[];
  amount24?: number; // 24h notional volume (quote currency)
  // Open interest in CONTRACTS, not a comparable unit across symbols — each
  // symbol has its own contractSize multiplier (see fetchContractSizes).
  // Confirmed against KCEX's own site: BTC's displayed "Open Interest(USDT)"
  // matched holdVol * contractSize(0.0001) * lastPrice almost exactly.
  holdVol?: number;
  fundingRate?: number;
}

export async function fetchPerpPrices(symbols: string[]): Promise<Map<string, number>> {
  const res = await fetch(CONTRACT_TICKER_URL);
  if (!res.ok) throw new Error(`KCEX ticker request failed: ${res.status}`);

  const json = await res.json() as { data?: KcexTicker[] };
  const wanted = new Set(symbols);
  const prices = new Map<string, number>();

  for (const ticker of json.data ?? []) {
    if (!wanted.has(ticker.symbol)) continue;
    const raw = ticker.lastPrice ?? ticker.last ?? ticker.price;
    const price = Number(raw);
    if (Number.isFinite(price)) prices.set(ticker.symbol, price);
  }

  return prices;
}

export interface TickerSnapshot {
  symbol: string;
  lastPrice: number;
  changePct: number; // 24h change, signed percentage
  volume24: number; // 24h notional volume
  holdVol: number; // raw open interest in contracts — combine with fetchContractSizes to get USD
  fundingRate: number; // signed fraction, e.g. 0.0001 = 0.01%
}

export async function fetchTickerSnapshot(): Promise<TickerSnapshot[]> {
  const res = await fetch(CONTRACT_TICKER_URL);
  if (!res.ok) throw new Error(`KCEX ticker request failed: ${res.status}`);

  const json = await res.json() as { data?: KcexTicker[] };

  return (json.data ?? [])
    .map((t) => ({
      symbol: t.symbol,
      lastPrice: Number(t.lastPrice ?? t.last ?? t.price ?? 0),
      changePct: Number(t.riseFallRatesOfTimezone?.[0] ?? 0) * 100,
      volume24: Number(t.amount24 ?? 0),
      holdVol: Number(t.holdVol ?? 0),
      fundingRate: Number(t.fundingRate ?? 0),
    }))
    .filter((t) => t.symbol && Number.isFinite(t.changePct));
}

const CONTRACT_DETAIL_URL = 'https://www.kcex.com/fapi/v1/contract/detail';

interface KcexContractDetail {
  symbol: string;
  contractSize: number;
}

// Per-symbol multiplier needed to turn holdVol (raw contract count) into a
// real, cross-symbol-comparable open interest in USD. Rarely changes —
// callers should cache this far longer than ticker data.
export async function fetchContractSizes(): Promise<Map<string, number>> {
  const res = await fetch(CONTRACT_DETAIL_URL);
  if (!res.ok) throw new Error(`KCEX contract detail request failed: ${res.status}`);

  const json = await res.json() as { data?: KcexContractDetail[] };
  return new Map((json.data ?? []).map((d) => [d.symbol, Number(d.contractSize)]));
}

const KLINE_URL = 'https://www.kcex.com/fapi/v1/contract/kline';

// KCEX's own interval vocabulary. Only the ones the sweep detector actually
// uses today are mapped — add more as needed, no need to cover every value.
const KLINE_INTERVAL_MAP: Record<string, string> = {
  '1m': 'Min1',
  '5m': 'Min5',
  '15m': 'Min15',
  '30m': 'Min30',
  '1h': 'Min60',
  '4h': 'Hour4',
  '8h': 'Hour8',
  '1d': 'Day1',
};

interface KcexKlineResponse {
  success: boolean;
  data?: {
    time: number[];
    open: number[];
    high: number[];
    low: number[];
    close: number[];
  };
}

// Returns closed AND the currently-forming candle, oldest first — same
// columnar shape KCEX returns, just reassembled into rows. Callers that need
// only closed candles should drop the last element themselves (see
// sweeps/watcher.ts), since "is the last candle closed" is a timing decision
// for the caller to make, not something this function can know.
export async function fetchKlines(symbol: string, timeframe: string, limit?: number): Promise<Candle[]> {
  const interval = KLINE_INTERVAL_MAP[timeframe];
  if (!interval) throw new Error(`Unsupported kline timeframe: ${timeframe}`);

  const res = await fetch(`${KLINE_URL}/${symbol}?interval=${interval}`);
  if (!res.ok) throw new Error(`KCEX kline request failed: ${res.status}`);

  const json = await res.json() as KcexKlineResponse;
  if (!json.success || !json.data) throw new Error(`KCEX kline request returned no data for ${symbol}`);

  const { time, open, high, low, close } = json.data;
  const count = time?.length ?? 0;
  const candles: Candle[] = [];

  for (let i = 0; i < count; i++) {
    const candle = { time: time[i], open: open[i], high: high[i], low: low[i], close: close[i] };
    if (Object.values(candle).every(Number.isFinite)) candles.push(candle);
  }

  return limit ? candles.slice(-limit) : candles;
}
