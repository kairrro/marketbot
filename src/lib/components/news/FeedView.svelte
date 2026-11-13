<script lang="ts">
  // The feed: stories followed by a real price move. The moves are measured from
  // prices after the fact. They are what happened, not a forecast.
  import type { Feed, FeedItem } from '$lib/news/feed';
  import { addDays, ctDateKey, fmtDay, fmtTime } from '$lib/news/time';
  import Icon from '../ui/Icon.svelte';
  import Toggle from '../ui/Toggle.svelte';
  import StoryCard from './StoryCard.svelte';

  let {
    feed,
    running,
    error,
    today,
    onRefresh
  }: { feed: Feed | null; running: boolean; error: string; today: string; onRefresh: () => void } = $props();

  /** A move this many times a normal day is a clear one; below it only shows when asked. */
  const CLEAR = 1.5;
  let small = $state(false);
  let pick = $state('all');

  const visible = $derived((feed?.items ?? []).filter((i) => i.moves.some((m) => m.ratio >= (small ? 1 : CLEAR))));
  const symbols = $derived([...new Set(visible.flatMap((i) => i.moves.map((m) => m.symbol)))]);
  const shown = $derived(pick === 'all' ? visible : visible.filter((i) => i.moves.some((m) => m.symbol === pick)));

  // If the picked symbol is gone after a refresh or a filter change, go back to all.
  $effect(() => {
    if (pick !== 'all' && !symbols.includes(pick)) pick = 'all';
  });

  const groups = $derived.by(() => {
    const map = new Map<string, FeedItem[]>();
    for (const item of shown) {
      const day = ctDateKey(item.publishedAt);
      map.set(day, [...(map.get(day) ?? []), item]);
    }
    return [...map.entries()];
  });

  const dayName = (day: string) => (day === today ? 'Today' : day === addDays(today, -1) ? 'Yesterday' : fmtDay(day));
  const strongest = (i: FeedItem) => i.moves.filter((m) => m.ratio >= (small ? 1 : CLEAR));
</script>

<div class="feed">
  <div class="bar">
    <div class="chips" role="group" aria-label="Filter by symbol">
      <button type="button" class="chip" class:on={pick === 'all'} onclick={() => (pick = 'all')}>All</button>
      {#each symbols as s (s)}
        <button type="button" class="chip" class:on={pick === s} onclick={() => (pick = s)}>{s}</button>
      {/each}
    </div>
    <div class="right">
      {#if feed}<span class="faint s">Updated {fmtTime(feed.generatedAt)}</span>{/if}
      <button class="btn" type="button" disabled={running} onclick={onRefresh}>
        <Icon name="refresh" size={14} /> {running ? 'Reading…' : 'Refresh'}
      </button>
    </div>
  </div>

  {#if running && !feed}
    <div class="card empty rise">
      <p class="big">Reading the week's news and checking prices…</p>
      <p class="dim">This takes about half a minute the first time.</p>
    </div>
  {:else if error && !feed}
    <p class="note bad">Could not build the feed: {error}</p>
  {:else if feed}
    {#if shown.length === 0}
      <div class="card empty rise">
        <p class="big">Nothing moved prices much</p>
        <p class="dim">
          No story in the past {feed.days} days was followed by a clear price move{pick !== 'all' ? ` in ${pick}` : ''}.
          {#if !small}Turn on smaller moves to see more.{/if}
        </p>
      </div>
    {:else}
      {#each groups as [day, items], g (day)}
        <section>
          <h2 class="h">{dayName(day)}</h2>
          <div class="list">
            {#each items as item, i (item.id)}
              <StoryCard {item} moves={strongest(item)} index={g * 2 + i} />
            {/each}
          </div>
        </section>
      {/each}
    {/if}

    <div class="foot">
      <Toggle checked={small} onchange={(v) => (small = v)}>Show smaller moves too</Toggle>
      <p class="faint s">
        Each move is the price change from just before the story to about a day later, as measured from prices. It is what happened, not a prediction, and other news may have moved the price too.
      </p>
      {#each feed.notes as note (note)}<p class="note warn">{note}</p>{/each}
    </div>
  {/if}
</div>

<style>
  .feed {
    display: flex;
    flex-direction: column;
    gap: 22px;
  }

  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 10px 14px;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .right {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .s {
    font-size: 12px;
  }

  .h {
    margin-bottom: 10px;
    font-size: 14px;
    font-weight: 600;
    letter-spacing: -0.01em;
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
    display: flex;
    flex-direction: column;
    gap: 10px;
    max-width: 560px;
  }
</style>
