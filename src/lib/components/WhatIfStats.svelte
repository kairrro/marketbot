<script lang="ts">
  // How the session's trades would have done with a fixed take profit at other
  // R multiples, from the same entries and stops, and how far price went for
  // and against them while they were open. Read from the session's saved candles.
  import { untrack } from 'svelte';
  import type { TradeRecord } from '$lib/engine/journal';
  import { TIME_RULE_MS } from '$lib/engine/rules';
  import { TF_MS } from '$lib/engine/types';
  import { tradeWhatIf, whatIfRows, type Excursion } from '$lib/engine/whatIf';
  import { fmtR, sign } from '$lib/format';
  import { journalCandles, type TradeCandles } from '$lib/state/journalCandles';
  import { sessions } from '$lib/state/sessions.svelte';
  import { ui } from '$lib/state/ui.svelte';
  import Toggle from './ui/Toggle.svelte';

  let found = $state.raw<{ trade: TradeRecord; data: TradeCandles }[] | null>(null);

  // Read again when a trade is added or removed, not on every note typed.
  const key = $derived(`${sessions.activeId}|${sessions.trades.map((t) => t.id).join()}`);
  $effect(() => {
    void key;
    let cancelled = false;
    void untrack(() => journalCandles($state.snapshot(sessions.trades) as TradeRecord[])).then((result) => {
      if (!cancelled) found = result;
    });
    return () => {
      cancelled = true;
    };
  });

  const analysed = $derived(
    (found ?? [])
      .map(({ trade, data }) => ({
        trade,
        feesR: trade.riskUsd > 0 ? trade.fees / trade.riskUsd : 0,
        whatIf: tradeWhatIf(trade, data.after, TF_MS[data.tf], ui.whatIfTimeRule ? TIME_RULE_MS : null)
      }))
      .filter((item) => item.whatIf.outcomes.length > 0)
  );
  const rows = $derived(whatIfRows(analysed));
  const best = $derived(rows.reduce((top, row) => (row.totalR > top.totalR ? row : top), rows[0]));
  const actualR = $derived(analysed.reduce((total, item) => total + item.trade.r, 0));
  const actualWin = $derived(analysed.length ? (analysed.filter((item) => item.trade.r > 0).length / analysed.length) * 100 : 0);
  const excursions = $derived(analysed.map((item) => item.whatIf.excursion).filter((e): e is Excursion => e != null));
  const avg = (values: number[]) => values.reduce((total, v) => total + v, 0) / values.length;
  const open = $derived(Math.max(0, ...rows.map((row) => row.open)));
  const missing = $derived(sessions.trades.length - analysed.length);
</script>

<section class="whatif">
  <p class="cap">What if <span class="sub">· same entries and stops, after fees</span></p>
  {#if found === null}
    <p class="note">Reading candles…</p>
  {:else if analysed.length === 0}
    <p class="note">No trades with candles in this session yet.</p>
  {:else}
    <table>
      <thead>
        <tr>
          <th>Take profit</th>
          <th class="r">Win</th>
          <th class="r">Avg</th>
          <th class="r">Total</th>
        </tr>
      </thead>
      <tbody>
        <tr class="actual">
          <td>What you did</td>
          <td class="r num">{actualWin.toFixed(0)}%</td>
          <td class="r num {sign(actualR)}">{fmtR(actualR / analysed.length)}</td>
          <td class="r num {sign(actualR)}">{fmtR(actualR)}</td>
        </tr>
        {#each rows as row (row.targetR)}
          <tr class:best={row === best && row.totalR > 0}>
            <td>At {row.targetR}R</td>
            <td class="r num">{row.winRate == null ? '–' : `${row.winRate.toFixed(0)}%`}</td>
            <td class="r num {sign(row.avgR ?? 0)}">{row.avgR == null ? '–' : fmtR(row.avgR)}</td>
            <td class="r num {sign(row.totalR)}">{fmtR(row.totalR)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
    {#if excursions.length > 0}
      <p class="foot">
        While open, price went <span class="num pos">+{avg(excursions.map((e) => e.mfe)).toFixed(2)}R</span> for you and
        <span class="num neg">−{avg(excursions.map((e) => e.mae)).toFixed(2)}R</span> against you on average.
      </p>
    {/if}
    <p class="foot faint">
      {analysed.length} trade{analysed.length === 1 ? '' : 's'}{missing > 0 ? ` (${missing} without candles left out)` : ''}.
      {#if open > 0}Up to {open} not settled by the replay time, counted at the last price.{/if}
      Stop first when a candle hits both.
    </p>
    <Toggle checked={ui.whatIfTimeRule} onchange={(checked) => (ui.whatIfTimeRule = checked)}>
      <span class="small">Close by the 1-hour rule</span>
    </Toggle>
  {/if}
</section>

<style>
  .whatif {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .sub {
    font-weight: 400;
    letter-spacing: 0;
    text-transform: none;
  }

  table {
    width: 100%;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    font-size: 12px;
  }

  th,
  td {
    padding: 6px 10px;
    text-align: left;
    white-space: nowrap;
  }

  th {
    color: var(--text-3);
    font-size: 10.5px;
    font-weight: 500;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  tbody tr {
    border-top: 1px solid var(--border);
  }

  .actual td {
    background: var(--surface-2);
    color: var(--text-2);
  }

  .best td:first-child {
    color: var(--accent-hover);
    font-weight: 600;
  }

  .r {
    text-align: right;
  }

  .foot {
    font-size: 11.5px;
    line-height: 1.45;
    color: var(--text-2);
  }

  .small {
    font-size: 12px;
  }
</style>
