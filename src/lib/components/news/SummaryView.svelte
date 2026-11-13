<script lang="ts">
  // The short version: what matters today, in a few lines. How big a swing to
  // expect and when to stay out; what prices already did after a story. Never a
  // direction.
  import { fmtPct, fmtSize } from '$lib/news/swing';
  import { LEVEL_LABEL, movePhrase, swingPhrase, type AssetLine, type Summary } from '$lib/news/summary';
  import { ctDateKey, fmtDay, fmtRange, fmtTime } from '$lib/news/time';
  import Icon from '../ui/Icon.svelte';

  let {
    summary,
    running,
    error,
    onRefresh,
    onFind
  }: { summary: Summary | null; running: boolean; error: string; onRefresh: () => void; onFind: (symbol: string) => void } = $props();

  const signed = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%`;
  const price = (v: number) => (v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : v.toFixed(2));
  const when = (ms: number, now: number) => (ctDateKey(ms) === ctDateKey(now) ? fmtTime(ms) : `${fmtDay(ctDateKey(ms))} ${fmtTime(ms)}`);

  const sections = $derived([
    { title: 'Markets', lines: (summary?.assets ?? []).filter((a) => a.kind === 'market') },
    { title: 'Stocks', lines: (summary?.assets ?? []).filter((a) => a.kind === 'stock') }
  ]);

  /** What is next, in one short line: "CPI · Feb Tue 7:30 AM, NQ ~1.0% (≈ 260 pts)". */
  function nextLine(a: AssetLine, now: number): string {
    if (!a.next) return '';
    const own = a.kind === 'market' ? { [a.symbol]: a.next.swing[a.symbol] } : a.next.swing;
    const swing = swingPhrase(Object.fromEntries(Object.entries(own).filter(([, v]) => v)), a.price != null ? { [a.symbol]: a.price } : {});
    return `${a.next.title} ${when(a.next.timeMs, now)}${swing ? `, ${swing}` : ''}`;
  }
</script>

<div class="sum">
  <div class="bar">
    <span class="faint s">{summary ? `Updated ${fmtTime(summary.generatedAt)}` : ''}</span>
    <button class="btn" type="button" disabled={running} onclick={onRefresh}>
      <Icon name="refresh" size={14} /> {running ? 'Reading…' : 'Refresh'}
    </button>
  </div>

  {#if running && !summary}
    <div class="card empty rise">
      <p class="big">Putting the day together…</p>
      <p class="dim">Reading the calendar, the news and prices. About half a minute the first time.</p>
    </div>
  {:else if error && !summary}
    <p class="note bad">Could not build the summary: {error}</p>
  {:else if summary}
    <section class="hero rise {summary.level}" style="--i:0">
      <span class="level"><span class="dot"></span>{LEVEL_LABEL[summary.level]}</span>
      <h2 class="headline">{summary.headline}</h2>
      <ul class="bullets">
        {#each summary.bullets as b (b)}<li>{b}</li>{/each}
      </ul>
      {#if summary.stayOut.length > 0}
        <p class="stay num">
          <Icon name="ban" size={13} /> Stay out {summary.stayOut.map((w) => fmtRange(w.startMs, w.endMs)).join('  ·  ')} <span class="faint">Central</span>
        </p>
      {/if}
    </section>

    {#each sections as section (section.title)}
      {#if section.lines.length > 0}
        <section class="rise" style="--i:1">
          <h3 class="cap h">{section.title}</h3>
          <div class="board">
            {#each section.lines as a (a.symbol)}
              <button type="button" class="row" onclick={() => onFind(a.symbol)} title="Open {a.symbol} in Find">
                <span class="who">
                  <span class="sym">{a.symbol}</span>
                  <span class="faint nm">{a.name}</span>
                </span>
                <span class="px num">
                  {#if a.price != null}{price(a.price)}{:else}–{/if}
                  {#if a.changePct != null}
                    <span class="chg" class:pos={a.changePct >= 0} class:neg={a.changePct < 0}>{signed(a.changePct)}</span>
                  {/if}
                  {#if a.typicalMove != null}<span class="faint norm">normal ±{fmtPct(a.typicalMove)}</span>{/if}
                </span>
                <span class="info">
                  {#if a.next}
                    <span class="next"><Icon name="clock" size={12} /> {nextLine(a, summary.generatedAt)}</span>
                  {/if}
                  {#if a.story}
                    <span class="story">
                      {movePhrase(a.story.move)} after a story {when(a.story.publishedAt, summary.generatedAt)}
                    </span>
                  {/if}
                  {#if !a.next && !a.story}<span class="faint">Nothing to watch</span>{/if}
                </span>
              </button>
            {/each}
          </div>
        </section>
      {/if}
    {/each}

    {#each summary.notes as note (note)}<p class="note warn">{note}</p>{/each}
    <p class="faint s foot">
      Swings are typical sizes from past events, and moves after a story are measured from prices. Neither says which way a price will go. Info only.
    </p>
  {/if}
</div>

<style>
  .sum {
    display: flex;
    flex-direction: column;
    gap: 22px;
  }

  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 30px;
  }

  .s {
    font-size: 12px;
  }

  .hero {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 22px 24px;
    border: 1px solid var(--border);
    border-left: 3px solid var(--text-3);
    border-radius: var(--radius);
    background: var(--surface-2);
  }

  .hero.big {
    border-left-color: var(--red);
  }

  .hero.careful {
    border-left-color: var(--amber);
  }

  .level {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    align-self: flex-start;
    height: 22px;
    padding: 0 10px;
    border-radius: 999px;
    background: var(--surface-3);
    color: var(--text-2);
    font-size: 12px;
    font-weight: 600;
  }

  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: currentColor;
  }

  .big .level {
    background: var(--red-soft);
    color: var(--red);
  }

  .careful .level {
    background: var(--amber-soft);
    color: var(--amber);
  }

  .headline {
    font-size: 19px;
    font-weight: 600;
    line-height: 1.35;
    letter-spacing: -0.02em;
  }

  .bullets {
    display: flex;
    flex-direction: column;
    gap: 7px;
    font-size: 14px;
    line-height: 1.5;
  }

  .bullets li {
    position: relative;
    padding-left: 16px;
  }

  .bullets li::before {
    content: '';
    position: absolute;
    left: 2px;
    top: 0.62em;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--accent);
  }

  .stay {
    display: inline-flex;
    align-items: center;
    align-self: flex-start;
    gap: 7px;
    padding: 5px 10px;
    border-radius: var(--radius-sm);
    background: var(--amber-soft);
    color: var(--amber);
    font-size: 12.5px;
    font-weight: 500;
  }

  .h {
    margin-bottom: 8px;
  }

  .board {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    overflow: hidden;
  }

  .row {
    display: grid;
    grid-template-columns: 150px 270px 1fr;
    align-items: center;
    gap: 6px 16px;
    width: 100%;
    padding: 11px 16px;
    border-bottom: 1px solid var(--border);
    transition: background-color 0.12s;
  }

  .row:last-child {
    border-bottom: 0;
  }

  .row:hover {
    background: var(--surface-2);
  }

  .who {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .sym {
    font-weight: 600;
  }

  .nm {
    overflow: hidden;
    font-size: 11.5px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .px {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 2px 10px;
  }

  .chg {
    font-weight: 600;
  }

  .norm {
    font-size: 11.5px;
  }

  .info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 12.5px;
  }

  .next {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--amber);
  }

  .story {
    color: var(--text-2);
  }

  .empty {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 34px 20px;
    text-align: center;
  }

  .big {
    font-size: 15px;
    font-weight: 600;
  }

  .foot {
    max-width: 560px;
  }

  @media (max-width: 900px) {
    .row {
      grid-template-columns: 1fr;
    }
  }
</style>
