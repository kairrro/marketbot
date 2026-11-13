<script lang="ts">
  // Account settings for the active session, chart display, and session
  // housekeeping.
  import { fmtSessionTime, MARKET_SESSIONS } from '$lib/engine/marketSessions';
  import { display } from '$lib/state/display.svelte';
  import {
    deleteSession,
    duplicateSession,
    exportCsv,
    exportSession,
    importSession,
    resetTrades
  } from '$lib/state/sessionActions';
  import { sessions, type RiskMode } from '$lib/state/sessions.svelte';
  import { storage } from '$lib/state/storage.svelte';
  import { trade } from '$lib/state/trade.svelte';
  import { TIME_ZONES, zoneLabel } from '$lib/timezone';
  import Segmented from './ui/Segmented.svelte';
  import Toggle from './ui/Toggle.svelte';

  type NumberSetting =
    | 'startBalance'
    | 'riskPct'
    | 'riskFixedUsd'
    | 'feePct'
    | 'makerFeePct'
    | 'commissionFull'
    | 'commissionMicro'
    | 'maxContractsFull'
    | 'maxContractsMicro'
    | 'minStopPct';

  const riskModes: { value: RiskMode; label: string; title: string }[] = [
    { value: 'pct', label: '%', title: 'A % of the balance at the time, so the $ amount grows and shrinks with it' },
    { value: 'usd', label: 'Fixed $', title: 'The same $ amount every trade, whatever the balance' }
  ];

  /** Futures pay a commission per contract, everything else a % fee: only the ones that apply are shown. */
  const FUTURES_ONLY: NumberSetting[] = ['commissionFull', 'commissionMicro', 'maxContractsFull', 'maxContractsMicro'];
  const WHOLE: NumberSetting[] = ['maxContractsFull', 'maxContractsMicro'];
  const NOT_FUTURES: NumberSetting[] = ['feePct', 'makerFeePct', 'minStopPct'];

  // The risk field follows the mode, so switching re-creates it with that mode's value.
  const allFields = $derived<{ key: NumberSetting; label: string; step: number; hint: string; title?: string }[]>([
    { key: 'startBalance', label: 'Start balance', step: 100, hint: '$' },
    sessions.settings.riskMode === 'usd'
      ? { key: 'riskFixedUsd', label: 'Risk', step: 1, hint: '$', title: 'Risked on every trade' }
      : { key: 'riskPct', label: 'Risk', step: 0.1, hint: '%', title: 'Of the balance at the time' },
    { key: 'feePct', label: 'Taker fee', step: 0.005, hint: '%', title: 'Market entries, stops and closing by hand' },
    { key: 'makerFeePct', label: 'Maker fee', step: 0.005, hint: '%', title: 'Limit entries and take-profit orders' },
    {
      key: 'commissionFull',
      label: 'NQ / ES commission',
      step: 0.05,
      hint: '$',
      title: 'Per full-size futures contract (NQ, ES, YM, RTY, GC, CL), per side, with exchange and NFA fees in. Futures pay this instead of the % fees. Set it to your firm\'s rate'
    },
    {
      key: 'commissionMicro',
      label: 'MNQ / MES commission',
      step: 0.05,
      hint: '$',
      title: 'Per micro contract (MNQ, MES), per side, with exchange and NFA fees in. Set it to your firm\'s rate'
    },
    {
      key: 'maxContractsFull',
      label: 'Max NQ / ES contracts',
      step: 1,
      hint: 'ct',
      title: 'The most full-size contracts one trade may use. 0 means no limit. The size follows your risk, up to this'
    },
    {
      key: 'maxContractsMicro',
      label: 'Max MNQ / MES contracts',
      step: 1,
      hint: 'ct',
      title: 'The most micro contracts one trade may use. 0 means no limit. The size follows your risk, up to this'
    },
    { key: 'minStopPct', label: 'Min stop', step: 0.1, hint: '%', title: 'Flags a stop tighter than this' }
  ]);
  const fields = $derived(
    allFields.filter((field) => !(trade.contract ? NOT_FUTURES : FUTURES_ONLY).includes(field.key))
  );

  const SESSION_COLOR = { asia: 'var(--session-asia)', london: 'var(--session-london)', newYork: 'var(--session-ny)' };

  /** A typed number, or null when it is not usable. */
  function readNumber(input: HTMLInputElement, min: number): number | null {
    const value = Number(input.value);
    return input.value.trim() !== '' && Number.isFinite(value) && value >= min ? value : null;
  }

  function setField(key: NumberSetting, event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const value = readNumber(input, 0);
    // Ignore anything that is not a usable number and show the saved value again.
    if (value != null) sessions.updateSettings({ [key]: WHOLE.includes(key) ? Math.floor(value) : value });
    input.value = String(sessions.settings[key]);
  }

  function setSwingSize(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const value = readNumber(input, 1);
    if (value != null) sessions.updateSettings({ swingSize: Math.round(value) });
    input.value = String(sessions.settings.swingSize);
  }

  function setAtrPeriod(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const value = readNumber(input, 1);
    if (value != null) display.atrPeriod = Math.min(200, Math.round(value));
    input.value = String(display.atrPeriod);
  }

  function rename(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    sessions.rename(sessions.activeId, input.value);
    input.value = sessions.active.name;
  }
</script>

<div class="stack">
  <section class="group">
    <p class="cap">Session</p>
    <label class="field">
      <span class="dim">Name</span>
      <!-- Keyed so switching session re-creates the input with the new name. -->
      {#key sessions.activeId}
        <input class="inp" value={sessions.active.name} onchange={rename} maxlength="60" aria-label="Session name" />
      {/key}
    </label>
  </section>

  <section class="group">
    <p class="cap">Account</p>
    {#key sessions.activeId}
      {#each fields as field (field.key)}
        {#if field.key === 'riskPct' || field.key === 'riskFixedUsd'}
          <div class="field">
            <span class="dim">Risk per trade</span>
            <Segmented
              label="Risk per trade"
              options={riskModes}
              value={sessions.settings.riskMode}
              onchange={(riskMode) => sessions.updateSettings({ riskMode })}
              stretch
              compact
            />
          </div>
        {/if}
        <label class="field" title={field.title}>
          <span class="dim">{field.label}</span>
          <span class="unit">
            <input
              class="inp num"
              type="number"
              min="0"
              step={field.step}
              value={sessions.settings[field.key]}
              onchange={(event) => setField(field.key, event)}
            />
            <span class="faint">{field.hint}</span>
          </span>
        </label>
      {/each}
    {/key}
    {#if trade.open || trade.pending}
      <p class="note">Changes apply to the next trade. The open trade keeps the risk and fees it was placed with.</p>
    {/if}
  </section>

  <section class="group">
    <p class="cap">Chart</p>
    <label class="field">
      <span class="dim">Time zone</span>
      <select class="inp" bind:value={display.timeZone} aria-label="Time zone">
        {#each TIME_ZONES as zone (zone.id)}
          <option value={zone.id}>{zoneLabel(zone.id)}</option>
        {/each}
      </select>
    </label>
    <Toggle checked={display.sessions} onchange={(on) => (display.sessions = on)}>Session highs and lows</Toggle>
    {#if display.sessions}
      <ul class="sessions">
        {#each MARKET_SESSIONS as session (session.id)}
          <li>
            <Toggle checked={display.isShown(session.id)} onchange={() => display.toggleSession(session.id)}>
              <span class="session">
                <span class="swatch" style:background={SESSION_COLOR[session.id]}></span>
                {session.label}
                <span class="faint num">
                  {fmtSessionTime(session.open)}–{fmtSessionTime(session.close)} {session.city}
                </span>
              </span>
            </Toggle>
          </li>
        {/each}
        <li>
          <Toggle checked={display.weekendSessions} onchange={(on) => (display.weekendSessions = on)}>
            <span class="session">Weekends too <span class="faint num">Sat, Sun</span></span>
          </Toggle>
        </li>
      </ul>
    {/if}
    <Toggle checked={display.swings} onchange={(on) => (display.swings = on)}>Swing dots and 1h mode</Toggle>
    {#if display.swings}
      {#key sessions.activeId}
        <label class="field" title="Candles on each side that must have lower highs (or higher lows)">
          <span class="dim">Swing size</span>
          <span class="unit wide">
            <input
              class="inp num"
              type="number"
              min="1"
              step="1"
              value={sessions.settings.swingSize}
              onchange={setSwingSize}
            />
            <span class="faint">bars</span>
          </span>
        </label>
      {/key}
      <Toggle checked={display.sweeps} onchange={(on) => (display.sweeps = on)}>Mark sweeps</Toggle>
      {#if display.sweeps}
        <Toggle checked={display.pauseOnSweep} onchange={(on) => (display.pauseOnSweep = on)}>
          Pause playback on a sweep
        </Toggle>
      {/if}
    {/if}
    <Toggle checked={display.atr} onchange={(on) => (display.atr = on)}>
      ATR <span class="faint">volatility · key A</span>
    </Toggle>
    {#if display.atr}
      <label class="field" title="Candles the average true range is taken over. 14 is the standard">
        <span class="dim">ATR length</span>
        <span class="unit wide">
          <input
            class="inp num"
            type="number"
            min="1"
            max="200"
            step="1"
            value={display.atrPeriod}
            onchange={setAtrPeriod}
          />
          <span class="faint">bars</span>
        </span>
      </label>
    {/if}
  </section>

  <section class="group">
    <p class="cap">Data</p>
    <div class="buttons">
      <button type="button" class="btn" onclick={exportCsv}>Export CSV</button>
      <button type="button" class="btn" onclick={exportSession}>Export JSON</button>
      <button type="button" class="btn" onclick={importSession}>Import JSON</button>
      <button type="button" class="btn" onclick={duplicateSession}>Duplicate</button>
      <button type="button" class="btn danger" onclick={resetTrades}>Reset trades</button>
      <button type="button" class="btn danger" onclick={deleteSession}>Delete session</button>
    </div>
    {#if storage.failed}
      <p class="note warn">Browser storage is unavailable, so nothing is being saved. Export JSON to keep your work.</p>
    {:else if storage.durability === 'best-effort'}
      <p class="note">
        Saved automatically in this browser. The browser has not promised to keep it, though: it may clear site data
        if disk space runs low. Export JSON now and then for a backup.
      </p>
    {/if}
  </section>

  <p class="faint small">
    Charts by
    <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">TradingView Lightweight Charts™</a>.
  </p>
</div>

<style>
  .stack {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .group {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .field {
    display: grid;
    grid-template-columns: 1fr 132px;
    align-items: center;
    gap: 10px;
    min-height: var(--ctl);
  }

  .unit {
    position: relative;
    display: block;
  }

  .unit .inp {
    padding-right: 24px;
  }

  .unit.wide .inp {
    padding-right: 38px;
  }

  .unit .faint {
    position: absolute;
    top: 50%;
    right: 9px;
    transform: translateY(-50%);
    font-size: 12px;
    pointer-events: none;
  }

  .sessions {
    display: flex;
    flex-direction: column;
    gap: 7px;
    padding-left: 18px;
  }

  .session {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 12.5px;
    white-space: nowrap;
  }

  .session .num {
    margin-left: auto;
    font-size: 11.5px;
  }

  .swatch {
    width: 8px;
    height: 8px;
    border-radius: 2px;
  }

  .buttons {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
  }

  .small {
    font-size: 11.5px;
    line-height: 1.45;
  }

  .small a {
    color: var(--text-2);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
</style>
