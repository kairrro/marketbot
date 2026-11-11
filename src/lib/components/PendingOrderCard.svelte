<script lang="ts">
  // A limit entry waiting to fill: its prices (editable here or by dragging the
  // lines on the chart), what it will risk, and Cancel.
  import { limitLabel } from '$lib/chart/positionView';
  import { fmtSize } from '$lib/engine/instruments';
  import { TF_LABEL } from '$lib/engine/types';
  import { fmtMoney, fmtPct, fmtPrice } from '$lib/format';
  import { replay } from '$lib/state/replay.svelte';
  import { trade, type TradeLine } from '$lib/state/trade.svelte';

  const order = $derived(trade.pending);
  const meta = $derived(trade.meta);
  const metrics = $derived(trade.pendingMetrics);
  const precision = $derived(meta?.precision ?? replay.precision);
  const step = $derived(1 / 10 ** precision);
  const price = (value: number) => fmtPrice(value, precision);
  /** How far price still has to travel to fill it. */
  const awayPct = $derived(order && replay.price ? ((order.entry - replay.price) / replay.price) * 100 : 0);

  const lines: { line: TradeLine; label: string }[] = [
    { line: 'entry', label: 'Limit' },
    { line: 'stop', label: 'Stop' },
    { line: 'target', label: 'Target' }
  ];

  /** Applies a typed price, then shows whatever the order actually holds (bad values are ignored). */
  function commit(event: Event, line: TradeLine) {
    const input = event.currentTarget as HTMLInputElement;
    trade.movePending(line, Number(input.value));
    if (trade.pending) input.value = price(trade.pending[line]);
  }
</script>

{#if order && meta && metrics}
  <section class="card">
    <div>
      <p class="title">
        <span class={order.side === 'long' ? 'pos' : 'neg'}>{limitLabel(order.side)}</span>
        {meta.coin}
      </p>
      <p class="dim small">
        Waiting to fill · placed on {TF_LABEL[meta.tf]} · <span class="num">{fmtPct(awayPct, 2, true)}</span> from price
      </p>
    </div>

    {#each lines as row (row.line)}
      <label class="line">
        <span class="dim">{row.label}</span>
        <input
          class="inp num"
          type="number"
          {step}
          value={price(order[row.line])}
          onchange={(event) => commit(event, row.line)}
          aria-label="{row.label} price"
        />
      </label>
    {/each}

    <dl class="facts">
      <div><dt>R:R</dt><dd class="num">{metrics.rr.toFixed(2)}</dd></div>
      <div><dt>Risk</dt><dd class="num">{fmtMoney(metrics.riskUsd)}</dd></div>
      <div class="span"><dt>Size</dt><dd class="num">{fmtSize(metrics.qty, meta.coin, order.contract != null)}</dd></div>
      <div
        class="span"
        title={order.contract
          ? 'Commission in and out, as a share of the $ risked'
          : 'Maker fee in, taker fee out (a stop or closing by hand), as a share of the $ risked'}
      >
        <dt>Fees (round trip)</dt>
        <dd class="num">{metrics.feesR.toFixed(2)}R <span class="faint">· {fmtMoney(metrics.feesUsd)}</span></dd>
      </div>
    </dl>

    {#each trade.pendingWarnings as warning (warning.code)}
      <p class="note" class:bad={warning.code === 'min-stop'} class:warn={warning.code !== 'min-stop'}>
        {warning.message}
      </p>
    {/each}

    <button type="button" class="btn" onclick={() => trade.cancelPending()}>Cancel order</button>
    <p class="faint small">
      Fills at your limit when a candle trades there. Drag the lines on the chart to move it. The $ risk stays the
      same, so the size follows the stop.
    </p>
  </section>
{/if}

<style>
  .card {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .title {
    font-size: 14px;
    font-weight: 600;
  }

  .small {
    margin-top: 1px;
    font-size: 11.5px;
  }

  .line {
    display: grid;
    grid-template-columns: 48px 1fr;
    align-items: center;
    gap: 8px;
  }

  .facts {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px 14px;
    margin: 2px 0;
  }

  .facts div {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
  }

  .facts .span {
    grid-column: 1 / -1;
  }

  .facts dt {
    color: var(--text-2);
    font-size: 12px;
  }

  .facts dd {
    font-size: 12.5px;
  }
</style>
