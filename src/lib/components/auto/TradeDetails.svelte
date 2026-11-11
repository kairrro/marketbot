<script lang="ts">
  // Why the picked trade was taken and how it ended, with the numbers the run had at that moment.
  import { EXIT_LABEL } from '$lib/engine/auto/report';
  import { TIME_ZONE, type BreakoutSettings, type Trade } from '$lib/engine/auto/types';
  import { TF_MS } from '$lib/engine/types';
  import { fmtDayTime, fmtDuration, fmtPrice, fmtR, sign } from '$lib/format';

  let { trade, settings }: { trade: Trade; settings: BreakoutSettings } = $props();

  const p = (price: number) => fmtPrice(price, trade.precision);
  const at = (ms: number) => fmtDayTime(ms, TIME_ZONE);

  const rows = $derived.by(() => {
    const t = trade;
    const long = t.side === 'long';
    const bar = TF_MS[settings.tf];
    const risk = Math.abs(t.entry - t.stop);
    const last = t.trail.at(-1);
    return [
      {
        label: 'Breakout',
        value: `The ${at(t.signalTime)} candle closed at ${p(t.entry)}, ${long ? 'above' : 'below'} the ${long ? 'highest high' : 'lowest low'} ${p(t.breakoutLevel)} of the ${settings.entryLen} candles before it`
      },
      {
        label: 'Stop',
        value: `${p(t.stop)}, the ${long ? 'lowest low' : 'highest high'} of the last ${settings.exitLen} candles. 1R = ${p(risk)} (${((risk / t.entry) * 100).toFixed(2)}% of price)`
      },
      {
        label: 'Trailing',
        value: last ? `Moved ${t.trail.length} time${t.trail.length === 1 ? '' : 's'}, to ${p(last.stop)} after the ${at(last.time - bar)} candle` : 'Never moved'
      },
      ...(t.partial
        ? [{ label: 'Third off', value: `Taken at ${p(t.partial.price)} (+${((Math.abs(t.partial.price - t.entry)) / risk).toFixed(2)}R) after the ${at(t.partial.time - bar)} candle, and the stop moved to the entry` }]
        : []),
      {
        label: 'Exit',
        value: `${EXIT_LABEL[t.exitReason]} at ${p(t.exitPrice)}${t.partial ? ' for the rest' : ''}, the ${at(t.exitTime - bar)} candle, ${fmtDuration(t.exitTime - t.entryTime)} after entry`
      },
      {
        label: 'Result',
        value: `${fmtR(t.grossR)} before fees, ${fmtR(-t.feeR)} fees (${settings.feePct}% each way) = ${fmtR(t.r)}`
      }
    ];
  });
</script>

<div class="details">
  <p class="title">
    <span class="num faint">#{trade.id}</span>
    <span class={trade.side === 'long' ? 'pos' : 'neg'}>{trade.side === 'long' ? 'Long' : 'Short'}</span>
    <span>{trade.coin}</span>
    <span class="num dim">{at(trade.entryTime)} → {at(trade.exitTime)} CT</span>
    <span class="num r {sign(trade.r)}">{fmtR(trade.r)}</span>
  </p>
  <dl>
    {#each rows as row (row.label)}
      <div>
        <dt>{row.label}</dt>
        <dd class="num">{row.value}</dd>
      </div>
    {/each}
  </dl>
</div>

<style>
  .details {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .title {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0 8px;
    font-size: 13px;
    font-weight: 600;
  }

  .title .dim {
    font-size: 12px;
    font-weight: 400;
  }

  .r {
    margin-left: auto;
    font-size: 15px;
  }

  dl {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 6px 20px;
  }

  dl div {
    display: flex;
    flex-direction: column;
    min-width: 0;
    font-size: 12px;
    line-height: 1.4;
  }

  dt {
    color: var(--text-3);
    font-size: 11px;
  }

  dd {
    color: var(--text);
    font-size: 11.5px;
  }
</style>
