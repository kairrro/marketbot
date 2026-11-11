<script lang="ts">
  // Bottom drawer: the trade journal for the active session. Drag its top edge
  // to resize it, up to the whole chart area (or use the expand button). The
  // trades are listed across the full width; clicking one opens its details
  // under it, and ↑/↓ move the open one through them.
  import { TAGS, type TradeRecord } from '$lib/engine/journal';
  import { fmtR, sign } from '$lib/format';
  import { exportCsv } from '$lib/state/sessionActions';
  import { sessions } from '$lib/state/sessions.svelte';
  import { ui } from '$lib/state/ui.svelte';
  import JournalTable from './JournalTable.svelte';
  import Icon from './ui/Icon.svelte';

  type RulesFilter = 'all' | 'yes' | 'no' | 'unset';
  type ResultFilter = 'all' | 'win' | 'loss';

  /** Shortest the open journal can be dragged to. */
  const MIN_HEIGHT = 160;
  /** Dragged this close to the top, it snaps to the full chart area. */
  const SNAP = 32;

  let coin = $state('all');
  let tag = $state('all');
  let rules = $state<RulesFilter>('all');
  let result = $state<ResultFilter>('all');
  /** The height while the edge is being dragged. Saved to the prefs only once let go. */
  let dragHeight = $state<number | null>(null);
  let drawer: HTMLElement;

  const coins = $derived([...new Set(sessions.trades.map((t) => t.coin))].sort());

  function matches(t: TradeRecord): boolean {
    if (coin !== 'all' && t.coin !== coin) return false;
    if (tag !== 'all' && !t.tags.includes(tag)) return false;
    if (result === 'win' && !(t.r > 0)) return false;
    if (result === 'loss' && !(t.r <= 0)) return false;
    if (rules === 'yes') return t.followedRules === true;
    if (rules === 'no') return t.followedRules === false;
    if (rules === 'unset') return t.followedRules == null;
    return true;
  }

  // Numbered in the order taken, shown newest first.
  const rows = $derived(
    sessions.trades
      .map((t, i) => ({ trade: t, number: i + 1 }))
      .filter((row) => matches(row.trade))
      .reverse()
  );
  const filtered = $derived(coin !== 'all' || tag !== 'all' || rules !== 'all' || result !== 'all');
  const totalR = $derived(rows.reduce((total, row) => total + row.trade.r, 0));
  const index = $derived(rows.findIndex((row) => row.trade.id === ui.detailId));
  const height = $derived(ui.journalFull && dragHeight == null ? '100%' : `${dragHeight ?? ui.journalHeight}px`);

  // A coin filter cannot outlive the last trade on that coin.
  $effect(() => {
    if (coin !== 'all' && !coins.includes(coin)) coin = 'all';
  });

  function clearFilters() {
    coin = 'all';
    tag = 'all';
    rules = 'all';
    result = 'all';
  }

  /** Opens the next trade up or down the list; with none open, the newest. */
  function step(by: number) {
    const next = rows[Math.min(rows.length - 1, Math.max(0, index + by))];
    if (next) ui.detailId = next.trade.id;
  }

  function onkeydown(event: KeyboardEvent) {
    if (!ui.journalOpen || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target;
    if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select'))) return;
    event.preventDefault();
    step(event.key === 'ArrowDown' ? 1 : -1);
  }

  function startResize(event: PointerEvent) {
    const handle = event.currentTarget as HTMLElement;
    const area = drawer.parentElement;
    if (!area || event.button !== 0) return;
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    const bottom = area.getBoundingClientRect().bottom;
    const max = area.clientHeight;
    ui.journalOpen = true;
    ui.journalResizing = true;

    // Mice report far more often than the screen redraws: one layout per frame is plenty.
    let frame = 0;
    let y = event.clientY;
    const move = (e: PointerEvent) => {
      y = e.clientY;
      frame ||= requestAnimationFrame(() => {
        frame = 0;
        dragHeight = Math.round(Math.min(max, Math.max(MIN_HEIGHT, bottom - y)));
      });
    };
    const end = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      cancelAnimationFrame(frame);
      ui.journalResizing = false;
      if (dragHeight == null) return;
      ui.journalFull = dragHeight >= max - SNAP;
      if (!ui.journalFull) ui.journalHeight = dragHeight;
      dragHeight = null;
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }
</script>

<svelte:window {onkeydown} />

<section
  class="drawer"
  class:open={ui.journalOpen}
  class:dragging={dragHeight != null}
  style:height={ui.journalOpen ? height : null}
  bind:this={drawer}
>
  <div
    class="grip"
    role="separator"
    aria-orientation="horizontal"
    aria-label="Resize journal"
    title="Drag to resize · double-click to fill the screen"
    onpointerdown={startResize}
    ondblclick={() => {
      ui.journalOpen = true;
      ui.journalFull = !ui.journalFull;
    }}
  ></div>

  <header class="head">
    <button
      type="button"
      class="toggle"
      aria-expanded={ui.journalOpen}
      onclick={() => (ui.journalOpen = !ui.journalOpen)}
    >
      <Icon name={ui.journalOpen ? 'chevron' : 'chevronUp'} size={14} />
      <span class="title">Journal</span>
      <span class="num dim">{rows.length}{filtered ? ` of ${sessions.trades.length}` : ''}</span>
      {#if rows.length > 0}
        <span class="num {sign(totalR)}">{fmtR(totalR)}</span>
      {/if}
    </button>

    {#if ui.journalOpen}
      <div class="filters">
        <select class="inp" bind:value={result} aria-label="Filter by result">
          <option value="all">Wins &amp; losses</option>
          <option value="win">Wins</option>
          <option value="loss">Losses</option>
        </select>
        {#if coins.length > 1}
          <select class="inp" bind:value={coin} aria-label="Filter by market">
            <option value="all">All markets</option>
            {#each coins as option (option)}
              <option value={option}>{option}</option>
            {/each}
          </select>
        {/if}
        <select class="inp" bind:value={rules} aria-label="Filter by followed rules">
          <option value="all">Rules: any</option>
          <option value="yes">Followed rules</option>
          <option value="no">Broke rules</option>
          <option value="unset">Not answered</option>
        </select>
        <select class="inp" bind:value={tag} aria-label="Filter by tag">
          <option value="all">All tags</option>
          {#each TAGS as option (option)}
            <option value={option}>{option}</option>
          {/each}
        </select>
        {#if filtered}
          <button type="button" class="btn quiet sm" onclick={clearFilters}>Clear</button>
        {/if}
      </div>
      <button type="button" class="btn quiet sm" onclick={exportCsv} title="Export the journal as CSV">
        <Icon name="download" size={13} /> CSV
      </button>
      <button
        type="button"
        class="btn quiet sm square"
        onclick={() => (ui.journalFull = !ui.journalFull)}
        title={ui.journalFull ? 'Restore size' : 'Fill the screen'}
        aria-label={ui.journalFull ? 'Restore size' : 'Fill the screen'}
      >
        <Icon name={ui.journalFull ? 'shrink' : 'expand'} size={14} />
      </button>
    {/if}
  </header>

  {#if ui.journalOpen}
    <div class="list">
      <JournalTable {rows} empty={filtered ? 'No trades match these filters.' : 'No trades yet.'} />
    </div>
  {/if}
</section>

<style>
  .drawer {
    position: relative;
    flex: none;
    display: flex;
    flex-direction: column;
    max-height: 100%;
    border-top: 1px solid var(--border);
    background: var(--surface);
  }

  .grip {
    position: absolute;
    top: -4px;
    left: 0;
    right: 0;
    z-index: 5;
    height: 8px;
    cursor: row-resize;
    touch-action: none;
  }

  .grip::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 50%;
    width: 36px;
    height: 4px;
    margin-left: -18px;
    border-radius: 2px;
    background: var(--border-strong);
  }

  .grip:hover,
  .dragging .grip {
    background: linear-gradient(transparent 3px, var(--accent) 3px, var(--accent) 5px, transparent 5px);
  }

  .dragging {
    user-select: none;
  }

  .head {
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 38px;
    padding: 0 8px 0 4px;
  }

  .toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 38px;
    padding: 0 8px;
    color: var(--text-2);
    font-size: 12px;
  }

  .toggle:hover {
    color: var(--text);
  }

  .title {
    color: var(--text);
    font-size: 13px;
    font-weight: 500;
  }

  .filters {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 6px;
    min-width: 0;
  }

  .filters .inp {
    width: auto;
    height: 24px;
    padding-left: 8px;
    font-size: 12px;
  }

  .list {
    flex: 1;
    min-height: 0;
    overflow: auto;
    border-top: 1px solid var(--border);
  }
</style>
