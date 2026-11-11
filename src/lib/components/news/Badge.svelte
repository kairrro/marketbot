<script lang="ts">
  // An impact (Low / Medium / High) or volatility (normal / elevated / extreme) tag.
  let { kind, value }: { kind: 'impact' | 'vol'; value: string } = $props();

  const bars = $derived(value === 'extreme' ? 3 : value === 'elevated' ? 2 : 1);
  const label = $derived(kind === 'impact' ? value.charAt(0).toUpperCase() + value.slice(1) : value);
  const tone = $derived(
    kind === 'impact' ? value : value === 'extreme' ? 'high' : value === 'elevated' ? 'medium' : 'low'
  );
</script>

<span class="badge {tone}" title={kind === 'impact' ? `${label} impact` : `${label} volatility expected`}>
  {#if kind === 'vol'}
    <svg width="12" height="10" viewBox="0 0 12 10" aria-hidden="true">
      {#each [0, 1, 2] as i (i)}
        <rect x={i * 4.4} y={7 - i * 3} width="2.6" height={3 + i * 3} rx="0.8" opacity={i < bars ? 1 : 0.28} fill="currentColor" />
      {/each}
    </svg>
  {:else}
    <span class="dot"></span>
  {/if}
  {label}
</span>

<style>
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 20px;
    padding: 0 8px;
    border-radius: 999px;
    background: var(--surface-3);
    color: var(--text-2);
    font-size: 11.5px;
    font-weight: 500;
    white-space: nowrap;
  }

  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
  }

  .badge.high {
    background: var(--red-soft);
    color: var(--red);
  }

  .badge.medium {
    background: var(--amber-soft);
    color: var(--amber);
  }
</style>
