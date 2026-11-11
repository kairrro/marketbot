<script lang="ts">
  // Source, coin, timeframe, start date and Load.
  import { SOURCES } from '$lib/data';
  import { replay } from '$lib/state/replay.svelte';
  import { tested } from '$lib/state/tested.svelte';
  import CoinPicker from './CoinPicker.svelte';
  import TimeframePicker from './TimeframePicker.svelte';
  import Icon from './ui/Icon.svelte';
</script>

<form
  class="group"
  onsubmit={(event) => {
    event.preventDefault();
    void replay.load();
  }}
>
  <select class="inp source" bind:value={replay.source} title="Data source" aria-label="Data source">
    {#each SOURCES as source (source.id)}
      <option value={source.id} title={source.hint}>{source.label}</option>
    {/each}
  </select>

  <CoinPicker bind:value={replay.coinInput} source={replay.source} />

  <TimeframePicker />

  <input
    class="inp start num"
    type="datetime-local"
    bind:value={replay.startInput}
    title="Jump the replay to a date. Leave it as it is and Load keeps the session where it is; a new session with no date starts 300 candles in."
    aria-label="Replay date"
  />

  <button
    type="button"
    class="btn square"
    disabled={replay.loading}
    onclick={() => tested.randomStart()}
    title="Load a random date with a week of data you have not tested yet"
    aria-label="Random untested date"
  >
    <Icon name="dice" />
  </button>

  <button type="submit" class="btn primary" disabled={replay.loading}>
    {replay.loading ? 'Loading…' : 'Load'}
  </button>
</form>

<style>
  .group {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
  }

  .source {
    width: 122px;
  }

  .start {
    width: 190px;
    font-size: 12px;
  }
</style>
