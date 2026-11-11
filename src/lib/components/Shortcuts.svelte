<script lang="ts">
  const shortcuts: { keys: string[]; label: string }[] = [
    { keys: ['→'], label: 'Next candle' },
    { keys: ['Shift', '→'], label: '+10 candles' },
    { keys: ['Space'], label: 'Play / pause' },
    { keys: ['B'], label: 'Long' },
    { keys: ['S'], label: 'Short' },
    { keys: ['L'], label: 'Level' },
    { keys: ['R'], label: 'Zone' },
    { keys: ['M'], label: 'Measure' },
    { keys: ['A'], label: 'ATR on / off' },
    { keys: ['Enter'], label: 'Confirm trade' },
    { keys: ['Esc'], label: 'Cancel' },
    { keys: ['1'], label: 'Trend (after a trade)' },
    { keys: ['2'], label: 'Range (after a trade)' },
    { keys: ['Y'], label: 'Followed rules' },
    { keys: ['N'], label: 'Broke rules' },
    { keys: ['V'], label: 'Hold: voice note' },
    { keys: ['Del'], label: 'Delete drawing' }
  ];
</script>

<details class="keys">
  <summary class="cap">Shortcuts</summary>
  <ul>
    {#each shortcuts as shortcut (shortcut.label)}
      <li>
        <span class="combo">
          {#each shortcut.keys as key (key)}<kbd>{key}</kbd>{/each}
        </span>
        <span class="dim">{shortcut.label}</span>
      </li>
    {/each}
  </ul>
  <p class="faint tip">Shift+drag on the chart also measures. Click a zone to select it, then drag it or its corners.</p>
</details>

<style>
  .keys {
    padding-top: 12px;
    border-top: 1px solid var(--border);
  }

  summary {
    cursor: pointer;
    list-style: none;
  }

  summary::-webkit-details-marker {
    display: none;
  }

  summary::after {
    content: ' ▸';
  }

  details[open] > summary::after {
    content: ' ▾';
  }

  ul {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px 10px;
    margin-top: 8px;
  }

  li {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 11.5px;
    white-space: nowrap;
  }

  .combo {
    display: inline-flex;
    gap: 3px;
  }

  .tip {
    margin-top: 8px;
    font-size: 11.5px;
  }
</style>
