<script lang="ts">
  import { ui } from '$lib/state/ui.svelte';
  import { voice } from '$lib/state/voice.svelte';
  import DataControls from './DataControls.svelte';
  import ReplayControls from './ReplayControls.svelte';
  import SessionMenu from './SessionMenu.svelte';
  import ToolButtons from './ToolButtons.svelte';
  import Icon from './ui/Icon.svelte';
</script>

<header class="bar">
  <a class="btn quiet square" href="/" title="Back to Marketbot" aria-label="Back to Marketbot">
    <Icon name="back" />
  </a>
  <SessionMenu />
  <span class="sep"></span>
  <DataControls />
  <span class="sep"></span>
  <ReplayControls />
  <span class="sep"></span>
  <ToolButtons />
  <div class="end">
    <button
      type="button"
      class="btn"
      title="Stats and every trade of this session"
      onclick={() => {
        ui.promptId = null;
        voice.dismiss();
        ui.summaryOpen = true;
      }}
    >
      Session summary
    </button>
    <a class="btn" href="/backtest/auto" title="Run the strategy's rules over a date range automatically">
      Auto backtest
    </a>
  </div>
</header>

<style>
  .bar {
    flex: none;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 8px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
  }

  .end {
    display: flex;
    gap: 8px;
    margin-left: auto;
  }

  .sep {
    width: 1px;
    height: 20px;
    margin: 0 4px;
    background: var(--border);
  }
</style>
