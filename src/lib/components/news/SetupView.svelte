<script lang="ts">
  // What is tracked, which AI model rates it, when things run, and where they go.
  import { MODEL_PRESETS } from '$lib/news/defaults';
  import type { AssetKind, Impact, NewsSettings, NewsStatus, TrackedAsset } from '$lib/news/types';
  import Icon from '../ui/Icon.svelte';
  import Segmented from '../ui/Segmented.svelte';
  import Toggle from '../ui/Toggle.svelte';

  let {
    assets,
    settings,
    status,
    onChanged
  }: { assets: TrackedAsset[]; settings: NewsSettings; status: NewsStatus; onChanged: () => void } = $props();

  interface ModelInfo {
    id: string;
    name: string;
    inputPrice: number;
    outputPrice: number;
  }

  const groups: { kind: AssetKind; title: string; hint: string }[] = [
    { kind: 'market', title: 'Markets you trade', hint: 'Impact ratings are written for these.' },
    { kind: 'stock', title: 'Stocks that move NQ', hint: 'Earnings and company news.' },
    { kind: 'topic', title: 'Macro and world news', hint: 'Fed, inflation, jobs, tariffs, war, OPEC.' }
  ];

  let kind = $state<AssetKind>('stock');
  let symbol = $state('');
  let keywords = $state('');
  let error = $state('');
  let saved = $state(false);
  let models = $state<ModelInfo[]>([]);
  let modelDraft = $state('');
  let testing = $state(false);
  let testResult = $state('');
  let savedTimer: ReturnType<typeof setTimeout> | undefined;

  $effect(() => {
    modelDraft = settings.model;
  });

  async function call(url: string, method: string, body?: unknown): Promise<Response> {
    return fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  }

  async function add(event: SubmitEvent) {
    event.preventDefault();
    error = '';
    if (!symbol.trim()) {
      error = kind === 'topic' ? 'Type a topic, like "Semiconductors".' : 'Type a ticker, like AMD.';
      return;
    }
    const res = await call('/api/news/assets', 'POST', { kind, symbol, name: kind === 'topic' ? symbol.trim() : undefined, keywords: keywords });
    if (!res.ok) {
      error = ((await res.json().catch(() => null)) as { message?: string } | null)?.message ?? 'Could not add it.';
      return;
    }
    symbol = '';
    keywords = '';
    onChanged();
  }

  async function toggle(a: TrackedAsset) {
    await call('/api/news/assets', 'PATCH', { id: a.id, enabled: !a.enabled });
    onChanged();
  }

  async function remove(a: TrackedAsset) {
    await call('/api/news/assets', 'DELETE', { id: a.id });
    onChanged();
  }

  async function restore() {
    await call('/api/news/assets', 'PUT');
    onChanged();
  }

  async function save(patch: Partial<NewsSettings>) {
    const res = await call('/api/news/settings', 'PUT', patch);
    if (res.ok) {
      saved = true;
      clearTimeout(savedTimer);
      savedTimer = setTimeout(() => (saved = false), 1600);
      onChanged();
    }
  }

  async function loadModels() {
    if (models.length > 0) return;
    try {
      const res = await fetch('/api/news/models');
      if (res.ok) models = await res.json();
    } catch {
      // The picker still works by typing an id.
    }
  }

  const priceOf = $derived(models.find((m) => m.id === modelDraft));

  async function sendTest() {
    testing = true;
    testResult = '';
    const res = await call('/api/news/run', 'POST', { kind: 'discord-test' });
    testResult = res.ok ? 'Sent. Check your Discord channel.' : (((await res.json().catch(() => null)) as { message?: string } | null)?.message ?? 'Could not send.');
    testing = false;
  }

  const setWindow = (i: number, key: 'start' | 'end', value: string) => {
    if (!value) return;
    void save({ alertWindows: settings.alertWindows.map((w, n) => (n === i ? { ...w, [key]: value } : w)) });
  };
  const addWindow = () => void save({ alertWindows: [...settings.alertWindows, { start: '10:30', end: '11:30' }] });
  const removeWindow = (i: number) => void save({ alertWindows: settings.alertWindows.filter((_, n) => n !== i) });

  const dayOptions = [
    { value: 0, label: 'Sun' },
    { value: 1, label: 'Mon' },
    { value: 5, label: 'Fri' },
    { value: 6, label: 'Sat' }
  ] as const;
  const impactOptions: { value: Impact; label: string }[] = [
    { value: 'medium', label: 'Medium +' },
    { value: 'high', label: 'High only' }
  ];
</script>

<div class="setup">
  <section class="card rise" style="--i:0">
    <div class="head">
      <h2 class="h">Tracked</h2>
      <button class="btn quiet sm" type="button" onclick={restore} title="Put back any starting asset you removed">Restore defaults</button>
    </div>
    <p class="dim sub">Click a name to pause or resume it. The × removes it.</p>

    {#each groups as g (g.kind)}
      {@const list = assets.filter((a) => a.kind === g.kind)}
      <div class="group">
        <p class="cap">{g.title} <span class="faint hint">{g.hint}</span></p>
        <div class="chips">
          {#each list as a (a.id)}
            <span class="tag" class:off={!a.enabled}>
              <button type="button" class="name" onclick={() => toggle(a)} title={a.enabled ? `Pause ${a.name}` : `Resume ${a.name}`}>
                <span class="sym">{a.symbol}</span>
                {#if a.name && a.name.toUpperCase() !== a.symbol}<span class="nm">{a.name}</span>{/if}
              </button>
              <button type="button" class="x" onclick={() => remove(a)} aria-label="Remove {a.symbol}"><Icon name="close" size={11} /></button>
            </span>
          {:else}
            <span class="faint small">Nothing here.</span>
          {/each}
        </div>
      </div>
    {/each}

    <form class="add" onsubmit={add}>
      <select class="inp kind" bind:value={kind} aria-label="What to add">
        <option value="stock">Stock</option>
        <option value="market">Market</option>
        <option value="topic">Topic</option>
      </select>
      <input
        class="inp"
        bind:value={symbol}
        placeholder={kind === 'topic' ? 'Topic, e.g. Semiconductors' : kind === 'market' ? 'Symbol, e.g. ES' : 'Ticker, e.g. AMD'}
        aria-label="Ticker or topic"
      />
      <input class="inp" bind:value={keywords} placeholder="Extra words to match (optional, comma separated)" aria-label="Extra words" />
      <button class="btn primary" type="submit"><Icon name="plus" size={14} /> Add</button>
    </form>
    {#if error}<p class="note bad err">{error}</p>{/if}
  </section>

  <section class="card rise" style="--i:1">
    <div class="head">
      <h2 class="h">AI model</h2>
      <span class="key" class:ok={status.aiReady}>{status.aiReady ? 'OpenRouter key found' : 'No OpenRouter key'}</span>
    </div>
    <p class="dim sub">
      Rates headlines and writes the mood. It rates how big and how risky, never which way. Any model on OpenRouter works.
    </p>
    <div class="presets">
      {#each MODEL_PRESETS as p (p.id)}
        <button type="button" class="chip" class:on={settings.model === p.id} title={p.note} onclick={() => save({ model: p.id })}>{p.label}</button>
      {/each}
    </div>
    <div class="model-row">
      <input
        class="inp num"
        list="news-models"
        bind:value={modelDraft}
        onfocus={loadModels}
        onchange={() => save({ model: modelDraft })}
        placeholder="vendor/model-name"
        aria-label="OpenRouter model id"
      />
      <datalist id="news-models">
        {#each models as m (m.id)}<option value={m.id}>{m.name}</option>{/each}
      </datalist>
    </div>
    {#if priceOf}
      <p class="faint small num">${priceOf.inputPrice.toFixed(2)} in · ${priceOf.outputPrice.toFixed(2)} out per million tokens</p>
    {/if}
    {#if !status.aiReady}
      <p class="note warn">
        Add your key to the <code>.env</code> file in the project folder as <code>OPENROUTER_API_KEY=…</code>, then restart Marketbot. The calendar, earnings and no-trade windows work without it.
      </p>
    {/if}
  </section>

  <section class="card rise" style="--i:2">
    <div class="head">
      <h2 class="h">Schedule</h2>
      <span class="saved" class:show={saved}><Icon name="check" size={12} /> Saved</span>
    </div>
    <div class="grid">
      <label class="field">
        <span class="cap">Morning brief (Central)</span>
        <input class="inp num" type="time" value={settings.morningTime} onchange={(e) => save({ morningTime: e.currentTarget.value })} />
      </label>
      <label class="field">
        <span class="cap">Weekly preview</span>
        <div class="two">
          <select class="inp" value={settings.weeklyDay} onchange={(e) => save({ weeklyDay: Number(e.currentTarget.value) })}>
            {#each dayOptions as d (d.value)}<option value={d.value}>{d.label}</option>{/each}
          </select>
          <input class="inp num" type="time" value={settings.weeklyTime} onchange={(e) => save({ weeklyTime: e.currentTarget.value })} />
        </div>
      </label>
    </div>

    <div class="field">
      <span class="cap">Live alert windows (Central, weekdays)</span>
      <div class="wins">
        {#each settings.alertWindows as w, i (i)}
          <div class="win">
            <input class="inp num" type="time" value={w.start} onchange={(e) => setWindow(i, 'start', e.currentTarget.value)} aria-label="Window start" />
            <span class="faint">to</span>
            <input class="inp num" type="time" value={w.end} onchange={(e) => setWindow(i, 'end', e.currentTarget.value)} aria-label="Window end" />
            {#if settings.alertWindows.length > 1}
              <button class="btn quiet square sm" type="button" onclick={() => removeWindow(i)} aria-label="Remove window"><Icon name="close" size={12} /></button>
            {/if}
          </div>
        {/each}
        {#if settings.alertWindows.length < 4}
          <button class="btn quiet sm add-win" type="button" onclick={addWindow}><Icon name="plus" size={12} /> Add window</button>
        {/if}
      </div>
    </div>

    <div class="grid">
      <div class="field">
        <span class="cap">Alert me for</span>
        <Segmented options={impactOptions} value={settings.alertMinImpact} label="Lowest impact that alerts" onchange={(v) => save({ alertMinImpact: v })} />
      </div>
      <label class="field">
        <span class="cap">Most alerts per hour</span>
        <input class="inp num" type="number" min="1" max="12" value={settings.maxAlertsPerHour} onchange={(e) => save({ maxAlertsPerHour: Number(e.currentTarget.value) })} />
      </label>
    </div>
  </section>

  <section class="card rise" style="--i:3">
    <div class="head">
      <h2 class="h">Discord</h2>
      <span class="key" class:ok={status.discordReady}>{status.discordReady ? 'Webhook found' : 'No webhook'}</span>
    </div>
    <p class="dim sub">
      Uses <code>NEWS_DISCORD_WEBHOOK_URL</code> from <code>.env</code> if set, otherwise your main <code>DISCORD_WEBHOOK_URL</code>.
    </p>
    <div class="toggles">
      <Toggle checked={settings.discordBrief} onchange={(v) => save({ discordBrief: v })}>Send the morning brief</Toggle>
      <Toggle checked={settings.discordAlerts} onchange={(v) => save({ discordAlerts: v })}>Send live alerts</Toggle>
      <Toggle checked={settings.discordWeekly} onchange={(v) => save({ discordWeekly: v })}>Send the weekly preview</Toggle>
      <Toggle checked={settings.moveAlerts} onchange={(v) => save({ moveAlerts: v })}>Ping me when a tracked stock moves a lot after a story</Toggle>
      <Toggle checked={settings.showLow} onchange={(v) => save({ showLow: v })}>Include low-impact events in Discord</Toggle>
    </div>
    {#if settings.moveAlerts}
      <label class="ratio">
        <span class="dim small">Ping when the move is at least</span>
        <select class="inp" value={settings.moveAlertRatio} onchange={(e) => save({ moveAlertRatio: Number(e.currentTarget.value) })}>
          {#each [1.5, 2, 3, 4] as r (r)}<option value={r}>{r}× a normal day</option>{/each}
        </select>
        <span class="faint small">One ping per stock per day, 8:30 AM to 3:15 PM Central.</span>
      </label>
    {/if}
    <div class="test">
      <button class="btn" type="button" disabled={!status.discordReady || testing} onclick={sendTest}>
        <Icon name="send" size={14} /> {testing ? 'Sending…' : 'Send a test message'}
      </button>
      {#if testResult}<span class="dim small">{testResult}</span>{/if}
    </div>
  </section>

  <p class="faint small foot">
    The bot runs while Marketbot is running. If it was off at 8:00 AM, it writes the brief as soon as it starts (until 3 PM).
  </p>
</div>

<style>
  .setup {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 18px;
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .h {
    font-size: 14px;
    font-weight: 600;
    letter-spacing: -0.01em;
  }

  .sub {
    margin-top: -4px;
    font-size: 12.5px;
  }

  .small {
    font-size: 11.5px;
  }

  .group {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .hint {
    margin-left: 6px;
    letter-spacing: 0;
    text-transform: none;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .tag {
    display: inline-flex;
    align-items: center;
    height: 28px;
    border: 1px solid var(--border-strong);
    border-radius: 999px;
    background: var(--surface-3);
    transition:
      border-color 0.14s,
      background-color 0.14s,
      opacity 0.14s;
  }

  .tag:hover {
    border-color: var(--accent);
  }

  .tag.off {
    border-style: dashed;
    background: transparent;
    opacity: 0.55;
  }

  .name {
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
    height: 100%;
    padding: 0 4px 0 11px;
  }

  .sym {
    font-size: 12.5px;
    font-weight: 600;
  }

  .nm {
    color: var(--text-3);
    font-size: 11.5px;
  }

  .x {
    display: grid;
    place-items: center;
    width: 24px;
    height: 100%;
    border-radius: 0 999px 999px 0;
    color: var(--text-3);
    transition:
      color 0.12s,
      background-color 0.12s;
  }

  .x:hover {
    background: var(--red-soft);
    color: var(--red);
  }

  .add {
    display: grid;
    grid-template-columns: 110px minmax(120px, 1fr) minmax(160px, 1.6fr) auto;
    gap: 8px;
    padding-top: 4px;
  }

  .err {
    margin-top: -4px;
  }

  .key {
    padding: 2px 9px;
    border-radius: 999px;
    background: var(--amber-soft);
    color: var(--amber);
    font-size: 11.5px;
    font-weight: 500;
  }

  .key.ok {
    background: var(--green-soft);
    color: var(--green);
  }

  .presets {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .model-row {
    max-width: 420px;
  }

  code {
    font-family: var(--font-mono);
    font-size: 11.5px;
    color: var(--text);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .two {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  .wins {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .win {
    display: grid;
    grid-template-columns: 130px auto 130px auto;
    align-items: center;
    justify-content: start;
    gap: 8px;
  }

  .add-win {
    align-self: flex-start;
  }

  .saved {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--green);
    font-size: 12px;
    opacity: 0;
    transform: translateY(2px);
    transition:
      opacity 0.2s,
      transform 0.2s;
  }

  .saved.show {
    opacity: 1;
    transform: none;
  }

  .toggles {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .test {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .ratio {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
    padding-left: 37px;
  }

  .ratio .inp {
    width: 170px;
  }

  .foot {
    padding: 0 4px;
  }

  @media (max-width: 640px) {
    .add,
    .grid {
      grid-template-columns: 1fr;
    }

    .win {
      grid-template-columns: 1fr auto 1fr auto;
    }
  }
</style>
