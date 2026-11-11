<script lang="ts">
  // Coins and date range for a run, and the button that runs it.
  import { auto, type AutoInputs } from '$lib/state/auto.svelte';

  const DATES: { key: keyof Pick<AutoInputs, 'from' | 'to'>; label: string }[] = [
    { key: 'from', label: 'From' },
    { key: 'to', label: 'To' }
  ];
</script>

<form
  class="form"
  onsubmit={(event) => {
    event.preventDefault();
    void auto.run();
  }}
>
  <label class="field" title="Binance spot coins, separated by commas">
    <span class="faint">Coins</span>
    <input class="inp num coins" type="text" bind:value={auto.inputs.coins} placeholder="BTC, ETH, SOL" aria-label="Coins" />
  </label>

  {#each DATES as date (date.key)}
    <label class="field" title="{date.label} (CT calendar day, included)">
      <span class="faint">{date.label}</span>
      <input class="inp num date" type="date" bind:value={auto.inputs[date.key]} aria-label="{date.label} date" />
    </label>
  {/each}

  <button type="submit" class="btn primary" disabled={auto.running}>
    {auto.running ? `Downloading ${Math.round(auto.progress * 100)}%` : 'Run auto backtest'}
  </button>
</form>

<style>
  .form {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
    margin: 0;
  }

  .field {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
  }

  .coins {
    width: 190px;
    font-size: 12px;
  }

  .date {
    width: 134px;
    font-size: 12px;
  }

  @media (max-width: 767px) {
    .form {
      width: 100%;
    }

    .form .btn {
      width: 100%;
    }
  }
</style>
