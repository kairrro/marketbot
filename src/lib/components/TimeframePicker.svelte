<script lang="ts">
  // Timeframes: favourites as buttons in the bar, the full list in a menu
  // where each one can be starred or unstarred.
  import { TF_LABEL, TIMEFRAMES, type Timeframe } from '$lib/engine/types';
  import { favorites } from '$lib/state/prefs.svelte';
  import { replay } from '$lib/state/replay.svelte';
  import Icon from './ui/Icon.svelte';
  import Segmented from './ui/Segmented.svelte';

  let open = $state(false);
  let root: HTMLDivElement;

  // The timeframe in use is always shown, starred or not, so the bar never
  // hides which chart you are looking at.
  const shown = $derived(
    TIMEFRAMES.filter((tf) => favorites.has(tf) || tf === replay.tf).map((tf) => ({ value: tf, label: TF_LABEL[tf] }))
  );

  function pick(tf: Timeframe) {
    open = false;
    void replay.setTimeframe(tf);
  }
</script>

<svelte:window
  onmousedown={(event) => {
    if (open && !root.contains(event.target as Node)) open = false;
  }}
/>

<div class="picker" bind:this={root}>
  <Segmented
    label="Timeframe"
    options={shown}
    value={replay.tf}
    onchange={(tf) => replay.setTimeframe(tf)}
    mono
    compact
  />
  <button
    type="button"
    class="btn quiet more"
    class:on={open}
    aria-haspopup="menu"
    aria-expanded={open}
    title="All timeframes. Star the ones you want in the bar."
    aria-label="All timeframes"
    onclick={() => (open = !open)}
  >
    <Icon name="chevron" size={14} />
  </button>

  {#if open}
    <div
      class="popover"
      role="menu"
      tabindex="-1"
      onkeydown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          open = false;
        }
      }}
    >
      <p class="cap">Timeframes</p>
      <ul>
        {#each TIMEFRAMES as tf (tf)}
          <li class:current={tf === replay.tf}>
            <button type="button" class="choose num" role="menuitem" onclick={() => pick(tf)}>
              {TF_LABEL[tf]}
            </button>
            <button
              type="button"
              class="star"
              class:starred={favorites.has(tf)}
              aria-pressed={favorites.has(tf)}
              title={favorites.has(tf) ? 'Remove from the bar' : 'Show in the bar'}
              aria-label="{favorites.has(tf) ? 'Unfavourite' : 'Favourite'} {TF_LABEL[tf]}"
              onclick={() => favorites.toggle(tf)}
            >
              <Icon name="star" size={14} filled={favorites.has(tf)} />
            </button>
          </li>
        {/each}
      </ul>
      <p class="faint tip">Starred timeframes show in the bar.</p>
    </div>
  {/if}
</div>

<style>
  .picker {
    position: relative;
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .more {
    width: 22px;
    padding: 0;
  }

  .popover {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    z-index: 30;
    width: 168px;
    padding: 6px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface-2);
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4);
  }

  .cap {
    padding: 6px 8px 4px;
  }

  li {
    display: flex;
    align-items: center;
    border-radius: var(--radius-sm);
  }

  li:hover {
    background: var(--surface-3);
  }

  li.current .choose {
    color: var(--accent-hover);
    font-weight: 600;
  }

  .choose {
    flex: 1;
    height: 30px;
    padding: 0 8px;
    color: var(--text);
    text-align: left;
  }

  .star {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: var(--radius-sm);
    color: var(--text-3);
  }

  .star:hover {
    color: var(--text);
  }

  .star.starred {
    color: var(--accent);
  }

  .tip {
    padding: 6px 8px 4px;
    font-size: 11.5px;
  }
</style>
