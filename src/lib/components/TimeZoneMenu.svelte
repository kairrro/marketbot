<script lang="ts">
  // The time zone in the chart's bottom-right corner, under the price axis.
  // Clicking it picks the zone every time in the backtester is shown in.
  import { display } from '$lib/state/display.svelte';
  import { replay } from '$lib/state/replay.svelte';
  import { offsetLabel, offsetMinutes, TIME_ZONES, zoneLabel, type TimeZone } from '$lib/timezone';

  let { width, height }: { width: number; height: number } = $props();

  let open = $state(false);
  let root: HTMLDivElement;

  /** Offsets are given for the replay's own moment, so daylight saving matches the chart. */
  const at = $derived(replay.cursorTime || Date.now());
  const offset = (zone: TimeZone) => offsetLabel(offsetMinutes(at, zone));

  function pick(zone: TimeZone) {
    display.timeZone = zone;
    open = false;
  }
</script>

<svelte:window
  onmousedown={(event) => {
    if (open && !root.contains(event.target as Node)) open = false;
  }}
/>

<div class="tz" bind:this={root} style:width="{width}px" style:height="{height}px">
  <button
    type="button"
    class="corner num"
    class:on={open}
    aria-haspopup="menu"
    aria-expanded={open}
    title="Chart times are in {zoneLabel(display.timeZone)}. Click to change."
    onclick={() => (open = !open)}
  >
    {offset(display.timeZone)}
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
      <p class="cap">Time zone</p>
      <ul>
        {#each TIME_ZONES as zone (zone.id)}
          <li>
            <button
              type="button"
              class="choose"
              class:current={zone.id === display.timeZone}
              role="menuitemradio"
              aria-checked={zone.id === display.timeZone}
              onclick={() => pick(zone.id)}
            >
              <span class="name">{zoneLabel(zone.id)}</span>
              <span class="num faint">{offset(zone.id)}</span>
            </button>
          </li>
        {/each}
      </ul>
      <p class="faint tip">Applies to the chart, the legend and the journal.</p>
    </div>
  {/if}
</div>

<style>
  .tz {
    position: absolute;
    right: 0;
    bottom: 0;
    z-index: 3;
  }

  .corner {
    display: grid;
    place-items: center;
    width: 100%;
    height: 100%;
    color: var(--text-2);
    font-size: 10.5px;
    white-space: nowrap;
    transition:
      background-color 0.12s,
      color 0.12s;
  }

  .corner:hover,
  .corner.on {
    background: var(--surface-3);
    color: var(--text);
  }

  .popover {
    position: absolute;
    right: 6px;
    bottom: calc(100% + 6px);
    width: 250px;
    max-height: min(440px, calc(100vh - 120px));
    overflow-y: auto;
    padding: 6px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface-2);
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4);
  }

  .cap {
    padding: 6px 8px 4px;
  }

  .choose {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    width: 100%;
    height: 30px;
    padding: 0 8px;
    border-radius: var(--radius-sm);
    color: var(--text);
  }

  .choose:hover {
    background: var(--surface-3);
  }

  .choose.current .name {
    color: var(--accent-hover);
    font-weight: 600;
  }

  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .choose .num {
    font-size: 11.5px;
  }

  .tip {
    padding: 6px 8px 4px;
    font-size: 11.5px;
  }
</style>
