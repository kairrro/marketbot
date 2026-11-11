<script lang="ts">
  // A news item the AI rated: what happened, how big a swing to expect, whether to pause.
  import { fmtTime, MINUTE } from '$lib/news/time';
  import type { HeadlineItem } from '$lib/news/types';
  import Icon from '../ui/Icon.svelte';
  import Badge from './Badge.svelte';
  import Swing from './Swing.svelte';

  let {
    item,
    now,
    prices = {},
    index = 0
  }: { item: HeadlineItem; now: number; prices?: Record<string, number>; index?: number } = $props();

  const ago = $derived.by(() => {
    const m = Math.max(0, Math.round((now - item.publishedAt) / MINUTE));
    if (m < 1) return 'just now';
    if (m < 60) return `${m} min ago`;
    if (m < 60 * 24) return `${Math.floor(m / 60)} h ago`;
    return fmtTime(item.publishedAt);
  });
</script>

<article class="hl rise {item.impact}" style="--i:{index}">
  <div class="top">
    <p class="what">{item.what}</p>
    <Badge kind="impact" value={item.impact} />
  </div>
  <Swing swing={item.swing ?? {}} {prices} />
  <div class="meta">
    {#if item.pauseMinutes > 0}
      <span class="pause num"><Icon name="ban" size={12} /> Pause about {item.pauseMinutes} min</span>
    {/if}
    <span class="spacer"></span>
    <span class="faint small">{ago}</span>
    {#if item.url}
      <a class="src small" href={item.url} target="_blank" rel="noreferrer noopener" title={item.headline}>
        {item.source || 'Source'}
        <Icon name="arrow" size={11} />
      </a>
    {:else if item.source}
      <span class="faint small">{item.source}</span>
    {/if}
  </div>
</article>

<style>
  .hl {
    display: flex;
    flex-direction: column;
    gap: 9px;
    padding: 13px 16px;
    border: 1px solid var(--border);
    border-left: 3px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface-2);
    transition:
      border-color 0.16s,
      background-color 0.16s,
      transform 0.16s var(--ease);
  }

  .hl.high {
    border-left-color: var(--red);
  }

  .hl.medium {
    border-left-color: var(--amber);
  }

  .hl:hover {
    border-color: var(--border-strong);
    background: var(--surface-3);
    transform: translateY(-1px);
  }

  .top {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }

  .what {
    font-size: 14px;
    font-weight: 500;
    line-height: 1.45;
  }

  .meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
  }

  .pause {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 24px;
    padding: 0 9px;
    border-radius: var(--radius-sm);
    background: var(--amber-soft);
    color: var(--amber);
    font-size: 12px;
    font-weight: 500;
  }

  .spacer {
    flex: 1;
  }

  .small {
    font-size: 12px;
  }

  .src {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    max-width: 180px;
    overflow: hidden;
    color: var(--accent);
    text-overflow: ellipsis;
    white-space: nowrap;
    transition: color 0.12s;
  }

  .src:hover {
    color: var(--accent-hover);
  }
</style>
