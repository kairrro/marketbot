<script lang="ts">
  // Your own trades, replayed through a prop firm's evaluation at different risks per trade:
  // how often it passes, how often it is blown, and how long it takes. A table is the answer,
  // the rules behind it are one click away.
  import { onMount } from 'svelte';
  import { simulateEval, tradingDays, EVAL_DAYS, EVAL_RUNS } from '$lib/engine/evalSim';
  import type { TradeRecord } from '$lib/engine/journal';
  import { fmtMoney } from '$lib/format';
  import { display } from '$lib/state/display.svelte';
  import { evalRules } from '$lib/state/evalRules.svelte';
  import { zonedDay } from '$lib/timezone';
  import Toggle from './ui/Toggle.svelte';

  let { trades, riskNow }: { trades: readonly TradeRecord[]; riskNow: number } = $props();

  /** Risks tried, in % of the account. The session's own risk is added to them. */
  const LEVELS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3];
  const MIN_TRADES = 10;
  const MIN_DAYS = 5;

  onMount(() => void evalRules.load());

  const rules = $derived(evalRules.rules);
  const days = $derived(tradingDays(trades, (ms) => zonedDay(ms, display.timeZone)));
  const enough = $derived(trades.length >= MIN_TRADES && days.length >= MIN_DAYS);

  const rows = $derived.by(() => {
    if (!enough) return [];
    const usd = LEVELS.map((pct) => (pct / 100) * rules.accountSize);
    // The session's own risk replaces the level it is within a twentieth of, or sits between them.
    const near = usd.findIndex((v) => Math.abs(v - riskNow) / v < 0.05);
    const list = usd.map((riskUsd, i) => ({ riskUsd, now: i === near }));
    if (near < 0 && riskNow > 0) list.push({ riskUsd: riskNow, now: true });
    list.sort((a, b) => a.riskUsd - b.riskUsd);
    return list.map((row) => ({ ...row, pct: (row.riskUsd / rules.accountSize) * 100, odds: simulateEval(days, row.riskUsd, rules) }));
  });
  // The fastest of the risks that pass about as often as any (within a point of the best): more risk
  // than that only adds blown accounts, less only adds days.
  const best = $derived.by(() => {
    const top = Math.max(0, ...rows.map((row) => row.odds.passed));
    const close = rows.filter((row) => row.odds.passed >= top - 0.01);
    return close.reduce<(typeof rows)[number] | null>(
      (fastest, row) => (!fastest || (row.odds.medianDays ?? Infinity) < (fastest.odds.medianDays ?? Infinity) ? row : fastest),
      null
    );
  });

  const share = (x: number) => `${Math.round(x * 100)}%`;
  const money = (x: number) => fmtMoney(x).replace(/\.00$/, '');
  const pctText = (pct: number) => `${Number(pct.toFixed(2))}%`;
  const summary = $derived(
    `${money(rules.accountSize)} · +${rules.targetPct}% target · ${rules.maxDrawdownPct}% ${rules.trailing ? 'trailing' : 'fixed'} drawdown · ${
      rules.dailyLossPct > 0 ? `${rules.dailyLossPct}% daily loss` : 'no daily limit'
    }`
  );

  function setNumber(key: 'accountSize' | 'targetPct' | 'maxDrawdownPct' | 'dailyLossPct', event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const value = Number(input.value);
    const ok = input.value.trim() !== '' && Number.isFinite(value) && (key === 'dailyLossPct' ? value >= 0 : value > 0);
    if (ok) evalRules.update({ [key]: value });
    input.value = String(evalRules.rules[key]);
  }
</script>

<section>
  <p class="cap">Prop eval odds <span class="sub">· your trades, replayed day by day through the firm's rules</span></p>

  {#if !enough}
    <p class="note">Needs at least {MIN_TRADES} trades over {MIN_DAYS} different days. This session has {trades.length} over {days.length}.</p>
  {:else}
    <details class="rules">
      <summary><span class="dim">Rules</span> <span class="num">{summary}</span></summary>
      <div class="fields">
        <label>
          <span class="dim">Account</span>
          <span class="unit"><input class="inp num" type="number" min="1" step="1000" value={rules.accountSize} onchange={(e) => setNumber('accountSize', e)} /><span class="faint">$</span></span>
        </label>
        <label>
          <span class="dim">Profit target</span>
          <span class="unit"><input class="inp num" type="number" min="0" step="0.5" value={rules.targetPct} onchange={(e) => setNumber('targetPct', e)} /><span class="faint">%</span></span>
        </label>
        <label>
          <span class="dim">Max drawdown</span>
          <span class="unit"><input class="inp num" type="number" min="0" step="0.5" value={rules.maxDrawdownPct} onchange={(e) => setNumber('maxDrawdownPct', e)} /><span class="faint">%</span></span>
        </label>
        <label title="0 means the firm has no daily loss limit">
          <span class="dim">Daily loss</span>
          <span class="unit"><input class="inp num" type="number" min="0" step="0.5" value={rules.dailyLossPct} onchange={(e) => setNumber('dailyLossPct', e)} /><span class="faint">%</span></span>
        </label>
        <div class="toggle" title="On: the drawdown limit rises with your best balance and stops at the starting balance. Off: it stays fixed below the start.">
          <Toggle checked={rules.trailing} onchange={(on) => evalRules.update({ trailing: on })}>Trailing drawdown</Toggle>
        </div>
      </div>
    </details>

    <table>
      <thead>
        <tr>
          <th>Risk per trade</th>
          <th class="r">Passed</th>
          <th class="r">Blown</th>
          <th class="r">Not done</th>
          <th class="r">Median days</th>
        </tr>
      </thead>
      <tbody>
        {#each rows as row (row.riskUsd)}
          <tr class:best={row === best}>
            <td>
              <span class="num">{money(row.riskUsd)}</span>
              <span class="faint num">· {pctText(row.pct)}</span>
              {#if row.now}<span class="tag">now</span>{/if}
              {#if row === best}
                <span class="tag top" title="Passes about as often as any risk here, and gets there fastest">best</span>
              {/if}
            </td>
            <td class="r num strong pos">{share(row.odds.passed)}</td>
            <td class="r num {row.odds.blown > 0.005 ? 'neg' : 'faint'}">{share(row.odds.blown)}</td>
            <td class="r num dim">{share(row.odds.open)}</td>
            <td class="r num">{row.odds.medianDays ?? '–'}</td>
          </tr>
        {/each}
      </tbody>
    </table>

    <p class="faint foot">
      From your {trades.length} trades over {days.length} days; {EVAL_RUNS.toLocaleString('en-US')} runs per row, up to {EVAL_DAYS} trading days each.
      "Not done" is neither by then. Closed trades only, so a real account's drawdown is a little tighter: check your firm's own rules.
      {#if days.length < 15}<span class="amber">Few days of data, so the odds are rough.</span>{/if}
    </p>
  {/if}
</section>

<style>
  .sub {
    font-weight: 400;
    letter-spacing: 0;
    text-transform: none;
  }

  .rules {
    margin-top: 8px;
  }

  summary {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 10px;
    cursor: pointer;
    font-size: 12px;
    list-style: none;
  }

  summary::-webkit-details-marker {
    display: none;
  }

  summary::after {
    content: '▸ edit';
    color: var(--text-3);
  }

  details[open] > summary::after {
    content: '▾';
  }

  .fields {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 8px 12px;
    margin-top: 8px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface-2);
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 11.5px;
  }

  .unit {
    position: relative;
  }

  .unit .inp {
    padding-right: 24px;
  }

  .unit .faint {
    position: absolute;
    top: 50%;
    right: 9px;
    transform: translateY(-50%);
    font-size: 12px;
    pointer-events: none;
  }

  .toggle {
    align-self: end;
    padding-bottom: 6px;
    font-size: 12px;
  }

  table {
    width: 100%;
    margin-top: 8px;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
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

  tr.best {
    background: var(--green-soft);
  }

  .r {
    text-align: right;
  }

  .strong {
    font-weight: 600;
  }

  .tag {
    margin-left: 4px;
    padding: 0 7px;
    border: 1px solid var(--border);
    border-radius: 999px;
    color: var(--text-2);
    font-size: 10.5px;
  }

  .tag.top {
    border-color: transparent;
    background: var(--green-soft);
    color: var(--green);
  }

  .foot {
    margin-top: 6px;
    font-size: 11.5px;
    line-height: 1.5;
  }
</style>
