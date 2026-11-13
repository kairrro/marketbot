<script lang="ts">
  // The stock finder: type a ticker, get what you need on it without reading the
  // news. Price against a normal day, the next report, the week's stories with the
  // move that followed each, and a few plain lines. A size and a record, never a
  // direction.
  import { onMount } from 'svelte';
  import type { Lookup } from '$lib/news/lookup';
  import { fmtDay, fmtTime } from '$lib/news/time';
  import { fmtPct } from '$lib/news/swing';
  import type { TrackedAsset } from '$lib/news/types';
  import Icon from '../ui/Icon.svelte';
  import StoryCard from './StoryCard.svelte';

  let {
    assets,
    initial = '',
    onChanged
  }: { assets: TrackedAsset[]; initial?: string; onChanged: () => void } = $props();

  let query = $state('');
  let result = $state<Lookup | null>(null);
  let loading = $state(false);
  let error = $state('');
  let asked = $state('');
  let tracking = $state(false);
  let input: HTMLInputElement | undefined;

  const tracked = (symbol: string) => assets.some((a) => a.symbol === symbol && a.kind !== 'topic');
  const quick = $derived(assets.filter((a) => a.enabled && a.kind !== 'topic'));

  const signed = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%`;
  const price = (v: number) => (v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : v.toFixed(2));

  async function find(raw: string) {
    const symbol = raw.trim().toUpperCase();
    if (!symbol || loading) return;
    query = symbol;
    asked = symbol;
    loading = true;
    error = '';
    try {
      const res = await fetch(`/api/news/lookup?symbol=${encodeURIComponent(symbol)}`);
      const body = (await res.json().catch(() => ({}))) as Lookup & { message?: string };
      if (res.ok) result = body;
      else {
        result = null;
        error = body.message ?? 'Could not look that up.';
      }
    } catch (err) {
      result = null;
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  }

  async function track() {
    if (!result) return;
    tracking = true;
    await fetch('/api/news/assets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'stock', symbol: result.symbol, name: result.name })
    });
    tracking = false;
    onChanged();
  }

  onMount(() => {
    if (initial) void find(initial);
    else input?.focus();
  });
</script>

<div class="find">
  <form
    class="search"
    onsubmit={(e) => {
      e.preventDefault();
      void find(query);
    }}
  >
    <input class="inp" bind:this={input} bind:value={query} placeholder="Ticker, e.g. AMD, NVDA, QQQ" aria-label="Ticker" autocomplete="off" spellcheck="false" />
    <button class="btn primary" type="submit" disabled={loading || !query.trim()}>{loading ? 'Reading…' : 'Find'}</button>
  </form>

  {#if quick.length > 0}
    <div class="chips" role="group" aria-label="Your tracked symbols">
      {#each quick as a (a.id)}
        <button type="button" class="chip" class:on={asked === a.symbol} onclick={() => find(a.symbol)}>{a.symbol}</button>
      {/each}
    </div>
  {/if}

  {#if loading}
    <div class="card empty rise">
      <p class="big">Reading the news on {asked}…</p>
      <p class="dim">Checking prices, stories and the earnings calendar. 10 to 20 seconds.</p>
    </div>
  {:else if error}
    <p class="note bad">{error}</p>
  {:else if result}
    <section class="head card rise" style="--i:0">
      <div class="id">
        <h2 class="sym">{result.symbol}</h2>
        <span class="faint">{result.name}</span>
      </div>
      <div class="px num">
        {#if result.price != null}<span class="price">{price(result.price)}</span>{/if}
        {#if result.changePct != null}
          <span class="chg" class:pos={result.changePct >= 0} class:neg={result.changePct < 0}>{signed(result.changePct)} today</span>
        {/if}
        {#if result.typicalMove != null}<span class="faint">a normal day is about ±{fmtPct(result.typicalMove)}</span>{/if}
      </div>
      <div class="act">
        {#if tracked(result.symbol)}
          <span class="faint s"><Icon name="check" size={13} /> Tracked</span>
        {:else}
          <button class="btn" type="button" disabled={tracking} onclick={track} title="Add it to your tracked stocks, so it shows in the summary and alerts">
            <Icon name="plus" size={14} /> {tracking ? 'Adding…' : 'Track it'}
          </button>
        {/if}
      </div>
    </section>

    <section class="short card rise" style="--i:1">
      <h3 class="cap">In short</h3>
      <ul>
        {#each result.bullets as b (b)}<li>{b}</li>{/each}
      </ul>
    </section>

    {#if result.earnings && !result.bullets.some((b) => /earnings/i.test(b))}
      <p class="earn rise" style="--i:2">
        <Icon name="calendar" size={14} />
        Next earnings {fmtDay(result.earnings.date)}{result.earnings.time === 'pre' ? ', before the open' : result.earnings.time === 'post' ? ', after the close' : ''}.
        {#if result.earningsSwing}
          A report from {result.symbol} has meant about a {fmtPct(result.earningsSwing.pct)} swing in NQ in the hour after.
        {/if}
      </p>
    {/if}

    <section>
      <h3 class="cap h">Stories this week, with what the price did after</h3>
      {#if result.stories.length === 0}
        <div class="card empty"><p class="dim">No notable stories found for {result.symbol} in the past 7 days.</p></div>
      {:else}
        <div class="list">
          {#each result.stories as item, i (item.id)}
            <StoryCard {item} moves={item.moves.filter((m) => m.symbol === result?.symbol)} index={i + 3} />
          {/each}
        </div>
      {/if}
    </section>

    {#each result.notes as note (note)}<p class="note warn">{note}</p>{/each}
    <p class="faint s foot">
      Updated {fmtTime(result.generatedAt)}. Each move is the price change from just before the story to about a day later, as measured from prices. It is what happened, not a prediction, and other news may have moved the price too.
    </p>
  {:else}
    <div class="card empty">
      <p class="big">Find any stock</p>
      <p class="dim">Type a ticker to see how it is doing against a normal day, what the news did to its price this week, and when it reports next.</p>
    </div>
  {/if}
</div>

<style>
  .find {
    display: flex;
    flex-direction: column;
    gap: 18px;
  }

  .search {
    display: flex;
    gap: 8px;
    max-width: 460px;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 26px;
  }

  .id {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .sym {
    font-size: 22px;
    font-weight: 600;
    letter-spacing: -0.02em;
  }

  .px {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 14px;
  }

  .price {
    font-size: 20px;
    font-weight: 500;
  }

  .chg {
    font-weight: 600;
  }

  .act {
    margin-left: auto;
  }

  .s {
    font-size: 12px;
  }

  .short {
    display: flex;
    flex-direction: column;
    gap: 10px;
    border-left: 3px solid var(--accent);
  }

  .short ul {
    display: flex;
    flex-direction: column;
    gap: 7px;
    font-size: 14px;
    line-height: 1.5;
  }

  .short li {
    position: relative;
    padding-left: 16px;
  }

  .short li::before {
    content: '';
    position: absolute;
    left: 2px;
    top: 0.62em;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--accent);
  }

  .earn {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 10px 14px;
    border-radius: var(--radius-sm);
    background: var(--amber-soft);
    color: var(--amber);
    font-size: 13px;
  }

  .h {
    margin-bottom: 8px;
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .empty {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 34px 20px;
    text-align: center;
  }

  .big {
    font-size: 15px;
    font-weight: 600;
  }

  .foot {
    max-width: 600px;
  }
</style>
