<script lang="ts">
  import { fmtSessionTime, MARKET_SESSIONS } from '$lib/engine/marketSessions';
  import { replay, SPEEDS } from '$lib/state/replay.svelte';
  import { ui } from '$lib/state/ui.svelte';
  import { TIME_ZONES, zoneLabel } from '$lib/timezone';
  import Icon from './ui/Icon.svelte';
  import Segmented from './ui/Segmented.svelte';

  const speeds = SPEEDS.map((speed) => ({ value: speed, label: `${speed}x` }));
  const idle = $derived(!replay.info || replay.loading);

  const toTime = fmtSessionTime;

  /** "HH:MM" from a time input, as minutes after midnight (null when cleared). */
  function fromTime(value: string): number | null {
    const match = /^(\d{1,2}):(\d{2})$/.exec(value);
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
  }

  /** Changes part of the custom window. A cleared field or an empty window is ignored. */
  function setHours(change: { zone?: string; open?: number | null; close?: number | null }) {
    const { zone, open, close } = replay.customHours;
    const next = {
      zone: change.zone ?? zone,
      open: change.open === undefined ? open : (change.open ?? open),
      close: change.close === undefined ? close : (change.close ?? close)
    };
    if (next.open === next.close) return ui.toast('The window needs a start and an end that differ.', 'warn');
    replay.customHours = next;
  }

  function next(count: number) {
    replay.pause();
    if (count === 1) replay.step();
    else replay.stepN(count);
  }
</script>

<div class="group">
  <button type="button" class="btn" disabled={idle} onclick={() => next(1)} title="Next candle (→)">
    Next <Icon name="step" size={14} />
  </button>
  <button type="button" class="btn num" disabled={idle} onclick={() => next(10)} title="Next 10 candles (Shift+→)">
    +10
  </button>
  <button
    type="button"
    class="btn play"
    class:on={replay.playing}
    disabled={idle}
    onclick={() => replay.toggle()}
    title="Play / pause (Space)"
  >
    <Icon name={replay.playing ? 'pause' : 'play'} size={14} />
    {replay.playing ? 'Pause' : 'Play'}
  </button>
  <Segmented label="Play speed" options={speeds} value={replay.speed} onchange={(speed) => replay.setSpeed(speed)} mono />
  <select
    class="inp"
    aria-label="Trading session"
    title={replay.sessionOnly && !replay.sessionActive
      ? 'Sessions only apply on 1h and lower timeframes. Showing all hours.'
      : 'Only replay one session: Next skips to the same session on the next day'}
    value={replay.sessionOnly ?? ''}
    onchange={(event) => {
      const id = event.currentTarget.value;
      replay.sessionOnly = id === 'custom' ? 'custom' : (MARKET_SESSIONS.find((s) => s.id === id)?.id ?? null);
    }}
  >
    <option value="">All hours</option>
    {#each MARKET_SESSIONS as session (session.id)}
      <option value={session.id}>{session.label} only</option>
    {/each}
    <option value="custom">Custom hours…</option>
  </select>
  {#if replay.sessionOnly === 'custom'}
    <input
      class="inp time"
      type="time"
      aria-label="Window start"
      value={toTime(replay.customHours.open)}
      onchange={(event) => setHours({ open: fromTime(event.currentTarget.value) })}
    />
    <span class="faint">to</span>
    <input
      class="inp time"
      type="time"
      aria-label="Window end"
      value={toTime(replay.customHours.close)}
      onchange={(event) => setHours({ close: fromTime(event.currentTarget.value) })}
    />
    <select
      class="inp"
      aria-label="Window time zone"
      value={replay.customHours.zone}
      onchange={(event) => setHours({ zone: event.currentTarget.value })}
    >
      {#each TIME_ZONES as zone (zone.id)}
        <option value={zone.id}>{zoneLabel(zone.id)}</option>
      {/each}
    </select>
  {/if}
</div>

<style>
  .group {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .play {
    min-width: 78px;
  }

  .time {
    width: 92px;
  }
</style>
