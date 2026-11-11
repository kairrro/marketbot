<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from '$lib/components/ui/Icon.svelte';

  type Watch = {
    id: number;
    symbol: string;
    targetPrice: number | null;
    direction: 'ABOVE' | 'BELOW' | null;
    armed: boolean;
    createdAt: number;
    triggeredAt: number | null;
  };

  let watches = $state<Watch[]>([]);
  let symbol = $state('');
  // A number input's bind:value gives an actual number (or null when empty),
  // not a string — despite the placeholder text this was previously typed
  // and treated as a string, so calling .trim() on it crashed as soon as a
  // real number was entered, silently killing the whole submit.
  let targetPrice = $state<number | null>(null);
  let direction = $state<'ABOVE' | 'BELOW'>('ABOVE');
  let loading = $state(true);
  let error = $state('');

  async function loadWatches() {
    try {
      const res = await fetch('/api/watchlist');
      if (!res.ok) throw new Error('Failed to load watchlist');
      watches = await res.json();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  }

  async function addWatch() {
    error = '';
    const targetSymbol = symbol.trim().toUpperCase();
    if (!targetSymbol) {
      error = 'Enter a symbol.';
      return;
    }

    const hasPrice = targetPrice != null;
    if (targetPrice != null && (!Number.isFinite(targetPrice) || targetPrice <= 0)) {
      error = 'Target price must be a positive number, or leave it blank to just watch.';
      return;
    }

    const res = await fetch('/api/watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbol: targetSymbol,
        ...(hasPrice ? { targetPrice, direction } : {}),
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      error = body.error ?? 'Failed to add watch.';
      return;
    }

    watches = [await res.json(), ...watches];
    symbol = '';
    targetPrice = null;
  }

  async function removeWatch(id: number) {
    await fetch('/api/watchlist', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    watches = watches.filter((watch) => watch.id !== id);
  }

  async function toggleWatch(watch: Watch) {
    const armed = !watch.armed;

    await fetch('/api/watchlist', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: watch.id, armed }),
    });

    watches = watches.map((item) =>
      item.id === watch.id
        ? { ...item, armed, triggeredAt: armed ? null : item.triggeredAt }
        : item
    );
  }

  onMount(() => {
    loadWatches();
  });
</script>

<svelte:head><title>Watchlist · Marketbot</title></svelte:head>

<div class="page narrow">
  <header class="page-head">
    <div>
      <h1 class="page-title">Perp watchlist</h1>
      <p class="page-sub">A price target is optional. Add one to get a Discord alert when it is hit.</p>
    </div>
    <a href="/" class="btn quiet go">Discover coins <Icon name="arrow" size={13} /></a>
  </header>

  <form
    class="card form rise"
    onsubmit={(event) => {
      event.preventDefault();
      addWatch();
    }}
  >
    <input bind:value={symbol} placeholder="BTC_USDT" class="inp" aria-label="Symbol" />
    <input
      bind:value={targetPrice}
      type="number"
      step="any"
      min="0"
      placeholder="Target price (optional)"
      class="inp"
      aria-label="Target price"
    />
    <select bind:value={direction} class="inp" aria-label="Direction">
      <option value="ABOVE">At / above</option>
      <option value="BELOW">At / below</option>
    </select>
    <button class="btn primary" type="submit"><Icon name="plus" size={14} /> Add</button>

    {#if error}
      <p class="note bad full">{error}</p>
    {/if}
  </form>

  {#if loading}
    <p class="faint">Loading…</p>
  {:else if watches.length === 0}
    <div class="card empty fade">
      <span class="eico"><Icon name="eye" size={20} /></span>
      <p class="big">Nothing watched yet</p>
      <p class="dim">Add a symbol above, or pick coins from Discover.</p>
    </div>
  {:else}
    <div class="scroll">
      <table class="tbl fade">
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Price alert</th>
            <th>Status</th>
            <th class="r">Actions</th>
          </tr>
        </thead>
        <tbody>
          {#each watches as watch, i (watch.id)}
            <tr class="rise" style="--i:{Math.min(i, 10)}">
              <td class="sym">{watch.symbol}</td>
              <td class="num">
                {#if watch.targetPrice != null}
                  <span class="dim">{watch.direction === 'ABOVE' ? '≥' : '≤'}</span> {watch.targetPrice}
                {:else}
                  <span class="faint">–</span>
                {/if}
              </td>
              <td>
                {#if watch.targetPrice == null}
                  <span class="pill">Watching only</span>
                {:else if watch.armed}
                  <span class="pill armed"><i></i>Armed</span>
                {:else}
                  <span class="pill {watch.triggeredAt ? 'done' : ''}">{watch.triggeredAt ? 'Triggered' : 'Paused'}</span>
                {/if}
              </td>
              <td class="r">
                <span class="actions">
                  {#if watch.targetPrice != null}
                    <button class="btn quiet sm" type="button" onclick={() => toggleWatch(watch)}>
                      {watch.armed ? 'Pause' : 'Re-arm'}
                    </button>
                  {/if}
                  <button class="btn quiet sm danger" type="button" onclick={() => removeWatch(watch.id)}>Delete</button>
                </span>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

<style>
  .narrow {
    max-width: 920px;
  }

  .go {
    flex: none;
  }

  .form {
    display: grid;
    grid-template-columns: 1fr 1fr 150px auto;
    gap: 8px;
    margin-bottom: 22px;
  }

  .full {
    grid-column: 1 / -1;
  }

  .scroll {
    overflow-x: auto;
  }

  .sym {
    font-weight: 600;
    letter-spacing: -0.01em;
  }

  .pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 22px;
    padding: 0 9px;
    border-radius: 999px;
    background: var(--surface-3);
    color: var(--text-2);
    font-size: 12px;
    font-weight: 500;
  }

  .pill i {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
  }

  .pill.armed {
    background: var(--green-soft);
    color: var(--green);
  }

  .pill.armed i {
    animation: pulse 2.4s ease-out infinite;
  }

  .pill.done {
    background: var(--accent-soft);
    color: var(--accent-hover);
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.35;
    }
  }

  .actions {
    display: inline-flex;
    gap: 4px;
  }

  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 44px 20px;
    text-align: center;
  }

  .eico {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    margin-bottom: 4px;
    border-radius: 12px;
    background: var(--accent-soft);
    color: var(--accent-hover);
  }

  .big {
    font-size: 15px;
    font-weight: 600;
  }

  @media (max-width: 720px) {
    .form {
      grid-template-columns: 1fr;
    }
  }
</style>
