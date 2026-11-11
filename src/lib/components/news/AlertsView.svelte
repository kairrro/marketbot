<script lang="ts">
  // Live alerts: only big, unscheduled headlines that touch what you track.
  import { fmtDay, fmtTime, clockMinutes, ctDateKey } from '$lib/news/time';
  import type { AlertRecord, NewsSettings, NewsStatus } from '$lib/news/types';
  import Icon from '../ui/Icon.svelte';
  import HeadlineCard from './HeadlineCard.svelte';

  let {
    alerts,
    status,
    settings,
    busy,
    prices = {},
    onCheck
  }: {
    alerts: AlertRecord[];
    status: NewsStatus;
    settings: NewsSettings;
    busy: boolean;
    prices?: Record<string, number>;
    onCheck: () => void;
  } = $props();

  const groups = $derived.by(() => {
    const map = new Map<string, AlertRecord[]>();
    for (const a of alerts) {
      const day = ctDateKey(a.createdAt);
      map.set(day, [...(map.get(day) ?? []), a]);
    }
    return [...map.entries()];
  });

  const windowsText = $derived(
    settings.alertWindows
      .map((w) => {
        const f = (t: string) => {
          const m = clockMinutes(t);
          const h = Math.floor(m / 60);
          return `${h % 12 === 0 ? 12 : h % 12}${m % 60 ? `:${String(m % 60).padStart(2, '0')}` : ''}`;
        };
        const end = clockMinutes(w.end);
        return `${f(w.start)}–${f(w.end)} ${end >= 720 ? 'PM' : 'AM'}`;
      })
      .join(' and ')
  );
</script>

<div class="alerts">
  <div class="bar card rise" style="--i:0">
    <div class="state">
      <span class="dot" class:on={status.windowOpen && status.aiReady}></span>
      <div>
        <p class="t">
          {#if !status.aiReady}
            Live alerts are off
          {:else if status.windowOpen}
            Watching headlines now
          {:else}
            Outside your trading windows
          {/if}
        </p>
        <p class="s faint">
          Checks every {settings.pollMinutes} min, {windowsText} Central.
          {#if status.lastAlertRun && !status.lastAlertRun.skipped}
            Last check {fmtTime(status.lastAlertRun.at)}: {status.lastAlertRun.candidates} candidate{status.lastAlertRun.candidates === 1 ? '' : 's'}, {status.lastAlertRun.alerts} alert{status.lastAlertRun.alerts === 1 ? '' : 's'}.
          {/if}
        </p>
      </div>
    </div>
    <button class="btn" type="button" disabled={busy || !status.aiReady} onclick={onCheck} title="Look for big headlines right now, even outside the windows">
      <Icon name="refresh" size={14} /> {busy ? 'Checking…' : 'Check now'}
    </button>
  </div>

  {#if !status.aiReady}
    <p class="note warn">
      Alerts need the AI to rate headlines. Add <code>OPENROUTER_API_KEY=…</code> to <code>.env</code> and restart Marketbot.
    </p>
  {/if}

  {#if groups.length === 0}
    <div class="empty card rise" style="--i:1">
      <p class="big">No alerts</p>
      <p class="dim">
        Quiet is good. Only big, unscheduled headlines that touch your tracked assets get through, rated {settings.alertMinImpact === 'high' ? 'High' : 'Medium or High'}, at most {settings.maxAlertsPerHour} an hour.
      </p>
    </div>
  {:else}
    {#each groups as [day, list], g (day)}
      <section>
        <h2 class="h">{day === status.today ? 'Today' : fmtDay(day)}</h2>
        <div class="list">
          {#each list as alert, i (alert.id + ':' + alert.createdAt)}
            <div class="row">
              <span class="at num faint">{fmtTime(alert.createdAt)}</span>
              <HeadlineCard item={alert} now={status.now} {prices} index={g * 3 + i} />
            </div>
          {/each}
        </div>
      </section>
    {/each}
  {/if}
</div>

<style>
  .alerts {
    display: flex;
    flex-direction: column;
    gap: 18px;
  }

  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }

  .state {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .t {
    font-weight: 600;
  }

  .s {
    font-size: 12px;
  }

  .dot {
    flex: none;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--text-3);
  }

  .dot.on {
    background: var(--green);
    animation: pulse 2.4s ease-out infinite;
  }

  @keyframes pulse {
    0% {
      box-shadow: 0 0 0 0 rgba(53, 179, 137, 0.45);
    }
    70%,
    100% {
      box-shadow: 0 0 0 8px rgba(53, 179, 137, 0);
    }
  }

  code {
    font-family: var(--font-mono);
    font-size: 11.5px;
  }

  .empty {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 28px 20px;
    text-align: center;
  }

  .big {
    font-size: 15px;
    font-weight: 600;
  }

  .h {
    margin-bottom: 8px;
    font-size: 14px;
    font-weight: 600;
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .row {
    display: grid;
    grid-template-columns: 64px 1fr;
    align-items: start;
    gap: 10px;
  }

  .at {
    padding-top: 14px;
    font-size: 12px;
  }

  @media (max-width: 560px) {
    .bar {
      flex-direction: column;
      align-items: flex-start;
    }

    .row {
      grid-template-columns: 1fr;
      gap: 2px;
    }

    .at {
      padding-top: 0;
    }
  }
</style>
