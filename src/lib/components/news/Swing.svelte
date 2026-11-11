<script lang="ts">
  // The size of swing to expect, per market: "NQ about 1.0%, ≈ 250 pts, 3.5× a normal hour".
  // A size, never a direction.
  import { fmtPct, fmtRatio, fmtSize, type Swing } from '$lib/news/swing';

  let { swing, prices = {} }: { swing: Record<string, Swing>; prices?: Record<string, number> } = $props();

  const rows = $derived(Object.entries(swing));
</script>

{#if rows.length > 0}
  <ul class="swing" aria-label="Swing to expect in the next hour">
    {#each rows as [symbol, sw] (symbol)}
      {@const size = fmtSize(symbol, sw.pct, prices[symbol])}
      <li>
        <span class="sym">{symbol}</span>
        <span class="pct num">~{fmtPct(sw.pct)}</span>
        {#if size}<span class="size num dim">{size}</span>{/if}
        <span class="x faint">{fmtRatio(sw.ratio)}</span>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .swing {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  li {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 10px;
    font-size: 13px;
  }

  .sym {
    min-width: 26px;
    font-weight: 600;
  }

  .pct {
    color: var(--text);
    font-weight: 500;
  }

  .x {
    font-size: 12px;
  }
</style>
