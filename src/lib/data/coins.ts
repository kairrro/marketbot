// Every coin a source lists, with its 24h volume, for suggestions as a coin is typed.

import { STOCK_LIST } from './stocks';
import { DataError, type Source } from './types';

export interface CoinInfo {
  coin: string;
  /** 24h volume in $. */
  volume: number;
  /** What the ticker is, for stocks ("Nasdaq 100 futures"). */
  name?: string;
}

interface HlMeta {
  universe: { name: string; isDelisted?: boolean }[];
}

async function hyperliquidCoins(): Promise<CoinInfo[]> {
  const res = await fetch('https://api.hyperliquid.xyz/info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'metaAndAssetCtxs' })
  });
  if (!res.ok) throw new DataError(`Hyperliquid returned ${res.status}`, 'hyperliquid');
  const [meta, ctxs] = (await res.json()) as [HlMeta, { dayNtlVlm: string }[]];
  return meta.universe.flatMap((market, i) =>
    market.isDelisted ? [] : [{ coin: market.name, volume: Number(ctxs[i]?.dayNtlVlm) || 0 }]
  );
}

/** Spot pairs against USDT that traded in the last 24h. */
async function binanceCoins(): Promise<CoinInfo[]> {
  const res = await fetch('https://data-api.binance.vision/api/v3/ticker/24hr?type=MINI');
  if (!res.ok) throw new DataError(`Binance returned ${res.status}`, 'binance');
  const tickers = (await res.json()) as { symbol: string; quoteVolume: string }[];
  return tickers
    .filter((t) => t.symbol.endsWith('USDT') && Number(t.quoteVolume) > 0)
    .map((t) => ({ coin: t.symbol.slice(0, -4), volume: Number(t.quoteVolume) }));
}

export async function fetchCoins(source: Source): Promise<CoinInfo[]> {
  if (source === 'stocks') return STOCK_LIST.map((stock) => ({ ...stock, volume: 0 }));
  return source === 'binance' ? binanceCoins() : hyperliquidCoins();
}

/**
 * Coins matching what has been typed, case-insensitively: those starting with
 * it first, then those containing it (in the ticker or its name), each by 24h
 * volume. Everything by volume when nothing is typed.
 */
export function matchCoins(coins: readonly CoinInfo[], query: string, limit = 12): CoinInfo[] {
  const q = query.trim().toUpperCase();
  const rank = (c: CoinInfo) => {
    const name = c.coin.toUpperCase();
    return name.startsWith(q) ? 0 : name.includes(q) || c.name?.toUpperCase().includes(q) ? 1 : 2;
  };
  return coins
    .map((coin) => ({ coin, rank: rank(coin) }))
    .filter((c) => c.rank < 2)
    .sort((a, b) => a.rank - b.rank || b.coin.volume - a.coin.volume)
    .slice(0, limit)
    .map((c) => c.coin);
}
