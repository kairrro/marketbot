<script lang="ts">
  // One scheduled event: when, what, how big a swing to expect, and when to stay out.
  import { fmtRange, fmtTime, MINUTE } from '$lib/news/time';
  import type { ScheduledItem } from '$lib/news/types';
  import Icon from '../ui/Icon.svelte';
  import Badge from './Badge.svelte';
  import Swing from './Swing.svelte';

  let {
    item,
    now,
    prices = {},
    index = 0
  }: { item: ScheduledItem; now: number; prices?: Record<string, number>; index?: number } = $props();

  /** Over once its no-trade window (or a few minutes, when it has none) has passed. */
  const done = $derived(now > (item.noTrade?.endMs ?? item.timeMs + 15 * MINUTE));
  const live = $derived(item.noTrade ? now >= item.noTrade.startMs && now <= item.noTrade.endMs : false);
</script>

<article class="ev rise" class:done class:live style="--i:{index}">
  <div class="when num">{fmtTime(item.timeMs)}</div>
  <div class="main">
    <div class="top">
      <h3 class="title">{item.title}</h3>
      <Badge kind="impact" value={item.impact} />
      <span class="vol faint">{item.volatility} volatility</span>
    </div>
    <Swing swing={item.swing ?? {}} {prices} />
    {#if item.noTrade}
      <p class="win num" class:live>
        <Icon name="ban" size={12} /> Stay out {fmtRange(item.noTrade.startMs, item.noTrade.endMs)}
      </p>
    {/if}
    {#if item.outsideHours}<p class="faint small">After the close. It hits the next open.</p>{/if}
  </div>
</article>

<style>
  .ev {
    display: grid;
    grid-template-columns: 84px 1fr;
    gap: 14px;
    padding: 14px 16px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface-2);
    transition:
      border-color 0.16s,
      background-color 0.16s,
      opacity 0.2s,
      transform 0.16s var(--ease);
  }

  .ev:hover {
    border-color: var(--border-strong);
    background: var(--surface-3);
    transform: translateY(-1px);
  }

  .ev.done {
    opacity: 0.5;
  }

  .ev.done:hover {
    opacity: 0.85;
  }

  .ev.live {
    border-color: var(--amber);
    box-shadow: 0 0 0 3px var(--amber-soft);
  }

  .when {
    padding-top: 1px;
    font-size: 14px;
    font-weight: 500;
    white-space: nowrap;
  }

  .main {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }

  .top {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
  }

  .title {
    font-size: 14.5px;
    font-weight: 600;
    letter-spacing: -0.01em;
  }

  .vol {
    font-size: 12px;
  }

  .win {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    align-self: flex-start;
    height: 24px;
    padding: 0 9px;
    border-radius: var(--radius-sm);
    background: var(--amber-soft);
    color: var(--amber);
    font-size: 12px;
    font-weight: 500;
  }

  .win.live {
    animation: blink 1.6s ease-in-out infinite;
  }

  @keyframes blink {
    50% {
      background: rgba(217, 164, 65, 0.22);
    }
  }

  .small {
    font-size: 12px;
  }

  @media (max-width: 560px) {
    .ev {
      grid-template-columns: 1fr;
      gap: 6px;
    }
  }
</style>
