<script lang="ts">
  // The morning brief, kept short: when to stay out, the mood, today's events, overnight news.
  import { fmtDay, fmtRange, fmtTime } from '$lib/news/time';
  import { IMPACT_RANK, type Brief } from '$lib/news/types';
  import Icon from '../ui/Icon.svelte';
  import EventCard from './EventCard.svelte';
  import HeadlineCard from './HeadlineCard.svelte';

  let { brief, now, prices = {} }: { brief: Brief; now: number; prices?: Record<string, number> } = $props();

  const main = $derived(brief.events.filter((e) => IMPACT_RANK[e.impact] >= 1));
  const minor = $derived(brief.events.filter((e) => IMPACT_RANK[e.impact] < 1));
  const moodText: Record<string, string> = { 'risk-off': 'Risk-off', 'risk-on': 'Risk-on', mixed: 'Mixed', quiet: 'Quiet' };
  const aiOff = $derived(brief.notes.some((n) => n.startsWith('AI is off')));
  const problems = $derived(brief.notes.filter((n) => !n.startsWith('AI is off')));
</script>

<div class="brief">
  <section class="stay rise" class:clear={brief.noTrade.length === 0} style="--i:0">
    <Icon name="ban" size={16} />
    {#if brief.noTrade.length > 0}
      <p>
        <strong>Stay out</strong>
        <span class="num">{brief.noTrade.map((w) => fmtRange(w.startMs, w.endMs)).join('  ·  ')}</span>
        <span class="faint">Central</span>
      </p>
    {:else}
      <p><strong>Nothing to stay out of today.</strong> <span class="faint">Nothing big is scheduled.</span></p>
    {/if}
  </section>

  {#if brief.mood}
    <p class="mood rise" style="--i:1">
      <span class="state">{moodText[brief.mood.state] ?? brief.mood.state}</span>
      {brief.mood.lines.join(' ')}
    </p>
  {/if}

  <section>
    <h2 class="h">Today · {fmtDay(brief.forDate)}</h2>
    {#if main.length === 0}
      <p class="empty dim">No big events on the calendar today.</p>
    {:else}
      <div class="list">
        {#each main as item, i (item.id)}
          <EventCard {item} {now} {prices} index={i + 2} />
        {/each}
      </div>
    {/if}
    {#if minor.length > 0}
      <details class="minor">
        <summary class="faint">{minor.length} small {minor.length === 1 ? 'event' : 'events'} not shown</summary>
        <ul>
          {#each minor as item (item.id)}
            <li class="num"><span class="faint">{fmtTime(item.timeMs)}</span> {item.title}</li>
          {/each}
        </ul>
      </details>
    {/if}
  </section>

  <section>
    <h2 class="h">Overnight news</h2>
    {#if brief.overnight.length === 0}
      <p class="empty dim">{aiOff ? 'The AI rates overnight news. Add an OpenRouter key in Settings to see it here.' : 'Nothing big overnight.'}</p>
    {:else}
      <div class="list">
        {#each brief.overnight as item, i (item.id)}
          <HeadlineCard {item} {now} {prices} index={i} />
        {/each}
      </div>
    {/if}
  </section>

  {#each problems as note (note)}
    <p class="note warn">{note}</p>
  {/each}

  <p class="foot faint">Written {fmtTime(brief.generatedAt)} CT. Swings are typical sizes from past events, not a direction. Info only.</p>
</div>

<style>
  .brief {
    display: flex;
    flex-direction: column;
    gap: 22px;
  }

  .stay {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    border: 1px solid rgba(217, 164, 65, 0.45);
    border-radius: var(--radius);
    background: var(--amber-soft);
    color: var(--amber);
    font-size: 14px;
  }

  .stay strong {
    margin-right: 8px;
    color: var(--text);
  }

  .stay.clear {
    border-color: var(--border);
    background: var(--surface-2);
    color: var(--text-2);
  }

  .stay.clear strong {
    color: var(--text);
  }

  .mood {
    font-size: 14px;
    line-height: 1.55;
  }

  .state {
    display: inline-block;
    margin-right: 8px;
    padding: 1px 9px;
    border-radius: 999px;
    background: var(--accent-soft);
    color: var(--accent-hover);
    font-size: 12px;
    font-weight: 600;
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
    font-size: 13.5px;
  }

  .minor {
    margin-top: 12px;
    font-size: 12.5px;
  }

  .minor summary {
    cursor: pointer;
    list-style: none;
    transition: color 0.12s;
  }

  .minor summary:hover {
    color: var(--text);
  }

  .minor summary::before {
    content: '▸ ';
  }

  .minor[open] summary::before {
    content: '▾ ';
  }

  .minor ul {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 8px 0 0 14px;
    color: var(--text-2);
  }

  .foot {
    font-size: 12px;
  }
</style>
