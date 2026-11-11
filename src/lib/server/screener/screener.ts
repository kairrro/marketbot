// Ranks every KCEX perp by how much is actually happening on it, using
// nothing but exchange stats — no AI, no candle history. This is the whole
// "is this coin worth looking at" mechanism for the app.

import { fetchTickerSnapshot, fetchContractSizes } from '../kcex/client';
import { getSymbolFirstSeenMap } from '../db';
import { CONFIG } from '$lib/config';

export type LiquidityTier = 'high' | 'medium' | 'low' | 'very_low';

export interface CoinSignal {
  symbol: string;
  lastPrice: number;
  changePct: number;
  volume24: number;
  openInterestUsd: number;
  fundingRate: number;
  // 0-100, this coin's move/volume/OI ranked against every other coin right
  // now — see computeInterestScores below for exactly how.
  interestScore: number;
  // A risk flag, not a filter — a thin coin can still have a genuinely good
  // chart setup, it just means bad slippage actually executing it.
  liquidityTier: LiquidityTier;
}

export interface ScreenerResult {
  mostInteresting: CoinSignal[]; // ranked by interestScore, either direction
  topGainers: CoinSignal[];
  topLosers: CoinSignal[];
  newListings: CoinSignal[];
}

function liquidityTier(volume24: number): LiquidityTier {
  const { high, medium, low } = CONFIG.screener.liquidityTiers;
  if (volume24 >= high) return 'high';
  if (volume24 >= medium) return 'medium';
  if (volume24 >= low) return 'low';
  return 'very_low';
}

// For each value, what fraction of the whole set it's >= to (0-1). Percentile
// rather than a fixed threshold so the score self-calibrates as overall
// market volatility/volume rises and falls, instead of going stale.
function percentileRanks(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  return values.map((v) => {
    let count = 0;
    for (const s of sorted) if (s <= v) count++;
    return count / values.length;
  });
}

// Weighted blend: mostly "how big was the move," backed up by volume (is it
// real, not on fumes) and open interest (are people actually positioning,
// not just spot noise). Funding rate is deliberately NOT part of this score —
// it's a crowded-positioning flag, a different kind of signal, shown
// separately so it doesn't muddy what this number means.
function computeInterestScores(coins: { changePct: number; volume24: number; openInterestUsd: number }[]): number[] {
  const movePct = percentileRanks(coins.map((c) => Math.abs(c.changePct)));
  const volPct = percentileRanks(coins.map((c) => c.volume24));
  const oiPct = percentileRanks(coins.map((c) => c.openInterestUsd));

  return coins.map((_, i) => Math.round(100 * (0.5 * movePct[i] + 0.3 * volPct[i] + 0.2 * oiPct[i])));
}

// In-memory only — cheap to recompute, doesn't need to survive a restart.
let cachedTickers: { result: ScreenerResult; fetchedAt: number } | null = null;

// Contract sizes rarely change — cache far longer than ticker data instead
// of re-fetching all ~800 symbols' details every time the screener refreshes.
let cachedContractSizes: { map: Map<string, number>; fetchedAt: number } | null = null;
const CONTRACT_SIZE_TTL_MS = 60 * 60_000;

async function getContractSizes(): Promise<Map<string, number>> {
  if (cachedContractSizes && Date.now() - cachedContractSizes.fetchedAt < CONTRACT_SIZE_TTL_MS) {
    return cachedContractSizes.map;
  }
  const map = await fetchContractSizes();
  cachedContractSizes = { map, fetchedAt: Date.now() };
  return map;
}

export async function getInterestingCoins(): Promise<ScreenerResult> {
  if (cachedTickers && Date.now() - cachedTickers.fetchedAt < CONFIG.screener.cacheTtlMs) {
    return cachedTickers.result;
  }

  const { topCount, newListingWindowMs } = CONFIG.screener;

  const [tickers, contractSizes] = await Promise.all([fetchTickerSnapshot(), getContractSizes()]);
  const firstSeen = getSymbolFirstSeenMap();
  const cutoff = Date.now() - newListingWindowMs;

  // Zero volume means nothing traded — not a liquidity tier, just dead data.
  const withOi = tickers
    .filter((t) => t.volume24 > 0)
    .map((t) => ({
      ...t,
      openInterestUsd: t.holdVol * (contractSizes.get(t.symbol) ?? 0) * t.lastPrice,
    }));

  const scores = computeInterestScores(withOi);
  const tradable: CoinSignal[] = withOi.map((t, i) => ({
    ...t,
    interestScore: scores[i],
    liquidityTier: liquidityTier(t.volume24),
  }));

  const byChange = [...tradable].sort((a, b) => b.changePct - a.changePct);
  const byInterest = [...tradable].sort((a, b) => b.interestScore - a.interestScore);

  const newListings = tradable
    .filter((t) => (firstSeen.get(t.symbol) ?? 0) >= cutoff)
    .sort((a, b) => (firstSeen.get(b.symbol) ?? 0) - (firstSeen.get(a.symbol) ?? 0));

  const result: ScreenerResult = {
    mostInteresting: byInterest.slice(0, topCount),
    topGainers: byChange.slice(0, topCount),
    topLosers: byChange.slice(-topCount).reverse(),
    newListings,
  };

  cachedTickers = { result, fetchedAt: Date.now() };
  return result;
}
