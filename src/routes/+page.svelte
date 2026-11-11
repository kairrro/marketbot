<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from '$lib/components/ui/Icon.svelte';
  import Segmented from '$lib/components/ui/Segmented.svelte';
  import type { CoinSignal, ScreenerResult } from '$lib/server/screener/screener';

  type Tab = 'interesting' | 'gainers' | 'losers' | 'new';

  let screener = $state<ScreenerResult | null>(null);
  let error = $state('');
  let watchedSymbols = $state<Set<string>>(new Set());
  let addedSymbols = $state<Set<string>>(new Set());
  let tab = $state<Tab>('interesting');

  async function loadScreener() {
    try {
      const res = await fetch('/api/screener');
      if (!res.ok) throw new Error('Failed to load screener');
      screener = await res.json();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  async function loadWatchlist() {
    try {
      const res = await fetch('/api/watchlist');
      if (!res.ok) return;
      const watches: { symbol: string }[] = await res.json();
      watchedSymbols = new Set(watches.map((w) => w.symbol));
    } catch {
      // Non-critical — Add buttons just won't know what's already watched.
    }
  }

  async function addToWatchlist(symbol: string) {
    const res = await fetch('/api/watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol }),
    });
    if (res.ok) {
      addedSymbols = new Set([...addedSymbols, symbol]);
    }
  }

  function fmtChange(pct: number): string {
    return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
  }

  function fmtVolume(v: number): string {
    if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
    return `$${v.toFixed(0)}`;
  }

  function fmtFunding(rate: number): string {
    return `${rate >= 0 ? '+' : ''}${(rate * 100).toFixed(3)}%`;
  }

  const liquidityLabel: Record<string, string> = {
    high: 'Liquid',
    medium: 'Medium',
    low: 'Low',
    very_low: 'Very low',
  };

  // Liquidity is a risk flag: quiet when fine, amber to red as it thins.
  const liquidityTone: Record<string, string> = {
    high: 'ok',
    medium: 'mid',
    low: 'warn',
    very_low: 'bad',
  };

  const rows = $derived.by<CoinSignal[]>(() => {
    if (!screener) return [];
    switch (tab) {
      case 'gainers':
        return screener.topGainers;
      case 'losers':
        return screener.topLosers;
      case 'new':
        return screener.newListings;
      default:
        return screener.mostInteresting;
    }
  });

  const tabs = $derived([
    { value: 'interesting' as Tab, label: 'Most interesting' },
    { value: 'gainers' as Tab, label: 'Top gainers' },
    { value: 'losers' as Tab, label: 'Top losers' },
    { value: 'new' as Tab, label: 'New listings (24h)' },
  ]);

  onMount(() => {
    loadScreener();
    loadWatchlist();
  });
</script>

<svelte:head><title>Discover · Marketbot</title></svelte:head>

<div class="page">
  <header class="page-head">
    <div>
      <h1 class="page-title">Discover</h1>
      <p class="page-sub">
        Every coin ranked by 24h move size (50%), volume (30%) and open interest (20%), each measured against the rest of
        the market right now, not fixed thresholds. Funding is a crowded-positioning flag and liquidity a risk flag. Neither is in the score.
      </p>
    </div>
  </header>

  {#if error}
    <p class="note bad">{error}</p>
  {:else if !screener}
    <div class="skel" aria-label="Loading">
      {#each [0, 1, 2, 3, 4, 5, 6, 7] as i (i)}
        <div class="bar" style="--i:{i}"></div>
      {/each}
    </div>
  {:else}
    <div class="tabs fade">
      <Segmented options={tabs} value={tab} label="Coin list" onchange={(v) => (tab = v)} />
      <span class="faint count num">{rows.length} coins</span>
    </div>

    {#if rows.length === 0}
      <div class="card empty fade">None right now.</div>
    {:else}
      <div class="scroll">
        <table class="tbl fade">
          <thead>
            <tr>
              <th>Symbol</th>
              <th class="r">Price</th>
              <th class="r">24h change</th>
              <th class="r">24h volume</th>
              <th class="r">Funding</th>
              <th>Liquidity</th>
              <th>Score</th>
              <th class="r"></th>
            </tr>
          </thead>
          <tbody>
            {#each rows as coin, i (coin.symbol)}
              <tr class="rise" style="--i:{Math.min(i, 12)}">
                <td class="sym">{coin.symbol}</td>
                <td class="r num">{coin.lastPrice}</td>
                <td class="r num">
                  <span class="chg" class:up={coin.changePct >= 0} class:down={coin.changePct < 0}>{fmtChange(coin.changePct)}</span>
                </td>
                <td class="r num dim">{fmtVolume(coin.volume24)}</td>
                <td class="r num dim">{fmtFunding(coin.fundingRate)}</td>
                <td><span class="liq {liquidityTone[coin.liquidityTier]}"><i></i>{liquidityLabel[coin.liquidityTier]}</span></td>
                <td>
                  <span class="score">
                    <span class="meter"><span class="fillbar" style="width:{Math.max(3, Math.min(100, coin.interestScore))}%"></span></span>
                    <span class="num">{coin.interestScore}</span>
                  </span>
                </td>
                <td class="r">
                  {#if watchedSymbols.has(coin.symbol) || addedSymbols.has(coin.symbol)}
                    <span class="watching"><Icon name="check" size={13} /> Watching</span>
                  {:else}
                    <button class="btn sm add" type="button" onclick={() => addToWatchlist(coin.symbol)}>
                      <Icon name="plus" size={12} /> Watch
                    </button>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  {/if}
</div>

<style>
  .tabs {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 14px;
  }

  .count {
    font-size: 12px;
  }

  .scroll {
    overflow-x: auto;
  }

  .empty {
    padding: 40px 20px;
    text-align: center;
    color: var(--text-2);
  }

  .sym {
    font-weight: 600;
    letter-spacing: -0.01em;
  }

  .chg {
    display: inline-block;
    min-width: 62px;
    padding: 2px 8px;
    border-radius: 999px;
    text-align: right;
  }

  .chg.up {
    background: var(--green-soft);
    color: var(--green);
  }

  .chg.down {
    background: var(--red-soft);
    color: var(--red);
  }

  .liq {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    color: var(--text-2);
    white-space: nowrap;
  }

  .liq i {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--text-3);
  }

  .liq.ok i {
    background: var(--green);
  }

  .liq.mid i,
  .liq.warn i {
    background: var(--amber);
  }

  .liq.warn {
    color: var(--amber);
  }

  .liq.bad i {
    background: var(--red);
  }

  .liq.bad {
    color: var(--red);
  }

  .score {
    display: inline-flex;
    align-items: center;
    gap: 9px;
  }

  .meter {
    width: 64px;
    height: 5px;
    border-radius: 999px;
    background: var(--surface-3);
    overflow: hidden;
  }

  .fillbar {
    display: block;
    height: 100%;
    border-radius: 999px;
    background: linear-gradient(90deg, var(--accent), var(--accent-hover));
    transition: width 0.5s var(--ease);
  }

  .watching {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    color: var(--text-3);
    font-size: 12px;
  }

  /* The add button waits quietly and wakes when its row is hovered. */
  .add {
    opacity: 0.55;
    transition:
      opacity 0.14s,
      background-color 0.14s,
      border-color 0.14s,
      transform 0.14s var(--ease);
  }

  tr:hover .add,
  .add:focus-visible {
    opacity: 1;
  }

  .add:hover:not(:disabled) {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent-hover);
  }

  .skel {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .bar {
    height: 42px;
    border-radius: var(--radius);
    background: linear-gradient(90deg, var(--surface-2) 20%, var(--surface-3) 50%, var(--surface-2) 80%);
    background-size: 200% 100%;
    animation: shimmer 1.4s linear infinite;
    animation-delay: calc(var(--i) * 80ms);
    opacity: 0.8;
  }

  @keyframes shimmer {
    to {
      background-position: -200% 0;
    }
  }
</style>
