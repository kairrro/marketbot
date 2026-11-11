<script lang="ts">
  // Accuracy: did the Low / Medium / High ratings match what NQ, GC and CL did afterwards?
  // The top is the answer in plain words. Everything else is in "Details".
  import type { BacktestProgress, BacktestResult, FamilyRow, SampleView } from '$lib/news/backtestTypes';
  import { summarize, type Sample, type Summary } from '$lib/news/evaluate';
  import { fmtDay } from '$lib/news/time';
  import type { Impact } from '$lib/news/types';
  import Icon from '../ui/Icon.svelte';
  import Segmented from '../ui/Segmented.svelte';
  import Badge from './Badge.svelte';

  let {
    progress,
    result,
    onRun
  }: { progress: BacktestProgress; result: BacktestResult | null; onRun: () => void } = $props();

  type Pick = 'all' | 'tune' | 'hold';
  type Group = 'all' | 'data' | 'earnings';
  let pick = $state<Pick>('all');
  let group = $state<Group>('all');
  let asset = $state<string>('all');
  let showAllEvents = $state(false);

  const picks = $derived([
    { value: 'all' as Pick, label: 'All' },
    { value: 'tune' as Pick, label: result ? `Tuned on (to ${result.tuneUntil})` : 'Tuned on' },
    { value: 'hold' as Pick, label: 'Held out (later)' }
  ]);
  const groups: { value: Group; label: string }[] = [
    { value: 'all', label: 'All events' },
    { value: 'data', label: 'Data and Fed' },
    { value: 'earnings', label: 'Earnings' }
  ];
  const assetOptions = $derived([{ value: 'all', label: 'All markets' }, ...Object.keys(result?.perAsset ?? {}).map((a) => ({ value: a, label: a }))]);

  const toSample = (v: SampleView): Sample => ({
    family: v.family,
    label: v.label,
    asset: v.asset,
    tier: v.tier,
    timeMs: v.timeMs,
    reaction: { range30: v.range30, range60: v.range60, net30: v.net30, net60: v.net60 },
    baseline: v.baseline,
    ratio: v.ratio
  });

  /** The headline numbers: every event, every market. */
  const overall = $derived<Summary | null>(result ? summarize(result.samples.map(toSample), 8) : null);

  /** The detail tables, narrowed by the filters. */
  const base = $derived.by<Sample[]>(() => {
    if (!result) return [];
    return result.samples
      .filter((v) => (pick === 'all' ? true : pick === 'tune' ? v.timeMs < result.splitMs : v.timeMs >= result.splitMs))
      .filter((v) => (group === 'all' ? true : group === 'earnings' ? v.family.startsWith('earnings') : !v.family.startsWith('earnings')))
      .map(toSample);
  });
  const byMarket = $derived(Object.keys(result?.perAsset ?? {}).map((a) => ({ asset: a, summary: summarize(base.filter((x) => x.asset === a)) })));
  const narrowed = $derived<Summary | null>(result ? summarize(asset === 'all' ? base : base.filter((x) => x.asset === asset), 8) : null);

  const tiers = $derived(overall ? overall.byTier : []);
  const maxRange = $derived(Math.max(0.01, ...tiers.map((t) => (Number.isFinite(t.avgRange60) ? t.avgRange60 : 0))));
  const low = $derived(tiers.find((t) => t.tier === 'low'));
  const med = $derived(tiers.find((t) => t.tier === 'medium'));
  const high = $derived(tiers.find((t) => t.tier === 'high'));

  const pct = (v: number, d = 2) => (Number.isFinite(v) ? `${v.toFixed(d)}%` : '–');
  const x = (v: number) => (Number.isFinite(v) ? `${v.toFixed(1)}×` : '–');
  const share = (v: number) => (Number.isFinite(v) ? `${Math.round(v)}%` : '–');
  const elapsed = $derived(result ? Math.round(result.durationMs / 1000) : 0);
  const tierOf = (s: Summary | undefined, tier: Impact) => s?.byTier.find((t) => t.tier === tier);
  const dateOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const families = $derived<FamilyRow[]>(result ? [...result.families].sort((a, b) => a.asset.localeCompare(b.asset) || b.medianRatio - a.medianRatio) : []);
  const events = $derived<SampleView[]>(result ? [...result.samples].reverse() : []);
  const barPct = $derived(progress.total > 0 ? Math.min(100, (progress.done / progress.total) * 100) : 4);
</script>

<div class="test">
  <div class="top">
    <p class="dim">
      Each past day was replayed as it would have looked at 8:00 AM, using only what was known then. Every event was then compared with what NQ, gold and crude really did in the next hour.
    </p>
    <button class="btn" type="button" disabled={progress.running} onclick={onRun}>
      <Icon name="flask" size={14} /> {progress.running ? 'Running…' : result ? 'Run again' : 'Run the test'}
    </button>
  </div>

  {#if progress.running}
    <div class="prog card">
      <p class="dim s">{progress.phase}{progress.total > 0 ? ` (${progress.done} of ${progress.total})` : ''}</p>
      <div class="rail"><div class="fill" style="width:{barPct}%"></div></div>
    </div>
  {:else if progress.error}
    <p class="note bad">The test failed: {progress.error}</p>
  {/if}

  {#if !result}
    {#if !progress.running}
      <div class="card empty">No test has been run yet. It uses prices already saved on this machine plus free Yahoo data, and takes a minute or two the first time.</div>
    {/if}
  {:else if overall}
    <div class="verdict card rise {overall.ordered ? 'good' : 'bad'}" style="--i:0">
      <span class="vi"><Icon name={overall.ordered ? 'check' : 'alert'} size={16} /></span>
      <p>
        {#if overall.ordered && high && med && low}
          Yes. Bigger ratings meant bigger swings. In the hour after, High events ranged <strong>{x(high.medianRatio)}</strong> a normal hour, Medium <strong>{x(med.medianRatio)}</strong>, Low <strong>{x(low.medianRatio)}</strong>.
        {:else}
          Not clearly. The ratings did not line up with the swings. Open the details below.
        {/if}
      </p>
    </div>

    <div class="tiers">
      {#each tiers as t, i (t.tier)}
        <article class="tier card rise" style="--i:{i + 1}">
          <div class="th">
            <Badge kind="impact" value={t.tier} />
            <span class="faint num">{t.n} events</span>
          </div>
          <p class="big num">{pct(t.avgRange60)}</p>
          <p class="faint s">average swing in the next hour, {x(t.medianRatio)} a normal hour</p>
          <div class="rail"><div class="fill {t.tier}" style="width:{Number.isFinite(t.avgRange60) ? (t.avgRange60 / maxRange) * 100 : 0}%"></div></div>
          {#if t.tier === 'high'}
            <p class="s">Stayed quiet anyway: <strong class="num" class:amber={t.quietPct > 15}>{share(t.quietPct)}</strong></p>
          {:else if t.tier === 'low'}
            <p class="s">Spiked anyway: <strong class="num" class:amber={t.spikePct > 20}>{share(t.spikePct)}</strong></p>
          {:else}
            <p class="s">Quiet {share(t.quietPct)} · spiked {share(t.spikePct)}</p>
          {/if}
        </article>
      {/each}
    </div>
    <p class="faint s">Swing is high minus low as a share of price. Quiet means under 1.25× normal for that hour. A spike means 2× or more.</p>

    <section class="misses">
      <div>
        <h2 class="h">Worst misses: High, but quiet</h2>
        {#each overall.highQuiet.slice(0, 5) as m (m.timeMs + m.asset + m.label)}
          <p class="miss"><span class="num faint">{dateOf(m.timeMs)}</span> <span class="num">{m.asset}</span> {m.label} <span class="num faint">{x(m.ratio)}</span></p>
        {:else}
          <p class="faint s">None.</p>
        {/each}
      </div>
      <div>
        <h2 class="h">Worst misses: Low, but spiked</h2>
        {#each overall.lowSpike.slice(0, 5) as m (m.timeMs + m.asset + m.label)}
          <p class="miss"><span class="num faint">{dateOf(m.timeMs)}</span> <span class="num">{m.asset}</span> {m.label} <span class="num amber">{x(m.ratio)}</span></p>
        {:else}
          <p class="faint s">None.</p>
        {/each}
      </div>
    </section>

    <details class="more">
      <summary>Details</summary>

      <div class="inner">
        <div class="pickrow">
          <Segmented options={assetOptions} value={asset} label="Which market" onchange={(v) => (asset = v)} />
          <Segmented options={groups} value={group} label="Which events" onchange={(v) => (group = v)} />
          <Segmented options={picks} value={pick} label="Which period" onchange={(v) => (pick = v)} />
        </div>
        {#if narrowed}
          <p class="faint s">
            {narrowed.total} events checked ·
            {#each narrowed.byTier as t (t.tier)}{t.tier} {pct(t.avgRange60)} ({t.n}) · {/each}
            tuning used the earlier period only, the later one is the check.
          </p>
        {/if}

        <section>
          <h2 class="h">By market</h2>
          <table class="tbl">
            <thead>
              <tr><th>Market</th><th class="r">Low</th><th class="r">Medium</th><th class="r">High</th><th>Notes</th></tr>
            </thead>
            <tbody>
              {#each byMarket as m (m.asset)}
                <tr>
                  <td class="num">{m.asset}</td>
                  {#each ['low', 'medium', 'high'] as const as tier (tier)}
                    {@const ts = tierOf(m.summary, tier)}
                    <td class="r num">{ts && ts.n > 0 ? `${pct(ts.avgRange60)} · ${ts.n}` : '–'}</td>
                  {/each}
                  <td class="faint s">
                    {#if m.summary.total < 80}Small sample.{/if}
                    {#if m.asset === 'CL'}Only the last 58 days of prices.{/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
          <p class="faint s">Average swing in the next hour, then how many events.</p>
        </section>

        <section>
          <h2 class="h">By event</h2>
          <div class="scroll">
            <table class="tbl">
              <thead>
                <tr><th>Market</th><th>Event</th><th>Rated</th><th class="r">Events</th><th class="r">vs normal</th><th class="r">Spiked</th><th class="r">Tuned on</th><th class="r">Held out</th></tr>
              </thead>
              <tbody>
                {#each families as f (f.family + f.asset + f.tier)}
                  <tr>
                    <td class="num">{f.asset}</td>
                    <td>{f.label}</td>
                    <td><Badge kind="impact" value={f.tier} /></td>
                    <td class="r num">{f.n}</td>
                    <td class="r num">{x(f.medianRatio)}</td>
                    <td class="r num">{share(f.spikePct)}</td>
                    <td class="r num faint">{f.tuneN ? `${x(f.tuneRatio)} · ${f.tuneN}` : '–'}</td>
                    <td class="r num faint">{f.holdN ? `${x(f.holdRatio)} · ${f.holdN}` : '–'}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </section>

        {#if result.windows.length > 0}
          <section>
            <h2 class="h">Stay-out windows</h2>
            <table class="tbl">
              <thead>
                <tr><th>Event</th><th class="r">Events</th><th class="r">NQ calm after (typical)</th><th class="r">80% calm by</th><th class="r">Window after</th><th class="r">Long enough</th></tr>
              </thead>
              <tbody>
                {#each result.windows as w (w.family)}
                  <tr>
                    <td>{w.label}</td>
                    <td class="r num">{w.n}</td>
                    <td class="r num">{Math.round(w.medianCalm)} min</td>
                    <td class="r num">{Math.round(w.p80Calm)} min</td>
                    <td class="r num">{w.after} min</td>
                    <td class="r num" class:amber={w.coveredPct < 60}>{share(w.coveredPct)}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
            <p class="faint s">Calm means NQ is back under twice its usual one-minute range for that time of day.</p>
          </section>
        {/if}

        <section>
          <button class="btn quiet sm" type="button" onclick={() => (showAllEvents = !showAllEvents)}>
            {showAllEvents ? 'Hide' : 'Show'} every event ({events.length})
          </button>
          {#if showAllEvents}
            <div class="scroll tall">
              <table class="tbl">
                <thead><tr><th>Date</th><th>Market</th><th>Event</th><th>Rated</th><th class="r">Swing</th><th class="r">vs normal</th></tr></thead>
                <tbody>
                  {#each events as e (e.timeMs + e.asset + e.family + e.label)}
                    <tr>
                      <td class="num">{fmtDay(dateOf(e.timeMs))}</td><td class="num">{e.asset}</td><td>{e.label}</td><td><Badge kind="impact" value={e.tier} /></td>
                      <td class="r num">{pct(e.range60)}</td><td class="r num">{x(e.ratio)}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
        </section>

        <section class="cov">
          <h2 class="h">What it was tested on</h2>
          <ul>
            {#each result.coverage as c (c.asset + c.source)}
              <li><span class="num">{c.asset}</span> {c.source}: {c.days} days, {c.from} to {c.to}</li>
            {/each}
          </ul>
          {#each result.notes as note (note)}<p class="faint s">{note}</p>{/each}
          <p class="faint s">Ran in {elapsed}s on {new Date(result.ranAt).toLocaleString()}.</p>
        </section>
      </div>
    </details>
  {/if}
</div>

<style>
  .test {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
    font-size: 13px;
  }

  .top p {
    max-width: 620px;
  }

  .s {
    font-size: 12.5px;
  }

  .empty {
    color: var(--text-2);
  }

  .rail {
    height: 6px;
    border-radius: 999px;
    background: var(--surface);
    overflow: hidden;
  }

  .fill {
    height: 100%;
    border-radius: 999px;
    background: var(--accent);
    transition: width 0.5s var(--ease);
  }

  .fill.high {
    background: var(--red);
  }

  .fill.medium {
    background: var(--amber);
  }

  .fill.low {
    background: var(--text-3);
  }

  .prog {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .verdict {
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 14px;
  }

  .verdict.good {
    border-color: rgba(53, 179, 137, 0.4);
    background: var(--green-soft);
  }

  .verdict.bad {
    border-color: rgba(217, 164, 65, 0.45);
    background: var(--amber-soft);
  }

  .vi {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    flex: none;
    border-radius: 50%;
    background: var(--surface-3);
  }

  .good .vi {
    color: var(--green);
  }

  .bad .vi {
    color: var(--amber);
  }

  .tiers {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
  }

  .tier {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .th {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .big {
    font-size: 28px;
    font-weight: 500;
    letter-spacing: -0.03em;
  }

  .h {
    margin-bottom: 10px;
    font-size: 14px;
    font-weight: 600;
  }

  .misses {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 20px;
  }

  .miss {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 8px;
    padding: 6px 0;
    border-bottom: 1px solid var(--border);
    font-size: 12.5px;
  }

  .more {
    border-top: 1px solid var(--border);
    padding-top: 14px;
  }

  .more > summary {
    cursor: pointer;
    list-style: none;
    color: var(--text-2);
    font-weight: 500;
    transition: color 0.12s;
  }

  .more > summary:hover {
    color: var(--text);
  }

  .more > summary::before {
    content: '▸ ';
  }

  .more[open] > summary::before {
    content: '▾ ';
  }

  .inner {
    display: flex;
    flex-direction: column;
    gap: 22px;
    margin-top: 16px;
  }

  .pickrow {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
  }

  .scroll {
    overflow-x: auto;
  }

  .scroll.tall {
    max-height: 420px;
    margin-top: 10px;
    overflow-y: auto;
  }

  .cov ul {
    display: flex;
    flex-direction: column;
    gap: 3px;
    margin-bottom: 10px;
    font-size: 12.5px;
    color: var(--text-2);
  }

  .cov p {
    margin-top: 4px;
  }

  @media (max-width: 800px) {
    .tiers,
    .misses {
      grid-template-columns: 1fr;
    }

    .top {
      flex-direction: column;
      align-items: flex-start;
    }
  }
</style>
