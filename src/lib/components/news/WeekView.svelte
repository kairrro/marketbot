<script lang="ts">
  // The weekly preview: the events that matter, day by day.
  import { addDays, ctDateKey, fmtDay, fmtTime } from '$lib/news/time';
  import { IMPACT_RANK, type Brief, type ScheduledItem } from '$lib/news/types';
  import EventCard from './EventCard.svelte';

  let { brief, now, prices = {} }: { brief: Brief; now: number; prices?: Record<string, number> } = $props();

  const days = $derived(
    [0, 1, 2, 3, 4].map((n) => {
      const date = addDays(brief.forDate, n);
      const items = brief.events.filter((e) => ctDateKey(e.timeMs) === date);
      const weight = items.reduce((sum, e) => sum + (IMPACT_RANK[e.impact] + 1) ** 2, 0);
      return { date, items, weight };
    })
  );
  const heaviest = $derived(days.reduce((best, d) => (d.weight > best.weight ? d : best), days[0]));
  const names = (items: ScheduledItem[]) => items.filter((e) => e.impact === 'high').map((e) => e.title).slice(0, 3).join(', ');
</script>

<div class="week">
  {#if heaviest.weight > 0}
    <p class="card rise lead" style="--i:0">
      Heaviest day: <strong>{fmtDay(heaviest.date)}</strong>{names(heaviest.items) ? ` (${names(heaviest.items)})` : ''}.
    </p>
  {/if}

  {#each days as day, d (day.date)}
    <section class="day rise" style="--i:{d + 1}">
      <div class="head">
        <h2 class="h">{fmtDay(day.date)}</h2>
        {#if day.weight > 0 && day.date === heaviest.date}<span class="tag">Heaviest</span>{/if}
        {#if day.items.length === 0}<span class="faint">Nothing major</span>{/if}
      </div>
      {#if day.items.length > 0}
        <div class="list">
          {#each day.items as item (item.id)}
            <EventCard {item} {now} {prices} />
          {/each}
        </div>
      {/if}
    </section>
  {/each}

  {#each brief.notes as note (note)}
    <p class="note warn">{note}</p>
  {/each}
  <p class="faint foot">Written {fmtTime(brief.generatedAt)} CT. Swings are typical sizes from past events, not a direction. Info only.</p>
</div>

<style>
  .week {
    display: flex;
    flex-direction: column;
    gap: 22px;
  }

  .lead {
    font-size: 14px;
    border-left: 3px solid var(--accent);
  }

  .head {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 8px;
  }

  .h {
    font-size: 14px;
    font-weight: 600;
    letter-spacing: -0.01em;
  }

  .tag {
    padding: 1px 8px;
    border-radius: 999px;
    background: var(--accent-soft);
    color: var(--accent-hover);
    font-size: 11px;
    font-weight: 600;
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .foot {
    font-size: 11.5px;
  }
</style>
