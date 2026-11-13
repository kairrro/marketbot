<script lang="ts">
  // The trade ticket: Long or Short. Once a side is picked it shows the drafted
  // position instead of the buttons. Below either, how the trade gets in and
  // how profit will be taken.
  import { replay } from '$lib/state/replay.svelte';
  import { sessions, type EntryOrder } from '$lib/state/sessions.svelte';
  import { trade } from '$lib/state/trade.svelte';
  import DraftPanel from './DraftPanel.svelte';
  import Segmented from './ui/Segmented.svelte';

  type Exit = 'partials' | 'target';

  const entries: { value: EntryOrder; label: string; title: string }[] = [
    { value: 'market', label: 'Market', title: 'Fill now at the current price, paying the taker fee' },
    { value: 'limit', label: 'Limit', title: 'Rest at your price and fill when a candle trades there, paying the maker fee' }
  ];

  const exits: { value: Exit; label: string; title: string }[] = [
    { value: 'target', label: 'Take profit at target', title: 'The target is a take-profit order for the whole position' },
    { value: 'partials', label: 'Partials by hand', title: 'Take profit yourself, a third at a time or all at once' }
  ];

  const exit = $derived<Exit>(sessions.settings.scaleOut ? 'partials' : 'target');
  const entry = $derived(sessions.settings.entryOrder);
  /** Futures pay a commission per contract; everything else a % of the position. */
  const fee = (pct: number) =>
    trade.contract ? `Commission $${trade.contract.commission} per contract per side.` : `Fee ${pct}%.`;
</script>

<section class="card ticket">
  {#if trade.draft}
    <DraftPanel />
  {:else}
    <div class="sides">
      <button type="button" class="btn buy" disabled={!replay.info} onclick={() => trade.begin('long')}>Long</button>
      <button type="button" class="btn sell" disabled={!replay.info} onclick={() => trade.begin('short')}>
        Short
      </button>
    </div>
    {#if trade.future}
      <p class="faint small">Starts with a {trade.stopPoints}-point stop. Pick a size, or drag the lines.</p>
    {/if}
  {/if}

  <div class="exit">
    <p class="cap">Entry</p>
    <div title={entry === 'market' ? fee(sessions.settings.feePct) : fee(sessions.settings.makerFeePct)}>
      <Segmented label="Entry" options={entries} value={entry} onchange={(value) => trade.setEntryOrder(value)} stretch />
    </div>
  </div>

  <!-- Futures are whole contracts, so there are no thirds to take: the target always closes it all. -->
  {#if !trade.contract}
    <div class="exit">
      <p class="cap">Taking profit</p>
      <Segmented
        label="Taking profit"
        options={exits}
        value={exit}
        onchange={(value) => sessions.updateSettings({ scaleOut: value === 'partials' })}
        stretch
      />
    </div>
  {/if}
</section>

<style>
  .ticket {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .sides {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  .sides .btn {
    height: 36px;
    font-weight: 600;
  }

  .exit {
    display: flex;
    flex-direction: column;
    gap: 7px;
    padding-top: 12px;
    border-top: 1px solid var(--border);
  }

  .small {
    font-size: 11.5px;
    line-height: 1.4;
  }
</style>
