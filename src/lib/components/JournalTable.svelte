<script lang="ts">
  // The journal's list of trades, one row each across the full width. Clicking
  // a row (or ↑/↓) opens its details underneath; clicking it again closes them.
  import type { TradeRecord } from '$lib/engine/journal';
  import { TF_LABEL } from '$lib/engine/types';
  import { fmtMoney, fmtR, fmtShortDateTime, sign } from '$lib/format';
  import { display } from '$lib/state/display.svelte';
  import { sessions } from '$lib/state/sessions.svelte';
  import { ui } from '$lib/state/ui.svelte';
  import JournalDetail from './JournalDetail.svelte';
  import Icon from './ui/Icon.svelte';

  let { rows, empty }: { rows: { trade: TradeRecord; number: number }[]; empty: string } = $props();

  /** Columns in a row, for the details row to span. */
  const COLUMNS = 8;

  let body = $state<HTMLTableSectionElement>();

  // Keeps the open trade in view when it is moved to with the keyboard: its
  // details if they fit, and always its row.
  $effect(() => {
    const id = ui.detailId;
    const row = body?.querySelector(`[data-id="${id}"]`);
    row?.nextElementSibling?.scrollIntoView({ block: 'nearest' });
    row?.scrollIntoView({ block: 'nearest' });
  });

  function toggle(id: string) {
    ui.detailId = ui.detailId === id ? null : id;
  }

  function remove(event: MouseEvent, trade: TradeRecord) {
    event.stopPropagation();
    if (!window.confirm(`Delete this ${trade.coin} ${trade.side} (${fmtR(trade.r)})?`)) return;
    if (ui.detailId === trade.id) ui.detailId = null;
    if (ui.promptId === trade.id) ui.promptId = null;
    sessions.deleteTrade(trade.id);
  }
</script>

{#if rows.length === 0}
  <p class="none dim">{empty}</p>
{:else}
  <table>
    <thead>
      <tr>
        <th class="arrow"></th>
        <th class="r">#</th>
        <th>Entry</th>
        <th class="wide">Market</th>
        <th title="Followed rules">Rules</th>
        <th class="r">R</th>
        <th class="r">P&amp;L</th>
        <th></th>
      </tr>
    </thead>
    <tbody bind:this={body}>
      {#each rows as { trade, number } (trade.id)}
        {@const open = ui.detailId === trade.id}
        <tr data-id={trade.id} class="row" class:open aria-expanded={open} onclick={() => toggle(trade.id)}>
          <td class="arrow faint"><Icon name={open ? 'chevron' : 'forward'} size={12} /></td>
          <td class="r num faint">{number}</td>
          <td class="num dim">{fmtShortDateTime(trade.entryTime, display.timeZone)}</td>
          <td class="wide">
            <span class={trade.side === 'long' ? 'pos' : 'neg'}>{trade.side === 'long' ? '▲' : '▼'}</span>
            <span class="strong">{trade.coin}</span>
            <span class="dim">{TF_LABEL[trade.tf] ?? trade.tf}</span>
            {#if trade.notes}<span class="faint" title="Has notes"><Icon name="edit" size={11} /></span>{/if}
          </td>
          <td>
            {#if trade.followedRules == null}
              <span class="faint">–</span>
            {:else if trade.followedRules}
              <span class="dim">✓</span>
            {:else}
              <span class="amber">✗</span>
            {/if}
          </td>
          <td class="r num strong {sign(trade.r)}">{fmtR(trade.r)}</td>
          <td class="r num {sign(trade.pnl)}">{fmtMoney(trade.pnl, true)}</td>
          <td class="r">
            <button
              type="button"
              class="btn quiet sm square del"
              title="Delete trade"
              aria-label="Delete trade"
              onclick={(event) => remove(event, trade)}
            >
              <Icon name="trash" size={13} />
            </button>
          </td>
        </tr>
        {#if open}
          <tr class="details">
            <td colspan={COLUMNS}>
              <JournalDetail {trade} />
            </td>
          </tr>
        {/if}
      {/each}
    </tbody>
  </table>
{/if}

<style>
  .none {
    padding: 22px;
    text-align: center;
  }

  table {
    width: 100%;
    font-size: 12px;
  }

  th,
  td {
    padding: 6px 10px;
    border-bottom: 1px solid var(--border);
    text-align: left;
    white-space: nowrap;
  }

  th {
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--surface);
    color: var(--text-3);
    font-size: 10.5px;
    font-weight: 500;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  td span {
    display: inline-flex;
    vertical-align: middle;
  }

  .r {
    text-align: right;
  }

  /* Takes the spare width, so the numbers line up at the right. */
  .wide {
    width: 100%;
  }

  .arrow {
    width: 1px;
    padding-right: 0;
  }

  .row {
    cursor: pointer;
    transition: background-color 0.1s;
    /* Clear of the sticky header when scrolled into view. */
    scroll-margin-top: 28px;
  }

  .row:hover {
    background: var(--surface-2);
  }

  .row.open {
    background: var(--accent-soft);
  }

  .row.open td {
    border-bottom-color: transparent;
  }

  .details > td {
    padding: 0;
    white-space: normal;
    background: var(--surface);
    box-shadow: inset 2px 0 0 var(--accent);
  }

  .details {
    scroll-margin-top: 28px;
  }

  .strong {
    font-weight: 600;
  }

  .del {
    width: 22px;
    height: 22px;
    opacity: 0;
  }

  .row:hover .del,
  .del:focus-visible {
    opacity: 1;
  }
</style>
