<script lang="ts">
  // A journaled trade opened up under its row in the journal: the screenshot
  // taken when it closed, the numbers and the journal fields, side by side.
  import { untrack } from 'svelte';
  import { fmtSize, futuresFor } from '$lib/engine/instruments';
  import { exitsText, type TradeRecord } from '$lib/engine/journal';
  import { TIME_RULE_MS } from '$lib/engine/rules';
  import { TF_MS } from '$lib/engine/types';
  import { tradeWhatIf, WHAT_IF_TARGETS, type Outcome } from '$lib/engine/whatIf';
  import { fmtDuration, fmtMoney, fmtPrice, fmtR, sign } from '$lib/format';
  import { fmtTime } from '$lib/state/display.svelte';
  import { tradeCandles, type TradeCandles } from '$lib/state/journalCandles';
  import { ui } from '$lib/state/ui.svelte';
  import Screenshot from './Screenshot.svelte';
  import TradeForm from './TradeForm.svelte';

  let { trade }: { trade: TradeRecord } = $props();

  /** The session's candles after the entry, for the what-if numbers. Null when it no longer holds them. */
  let data = $state.raw<TradeCandles | null | undefined>(undefined);

  $effect(() => {
    const current = trade;
    let cancelled = false;
    data = undefined;
    void untrack(() => tradeCandles(current)).then((found) => {
      if (!cancelled) data = found;
    });
    return () => {
      cancelled = true;
    };
  });

  const whatIf = $derived(
    data ? tradeWhatIf(trade, data.after, TF_MS[data.tf], ui.whatIfTimeRule ? TIME_RULE_MS : null) : null
  );
  const feesR = $derived(trade.riskUsd > 0 ? trade.fees / trade.riskUsd : 0);
  const OUTCOME_TITLE: Record<Outcome['kind'], string> = {
    target: 'Take profit hit',
    stop: 'Stopped out',
    time: 'Closed by the 1-hour rule',
    open: 'Not settled by the replay time: counted at the last price'
  };

  const price = (value: number) => fmtPrice(value, trade.precision);
  const plannedR = $derived.by(() => {
    const risk = Math.abs(trade.entry - trade.stop);
    return risk > 0 ? `${(Math.abs(trade.target - trade.entry) / risk).toFixed(1)}R` : '–';
  });
</script>

<div class="wrap">
  <div class="detail">
    <div class="visual">
      <Screenshot tradeId={trade.id} available={trade.hasScreenshot} />
    </div>

    <div class="col">
      <p class="num dim small">
        {fmtTime(trade.entryTime)} → {fmtTime(trade.exitTime)} · {fmtDuration(trade.exitTime - trade.entryTime)}
      </p>
      <dl class="facts">
        <div><dt>Entry</dt><dd class="num">{price(trade.entry)}</dd></div>
        <div><dt>Risk</dt><dd class="num">{fmtMoney(trade.riskUsd)}</dd></div>
        <div><dt>Stop</dt><dd class="num">{price(trade.stop)}</dd></div>
        <div><dt>Size</dt><dd class="num">{fmtSize(trade.qty, trade.coin, futuresFor(trade.source, trade.coin) != null)}</dd></div>
        <div><dt>Target</dt><dd class="num">{price(trade.target)} <span class="dim">({plannedR})</span></dd></div>
        <div><dt>Fees</dt><dd class="num">{fmtMoney(trade.fees)}</dd></div>
        <div class="span"><dt>Exits</dt><dd class="num">{exitsText(trade.exits, trade.precision)}</dd></div>
        {#if whatIf?.excursion}
          <div title="Furthest price went your way while the trade was open (MFE)">
            <dt>Max for</dt><dd class="num pos">+{whatIf.excursion.mfe.toFixed(2)}R</dd>
          </div>
          <div title="Furthest price went against you while the trade was open (MAE)">
            <dt>Max against</dt><dd class="num neg">−{whatIf.excursion.mae.toFixed(2)}R</dd>
          </div>
        {/if}
      </dl>

      {#if whatIf && whatIf.outcomes.length > 0}
        <div class="whatif">
          <p class="cap">
            With TP at <span class="sub">· after fees{ui.whatIfTimeRule ? ', 1-hour rule' : ''}</span>
          </p>
          <ul>
            {#each WHAT_IF_TARGETS as target, i (target)}
              {@const outcome = whatIf.outcomes[i]}
              <li title={OUTCOME_TITLE[outcome.kind]}>
                <span class="dim">{target}R</span>
                <span class="num {sign(outcome.r - feesR)}">{fmtR(outcome.r - feesR)}</span>
                {#if outcome.kind === 'open' || outcome.kind === 'time'}<span class="faint kind">{outcome.kind}</span>{/if}
              </li>
            {/each}
          </ul>
        </div>
      {/if}
    </div>

    <div class="col">
      <TradeForm {trade} />
    </div>
  </div>
</div>

<style>
  .wrap {
    container-type: inline-size;
  }

  .detail {
    display: grid;
    grid-template-columns: minmax(0, 1.4fr) repeat(2, minmax(0, 1fr));
    height: 300px;
  }

  .visual {
    min-height: 0;
    padding: 12px;
  }

  /* The screenshot fits the row's height rather than setting it. */
  .visual :global(.shot),
  .visual :global(.shot a) {
    height: 100%;
  }

  .visual :global(.shot img) {
    height: 100%;
    object-fit: contain;
  }

  .col {
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-height: 0;
    overflow-y: auto;
    padding: 12px 14px;
    border-left: 1px solid var(--border);
  }

  .small {
    font-size: 11.5px;
  }

  .facts {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px 16px;
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
    font-size: 12px;
    text-align: right;
  }

  .whatif {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .sub {
    font-weight: 400;
    letter-spacing: 0;
    text-transform: none;
  }

  .whatif ul {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 1px;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--border);
  }

  .whatif li {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 5px 4px;
    background: var(--surface-2);
    font-size: 11.5px;
  }

  .kind {
    font-size: 10px;
  }

  /* Too narrow for three columns: the screenshot and the numbers on top, the form under them. */
  @container (max-width: 900px) {
    .detail {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      height: auto;
    }

    .visual {
      height: 240px;
    }

    .col {
      overflow: visible;
    }

    .col:nth-child(n + 3) {
      border-top: 1px solid var(--border);
    }

    .col:nth-child(3) {
      grid-column: 1 / -1;
      border-left: 0;
    }
  }

  @container (max-width: 560px) {
    .detail {
      grid-template-columns: minmax(0, 1fr);
    }

    .col {
      border-left: 0;
      border-top: 1px solid var(--border);
    }
  }
</style>
