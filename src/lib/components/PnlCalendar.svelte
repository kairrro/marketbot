<script lang="ts">
  // One month at a time: each day shows what the trades that closed in it made, each week a total.
  // The shade of a day follows how big it was next to the month's biggest day. Only months with trades are listed.
  import { DAY_MS, groupDays, monthOfDay, monthWeeks, type CalendarDay, type CalendarEntry } from '$lib/engine/calendar';
  import { fmtR, fmtSigned } from '$lib/format';
  import Icon from './ui/Icon.svelte';

  let {
    entries,
    dayOf,
    tested,
    sub,
    notes
  }: {
    entries: readonly CalendarEntry[];
    /** Which calendar day (counted from 1970-01-01) a time falls on: the zone the days are counted in. */
    dayOf: (ms: number) => number;
    /** The tested dates, if there are any: days outside them are dimmed. */
    tested?: { from: number; to: number };
    /** After "Day by day ·": what a day is. */
    sub: string;
    /** What the $ and % figures are, shown under the grid. */
    notes: { usd: string; pct: string };
  } = $props();

  type Unit = '$' | '%' | 'R';
  interface Cell {
    date: number;
    data: CalendarDay | null;
    /** Outside the tested dates. */
    out: boolean;
  }

  const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const UNITS: Unit[] = ['$', '%', 'R'];

  const label = (month: number) => `${SHORT[month % 12]} ${Math.floor(month / 12)}`;

  let unit = $state<Unit>('$');
  let picked = $state<number | null>(null);

  const days = $derived(groupDays(entries, dayOf));
  // Newest first: the recent months are the ones looked at most.
  const months = $derived([...new Set([...days.keys()].map(monthOfDay))].sort((a, b) => b - a));
  const shown = $derived(picked != null && months.includes(picked) ? picked : (months[0] ?? null));
  const at = $derived(shown == null ? -1 : months.indexOf(shown));

  const first = $derived(tested ? dayOf(tested.from) : -Infinity);
  const last = $derived(tested ? dayOf(tested.to - 1) : Infinity);

  const value = (x: { r: number; usd: number; pct: number }) => (unit === '$' ? x.usd : unit === '%' ? x.pct : x.r);
  // Under half a hundredth of the unit shows as zero: a flat day, never "−0.00R" in red.
  const zero = (v: number) => Math.abs(v) < 0.005;
  const money = (v: number) => `${v < 0 ? '−' : '+'}$${Math.abs(v) < 100 ? Math.abs(v).toFixed(2) : Math.round(Math.abs(v)).toLocaleString('en-US')}`;
  function show(x: { r: number; usd: number; pct: number }): string {
    const v = value(x);
    if (zero(v)) return unit === '$' ? '$0' : `0${unit}`;
    return unit === '$' ? money(v) : unit === '%' ? `${fmtSigned(v)}%` : fmtR(v);
  }
  const color = (x: { r: number; usd: number; pct: number }) => (zero(value(x)) ? '' : value(x) > 0 ? 'pos' : 'neg');

  const view = $derived.by(() => {
    if (shown == null) return null;
    const weeks = monthWeeks(shown).map((row) => {
      const cells = row.map<Cell | null>((day) =>
        day == null ? null : { date: new Date(day * DAY_MS).getUTCDate(), data: days.get(day) ?? null, out: day < first || day > last }
      );
      const traded = cells.flatMap((c) => (c?.data ? [c.data] : []));
      return {
        cells,
        total: { r: sum(traded, 'r'), usd: sum(traded, 'usd'), pct: sum(traded, 'pct') },
        trades: traded.reduce((n, d) => n + d.entries.length, 0)
      };
    });
    const traded = weeks.flatMap((w) => w.cells.flatMap((c) => (c?.data ? [c.data] : [])));
    return {
      weeks,
      biggest: Math.max(0, ...traded.map((d) => Math.abs(value(d)))),
      total: { r: sum(traded, 'r'), usd: sum(traded, 'usd'), pct: sum(traded, 'pct') },
      trades: traded.reduce((n, d) => n + d.entries.length, 0),
      green: traded.filter((d) => d.r >= 0.005).length,
      red: traded.filter((d) => d.r <= -0.005).length
    };
  });

  function sum(list: readonly CalendarDay[], key: 'r' | 'usd' | 'pct'): number {
    return list.reduce((total, d) => total + d[key], 0);
  }

  const tint = (d: CalendarDay) => `${Math.round(8 + (16 * Math.abs(value(d))) / (view?.biggest || 1))}%`;
  const tone = (d: CalendarDay | null) => (d == null || zero(value(d)) ? '' : value(d) > 0 ? 'win' : 'loss');
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const tip = (d: CalendarDay) =>
    d.entries
      .slice(0, 12)
      .map((e) => `${e.label}  ${fmtR(e.r)}`)
      .concat(d.entries.length > 12 ? [`+${d.entries.length - 12} more`] : [])
      .join('\n');
</script>

<section>
  <p class="cap">Day by day <span class="sub">· {sub}</span></p>

  {#if view && shown != null}
    <div class="bar">
      <div class="nav">
        <button
          type="button"
          class="btn quiet square"
          onclick={() => (picked = months[at + 1])}
          disabled={at >= months.length - 1}
          title="Earlier month with trades"
          aria-label="Earlier month with trades"
        >
          <Icon name="back" />
        </button>
        <select class="inp month" value={shown} onchange={(e) => (picked = Number(e.currentTarget.value))} aria-label="Month">
          {#each months as month (month)}<option value={month}>{label(month)}</option>{/each}
        </select>
        <button
          type="button"
          class="btn quiet square"
          onclick={() => (picked = months[at - 1])}
          disabled={at <= 0}
          title="Later month with trades"
          aria-label="Later month with trades"
        >
          <Icon name="forward" />
        </button>
      </div>

      <p class="sum">
        <span class="num strong {color(view.total)}">{show(view.total)}</span>
        <span class="faint">
          · {plural(view.trades, 'trade')} · {plural(view.green, 'green day')} · {plural(view.red, 'red day')}
        </span>
      </p>

      <div class="units" role="group" aria-label="Show P&L in">
        {#each UNITS as u (u)}
          <button type="button" class="chip" class:on={unit === u} aria-pressed={unit === u} onclick={() => (unit = u)}>{u}</button>
        {/each}
      </div>
    </div>

    <div class="cal">
      {#each WEEKDAYS as name (name)}<div class="head">{name}</div>{/each}
      <div class="head wk">Week</div>

      {#each view.weeks as week, w (w)}
        {#each week.cells as cell, i (i)}
          {#if cell}
            <div class="cell {tone(cell.data)}" class:out={cell.out} style:--tint={cell.data ? tint(cell.data) : undefined} title={cell.data ? tip(cell.data) : undefined}>
              <span class="d">{cell.date}</span>
              {#if cell.data}
                <span class="v num {color(cell.data)}">{show(cell.data)}</span>
                <span class="n">{plural(cell.data.entries.length, 'trade')}</span>
              {/if}
            </div>
          {:else}
            <div class="cell blank"></div>
          {/if}
        {/each}
        <div class="cell wk">
          {#if week.trades > 0}
            <span class="v num {color(week.total)}">{show(week.total)}</span>
            <span class="n">{plural(week.trades, 'trade')}</span>
          {/if}
        </div>
      {/each}
    </div>

    {#if unit !== 'R'}
      <p class="faint foot">{unit === '$' ? notes.usd : notes.pct}</p>
    {/if}
  {:else}
    <p class="faint foot">No trades to show.</p>
  {/if}
</section>

<style>
  .sub {
    font-weight: 400;
    letter-spacing: 0;
    text-transform: none;
  }

  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
    margin-top: 8px;
  }

  .nav {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .month {
    width: auto;
    min-width: 112px;
    font-weight: 500;
  }

  .sum {
    flex: 1;
    min-width: 0;
    font-size: 12px;
  }

  .strong {
    font-size: 14px;
    font-weight: 600;
  }

  .units {
    display: flex;
    gap: 4px;
  }

  .units .chip {
    min-width: 32px;
    padding: 0 8px;
    font-family: var(--font-mono);
  }

  .cal {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr)) minmax(0, 1.15fr);
    gap: 1px;
    margin-top: 8px;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--border);
  }

  .head {
    padding: 6px 9px;
    background: var(--surface);
    color: var(--text-3);
    font-size: 11px;
    font-weight: 500;
  }

  .cell {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-height: 78px;
    padding: 7px 9px;
    background-color: var(--surface);
  }

  .cell.blank {
    background-color: var(--bg);
  }

  .cell.wk {
    justify-content: flex-end;
    background-color: var(--surface-2);
  }

  .cell.win,
  .cell.loss {
    background-image: linear-gradient(var(--c), var(--c));
  }

  .cell.win {
    --c: color-mix(in srgb, var(--green) var(--tint), transparent);
  }

  .cell.loss {
    --c: color-mix(in srgb, var(--red) var(--tint), transparent);
  }

  /* Days before or after the tested dates: no trades could have happened. */
  .cell.out {
    opacity: 0.4;
  }

  .d {
    color: var(--text-3);
    font-size: 11px;
  }

  .v {
    margin-top: auto;
    font-size: 14px;
    font-weight: 500;
    line-height: 1.2;
  }

  .n {
    color: var(--text-3);
    font-size: 10.5px;
  }

  .foot {
    margin-top: 6px;
    font-size: 11.5px;
  }

  @media (max-width: 767px) {
    /* The summary gets a line of its own under the month picker and the units. */
    .sum {
      flex-basis: 100%;
      order: 3;
    }

    .units {
      margin-left: auto;
    }

    .cal {
      grid-template-columns: repeat(7, minmax(0, 1fr));
    }

    .wk {
      display: none;
    }

    .head {
      padding: 5px 4px;
      text-align: center;
    }

    .cell {
      min-height: 54px;
      padding: 4px 3px 4px 5px;
    }

    .v {
      font-size: 10px;
    }

    .n {
      display: none;
    }
  }
</style>
