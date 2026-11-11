<script lang="ts">
  // The drafted position: prices, live sizing, rule warnings, Confirm / Cancel.
  // Mirrors the position tool on the chart — editing either updates both.
  import { limitLabel } from '$lib/chart/positionView';
  import { ATR_STOP_MULTS, fmtMult } from '$lib/engine/atr';
  import { fmtSize, snapToTick } from '$lib/engine/instruments';
  import { fmtMoney, fmtPct, fmtPrice } from '$lib/format';
  import { atr } from '$lib/state/atr.svelte';
  import { replay } from '$lib/state/replay.svelte';
  import { sessions } from '$lib/state/sessions.svelte';
  import { trade, type TradeLine } from '$lib/state/trade.svelte';

  const draft = $derived(trade.draft);
  const metrics = $derived(trade.draftMetrics);
  const precision = $derived(replay.precision);
  const step = $derived(1 / 10 ** precision);
  const price = (value: number) => fmtPrice(value, precision);
  /** How far the limit sits from the current price. */
  const awayPct = $derived(
    draft && replay.price ? ((draft.entry - replay.price) / replay.price) * 100 : 0
  );

  const future = $derived(trade.future);
  /** Futures move in ticks (0.25 on NQ), so the arrow keys in a price field do too. */
  const inputStep = $derived(future?.tick ?? step);
  /** Points, without trailing zeros: "15", "12.5". */
  const pts = (value: number) => `${Number(value.toFixed(2))}`;
  const stopPts = $derived(metrics ? Number(metrics.dist.toFixed(2)) : 0);
  const reading = $derived(atr.reading);

  /** Applies a typed price, then shows whatever the draft actually holds (bad values are ignored). */
  function commit(event: Event, line: TradeLine) {
    const input = event.currentTarget as HTMLInputElement;
    const typed = Number(input.value);
    trade.drag(line, future && Number.isFinite(typed) ? snapToTick(typed, future.tick) : typed);
    if (trade.draft) input.value = price(trade.draft[line]);
  }
</script>

{#if draft && metrics}
  <div class="draft">
    <div class="head">
      <span class={draft.side === 'long' ? 'pos' : 'neg'}>
        {trade.limitEntry ? limitLabel(draft.side) : draft.side === 'long' ? 'Long' : 'Short'}
      </span>
      <span>{replay.info?.coin}</span>
      {#if !trade.limitEntry}<span class="num dim">@ {price(draft.entry)}</span>{/if}
    </div>

    {#if future}
      <div class="presets" role="group" aria-label="Stop size in points">
        {#each future.stops as points (points)}
          <button type="button" class="chip num" class:on={stopPts === points} onclick={() => trade.setDraftStopPoints(points)}>
            {pts(points)}
          </button>
        {/each}
        <span class="faint unit">pts</span>
      </div>
    {/if}

    {#if reading}
      <div class="presets" role="group" aria-label="Stop size in ATRs" title="Stop this many ATRs from entry. One ATR is {price(reading.value)}">
        {#each ATR_STOP_MULTS as mult (mult)}
          <button
            type="button"
            class="chip num"
            class:on={Math.abs(metrics.dist - mult * reading.value) <= inputStep}
            onclick={() => trade.setDraftStopAtr(mult)}
          >
            {fmtMult(mult)}
          </button>
        {/each}
        <span class="faint unit">ATR</span>
      </div>
    {/if}

    {#if trade.limitEntry}
      <label class="line">
        <span class="dim">Limit</span>
        <input
          class="inp num"
          type="number"
          step={inputStep}
          value={price(draft.entry)}
          onchange={(event) => commit(event, 'entry')}
          aria-label="Limit price"
        />
        <span class="num dim">{fmtPct(awayPct, 2, true)}</span>
      </label>
    {/if}
    <label class="line">
      <span class="dim">Stop</span>
      <input
        class="inp num"
        type="number"
        step={inputStep}
        value={price(draft.stop)}
        onchange={(event) => commit(event, 'stop')}
        aria-label="Stop price"
      />
      <span class="num neg">{future ? `−${pts(metrics.dist)}` : fmtPct(-metrics.stopPct, 2, true)}</span>
    </label>
    <label class="line">
      <span class="dim">Target</span>
      <input
        class="inp num"
        type="number"
        step={inputStep}
        value={price(draft.target)}
        onchange={(event) => commit(event, 'target')}
        aria-label="Target price"
      />
      <span class="num pos">{future ? `+${pts(Math.abs(draft.target - draft.entry))}` : fmtPct(metrics.targetPct, 2, true)}</span>
    </label>

    <dl class="facts">
      <div><dt>Risk</dt><dd class="num">{fmtMoney(metrics.riskUsd)}</dd></div>
      <div><dt>R:R</dt><dd class="num">{metrics.rr.toFixed(2)}</dd></div>
      <div class="span">
        <dt>Size</dt>
        <dd class="num">
          {fmtSize(metrics.qty, replay.info?.coin ?? '', trade.contract != null)} <span class="faint">· {fmtMoney(metrics.notional)}</span>
        </dd>
      </div>
      {#if reading}
        {@const mult = metrics.dist / reading.value}
        <div
          class="span"
          title="How far the stop is from entry, in ATRs. Under 1×, one ordinary candle can reach it. The ATR is {price(reading.value)} now, {reading.ratio.toFixed(1)}× its usual level"
        >
          <dt>Stop size</dt>
          <dd class="num" class:hot={mult < 1}>{fmtMult(mult)} <span class="faint">· ATR {price(reading.value)}</span></dd>
        </div>
      {/if}
      <div
        class="span"
        title={trade.contract
          ? 'Commission in and out, as a share of the $ risked'
          : `${trade.limitEntry ? 'Maker' : 'Taker'} fee in, taker fee out (a stop or closing by hand), as a share of the $ risked`}
      >
        <dt>Fees (round trip)</dt>
        <dd class="num">{metrics.feesR.toFixed(2)}R <span class="faint">· {fmtMoney(metrics.feesUsd)}</span></dd>
      </div>
    </dl>

    {#if trade.contract && metrics.qty < 1}
      <p class="note bad">
        One contract risks {fmtMoney(metrics.dist * trade.contract.multiplier)} here, more than your {fmtMoney(sessions.riskUsd)}.
        Tighten the stop, raise the risk, or trade the micro contract.
      </p>
    {/if}
    {#if trade.contract?.maxQty && metrics.qty === trade.contract.maxQty && metrics.dist > 0 && sessions.riskUsd >= (metrics.qty + 1) * metrics.dist * trade.contract.multiplier}
      <p class="note">Capped at your max of {trade.contract.maxQty} {trade.contract.maxQty === 1 ? 'contract' : 'contracts'}.</p>
    {/if}
    {#each trade.draftWarnings as warning (warning.code)}
      <p class="note" class:bad={warning.code === 'min-stop'} class:warn={warning.code !== 'min-stop'}>
        {warning.message}
      </p>
    {/each}

    <div class="actions">
      <button type="button" class="btn primary" onclick={() => trade.confirm()}>
        {trade.limitEntry ? 'Place order' : 'Confirm'} <kbd>Enter</kbd>
      </button>
      <button type="button" class="btn" onclick={() => trade.cancel()}>Cancel <kbd>Esc</kbd></button>
    </div>
  </div>
{/if}

<style>
  .draft {
    display: flex;
    flex-direction: column;
    gap: 9px;
  }

  .head {
    display: flex;
    align-items: baseline;
    gap: 6px;
    font-weight: 600;
  }

  .head .num {
    font-weight: 400;
  }

  .line {
    display: grid;
    grid-template-columns: 48px 1fr 62px;
    align-items: center;
    gap: 8px;
  }

  .line .num:last-child {
    text-align: right;
    font-size: 12px;
  }

  .presets {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .presets .chip {
    flex: 1;
    border-radius: var(--radius-sm);
  }

  .presets .unit {
    font-size: 12px;
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

  .facts dd.hot {
    color: var(--amber);
  }

  .actions {
    display: grid;
    grid-template-columns: 1.4fr 1fr;
    gap: 8px;
    margin-top: 2px;
  }

  .actions kbd {
    border-color: transparent;
    background: rgba(255, 255, 255, 0.14);
    color: inherit;
  }
</style>
