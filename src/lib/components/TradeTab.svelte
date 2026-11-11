<script lang="ts">
  import { fmtMoney } from '$lib/format';
  import { replay } from '$lib/state/replay.svelte';
  import { sessions } from '$lib/state/sessions.svelte';
  import { storage } from '$lib/state/storage.svelte';
  import { trade } from '$lib/state/trade.svelte';
  import OpenTradeCard from './OpenTradeCard.svelte';
  import PendingOrderCard from './PendingOrderCard.svelte';
  import Shortcuts from './Shortcuts.svelte';
  import TradeTicket from './TradeTicket.svelte';

  const notice = $derived(replay.notice);
</script>

<div class="stack">
  <div class="account">
    <div>
      <p class="cap">Balance</p>
      <p class="balance num">{fmtMoney(sessions.balance)}</p>
    </div>
    <div class="risk">
      <p class="cap">Risk per trade</p>
      <p class="num">
        {fmtMoney(sessions.riskUsd)}
        <span class="faint">· {sessions.settings.riskMode === 'usd' ? 'fixed' : `${sessions.settings.riskPct}%`}</span>
      </p>
    </div>
  </div>

  {#if trade.open}
    <OpenTradeCard />
  {:else if trade.pending}
    <PendingOrderCard />
  {:else}
    <TradeTicket />
  {/if}

  {#if notice}
    <div class="note" class:warn={notice.kind === 'warn'} class:err={notice.kind === 'error'}>
      {notice.text}
      {#if notice.hint}<span class="hint">{notice.hint}</span>{/if}
    </div>
  {/if}

  {#if storage.failed}
    <div class="note warn">Browser storage is unavailable. The app works, but nothing will be saved.</div>
  {/if}

  <Shortcuts />
</div>

<style>
  .stack {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .account {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 12px;
  }

  .balance {
    margin-top: 2px;
    font-size: 20px;
    font-weight: 600;
  }

  .risk {
    text-align: right;
  }

  .risk .num {
    margin-top: 2px;
  }

  .hint {
    display: block;
    margin-top: 2px;
    opacity: 0.8;
  }
</style>
