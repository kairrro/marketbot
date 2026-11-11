<script lang="ts">
  // Stats for the active session.
  import { computeStats } from '$lib/engine/stats';
  import { fmtMoney, fmtR, sign } from '$lib/format';
  import { sessions } from '$lib/state/sessions.svelte';
  import EquityCurve from './EquityCurve.svelte';
  import TestedMonths from './TestedMonths.svelte';
  import WhatIfStats from './WhatIfStats.svelte';

  const trades = $derived(sessions.trades);
  const stats = $derived(computeStats(trades));

  const dash = '–';
  const r = (value: number | null) => (value == null ? dash : fmtR(value));
  const profitFactor = $derived(
    stats.profitFactor == null ? dash : Number.isFinite(stats.profitFactor) ? stats.profitFactor.toFixed(2) : '∞'
  );
</script>

<div class="stack">
  <dl class="stats">
    <div>
      <dt>Trades</dt>
      <dd class="num">{stats.trades}</dd>
    </div>
    <div>
      <dt>Win rate</dt>
      <dd class="num">{stats.winRate == null ? dash : `${stats.winRate.toFixed(0)}%`}</dd>
    </div>
    <div>
      <dt>Total R</dt>
      <dd class="num {sign(stats.totalR)}">{stats.trades ? fmtR(stats.totalR) : dash}</dd>
    </div>
    <div>
      <dt>Avg R / trade</dt>
      <dd class="num {sign(stats.avgR ?? 0)}">{r(stats.avgR)}</dd>
    </div>
    <div>
      <dt>Avg win</dt>
      <dd class="num">{r(stats.avgWinR)}</dd>
    </div>
    <div>
      <dt>Avg loss</dt>
      <dd class="num">{r(stats.avgLossR)}</dd>
    </div>
    <div>
      <dt>Profit factor</dt>
      <dd class="num">{profitFactor}</dd>
    </div>
    <div>
      <dt>Net P&amp;L</dt>
      <dd class="num {sign(stats.netPnl)}">{fmtMoney(stats.netPnl, true)}</dd>
    </div>
    <div>
      <dt>Max drawdown</dt>
      <dd class="num">{stats.maxDrawdownR.toFixed(2)}R</dd>
    </div>
    <div>
      <dt>Worst streak</dt>
      <dd class="num">{stats.worstLosingStreak} {stats.worstLosingStreak === 1 ? 'loss' : 'losses'}</dd>
    </div>
  </dl>

  <div class="balance">
    <span class="dim">Current balance</span>
    <span class="num">{fmtMoney(sessions.balance)}</span>
  </div>

  <section>
    <p class="cap">Equity curve (R)</p>
    {#if stats.trades > 0}
      <EquityCurve equity={stats.equity} />
    {:else}
      <p class="note none">No trades yet.</p>
    {/if}
  </section>

  {#if stats.trades > 0}
    <WhatIfStats />
  {/if}

  <TestedMonths />
</div>

<style>
  .stack {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .stats {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1px;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--border);
  }

  .stats div {
    padding: 9px 11px;
    background: var(--surface-2);
  }

  .stats dt {
    color: var(--text-2);
    font-size: 11.5px;
  }

  .stats dd {
    margin-top: 2px;
    font-size: 15px;
    font-weight: 500;
  }

  .balance {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    padding: 0 2px;
  }

  .balance .num {
    font-size: 15px;
    font-weight: 600;
  }

  .none {
    margin-top: 8px;
  }
</style>
