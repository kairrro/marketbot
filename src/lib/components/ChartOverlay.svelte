<script lang="ts">
  // Everything drawn over the chart in HTML: the legend, tool hints, load
  // errors, the "back to latest" button and the time zone in the corner.
  import { SOURCE_LABEL } from '$lib/data';
  import { TF_LABEL } from '$lib/engine/types';
  import { fmtPct, fmtPrice, sign } from '$lib/format';
  import { atr } from '$lib/state/atr.svelte';
  import { chartBridge } from '$lib/state/chartBridge';
  import { display, fmtTime } from '$lib/state/display.svelte';
  import { replay } from '$lib/state/replay.svelte';
  import { swings } from '$lib/state/swings.svelte';
  import { tested } from '$lib/state/tested.svelte';
  import { trade } from '$lib/state/trade.svelte';
  import { ui } from '$lib/state/ui.svelte';
  import TimeZoneMenu from './TimeZoneMenu.svelte';
  import Icon from './ui/Icon.svelte';

  let { atLatest, corner }: { atLatest: boolean; corner: { width: number; height: number } } = $props();

  const TOOL_HINT = {
    none: '',
    level: 'Click the chart to place a level',
    zone: 'Click one corner, move, click the other. End past the last candle to extend it right',
    measure: 'Drag to measure, or click two points',
    moveStop: 'Click the chart to set the new stop'
  } as const;

  const hint = $derived(
    ui.tool !== 'none'
      ? TOOL_HINT[ui.tool]
      : trade.draft
        ? trade.limitEntry
          ? 'Drag the entry, stop and target lines'
          : 'Drag the stop and target lines'
        : ''
  );
  // The latest bar on the chart: the forming candle, if there is one.
  const last = $derived(replay.forming ?? replay.last);
  const changePct = $derived(last ? ((last.c - last.o) / last.o) * 100 : 0);
  const price = (value: number) => fmtPrice(value, replay.precision);

  const TREND = {
    up: { label: 'UP', tone: 'pos' },
    down: { label: 'DOWN', tone: 'neg' },
    range: { label: 'RANGE', tone: '' }
  } as const;
</script>

{#if replay.info}
  <div class="legend">
    <span class="market">{replay.info.coin}</span>
    <span class="dim">{TF_LABEL[replay.info.tf]} · {SOURCE_LABEL[replay.info.source]}</span>
    {#if last}
      <span class="ohlc num">
        <span class="faint">O</span>{price(last.o)}
        <span class="faint">H</span>{price(last.h)}
        <span class="faint">L</span>{price(last.l)}
        <span class="faint">C</span>{price(last.c)}
        <span class={sign(changePct)}>{fmtPct(changePct, 2, true)}</span>
      </span>
    {/if}
    <span class="num dim">{fmtTime(replay.cursorTime)}</span>
    {#if swings.mode}
      {@const mode = swings.mode}
      <span class="mode num" title="1h mode, from the last two 1h swing highs and swing lows">
        <span class="faint">1h</span>
        <span class={TREND[mode.trend].tone}>{TREND[mode.trend].label}</span>
        {#if mode.trend === 'range'}
          <span class="dim">{price(mode.low)}–{price(mode.high)} · mid {price(mode.mid)}</span>
        {/if}
      </span>
    {/if}
    {#if atr.reading}
      {@const reading = atr.reading}
      <span
        class="mode num"
        title="Average true range of the last {display.atrPeriod} closed candles: how far a {TF_LABEL[replay.info.tf]} candle usually travels. Now {reading.ratio.toFixed(1)}× its usual level of {price(reading.usual)}."
      >
        <span class="faint">ATR {display.atrPeriod}</span>
        <span>{price(reading.value)}</span>
        <span class="dim">{fmtPct(reading.pct, 2)}</span>
        {#if reading.state !== 'normal'}
          <span class={reading.state === 'fast' ? 'hot' : 'dim'}>{reading.state === 'fast' ? 'FAST' : 'QUIET'}</span>
        {/if}
      </span>
    {/if}
    {#each swings.latest as sweep (sweep.kind)}
      <span class="mode num" title="The last candle wicked past the swing {sweep.kind} at this price and closed back">
        <span class={sweep.kind === 'high' ? 'neg' : 'pos'}>Swept {sweep.kind}</span>
        <span class="dim">{price(sweep.swings[0].price)}</span>
      </span>
    {/each}
    {#if tested.reused}
      <span class="mode reused" title="You have replayed this stretch of {replay.info.coin} before">Already tested</span>
    {/if}
  </div>
{/if}

{#if replay.info && corner.width > 0 && corner.height > 0}
  <TimeZoneMenu width={corner.width} height={corner.height} />
{/if}

{#if hint}
  <div class="hint">
    {hint}
    <span class="faint">·</span>
    {#if trade.draft && ui.tool === 'none'}<kbd>Enter</kbd> confirm{/if}
    <kbd>Esc</kbd> cancel
  </div>
{/if}

{#if replay.notice?.kind === 'error'}
  <div class="banner" role="alert">
    <div>
      <p class="banner-text">{replay.notice.text}</p>
      {#if replay.notice.hint}<p class="dim">{replay.notice.hint}</p>{/if}
    </div>
    {#if replay.notice.suggest}
      <button type="button" class="btn sm" onclick={() => replay.trySuggestion()}>
        Use {SOURCE_LABEL[replay.notice.suggest.source]}
      </button>
    {/if}
    <button
      type="button"
      class="btn quiet sm square"
      onclick={() => replay.dismissNotice()}
      title="Dismiss"
      aria-label="Dismiss"
    >
      <Icon name="close" size={14} />
    </button>
  </div>
{:else if !replay.info}
  <div class="empty">
    <p class="empty-title">{replay.loading ? 'Loading candles…' : 'No chart loaded'}</p>
    {#if !replay.loading}<p class="dim">Pick a coin and timeframe, then press Load.</p>{/if}
  </div>
{/if}

{#if replay.loading && replay.info}
  <div class="loading">Loading…</div>
{/if}

{#if replay.info && !atLatest}
  <button type="button" class="btn sm latest" onclick={() => chartBridge.scrollToLatest?.()}>
    Latest <Icon name="latest" size={14} />
  </button>
{/if}

<style>
  .legend,
  .hint,
  .banner,
  .empty,
  .loading,
  .latest {
    position: absolute;
    z-index: 3;
  }

  /* Purely informational: never get in the way of the chart. */
  .legend {
    top: 10px;
    left: 12px;
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 12px;
    max-width: calc(100% - 100px);
    font-size: 12px;
    pointer-events: none;
  }

  .market {
    font-size: 14px;
    font-weight: 600;
  }

  .ohlc {
    display: inline-flex;
    gap: 5px;
    font-size: 11.5px;
  }

  .ohlc .faint {
    margin-left: 4px;
  }

  .mode {
    display: inline-flex;
    gap: 5px;
    padding: 1px 7px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--surface-2);
    font-size: 11.5px;
    font-weight: 500;
  }

  .hot {
    color: var(--amber);
  }

  .mode.reused {
    border-color: var(--amber);
    background: var(--amber-soft);
    color: var(--amber);
  }

  .hint {
    top: 38px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--text-2);
    font-size: 12px;
    white-space: nowrap;
    pointer-events: none;
  }

  .banner {
    top: 76px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 10px;
    max-width: min(600px, calc(100% - 120px));
    padding: 9px 8px 9px 12px;
    border: 1px solid var(--amber);
    border-radius: var(--radius);
    background: var(--surface-2);
    font-size: 12.5px;
  }

  .banner-text {
    color: var(--amber);
  }

  .empty {
    inset: 0;
    display: grid;
    place-content: center;
    gap: 4px;
    text-align: center;
    pointer-events: none;
  }

  .empty-title {
    font-size: 15px;
    font-weight: 500;
  }

  .loading {
    top: 10px;
    right: 84px;
    color: var(--text-2);
    font-size: 12px;
  }

  .latest {
    right: 78px;
    bottom: 40px;
  }
</style>
