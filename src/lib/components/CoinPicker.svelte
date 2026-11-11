<script lang="ts">
  // The coin field. As you type it suggests the coins the source lists,
  // busiest first. ↑/↓ and Enter pick one; Enter on a coin typed in full submits the form.
  import { matchCoins, normalizeCoin, type Source } from '$lib/data';
  import { fmtCompactMoney } from '$lib/format';
  import { coinLists } from '$lib/state/coins.svelte';
  import { tested } from '$lib/state/tested.svelte';

  let { value = $bindable(), source }: { value: string; source: Source } = $props();

  const id = $props.id();
  let open = $state(false);
  let active = $state(-1);
  const matches = $derived(open ? matchCoins(coinLists.get(source), value) : []);

  function show() {
    open = true;
    active = -1;
    void coinLists.load(source);
  }

  function pick(coin: string) {
    value = coin;
    open = false;
    active = -1;
  }

  function onkeydown(event: KeyboardEvent) {
    const count = matches.length;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) return show();
      const down = event.key === 'ArrowDown';
      if (count > 0) active = active < 0 ? (down ? 0 : count - 1) : (active + (down ? 1 : count - 1)) % count;
    } else if (event.key === 'Enter' && open && matches[active]) {
      const coin = matches[active].coin;
      open = false;
      // Already typed in full: let Enter submit the form and load it.
      if (coin === normalizeCoin(value)) return;
      event.preventDefault();
      pick(coin);
    }
  }
</script>

<div class="picker">
  <input
    class="inp coin num"
    bind:value
    role="combobox"
    aria-expanded={matches.length > 0}
    aria-controls="{id}-list"
    aria-autocomplete="list"
    aria-activedescendant={active >= 0 ? `${id}-${active}` : undefined}
    title={source === 'stocks' ? 'Ticker (NQ, ES, NAS100, AAPL…)' : 'Coin'}
    aria-label={source === 'stocks' ? 'Ticker' : 'Coin'}
    placeholder={source === 'stocks' ? 'Ticker' : 'Coin'}
    spellcheck="false"
    autocomplete="off"
    onfocus={show}
    onblur={() => (open = false)}
    oninput={() => {
      show();
      if (value.trim()) active = 0;
    }}
    {onkeydown}
  />

  {#if matches.length > 0}
    <ul class="list" id="{id}-list" role="listbox" aria-label="Coins">
      {#each matches as item, i (item.coin)}
        <li
          id="{id}-{i}"
          role="option"
          aria-selected={i === active}
          class:active={i === active}
          onmousedown={(event) => {
            // Keeps focus in the field, so blur does not close the list first.
            event.preventDefault();
            pick(item.coin);
          }}
          onpointermove={() => (active = i)}
        >
          <span class="num name">{item.coin}</span>
          {#if tested.byCoin[item.coin]?.length}<span class="faint tag">tested</span>{/if}
          {#if item.volume > 0}<span class="faint num vol" title="24h volume">{fmtCompactMoney(item.volume)}</span>{/if}
          {#if item.name}<span class="faint vol">{item.name}</span>{/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .picker {
    position: relative;
  }

  .coin {
    width: 70px;
    font-weight: 500;
  }

  .list {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    z-index: 30;
    width: 240px;
    max-height: 340px;
    overflow-y: auto;
    padding: 4px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface-2);
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4);
  }

  li {
    display: flex;
    align-items: baseline;
    gap: 8px;
    height: 28px;
    padding: 0 8px;
    line-height: 28px;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  li.active {
    background: var(--surface-3);
  }

  .name {
    font-weight: 500;
  }

  .tag {
    font-size: 10.5px;
  }

  .vol {
    margin-left: auto;
    font-size: 11.5px;
  }
</style>
