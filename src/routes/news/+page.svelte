<script lang="ts">
  // News brief: scheduled events, overnight news, live alerts and the weekly preview.
  // It informs only. It never trades and never says which way a price will go.
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import AlertsView from '$lib/components/news/AlertsView.svelte';
  import BriefView from '$lib/components/news/BriefView.svelte';
  import FeedView from '$lib/components/news/FeedView.svelte';
  import FindView from '$lib/components/news/FindView.svelte';
  import SummaryView from '$lib/components/news/SummaryView.svelte';
  import SetupView from '$lib/components/news/SetupView.svelte';
  import TestView from '$lib/components/news/TestView.svelte';
  import WeekView from '$lib/components/news/WeekView.svelte';
  import Icon from '$lib/components/ui/Icon.svelte';
  import type { BacktestProgress, BacktestResult } from '$lib/news/backtestTypes';
  import type { Feed } from '$lib/news/feed';
  import type { Summary } from '$lib/news/summary';
  import { addDays, fmtDay, fmtTime, nextMonday } from '$lib/news/time';
  import type { NewsPayload } from '$lib/news/types';

  type Tab = 'summary' | 'find' | 'today' | 'feed' | 'alerts' | 'week' | 'test' | 'setup';
  const MAIN: { id: Tab; label: string }[] = [
    { id: 'summary', label: 'Summary' },
    { id: 'feed', label: 'Feed' },
    { id: 'find', label: 'Find' },
    { id: 'today', label: 'Today' },
    { id: 'week', label: 'Week ahead' },
    { id: 'alerts', label: 'Alerts' }
  ];
  /** Rarely needed, so they sit apart from the daily tabs. */
  const MORE: { id: Tab; label: string }[] = [
    { id: 'test', label: 'Accuracy' },
    { id: 'setup', label: 'Settings' }
  ];
  const TABS = [...MAIN, ...MORE];

  const asTab = (v: string | null): Tab => (TABS.some((t) => t.id === v) ? (v as Tab) : 'summary');

  let tab = $state<Tab>(asTab($page.url.searchParams.get('tab')));
  let data = $state<NewsPayload | null>(null);
  let error = $state('');
  let busy = $state<string | null>(null);
  let flash = $state('');
  let date = $state('');
  let week = $state('');
  let now = $state(Date.now());
  let progress = $state<BacktestProgress>({ running: false, phase: '', done: 0, total: 0, startedAt: null, error: null });
  let result = $state<BacktestResult | null>(null);
  let feed = $state<Feed | null>(null);
  let feedRunning = $state(false);
  let feedError = $state('');
  let summary = $state<Summary | null>(null);
  let summaryRunning = $state(false);
  let summaryError = $state('');
  /** The symbol to open in Find when it is reached from the Summary board. */
  let findSymbol = $state('');
  let flashTimer: ReturnType<typeof setTimeout> | undefined;

  function say(message: string) {
    flash = message;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => (flash = ''), 3500);
  }

  async function load() {
    try {
      const query = new URLSearchParams();
      if (date) query.set('date', date);
      if (week) query.set('week', week);
      const res = await fetch(`/api/news?${query}`);
      if (!res.ok) throw new Error(`The server answered ${res.status}`);
      data = await res.json();
      error = '';
      if (!date) date = data!.status.today;
      // The week picker starts on the latest preview, or on next week when there is none yet.
      if (!week) week = data!.weekly?.forDate ?? nextMonday(addDays(data!.status.today, 1));
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  async function loadTest() {
    try {
      const res = await fetch('/api/news/backtest');
      if (!res.ok) return;
      const body = (await res.json()) as { progress: BacktestProgress; result: BacktestResult | null };
      progress = body.progress;
      result = body.result;
    } catch {
      // The tab shows what it has.
    }
  }

  async function refreshSummary() {
    summaryRunning = true;
    summaryError = '';
    try {
      const res = await fetch('/api/news/summary', { method: 'POST' });
      const body = (await res.json().catch(() => ({}))) as { summary?: Summary; message?: string };
      if (res.ok && body.summary) summary = body.summary;
      else summaryError = body.message ?? 'Could not build it.';
    } catch (err) {
      summaryError = err instanceof Error ? err.message : String(err);
    } finally {
      summaryRunning = false;
    }
  }

  /** Shows the summary made last, and makes a new one when there is none or it is old. */
  async function loadSummary() {
    try {
      const res = await fetch('/api/news/summary');
      if (res.ok) {
        const body = (await res.json()) as { summary: Summary | null; running: boolean };
        summary = body.summary;
        if (body.running) summaryRunning = true;
      }
    } catch {
      // The tab shows what it has.
    }
    if (!summaryRunning && (!summary || Date.now() - summary.generatedAt > 45 * 60_000)) void refreshSummary();
  }

  function openFind(symbol: string) {
    findSymbol = symbol;
    choose('find');
  }

  async function refreshFeed() {
    feedRunning = true;
    feedError = '';
    try {
      const res = await fetch('/api/news/feed', { method: 'POST' });
      const body = (await res.json().catch(() => ({}))) as { feed?: Feed; message?: string };
      if (res.ok && body.feed) feed = body.feed;
      else feedError = body.message ?? 'Could not build it.';
    } catch (err) {
      feedError = err instanceof Error ? err.message : String(err);
    } finally {
      feedRunning = false;
    }
  }

  /** Shows the feed made last, and makes a new one when there is none or it is old. */
  async function loadFeed() {
    try {
      const res = await fetch('/api/news/feed');
      if (res.ok) {
        const body = (await res.json()) as { feed: Feed | null; running: boolean };
        feed = body.feed;
        if (body.running) feedRunning = true;
      }
    } catch {
      // The tab shows what it has.
    }
    if (!feedRunning && (!feed || Date.now() - feed.generatedAt > 90 * 60_000)) void refreshFeed();
  }

  async function post(kind: string, extra: Record<string, unknown> = {}): Promise<{ ok: boolean; body: Record<string, unknown> }> {
    const res = await fetch('/api/news/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, ...extra })
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok, body };
  }

  async function write(kind: 'morning' | 'weekly') {
    busy = kind;
    const target = kind === 'morning' ? date : week || nextMonday(addDays(data?.status.today ?? date, 1));
    const { ok, body } = await post(kind, { date: target });
    if (ok) {
      if (kind === 'weekly') week = target;
      else date = target;
      await load();
      say(kind === 'morning' ? 'Brief written.' : 'Preview written.');
    } else say(String(body.message ?? 'Could not write it.'));
    busy = null;
  }

  async function sendToDiscord(kind: 'morning' | 'weekly') {
    busy = `send-${kind}`;
    const { ok, body } = await post(kind === 'morning' ? 'send-morning' : 'send-weekly', { date: kind === 'morning' ? date : week || data?.weekly?.forDate });
    if (ok) {
      await load();
      say('Sent to Discord.');
    } else say(String(body.message ?? 'Could not send it.'));
    busy = null;
  }

  async function checkAlerts() {
    busy = 'alerts';
    const { ok, body } = await post('alerts');
    // Big days with a story to go with them are checked in the same go.
    const moved = await post('moves');
    if (ok) {
      const run = body.run as { alerts: unknown[]; skipped?: string; failed: string[] };
      const moves = moved.ok ? (moved.body.run as { found: unknown[] }).found.length : 0;
      const total = (run.skipped ? 0 : run.alerts.length) + moves;
      say(run.skipped && moves === 0 ? `Skipped: ${run.skipped}.` : total > 0 ? `${total} new alert${total === 1 ? '' : 's'}.` : 'Nothing big right now.');
      await load();
    } else say(String(body.message ?? 'Could not check.'));
    busy = null;
  }

  async function runTest() {
    const res = await fetch('/api/news/backtest', { method: 'POST' });
    if (res.ok) progress = ((await res.json()) as { progress: BacktestProgress }).progress;
    void pollTest();
  }

  async function pollTest() {
    await loadTest();
    if (progress.running) setTimeout(pollTest, 1500);
  }

  function choose(next: Tab) {
    tab = next;
    // A symbol sent over from the Summary board is for one visit to Find only.
    if (next !== 'find') findSymbol = '';
    void goto(`?tab=${next}`, { replaceState: true, keepFocus: true, noScroll: true });
    if (next === 'test') void pollTest();
    if (next === 'feed') void loadFeed();
    if (next === 'summary') void loadSummary();
  }

  onMount(() => {
    void load();
    void loadTest();
    if (tab === 'test') void pollTest();
    if (tab === 'feed') void loadFeed();
    if (tab === 'summary') void loadSummary();
    const tick = setInterval(() => (now = Date.now()), 30_000);
    const refresh = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 60_000);
    return () => {
      clearInterval(tick);
      clearInterval(refresh);
      clearTimeout(flashTimer);
    };
  });

  const morning = $derived(data?.morning ?? null);
  const weekly = $derived(data?.weekly ?? null);
  const dates = $derived.by(() => {
    if (!data) return [];
    return [...new Set([data.status.today, ...data.morningDates])].sort().reverse();
  });
  const nextWeek = $derived(data ? nextMonday(addDays(data.status.today, 1)) : '');
  const weekDates = $derived.by(() => {
    if (!data) return [];
    return [...new Set([nextWeek, ...data.weeklyDates])].sort().reverse();
  });
  const sentAt = (ms: number | null | undefined) => (ms ? `Sent ${fmtTime(ms)}` : '');
</script>

<svelte:head><title>News · Marketbot</title></svelte:head>

<div class="page">
  <header class="page-head">
    <div>
      <h1 class="page-title">News</h1>
      <p class="page-sub">
        When to stay out, how big a swing to expect, and which stories moved prices lately. Forecasts show size, never direction.
      </p>
    </div>
  </header>

  <nav class="tabs" aria-label="News sections">
    {#each MAIN as t (t.id)}
      <button type="button" class="tabbtn" class:active={tab === t.id} aria-current={tab === t.id ? 'page' : undefined} onclick={() => choose(t.id)}>
        {t.label}
        {#if t.id === 'alerts' && data && data.alerts.length > 0}<span class="count num">{data.alerts.length}</span>{/if}
      </button>
    {/each}
    <span class="gap">{#if flash}<span class="flash fade">{flash}</span>{/if}</span>
    {#each MORE as t (t.id)}
      <button type="button" class="tabbtn minor" class:active={tab === t.id} aria-current={tab === t.id ? 'page' : undefined} onclick={() => choose(t.id)}>
        {t.label}
      </button>
    {/each}
  </nav>

  {#if error && !data}
    <p class="note bad">Could not load the news page: {error}</p>
  {:else if !data}
    <p class="faint">Loading…</p>
  {:else if tab === 'today'}
    <div class="bar">
      <div class="left">
        <select class="inp date" bind:value={date} onchange={load} aria-label="Brief date">
          {#each dates as d (d)}<option value={d}>{d === data.status.today ? `Today · ${fmtDay(d)}` : fmtDay(d)}</option>{/each}
        </select>
      </div>
      <div class="right">
        {#if morning}<span class="faint s">{sentAt(morning.discordSentAt)}</span>{/if}
        {#if morning}
          <button class="btn" type="button" disabled={!!busy || !data.status.discordReady} onclick={() => sendToDiscord('morning')} title="Post this brief to Discord">
            <Icon name="send" size={14} /> {busy === 'send-morning' ? 'Sending…' : 'Send to Discord'}
          </button>
        {/if}
        <button class="btn" class:primary={!morning} type="button" disabled={!!busy} onclick={() => write('morning')}>
          <Icon name="refresh" size={14} /> {busy === 'morning' ? 'Writing…' : morning ? 'Rewrite' : 'Write the brief'}
        </button>
      </div>
    </div>

    {#if morning}
      <BriefView brief={morning} {now} prices={data.prices} />
    {:else}
      <div class="empty card rise">
        <span class="eico"><Icon name="calendar" size={20} /></span>
        <p class="big">No brief for {date === data.status.today ? 'today' : fmtDay(date)} yet</p>
        <p class="dim">
          It is written automatically at {data.settings.morningTime} Central while Marketbot is running. You can also write it now. Writing it does not send it to Discord.
        </p>
        <button class="btn primary" type="button" disabled={!!busy} onclick={() => write('morning')}>{busy === 'morning' ? 'Writing…' : 'Write the brief'}</button>
      </div>
    {/if}
  {:else if tab === 'summary'}
    <SummaryView {summary} running={summaryRunning} error={summaryError} onRefresh={refreshSummary} onFind={openFind} />
  {:else if tab === 'find'}
    {#key findSymbol}
      <FindView assets={data.assets} initial={findSymbol} onChanged={load} />
    {/key}
  {:else if tab === 'feed'}
    <FeedView {feed} running={feedRunning} error={feedError} today={data.status.today} onRefresh={refreshFeed} />
  {:else if tab === 'alerts'}
    <AlertsView alerts={data.alerts} moves={data.moveAlerts ?? []} status={data.status} settings={data.settings} busy={busy === 'alerts'} prices={data.prices} onCheck={checkAlerts} />
  {:else if tab === 'week'}
    <div class="bar">
      <div class="left">
        <select class="inp date" bind:value={week} onchange={load} aria-label="Week">
          {#each weekDates as d (d)}<option value={d}>Week of {fmtDay(d)}</option>{/each}
        </select>
      </div>
      <div class="right">
        {#if weekly}<span class="faint s">{sentAt(weekly.discordSentAt)}</span>{/if}
        {#if weekly}
          <button class="btn" type="button" disabled={!!busy || !data.status.discordReady} onclick={() => sendToDiscord('weekly')}>
            <Icon name="send" size={14} /> {busy === 'send-weekly' ? 'Sending…' : 'Send to Discord'}
          </button>
        {/if}
        <button class="btn" class:primary={!weekly} type="button" disabled={!!busy} onclick={() => write('weekly')}>
          <Icon name="refresh" size={14} /> {busy === 'weekly' ? 'Writing…' : weekly ? 'Rewrite' : 'Write the preview'}
        </button>
      </div>
    </div>
    {#if weekly && (!week || weekly.forDate === week)}
      <WeekView brief={weekly} {now} prices={data.prices} />
    {:else}
      <div class="empty card rise">
        <span class="eico"><Icon name="calendar" size={20} /></span>
        <p class="big">No preview for the week of {fmtDay(week || nextWeek)} yet</p>
        <p class="dim">The week-ahead preview is written automatically on Sunday at {data.settings.weeklyTime} Central. You can write it now.</p>
        <button class="btn primary" type="button" disabled={!!busy} onclick={() => write('weekly')}>{busy === 'weekly' ? 'Writing…' : 'Write the preview'}</button>
      </div>
    {/if}
  {:else if tab === 'test'}
    <TestView {progress} {result} onRun={runTest} />
  {:else}
    <SetupView assets={data.assets} settings={data.settings} status={data.status} onChanged={load} />
  {/if}
</div>

<style>
  .tabs {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-bottom: 22px;
    border-bottom: 1px solid var(--border);
    overflow-x: auto;
  }

  .tabbtn {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    height: 38px;
    padding: 0 12px;
    color: var(--text-2);
    font-weight: 500;
    white-space: nowrap;
    transition: color 0.14s;
  }

  .tabbtn::after {
    content: '';
    position: absolute;
    left: 10px;
    right: 10px;
    bottom: -1px;
    height: 2px;
    border-radius: 2px 2px 0 0;
    background: var(--accent);
    box-shadow: 0 0 10px var(--accent-glow);
    transform: scaleX(0);
    transition: transform 0.22s var(--ease);
  }

  .tabbtn:hover {
    color: var(--text);
  }

  .tabbtn.active {
    color: var(--text);
  }

  .tabbtn.active::after {
    transform: scaleX(1);
  }

  .count {
    min-width: 18px;
    padding: 0 5px;
    border-radius: 999px;
    background: var(--accent-soft);
    color: var(--accent-hover);
    font-size: 11px;
    line-height: 18px;
    text-align: center;
  }

  .gap {
    display: flex;
    flex: 1;
    justify-content: flex-end;
    padding: 0 8px;
  }

  .tabbtn.minor {
    color: var(--text-3);
    font-size: 12.5px;
  }

  .tabbtn.minor:hover,
  .tabbtn.minor.active {
    color: var(--text);
  }

  .flash {
    color: var(--green);
    font-size: 12px;
    white-space: nowrap;
  }

  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 18px;
  }

  .left,
  .right {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .date {
    width: 200px;
  }

  .s {
    font-size: 12px;
  }

  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 40px 24px;
    text-align: center;
  }

  .empty p {
    max-width: 460px;
  }

  .eico {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    margin-bottom: 4px;
    border-radius: 12px;
    background: var(--accent-soft);
    color: var(--accent-hover);
  }

  .big {
    font-size: 15px;
    font-weight: 600;
  }

  .empty .btn {
    margin-top: 8px;
  }

  @media (max-width: 640px) {
    .bar {
      flex-direction: column;
      align-items: stretch;
    }

    .right {
      flex-wrap: wrap;
    }

    .date {
      width: 100%;
    }
  }
</style>
