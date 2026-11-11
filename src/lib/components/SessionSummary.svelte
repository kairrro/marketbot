<script lang="ts">
  // The session at a glance: totals, the same numbers split by Setup and by
  // Followed rules, what the trades cut early would have done had they been
  // held, then every trade in a list to scan. Covers the chart area; Esc closes it.
  import { untrack } from 'svelte';
  import { exitReasonOf, setupTypeLabel, type TradeRecord } from '$lib/engine/journal';
  import { computeStats } from '$lib/engine/stats';
  import { heldOutcome } from '$lib/engine/whatIf';
  import { fmtR, fmtShortDateTime, sign } from '$lib/format';
  import { display } from '$lib/state/display.svelte';
  import { journalCandles } from '$lib/state/journalCandles';
  import { sessions } from '$lib/state/sessions.svelte';
  import { ui } from '$lib/state/ui.svelte';
  import Icon from './ui/Icon.svelte';

  const trades = $derived(sessions.trades);
  const total = $derived(computeStats(trades));

  const dash = '–';
  const winRate = (value: number | null) => (value == null ? dash : `${value.toFixed(0)}%`);
  const r = (value: number | null) => (value == null ? dash : fmtR(value));

  // Trades tagged in the popup, or not at all. Older trades carry no tag.
  const splits = $derived([
    {
      title: 'Setup',
      groups: [
        { label: 'Trend', trades: trades.filter((t) => t.setupType === 'trend') },
        { label: 'Range', trades: trades.filter((t) => t.setupType === 'range') },
        { label: 'Not tagged', trades: trades.filter((t) => !t.setupType) }
      ]
    },
    {
      title: 'Followed rules',
      groups: [
        { label: 'Yes', trades: trades.filter((t) => t.followedRules === true) },
        { label: 'No', trades: trades.filter((t) => t.followedRules === false) },
        { label: 'Not answered', trades: trades.filter((t) => t.followedRules == null) }
      ]
    }
  ]);

  // ---- cut early: would holding have reached the take profit? ----

  const cutEarly = $derived(trades.filter((t) => exitReasonOf(t) === 'Cut early'));
  let held = $state.raw<{ target: number; stop: number; unknown: number } | null>(null);

  // Read each time the summary opens (the replay may have moved on since), and when the
  // set of trades changes — not on every note typed.
  const key = $derived(`${sessions.activeId}|${cutEarly.map((t) => t.id).join()}`);
  $effect(() => {
    void key;
    held = null;
    if (!ui.summaryOpen) return;
    let cancelled = false;
    void untrack(async () => {
      const list = $state.snapshot(cutEarly) as TradeRecord[];
      const found = await journalCandles(list);
      const counts = { target: 0, stop: 0, unknown: 0 };
      for (const { trade, data } of found) counts[heldOutcome(trade, data.after)]++;
      // Trades whose candles are no longer saved cannot be checked.
      counts.unknown += list.length - found.length;
      return counts;
    }).then((counts) => {
      if (!cancelled) held = counts;
    });
    return () => {
      cancelled = true;
    };
  });

  const exitClass = { Target: 'pos', Stopped: 'neg', 'Cut early': 'amber' } as const;

  function tagsOf(trade: TradeRecord): string {
    return trade.tags.join(', ');
  }
</script>

{#if ui.summaryOpen}
  <section class="summary" aria-label="Session summary">
    <header class="top">
      <h2>Session summary <span class="dim">· {sessions.active.name}</span></h2>
      <button type="button" class="btn quiet sm" onclick={() => (ui.summaryOpen = false)}>
        <Icon name="close" size={13} /> Close <kbd>Esc</kbd>
      </button>
    </header>

    <div class="scroll">
      {#if trades.length === 0}
        <p class="dim empty">No trades in this session yet.</p>
      {:else}
        <dl class="tiles">
          <div><dt>Trades</dt><dd class="num">{total.trades}</dd></div>
          <div><dt>Win rate</dt><dd class="num">{winRate(total.winRate)}</dd></div>
          <div><dt>Average R</dt><dd class="num {sign(total.avgR ?? 0)}">{r(total.avgR)}</dd></div>
          <div><dt>Total R</dt><dd class="num {sign(total.totalR)}">{fmtR(total.totalR)}</dd></div>
        </dl>

        <div class="splits">
          {#each splits as split (split.title)}
            <div>
              <p class="cap">By {split.title}</p>
              <table>
                <thead>
                  <tr><th></th><th class="r">Trades</th><th class="r">Win rate</th><th class="r">Avg R</th><th class="r">Total R</th></tr>
                </thead>
                <tbody>
                  {#each split.groups as group (group.label)}
                    {@const s = computeStats(group.trades)}
                    {#if group.trades.length > 0 || !group.label.startsWith('Not')}
                      <tr class:faint={group.trades.length === 0}>
                        <td>{group.label}</td>
                        <td class="r num">{s.trades}</td>
                        <td class="r num">{winRate(s.winRate)}</td>
                        <td class="r num {sign(s.avgR ?? 0)}">{r(s.avgR)}</td>
                        <td class="r num {sign(s.totalR)}">{s.trades ? fmtR(s.totalR) : dash}</td>
                      </tr>
                    {/if}
                  {/each}
                </tbody>
              </table>
            </div>
          {/each}
        </div>

        <div>
          <p class="cap">Cut early</p>
          {#if cutEarly.length === 0}
            <p class="note">No trades were closed by hand before the target or the stop.</p>
          {:else if held === null}
            <p class="note">Checking the candles after your exits…</p>
          {:else}
            <p class="note cut">
              <span class="num strong">{cutEarly.length}</span> cut early:
              <span class="num strong pos">{held.target}</span> would have hit the take profit if held,
              <span class="num strong neg">{held.stop}</span> would have hit the stop first{#if held.unknown > 0}, and
                <span class="num strong">{held.unknown}</span> can't be told (not enough candles after the exit){/if}.
            </p>
          {/if}
        </div>

        <div>
          <p class="cap">All trades</p>
          <table class="list">
            <thead>
              <tr>
                <th class="r">#</th>
                <th>Time</th>
                <th>Market</th>
                <th>Tags</th>
                <th>Exit</th>
                <th class="r">R</th>
                <th class="note-col">Note</th>
              </tr>
            </thead>
            <tbody>
              {#each trades as trade, i (trade.id)}
                {@const reason = exitReasonOf(trade)}
                <tr>
                  <td class="r num faint">{i + 1}</td>
                  <td class="num dim">{fmtShortDateTime(trade.entryTime, display.timeZone)}</td>
                  <td>
                    <span class={trade.side === 'long' ? 'pos' : 'neg'}>{trade.side === 'long' ? '▲' : '▼'}</span>
                    <span class="strong">{trade.coin}</span>
                  </td>
                  <td>
                    {#if trade.setupType}<span class="tag">{setupTypeLabel(trade.setupType)}</span>{/if}
                    {#if trade.followedRules != null}
                      <span class="tag" class:warn={!trade.followedRules}>{trade.followedRules ? 'Rules ✓' : 'Rules ✗'}</span>
                    {/if}
                    {#if tagsOf(trade)}<span class="faint" title="Older tags">{tagsOf(trade)}</span>{/if}
                    {#if !trade.setupType && trade.followedRules == null && !tagsOf(trade)}<span class="faint">–</span>{/if}
                  </td>
                  <td class={reason ? exitClass[reason] : 'faint'}>{reason ?? dash}</td>
                  <td class="r num strong {sign(trade.r)}">{fmtR(trade.r)}</td>
                  <td class="note-col">
                    <input
                      class="quiet-inp"
                      value={trade.notes}
                      placeholder="–"
                      aria-label="Note for trade {i + 1}"
                      onchange={(event) => sessions.updateTrade(trade.id, { notes: event.currentTarget.value })}
                    />
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </div>
  </section>
{/if}

<style>
  .summary {
    position: absolute;
    inset: 0;
    z-index: 8;
    display: flex;
    flex-direction: column;
    background: var(--bg);
  }

  .top {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 14px;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
  }

  h2 {
    font-size: 14px;
    font-weight: 600;
  }

  h2 .dim {
    font-weight: 400;
  }

  .scroll {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 18px;
    min-height: 0;
    overflow-y: auto;
    padding: 16px 14px 24px;
  }

  /* Sections keep their height; the page scrolls instead of squashing them. */
  .scroll > :global(*) {
    flex: none;
  }

  .empty {
    margin: auto;
  }

  .tiles {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 1px;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--border);
  }

  .tiles div {
    padding: 10px 14px;
    background: var(--surface-2);
  }

  .tiles dt {
    color: var(--text-2);
    font-size: 11.5px;
  }

  .tiles dd {
    margin-top: 2px;
    font-size: 20px;
    font-weight: 600;
  }

  .splits {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
    gap: 18px;
  }

  .cap {
    margin-bottom: 6px;
  }

  table {
    width: 100%;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    font-size: 12px;
  }

  th,
  td {
    padding: 6px 10px;
    text-align: left;
    white-space: nowrap;
  }

  th {
    color: var(--text-3);
    font-size: 10.5px;
    font-weight: 500;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  tbody tr {
    border-top: 1px solid var(--border);
  }

  .r {
    text-align: right;
  }

  .strong {
    font-weight: 600;
  }

  .cut {
    line-height: 1.6;
  }

  .tag {
    display: inline-block;
    margin-right: 4px;
    padding: 0 7px;
    border: 1px solid var(--border);
    border-radius: 999px;
    color: var(--text-2);
    font-size: 11.5px;
  }

  .tag.warn {
    border-color: transparent;
    background: var(--amber-soft);
    color: var(--amber);
  }

  .list td {
    vertical-align: middle;
  }

  .note-col {
    width: 100%;
    min-width: 200px;
    white-space: normal;
  }

  .quiet-inp {
    width: 100%;
    padding: 2px 6px;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text);
    font-size: 12px;
  }

  .quiet-inp:hover {
    border-color: var(--border);
  }

  .quiet-inp:focus {
    outline: none;
    border-color: var(--accent);
    background: var(--surface-2);
  }

  @media (max-width: 760px) {
    .tiles {
      grid-template-columns: repeat(2, 1fr);
    }
  }
</style>
