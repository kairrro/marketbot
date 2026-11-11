<script lang="ts">
  // Every trade of an automatic run, in the order they were entered. A row puts the trade on the chart.
  import { EXIT_LABEL } from '$lib/engine/auto/report';
  import { TIME_ZONE, type Trade } from '$lib/engine/auto/types';
  import { fmtDateTime, fmtPrice, fmtR, sign } from '$lib/format';

  let { trades, index, onpick }: { trades: readonly Trade[]; index: number; onpick: (index: number) => void } = $props();

  let rows: HTMLTableRowElement[] = $state([]);
  let scroller: HTMLDivElement;
  let head: HTMLTableSectionElement;

  // Keeps the picked row in view as previous / next step through the list.
  // Only the list scrolls: scrollIntoView would also scroll the page off the chart.
  $effect(() => {
    const row = rows[index];
    if (!row) return;
    const box = scroller.getBoundingClientRect();
    const at = row.getBoundingClientRect();
    const top = box.top + head.offsetHeight;
    if (at.top < top) scroller.scrollTop -= top - at.top;
    else if (at.bottom > box.bottom) scroller.scrollTop += at.bottom - box.bottom;
  });

  const price = (t: Trade, value: number) => fmtPrice(value, t.precision);

  const COLUMNS: { head: string; right?: boolean; cell: (t: Trade) => string; tone?: (t: Trade) => string }[] = [
    { head: 'Entry time (CT)', cell: (t) => fmtDateTime(t.entryTime, TIME_ZONE), tone: () => 'dim' },
    { head: 'Coin', cell: (t) => t.coin },
    { head: 'Side', cell: (t) => (t.side === 'long' ? 'Long' : 'Short'), tone: (t) => (t.side === 'long' ? 'pos' : 'neg') },
    { head: 'Entry', right: true, cell: (t) => price(t, t.entry) },
    { head: 'Stop', right: true, cell: (t) => price(t, t.stop) },
    { head: 'Exit', right: true, cell: (t) => price(t, t.exitPrice) },
    { head: 'Result (R)', right: true, cell: (t) => fmtR(t.r), tone: (t) => sign(t.r) },
    { head: 'Why it exited', cell: (t) => EXIT_LABEL[t.exitReason], tone: () => 'dim' }
  ];
</script>

<section>
  <p class="cap">Trades <span class="sub">· {trades.length} · click one to see it on the chart</span></p>
  <div class="scroll" bind:this={scroller}>
    <table>
      <thead bind:this={head}>
        <tr>
          <th class="r">#</th>
          {#each COLUMNS as column (column.head)}
            <th class:r={column.right}>{column.head}</th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each trades as trade, i (trade.id)}
          <tr
            bind:this={rows[i]}
            class:on={i === index}
            tabindex="0"
            onclick={() => onpick(i)}
            onkeydown={(event) => {
              if (event.key === 'Enter') onpick(i);
            }}
          >
            <td class="r num faint">{trade.id}</td>
            {#each COLUMNS as column (column.head)}
              <td class="{column.right ? 'r num' : ''} {column.tone?.(trade) ?? ''}">{column.cell(trade)}</td>
            {/each}
          </tr>
        {:else}
          <tr><td class="faint" colspan={COLUMNS.length + 1}>No trades with these settings.</td></tr>
        {/each}
      </tbody>
    </table>
  </div>
</section>

<style>
  .sub {
    font-weight: 400;
    letter-spacing: 0;
    text-transform: none;
  }

  .scroll {
    max-height: 460px;
    margin-top: 8px;
    overflow: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius);
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
    background: var(--surface);
    color: var(--text-3);
    font-size: 11px;
    font-weight: 500;
  }

  tbody tr {
    cursor: pointer;
  }

  tbody tr:hover {
    background: var(--surface-2);
  }

  tbody tr.on {
    background: var(--accent-soft);
  }

  .r {
    text-align: right;
  }
</style>
