<script lang="ts">
  // Results of an automatic run: the summary, a line per coin, the chart on
  // the picked trade with previous / next, why that trade was taken, and the trade list.
  import { autoCsv, challenge, funded, monthly } from '$lib/engine/auto/report';
  import { utcDay, type CalendarEntry } from '$lib/engine/calendar';
  import { TIME_ZONE, type SkipReason } from '$lib/engine/auto/types';
  import { TF_MS } from '$lib/engine/types';
  import { fmtDate, fmtR, sign } from '$lib/format';
  import { auto } from '$lib/state/auto.svelte';
  import { download } from '$lib/state/files';
  import EquityCurve from '../EquityCurve.svelte';
  import PnlCalendar from '../PnlCalendar.svelte';
  import Icon from '../ui/Icon.svelte';
  import AutoChart from './AutoChart.svelte';
  import AutoTrades from './AutoTrades.svelte';
  import MonthlyGrid from './MonthlyGrid.svelte';
  import TradeDetails from './TradeDetails.svelte';

  const SKIPS: { id: SkipReason; label: string }[] = [
    { id: 'monthly stop', label: 'the month was down by the monthly stop' },
    { id: 'too many open', label: 'too many trades open' },
    { id: 'outside hours', label: 'outside the entry hours' },
    { id: 'tiny stop', label: 'stop too tight' }
  ];

  const stats = $derived(auto.stats);
  const ran = $derived(auto.ran);
  const trades = $derived(auto.trades);
  const risk = $derived(auto.settings.riskPct);
  const dash = '–';
  const pct = (r: number) => `${(r * risk).toFixed(1)}%`;

  const tiles = $derived(
    stats
      ? [
          { label: 'Total trades', value: String(stats.trades), tone: '' },
          { label: 'Win rate', value: stats.winRate == null ? dash : `${stats.winRate.toFixed(1)}%`, tone: '' },
          { label: 'Total R after fees', value: fmtR(stats.totalR), tone: sign(stats.totalR) },
          { label: 'Average R per trade', value: stats.avgR == null ? dash : fmtR(stats.avgR), tone: sign(stats.avgR ?? 0) },
          { label: 'Trades per month', value: stats.tradesPerMonth.toFixed(1), tone: '' },
          { label: 'Longest losing streak', value: String(stats.losingStreak), tone: '' },
          { label: 'Biggest drawdown', value: `${stats.maxDrawdownR.toFixed(2)}R · ${pct(stats.maxDrawdownR)}`, tone: stats.maxDrawdownR > 0 ? 'neg' : '' },
          { label: 'Worst day', value: `${fmtR(stats.worstDayR)} · ${pct(stats.worstDayR)}`, tone: stats.worstDayR < 0 ? 'neg' : '' },
          { label: 'Months up', value: `${((stats.monthsUp / Math.max(1, stats.months)) * 100).toFixed(0)}% · ${stats.monthsUp} of ${stats.months}`, tone: '' },
          { label: 'Worst month', value: `${fmtR(stats.worstMonthR)} · ${pct(stats.worstMonthR)}`, tone: stats.worstMonthR < 0 ? 'neg' : '' }
        ]
      : []
  );
  const months = $derived(auto.result ? monthly(trades, auto.result.from, auto.result.to) : []);
  /** The dollars and % are the R at the account's size and risk per trade. */
  const calendar = $derived<CalendarEntry[]>(
    trades.map((t) => ({
      time: t.exitTime,
      r: t.r,
      usd: (t.r * risk * auto.settings.accountSize) / 100,
      pct: t.r * risk,
      label: `${t.coin} ${t.side}`
    }))
  );
  const odds = $derived(
    auto.result
      ? challenge(trades, auto.result.from, auto.result.to, {
          targetPct: auto.settings.targetPct,
          maxDrawdownPct: auto.settings.maxDrawdownPct,
          dailyLossPct: auto.settings.dailyLossPct,
          riskPct: auto.settings.riskPct
        })
      : null
  );
  const payouts = $derived(
    auto.result
      ? funded(trades, auto.result.from, auto.result.to, {
          accountSize: auto.settings.accountSize,
          splitPct: auto.settings.profitSplitPct,
          maxDrawdownPct: auto.settings.maxDrawdownPct,
          dailyLossPct: auto.settings.dailyLossPct,
          riskPct: auto.settings.riskPct
        })
      : null
  );
  const share = (n: number, of: number) => `${((n / Math.max(1, of)) * 100).toFixed(0)}%`;
  const money = (x: number) => `$${Math.round(x).toLocaleString('en-US')}`;
  const dailyText = $derived(auto.settings.dailyLossPct > 0 ? `${auto.settings.dailyLossPct}% daily loss` : 'no daily loss limit');
  const skipped = $derived(
    auto.result ? SKIPS.filter((s) => auto.result!.skipped[s.id]).map((s) => `${auto.result!.skipped[s.id]} × ${s.label}`) : []
  );
  const day = (ms: number) => fmtDate(ms, TIME_ZONE);

  function exportCsv() {
    if (!ran || trades.length === 0) return;
    const coins = auto.coinStats.map((c) => c.coin).join('-');
    const name = `breakout-${coins}-${ran.tf}-${new Date(ran.from).toISOString().slice(0, 10)}-${new Date(ran.to).toISOString().slice(0, 10)}`;
    download(`${name.toLowerCase()}.csv`, autoCsv(trades), 'text/csv');
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.target instanceof HTMLElement && event.target.closest('input, select, textarea')) return;
    if (event.key === 'ArrowLeft') auto.step(-1);
    else if (event.key === 'ArrowRight') auto.step(1);
    else return;
    event.preventDefault();
  }
</script>

<svelte:window {onkeydown} />

{#if auto.error}
  <p class="note err">{auto.error}</p>
{/if}

{#if auto.running}
  <div class="progress" role="progressbar" aria-valuenow={Math.round(auto.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
    <span style:width="{auto.progress * 100}%"></span>
  </div>
  <p class="dim small">Downloading Binance candles. They are kept, so the next run over the same dates starts at once.</p>
{/if}

{#if auto.result && stats && ran}
  <div class="stack">
    <div class="head">
      <p>
        <span class="strong">{auto.coinStats.map((c) => c.coin).join(', ')}</span>
        <span class="dim">Breakout · {day(ran.from)} – {day(ran.to - 1)} · {ran.tf} Binance · times in CT</span>
      </p>
      <button type="button" class="btn" onclick={exportCsv} disabled={trades.length === 0}>
        <Icon name="download" />Export CSV
      </button>
    </div>

    <div class="summary">
      <div>
        <dl class="tiles">
          {#each tiles as tile (tile.label)}
            <div>
              <dt>{tile.label}</dt>
              <dd class="num {tile.tone}">{tile.value}</dd>
            </div>
          {/each}
        </dl>
        <p class="faint small lines">
          Before fees {fmtR(stats.grossR)}. First half of the dates {fmtR(stats.firstHalfR)}, second half {fmtR(stats.secondHalfR)}.
          Drawdown and worst day as % of the account at {risk}% risk per trade.
          {#if skipped.length > 0}
            <br />Breakouts not traded: {skipped.join(' · ')}.
          {/if}
        </p>
      </div>
      <section class="curve">
        <p class="cap">Total R, trade by trade</p>
        <EquityCurve equity={stats.equity} height={150} />
      </section>
    </div>

    <MonthlyGrid {months} />

    <PnlCalendar
      entries={calendar}
      dayOf={utcDay}
      tested={{ from: auto.result.from, to: auto.result.to }}
      sub="what the trades that closed each UTC day made"
      notes={{
        usd: `Dollars at ${risk}% risk on every trade, on a ${money(auto.settings.accountSize)} account.`,
        pct: `Percent of the account at ${risk}% risk on every trade.`
      }}
    />

    <section>
      <p class="cap">Prop challenge odds</p>
      {#if odds}
        <p class="small odds">
          Starting a challenge any week ({odds.starts} starts, up to {odds.horizonDays} days each; +{auto.settings.targetPct}% target, {auto.settings.maxDrawdownPct}% max drawdown,
          {dailyText}, {risk}% risk per trade):
          <span class="strong pos">passed {share(odds.passed, odds.starts)}</span>,
          <span class="strong neg">failed {share(odds.failed, odds.starts)}</span>, still going {share(odds.open, odds.starts)}{odds.medianDaysToPass == null
            ? ''
            : `. Median ${odds.medianDaysToPass.toFixed(0)} days to pass`}.
        </p>
        <p class="faint small">Closed trades only. A trade that dips before it closes would have been worse, so real drawdowns are a little deeper.</p>
      {:else}
        <p class="faint small">Pick at least 2 months of dates to see how a challenge would have gone.</p>
      {/if}
    </section>

    <section>
      <p class="cap">If you were funded</p>
      {#if payouts}
        <p class="small odds">
          A {money(auto.settings.accountSize)} account, you keep {auto.settings.profitSplitPct}%, {risk}% risk per trade, {auto.settings.maxDrawdownPct}% max drawdown, {dailyText}.
          Profit is withdrawn at the end of every month. Starting any week and following it for {payouts.horizonDays} days ({payouts.starts} starts):
        </p>
        <dl class="tiles">
          <div>
            <dt>Paid to you per month, on average</dt>
            <dd class="num pos">{money(payouts.perMonth)}</dd>
          </div>
          <div>
            <dt>Months with a payout</dt>
            <dd class="num">{payouts.monthsPaid.toFixed(0)}%</dd>
          </div>
          <div>
            <dt>Account blown within the period</dt>
            <dd class="num {payouts.blown > 0 ? 'neg' : ''}">{payouts.blown.toFixed(0)}%</dd>
          </div>
          <div>
            <dt>Typical total over the period</dt>
            <dd class="num">{money(payouts.median)}</dd>
          </div>
          <div>
            <dt>Bad case (worst 10%)</dt>
            <dd class="num">{money(payouts.low)}</dd>
          </div>
          <div>
            <dt>Good case (best 10%)</dt>
            <dd class="num">{money(payouts.high)}</dd>
          </div>
        </dl>
        <p class="faint small">The average counts accounts that were blown (they pay nothing after that). Closed trades only, so real drawdowns are a little deeper, and fees for the account are not counted.</p>
      {:else}
        <p class="faint small">Pick at least 2 months of dates to see what a funded account would have paid.</p>
      {/if}
    </section>

    {#if auto.coinStats.length > 1}
      <section>
        <p class="cap">By coin</p>
        <table class="coins">
          <thead>
            <tr>
              <th>Coin</th>
              <th class="r">Trades</th>
              <th class="r">Win</th>
              <th class="r">Avg R</th>
              <th class="r">Total R</th>
              <th class="r">Drawdown</th>
              <th class="r">First half</th>
              <th class="r">Second half</th>
            </tr>
          </thead>
          <tbody>
            {#each auto.coinStats as row (row.coin)}
              <tr>
                <td>{row.coin}</td>
                <td class="r num">{row.stats.trades}</td>
                <td class="r num">{row.stats.winRate == null ? dash : `${row.stats.winRate.toFixed(0)}%`}</td>
                <td class="r num {sign(row.stats.avgR ?? 0)}">{row.stats.avgR == null ? dash : fmtR(row.stats.avgR)}</td>
                <td class="r num {sign(row.stats.totalR)}">{fmtR(row.stats.totalR)}</td>
                <td class="r num">{row.stats.maxDrawdownR.toFixed(2)}R</td>
                <td class="r num {sign(row.stats.firstHalfR)}">{fmtR(row.stats.firstHalfR)}</td>
                <td class="r num {sign(row.stats.secondHalfR)}">{fmtR(row.stats.secondHalfR)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </section>
    {/if}

    {#if auto.loaded}
      <section class="viewer">
        <div class="nav">
          <button type="button" class="btn square" onclick={() => auto.step(-1)} disabled={auto.index <= 0} title="Previous trade (←)" aria-label="Previous trade">
            <Icon name="back" />
          </button>
          <span class="num count">{trades.length ? `Trade ${auto.index + 1} of ${trades.length}` : 'No trades'}</span>
          <button
            type="button"
            class="btn square"
            onclick={() => auto.step(1)}
            disabled={auto.index < 0 || auto.index >= trades.length - 1}
            title="Next trade (→)"
            aria-label="Next trade"
          >
            <Icon name="forward" />
          </button>
        </div>
        <AutoChart
          candles={auto.loaded.candles}
          tfMs={TF_MS[ran.tf]}
          entryLen={auto.settings.entryLen}
          trade={auto.trade}
          {trades}
          precision={auto.loaded.precision}
        />
        {#if auto.trade}
          <TradeDetails trade={auto.trade} settings={auto.settings} />
        {/if}
      </section>
    {/if}

    <AutoTrades {trades} index={auto.index} onpick={(i) => auto.pick(i)} />
  </div>
{:else if !auto.running && !ran}
  <div class="empty">
    <p class="strong">Run the breakout over a date range</p>
    <p class="dim small">Every rule it follows is on the left, and each number there can be changed. Enter the coins and dates above and press Run auto backtest.</p>
  </div>
{/if}

<style>
  .stack {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .strong {
    font-weight: 600;
  }

  .small {
    font-size: 12px;
    line-height: 1.5;
  }

  .summary {
    display: grid;
    grid-template-columns: 3fr 2fr;
    gap: 20px;
  }

  /* Lets the curve shrink with its column instead of holding the width it was drawn at. */
  .summary > * {
    min-width: 0;
  }

  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 1px;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--border);
  }

  .tiles div {
    padding: 10px 12px;
    background: var(--surface-2);
  }

  .tiles dt {
    color: var(--text-2);
    font-size: 11.5px;
  }

  .tiles dd {
    margin-top: 2px;
    font-size: 16px;
    font-weight: 500;
  }

  .lines {
    margin-top: 8px;
  }

  .coins {
    width: 100%;
    margin-top: 8px;
    font-size: 12px;
  }

  .coins th,
  .coins td {
    padding: 6px 8px;
    border-bottom: 1px solid var(--border);
    text-align: left;
    white-space: nowrap;
  }

  .coins th {
    color: var(--text-3);
    font-size: 11px;
    font-weight: 500;
  }

  .r {
    text-align: right;
  }

  .viewer {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .nav {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  .count {
    min-width: 120px;
    font-size: 12px;
    text-align: center;
  }

  .progress {
    height: 6px;
    margin-bottom: 8px;
    overflow: hidden;
    border-radius: 3px;
    background: var(--surface-3);
  }

  .progress span {
    display: block;
    height: 100%;
    background: var(--accent);
    transition: width 0.2s;
  }

  .note {
    margin-bottom: 12px;
  }

  .empty {
    max-width: 640px;
    margin: 60px auto;
    text-align: center;
  }

  .empty .small {
    margin-top: 6px;
  }

  @media (max-width: 1199px) {
    .summary {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 767px) {
    .coins {
      display: block;
      overflow-x: auto;
    }
  }
</style>
