<script lang="ts">
  // One story with the price move that followed it. The move is measured from
  // prices after the fact: what happened, not a forecast.
  import type { FeedItem, Move } from '$lib/news/feed';
  import { fmtTime } from '$lib/news/time';
  import Icon from '../ui/Icon.svelte';

  let { item, moves, index = 0 }: { item: FeedItem; moves: Move[]; index?: number } = $props();

  const pct = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%`;
  const ratio = (v: number) => (v < 1.25 ? 'a normal day' : `${v.toFixed(1)}× a normal day`);
  /** "in the day after" for a full day, otherwise how long had passed. */
  const span = (m: Move) => (m.hours >= 20 ? 'in the day after' : `in the ${Math.max(1, Math.round(m.hours))}h after`);
</script>

<article class="story rise" style="--i:{index}">
  <div class="top">
    <p class="what">{item.what}</p>
    <span class="at faint num">{fmtTime(item.publishedAt)}</span>
  </div>
  <ul class="moves">
    {#each moves as m (m.symbol)}
      <li class:small={m.ratio < 1.5}>
        <span class="sym">{m.symbol}</span>
        <span class="pct num" class:pos={m.pct >= 0} class:neg={m.pct < 0}>{pct(m.pct)}</span>
        <span class="faint x">{span(m)} · {ratio(m.ratio)}</span>
      </li>
    {/each}
  </ul>
  <div class="meta">
    {#if !item.described}<span class="faint s">as published</span>{/if}
    <span class="spacer"></span>
    {#if item.url}
      <a class="src s" href={item.url} target="_blank" rel="noreferrer noopener" title={item.headline}>
        {item.source || 'Source'} <Icon name="arrow" size={11} />
      </a>
    {:else if item.source}
      <span class="faint s">{item.source}</span>
    {/if}
  </div>
</article>

<style>
  .story {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px 16px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface-2);
    transition:
      border-color 0.16s,
      background-color 0.16s,
      transform 0.16s var(--ease);
  }

  .story:hover {
    border-color: var(--border-strong);
    background: var(--surface-3);
    transform: translateY(-1px);
  }

  .top {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 14px;
  }

  .what {
    font-size: 14px;
    font-weight: 500;
    line-height: 1.5;
  }

  .at {
    flex: none;
    padding-top: 2px;
    font-size: 12px;
  }

  .moves {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .moves li {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 10px;
  }

  .moves li.small {
    opacity: 0.6;
  }

  .sym {
    min-width: 40px;
    font-weight: 600;
  }

  .pct {
    min-width: 58px;
    font-size: 15px;
    font-weight: 600;
  }

  .x {
    font-size: 12px;
  }

  .s {
    font-size: 12px;
  }

  .meta {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .spacer {
    flex: 1;
  }

  .src {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    max-width: 220px;
    overflow: hidden;
    color: var(--accent);
    text-overflow: ellipsis;
    white-space: nowrap;
    transition: color 0.12s;
  }

  .src:hover {
    color: var(--accent-hover);
  }

  @media (max-width: 560px) {
    .top {
      flex-direction: column;
      gap: 4px;
    }
  }
</style>
