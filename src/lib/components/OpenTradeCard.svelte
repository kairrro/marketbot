<script lang="ts">
  // The open trade: live R, levels, what has been taken off, and the manual
  // controls. The stop fills by itself, and so does the target when the trade
  // takes profit there; otherwise profit is taken with the buttons.
  import { fmtSize } from '$lib/engine/instruments';
  import { exitsText } from '$lib/engine/journal';
  import { isValidStop, openQty, priceR, targetR } from '$lib/engine/trade';
  import { TF_LABEL, TF_MS } from '$lib/engine/types';
  import { fmtDuration, fmtMoney, fmtPrice, fmtR, sign } from '$lib/format';
  import { replay } from '$lib/state/replay.svelte';
  import { trade } from '$lib/state/trade.svelte';
  import { ui } from '$lib/state/ui.svelte';

  const open = $derived(trade.open);
  const meta = $derived(trade.meta);
  const price = (value: number) => fmtPrice(value, meta?.precision);
  /** Candles of the entry timeframe that have closed since entry. */
  const bars = $derived(meta ? Math.round(trade.elapsedMs / TF_MS[meta.tf]) : 0);
  /** Where the last close sits, in R: what a third taken right now would bank. */
  const nowR = $derived(open && replay.price != null ? priceR(open, replay.price) : null);
  const atEntry = $derived(open != null && open.stop === open.entry);
  /** Breakeven is only a valid stop once price is past entry. */
  const canBreakeven = $derived(
    open != null && !atEntry && replay.price != null && isValidStop(open, open.entry, replay.price)
  );
  /** P/L at the current price, as if closed now. Fees are a cost, so they are shown unsigned. */
  const pnlRows = $derived(
    trade.live
      ? [
          { label: 'Before fees', r: trade.live.grossR, usd: trade.live.gross, cost: false, total: false },
          { label: 'Fees', r: trade.live.feesR, usd: trade.live.fees, cost: true, total: false },
          { label: 'After fees', r: trade.live.netR, usd: trade.live.net, cost: false, total: true }
        ]
      : []
  );
</script>

{#if open && meta}
  <section class="card">
    <div class="head">
      <div>
        <p class="title">
          <span class={open.side === 'long' ? 'pos' : 'neg'}>{open.side === 'long' ? 'Long' : 'Short'}</span>
          {meta.coin}
        </p>
        <p class="dim small">
          Entered on {TF_LABEL[meta.tf]} ·
          {open.pieces > 1 ? `${open.piecesLeft}/${open.pieces} still open` : 'take profit at target'}
        </p>
      </div>
      {#if trade.live}
        <p class="live num {sign(trade.live.netR)}">{fmtR(trade.live.netR)}</p>
      {/if}
    </div>

    {#if pnlRows.length > 0}
      <dl class="pnl" title="As if the rest were closed at the current price, exit fee included">
        {#each pnlRows as row (row.label)}
          <div class:total={row.total}>
            <dt>{row.label}</dt>
            <dd class="num {row.cost ? 'dim' : sign(row.r)}">{row.cost ? `${row.r.toFixed(2)}R` : fmtR(row.r)}</dd>
            <dd class="num {row.cost ? 'dim' : sign(row.usd)}">{fmtMoney(row.usd, !row.cost)}</dd>
          </div>
        {/each}
      </dl>
    {/if}

    <dl class="facts levels">
      <div><dt>Entry</dt><dd class="num">{price(open.entry)}</dd></div>
      <div>
        <dt>Stop{open.stop === open.entry ? ' · breakeven' : ''}</dt>
        <dd class="num">{price(open.stop)}</dd>
      </div>
      <div>
        <dt>+1R{open.reached1R ? ' · reached' : ''}</dt>
        <dd class="num">{price(open.oneR)}</dd>
      </div>
      <div>
        <dt>
          {open.takeProfit ? 'Take profit' : 'Target'} · {targetR(open).toFixed(1)}R{open.reachedTarget ? ' · reached' : ''}
        </dt>
        <dd class="num">{price(open.target)}</dd>
      </div>
    </dl>

    <dl class="facts">
      <div><dt>Risk</dt><dd class="num">{fmtMoney(open.riskUsd)}</dd></div>
      <div><dt>Size</dt><dd class="num">{fmtSize(openQty(open), meta.coin, open.contracts)}</dd></div>
      <div><dt>In trade</dt><dd class="num">{fmtDuration(trade.elapsedMs)}</dd></div>
      <div><dt>Bars</dt><dd class="num">{bars}</dd></div>
    </dl>

    {#if open.fills.length > 0}
      <p class="fills num dim">{exitsText(open.fills, meta.precision)}</p>
    {/if}

    {#if trade.tightStop}
      <p class="note bad">{trade.tightStop}</p>
    {/if}
    {#if trade.slow}
      <p class="note warn">Not at +1R after 1 hour. Your rule says close it.</p>
    {/if}
    {#if trade.riskWidened}
      <p class="note warn">The stop is further away than planned. Risk is wider than 1R.</p>
    {/if}

    <div class="actions">
      {#if open.piecesLeft > 1}
        <button
          type="button"
          class="btn take"
          onclick={() => trade.takePartial(1)}
          title="Close one third of the position at the current candle close"
        >
          Take ⅓
          {#if nowR != null}<span class="num {sign(nowR)}">{fmtR(nowR)}</span>{/if}
        </button>
      {/if}
      <button
        type="button"
        class="btn"
        class:full={open.piecesLeft <= 1}
        onclick={() => trade.closeMarket()}
        title="Close everything that is left at the current candle close"
      >
        {open.pieces === 1 ? 'Close now' : open.piecesLeft < open.pieces ? 'Close the rest' : 'Close all'}
      </button>
      <button
        type="button"
        class="btn"
        class:on={ui.tool === 'moveStop'}
        onclick={() => ui.toggleTool('moveStop')}
        title="Then click the chart. You can also drag the stop line."
      >
        Move stop
      </button>
      <button
        type="button"
        class="btn"
        disabled={!canBreakeven}
        onclick={() => trade.stopToEntry()}
        title={atEntry ? 'The stop is already at entry' : 'Move the stop to the entry price (breakeven)'}
      >
        Stop to entry
      </button>
    </div>
    <p class="faint small">
      {open.takeProfit
        ? 'The stop and the take profit both fill by themselves. Drag either line to move it.'
        : 'Only the stop fills by itself. Take profit when you decide to.'}
    </p>
  </section>
{/if}

<style>
  .card {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
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

  .live {
    font-size: 22px;
    font-weight: 600;
    line-height: 1.1;
  }

  .facts {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 7px 14px;
  }

  /* Prices get a full row each: they can be long (BTC) and must never wrap. */
  .facts.levels {
    grid-template-columns: 1fr;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--border);
  }

  .facts div {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    min-width: 0;
  }

  .facts dt {
    color: var(--text-2);
    font-size: 12px;
    white-space: nowrap;
  }

  .facts dd {
    font-size: 12.5px;
    white-space: nowrap;
  }

  .pnl {
    display: grid;
    grid-template-columns: 1fr auto auto;
    column-gap: 14px;
    row-gap: 5px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--border);
  }

  .pnl div {
    display: grid;
    grid-column: 1 / -1;
    grid-template-columns: subgrid;
    align-items: baseline;
  }

  .pnl dt {
    color: var(--text-2);
    font-size: 12px;
  }

  .pnl dd {
    font-size: 12.5px;
    text-align: right;
    white-space: nowrap;
  }

  .pnl .total dt {
    color: var(--text);
  }

  .pnl .total dd {
    font-weight: 600;
  }

  .fills {
    padding-top: 10px;
    border-top: 1px solid var(--border);
    font-size: 11.5px;
  }

  .actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  .actions .full {
    grid-column: 1 / -1;
  }

  .take .num {
    font-size: 11.5px;
    font-weight: 400;
  }
</style>
