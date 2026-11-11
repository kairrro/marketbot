<script lang="ts">
  // The strategy's rules in plain words, written from the numbers the engine
  // runs on. The rules are fixed; only the fee, the risk and the entry hours
  // can be changed here, and results follow at once.
  import { DEFAULTS } from '$lib/engine/auto/types';
  import { auto } from '$lib/state/auto.svelte';
  import Toggle from '../ui/Toggle.svelte';

  type NumberKey =
    | 'feePct'
    | 'riskPct'
    | 'windowFrom'
    | 'windowTo'
    | 'targetPct'
    | 'maxDrawdownPct'
    | 'dailyLossPct'
    | 'monthlyStopR'
    | 'partialR'
    | 'accountSize'
    | 'profitSplitPct';

  interface Field {
    key: NumberKey;
    label: string;
    unit: string;
    step: number;
    title: string;
  }

  const R = DEFAULTS;
  const s = $derived(auto.settings);
  const hour = (h: number) => `${String(h % 24).padStart(2, '0')}:00`;

  const MONTHLY: Field = { key: 'monthlyStopR', label: 'Monthly loss stop', unit: 'R', step: 0.5, title: 'Stop opening trades for the rest of the UTC month once the month is down this many R. 0: never' };
  const PARTIAL: Field = { key: 'partialR', label: 'Calm mode: third off at', unit: 'R', step: 0.5, title: 'When a trade reaches this many R, a third of it is taken off and the stop moves to the entry. 0: off' };
  const FEE: Field = { key: 'feePct', label: 'Fee per side', unit: '%', step: 0.005, title: 'Charged on the entry and again on the exit, as % of the position' };
  const RISK: Field = { key: 'riskPct', label: 'Risk per trade', unit: '%', step: 0.05, title: 'Only used for the % figures in the summary' };
  const TARGET: Field = { key: 'targetPct', label: 'Profit target', unit: '%', step: 0.5, title: 'Account % to gain to pass the challenge' };
  const DRAWDOWN: Field = { key: 'maxDrawdownPct', label: 'Max drawdown', unit: '%', step: 0.5, title: 'Most the account may fall from its starting balance' };
  const DAILY: Field = { key: 'dailyLossPct', label: 'Daily loss', unit: '%', step: 0.5, title: 'Most the account may lose in one UTC day. 0: the firm has no daily limit' };
  const SIZE: Field = { key: 'accountSize', label: 'Account size', unit: '$', step: 1000, title: 'For the funded-account payouts' };
  const SPLIT: Field = { key: 'profitSplitPct', label: 'Your profit split', unit: '%', step: 5, title: 'The share of each payout that is yours' };
  const FROM: Field = { key: 'windowFrom', label: 'From', unit: 'h CT', step: 1, title: 'Entry candles must close at or after this CT hour' };
  const TO: Field = { key: 'windowTo', label: 'Until', unit: 'h CT', step: 1, title: 'and before this CT hour' };
</script>

{#snippet number(field: Field)}
  <label class="field" title={field.title}>
    <span class="dim">{field.label}</span>
    <span class="unit">
      <input class="inp num" type="number" min="0" step={field.step} bind:value={auto.settings[field.key]} />
      <span class="faint">{field.unit}</span>
    </span>
  </label>
{/snippet}

<div class="panel">
  <div>
    <p class="name">Breakout</p>
    <p class="dim summary">The classic channel breakout on {R.tf} candles, with a trailing stop. The rules are fixed.</p>
  </div>

  <section>
    <p class="cap">Entry</p>
    <ul>
      <li>Long: a {R.tf} candle closes above the highest high of the {R.entryLen} candles before it. Enter at that close.</li>
      <li>Short: it closes below the lowest low of the {R.entryLen} candles before it.</li>
      <li>One trade per coin. At most {R.maxOpen} trades open at once across all coins, and {R.maxPerSide} in each direction: coins move together.</li>
      <li>Skip it if the stop is under {R.minStopPct}% of price away.</li>
    </ul>
  </section>

  <section>
    <p class="cap">Stop and exit</p>
    <ul>
      <li>The stop starts at the lowest low (short: highest high) of the last {R.exitLen} candles. That distance is 1R.</li>
      <li>After each close the stop moves up to the lowest low of the last {R.exitLen} candles, if that is higher. It never moves back.</li>
      <li>No target. A touch of the stop exits there, or at the open if it gapped past.</li>
      <li>
        {s.monthlyStopR > 0
          ? `Bad months are stretches of chop. Once the trades closed this month (UTC) are down ${s.monthlyStopR}R, no new trades until the next month. Open trades keep their stops.`
          : 'No monthly loss stop.'}
      </li>
    </ul>
    <ul>
      <li>
        {s.partialR > 0
          ? `Calm mode: at +${s.partialR}R a third of the position is taken off and the stop moves to the entry. More winning trades and slightly shorter losing streaks, but about a third to a half less profit.`
          : 'Calm mode is off: nothing is taken off early.'}
      </li>
    </ul>
    <div class="fields">{@render number(MONTHLY)}{@render number(PARTIAL)}</div>
  </section>

  <section>
    <p class="cap">Entry hours</p>
    <div class="toggles">
      <Toggle checked={s.windowOn} onchange={(on) => (auto.settings.windowOn = on)}>Only enter in set hours</Toggle>
    </div>
    <ul>
      <li>
        {s.windowOn
          ? `Breakouts are only taken when the candle closes between ${hour(s.windowFrom)} and ${hour(s.windowTo)} Chicago time. Exits run at any hour.`
          : 'Breakouts are taken at any hour.'}
      </li>
    </ul>
    {#if s.windowOn}
      <div class="fields">{@render number(FROM)}{@render number(TO)}</div>
    {/if}
  </section>

  <section>
    <p class="cap">Results</p>
    <ul>
      <li>Every trade in R: 1R is the entry-to-stop distance. Fees are taken off every trade's R.</li>
      <li>Drawdown and worst day are also shown as % of the account at the risk below.</li>
    </ul>
    <div class="fields">{@render number(FEE)}{@render number(RISK)}</div>
  </section>

  <section>
    <p class="cap">Prop firm</p>
    <ul>
      <li>Your firm's rules, for the challenge odds and the funded payouts in the results. Daily loss 0 means the firm has none.</li>
    </ul>
    <div class="fields">{@render number(TARGET)}{@render number(DRAWDOWN)}{@render number(DAILY)}{@render number(SIZE)}{@render number(SPLIT)}</div>
  </section>

  {#if auto.settingsError}
    <p class="note err">{auto.settingsError}</p>
  {/if}
</div>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .name {
    font-size: 14px;
    font-weight: 600;
  }

  .summary {
    margin-top: 2px;
    font-size: 12px;
    line-height: 1.45;
  }

  section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  ul {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  li {
    position: relative;
    padding-left: 12px;
    font-size: 12px;
    line-height: 1.45;
  }

  li::before {
    content: '';
    position: absolute;
    top: 7px;
    left: 2px;
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: var(--text-3);
  }

  .fields {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
    font-size: 11.5px;
  }

  .field .inp {
    height: 28px;
    font-size: 12px;
  }

  .unit {
    position: relative;
    display: block;
  }

  .unit .inp {
    padding-right: 54px;
  }

  .unit .faint {
    position: absolute;
    top: 50%;
    right: 8px;
    transform: translateY(-50%);
    font-size: 11px;
    pointer-events: none;
  }

  .toggles {
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-size: 12px;
  }
</style>
