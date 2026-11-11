<script lang="ts">
  // Which months of a coin's history have been replayed, across all sessions.
  import { DAY_MS, monthCoverage } from '$lib/engine/tested';
  import { display } from '$lib/state/display.svelte';
  import { replay } from '$lib/state/replay.svelte';
  import { tested } from '$lib/state/tested.svelte';

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const today = new Date();

  let picked = $state<string | null>(null);
  const coins = $derived(
    [...new Set([...(replay.info ? [replay.info.coin] : []), ...Object.keys(tested.byCoin)])].sort()
  );
  const coin = $derived(picked && coins.includes(picked) ? picked : (replay.info?.coin ?? coins[0] ?? null));
  const ranges = $derived(coin ? (tested.byCoin[coin] ?? []) : []);
  const rows = $derived.by(() => {
    const first = ranges.length ? new Date(ranges[0][0]).getUTCFullYear() : today.getFullYear();
    const years: number[] = [];
    for (let year = today.getFullYear(); year >= Math.min(first, today.getFullYear() - 1); year--) years.push(year);
    return years.map((year) => ({ year, months: monthCoverage(ranges, year, display.timeZone) }));
  });
  const days = $derived(ranges.reduce((total, [a, b]) => total + b - a, 0) / DAY_MS);

  const isFuture = (year: number, month: number) =>
    year > today.getFullYear() || (year === today.getFullYear() && month > today.getMonth());
  const fill = (share: number) =>
    share > 0 ? `color-mix(in srgb, var(--accent) ${Math.round(30 + 70 * share)}%, transparent)` : undefined;
</script>

{#if coin}
  <section class="tested">
    <div class="head">
      <p class="cap">Tested data <span class="sub">· all sessions</span></p>
      <select
        class="inp coin"
        value={coin}
        onchange={(event) => (picked = event.currentTarget.value)}
        aria-label="Coin to show tested months for"
      >
        {#each coins as option (option)}
          <option value={option}>{option}</option>
        {/each}
      </select>
    </div>

    <div class="grid">
      <span></span>
      {#each MONTHS as month (month)}
        <span class="faint label">{month[0]}</span>
      {/each}
      {#each rows as row (row.year)}
        <span class="faint num year">{row.year}</span>
        {#each row.months as share, month (month)}
          <span
            class="cell"
            class:future={isFuture(row.year, month)}
            style:background={fill(share)}
            title="{MONTHS[month]} {row.year}: {share > 0 ? `${Math.max(1, Math.round(share * 100))}% tested` : 'untested'}"
          ></span>
        {/each}
      {/each}
    </div>

    <p class="faint small">
      {days < 0.05 ? 'Nothing' : `${days.toFixed(1)} days`} of {coin} tested. Filled months have been replayed; the
      darker, the more of the month.
    </p>
  </section>
{/if}

<style>
  .tested {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .sub {
    font-weight: 400;
    letter-spacing: 0;
    text-transform: none;
  }

  .coin {
    width: 92px;
  }

  .grid {
    display: grid;
    grid-template-columns: 34px repeat(12, 1fr);
    gap: 3px;
    align-items: center;
  }

  .label {
    font-size: 10px;
    text-align: center;
  }

  .year {
    font-size: 11px;
  }

  .cell {
    aspect-ratio: 1;
    border: 1px solid var(--border);
    border-radius: 3px;
  }

  .cell.future {
    border-style: dashed;
    opacity: 0.4;
  }

  .small {
    font-size: 11.5px;
    line-height: 1.4;
  }
</style>
