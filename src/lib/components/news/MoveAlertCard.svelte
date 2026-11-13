<script lang="ts">
  // A tracked stock or market had a big day and a story came out: the story and the
  // measured move so far. A record of what happened, not a forecast.
  import type { MoveAlertRecord } from '$lib/news/moves';
  import { fmtSize } from '$lib/news/swing';
  import { MINUTE, fmtTime } from '$lib/news/time';
  import Icon from '../ui/Icon.svelte';

  let { alert, now, index = 0 }: { alert: MoveAlertRecord; now: number; index?: number } = $props();

  const pct = $derived(`${alert.pct >= 0 ? '+' : '−'}${Math.abs(alert.pct).toFixed(1)}%`);
  const times = $derived(alert.ratio < 1.25 ? 'a normal day' : `${alert.ratio.toFixed(1)}× a normal day`);
  const size = $derived(fmtSize(alert.symbol, Math.abs(alert.pct), alert.price));
  const ago = $derived.by(() => {
    const m = Math.max(0, Math.round((now - alert.createdAt) / MINUTE));
    if (m < 1) return 'just now';
    if (m < 60) return `${m} min ago`;
    if (m < 60 * 24) return `${Math.floor(m / 60)} h ago`;
    return fmtTime(alert.createdAt);
  });
</script>

<article class="mv rise" style="--i:{index}">
  <div class="head">
    <span class="sym">{alert.symbol}</span>
    <span class="pct num" class:pos={alert.pct >= 0} class:neg={alert.pct < 0}>{pct}</span>
    <span class="faint x">today · {times}{size ? ` · ${size}` : ''}</span>
    <span class="spacer"></span>
    <span class="faint s">{ago}</span>
  </div>
  <p class="what">{alert.what}</p>
  {#if alert.url}
    <a class="src s" href={alert.url} target="_blank" rel="noreferrer noopener" title={alert.headline}>
      {alert.source || 'Source'} · {fmtTime(alert.publishedAt)} <Icon name="arrow" size={11} />
    </a>
  {/if}
</article>

<style>
  .mv {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 13px 16px;
    border: 1px solid var(--border);
    border-left: 3px solid var(--amber);
    border-radius: var(--radius);
    background: var(--surface-2);
    transition:
      border-color 0.16s,
      background-color 0.16s,
      transform 0.16s var(--ease);
  }

  .mv:hover {
    border-color: var(--border-strong);
    border-left-color: var(--amber);
    background: var(--surface-3);
    transform: translateY(-1px);
  }

  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 10px;
  }

  .sym {
    font-weight: 600;
  }

  .pct {
    font-size: 16px;
    font-weight: 600;
  }

  .x,
  .s {
    font-size: 12px;
  }

  .spacer {
    flex: 1;
  }

  .what {
    font-size: 14px;
    line-height: 1.5;
  }

  .src {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    align-self: flex-start;
    color: var(--accent);
    transition: color 0.12s;
  }

  .src:hover {
    color: var(--accent-hover);
  }
</style>
