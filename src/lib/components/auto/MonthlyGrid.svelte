<script lang="ts">
  // Total R of each month, years down and months across: the goal is a grid with as little red in it as possible.
  import type { Month } from '$lib/engine/auto/report';
  import { fmtR } from '$lib/format';

  let { months }: { months: readonly Month[] } = $props();

  const NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const rows = $derived(
    [...new Set(months.map((m) => m.year))].map((year) => {
      const own = months.filter((m) => m.year === year);
      return { year, cells: NAMES.map((_, i) => own.find((m) => m.month === i)), total: own.reduce((sum, m) => sum + m.r, 0) };
    })
  );

  const tone = (r: number) => (r > 0.05 ? 'pos' : r < -0.05 ? 'neg' : 'zero');
</script>

<section>
  <p class="cap">Month by month <span class="sub">· R after fees, by the month trades closed (UTC)</span></p>
  <div class="scroll">
    <table>
      <thead>
        <tr>
          <th></th>
          {#each NAMES as name (name)}<th class="r">{name}</th>{/each}
          <th class="r">Year</th>
        </tr>
      </thead>
      <tbody>
        {#each rows as row (row.year)}
          <tr>
            <td class="num dim">{row.year}</td>
            {#each row.cells as cell, i (i)}
              <td class="r num {cell ? tone(cell.r) : ''}">{cell ? cell.r.toFixed(1) : ''}</td>
            {/each}
            <td class="r num strong {tone(row.total)}">{fmtR(row.total, 1)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</section>

<style>
  .sub {
    font-weight: 400;
    letter-spacing: 0;
    text-transform: none;
  }

  .scroll {
    margin-top: 8px;
    overflow-x: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }

  table {
    width: 100%;
    font-size: 12px;
  }

  th,
  td {
    padding: 5px 8px;
    border-bottom: 1px solid var(--border);
    text-align: left;
    white-space: nowrap;
  }

  th {
    color: var(--text-3);
    font-size: 11px;
    font-weight: 500;
  }

  tbody tr:last-child td {
    border-bottom: 0;
  }

  .r {
    text-align: right;
  }

  .strong {
    font-weight: 600;
  }

  td.pos {
    background: var(--green-soft);
  }

  td.neg {
    background: var(--red-soft);
  }

  td.zero {
    color: var(--text-3);
  }
</style>
