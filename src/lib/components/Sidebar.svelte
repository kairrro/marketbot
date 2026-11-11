<script lang="ts">
  import { ui, type SidebarTab } from '$lib/state/ui.svelte';
  import SettingsTab from './SettingsTab.svelte';
  import StatsTab from './StatsTab.svelte';
  import TradeTab from './TradeTab.svelte';

  const tabs: { id: SidebarTab; label: string }[] = [
    { id: 'trade', label: 'Trade' },
    { id: 'stats', label: 'Stats' },
    { id: 'settings', label: 'Settings' }
  ];
</script>

<aside class="side">
  <div class="tabs" role="tablist" aria-label="Sidebar">
    {#each tabs as tab (tab.id)}
      <button
        type="button"
        role="tab"
        class="tab"
        class:on={ui.tab === tab.id}
        aria-selected={ui.tab === tab.id}
        onclick={() => (ui.tab = tab.id)}
      >
        {tab.label}
      </button>
    {/each}
  </div>

  <div class="body" role="tabpanel">
    {#if ui.tab === 'trade'}
      <TradeTab />
    {:else if ui.tab === 'stats'}
      <StatsTab />
    {:else}
      <SettingsTab />
    {/if}
  </div>
</aside>

<style>
  .side {
    flex: none;
    display: flex;
    flex-direction: column;
    width: 320px;
    min-height: 0;
    border-left: 1px solid var(--border);
    background: var(--surface);
  }

  .tabs {
    flex: none;
    display: flex;
    gap: 2px;
    padding: 0 10px;
    border-bottom: 1px solid var(--border);
  }

  .tab {
    position: relative;
    height: 38px;
    padding: 0 10px;
    color: var(--text-2);
    font-weight: 500;
    transition: color 0.12s;
  }

  .tab:hover {
    color: var(--text);
  }

  .tab.on {
    color: var(--text);
  }

  .tab.on::after {
    content: '';
    position: absolute;
    right: 10px;
    bottom: -1px;
    left: 10px;
    height: 2px;
    border-radius: 2px 2px 0 0;
    background: var(--accent);
  }

  .body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 14px;
  }
</style>
