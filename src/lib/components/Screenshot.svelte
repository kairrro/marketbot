<script lang="ts">
  // The chart screenshot saved with a trade, loaded from IndexedDB on demand.
  import { screenshots } from '$lib/state/storage.svelte';

  let { tradeId, available, compact = false }: { tradeId: string; available: boolean; compact?: boolean } = $props();

  let url = $state<string | null>(null);
  let missing = $state(false);

  $effect(() => {
    url = null;
    missing = !available;
    if (!available) return;

    let objectUrl: string | null = null;
    let cancelled = false;
    void screenshots.load(tradeId).then((blob) => {
      if (cancelled) return;
      if (!blob) {
        missing = true;
        return;
      }
      objectUrl = URL.createObjectURL(blob);
      url = objectUrl;
    });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  });
</script>

<div class="shot" class:compact>
  {#if url}
    <a href={url} target="_blank" rel="noreferrer" title="Open full size">
      <img src={url} alt="Chart at the time the trade closed" />
    </a>
  {:else}
    <p class="faint">{missing ? 'No screenshot for this trade.' : 'Loading screenshot…'}</p>
  {/if}
</div>

<style>
  .shot {
    display: grid;
    place-items: center;
    min-height: 120px;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg);
    font-size: 12px;
  }

  .shot.compact {
    min-height: 72px;
  }

  a {
    display: block;
    width: 100%;
  }

  img {
    display: block;
    width: 100%;
    height: auto;
  }

  .shot.compact img {
    max-height: 150px;
    object-fit: cover;
    object-position: right center;
  }
</style>
