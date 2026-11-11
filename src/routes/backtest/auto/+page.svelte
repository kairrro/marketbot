<script lang="ts">
  // The automatic backtester: the breakout strategy's rules run over a date range, no choices made by hand.
  import '$lib/styles/backtester.css';
  import { onMount } from 'svelte';
  import AutoForm from '$lib/components/auto/AutoForm.svelte';
  import AutoResults from '$lib/components/auto/AutoResults.svelte';
  import RulesPanel from '$lib/components/auto/RulesPanel.svelte';
  import Icon from '$lib/components/ui/Icon.svelte';
  import { auto } from '$lib/state/auto.svelte';

  $effect(() => auto.saveSettings());

  onMount(() => {
    void auto.init();
    const previousTitle = document.title;
    document.title = 'Auto backtest';
    return () => {
      document.title = previousTitle;
    };
  });
</script>

<svelte:head>
  <link
    rel="stylesheet"
    href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap"
  />
</svelte:head>

<div class="bt">
  <header class="bar">
    <a class="btn quiet square" href="/backtest" title="Back to the replay" aria-label="Back to the replay">
      <Icon name="back" />
    </a>
    <h1 class="title">Auto backtest</h1>
    <span class="sep"></span>
    <AutoForm />
  </header>
  <div class="frame">
    <aside class="rules">
      <RulesPanel />
    </aside>
    <main class="body">
      <AutoResults />
    </main>
  </div>
</div>

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

  .title {
    font-size: 14px;
    font-weight: 600;
  }

  .sep {
    width: 1px;
    height: 20px;
    margin: 0 4px;
    background: var(--border);
  }

  .frame {
    flex: 1;
    display: flex;
    min-height: 0;
  }

  .rules {
    flex: none;
    width: 340px;
    overflow-y: auto;
    padding: 14px;
    border-right: 1px solid var(--border);
    background: var(--surface);
  }

  .body {
    flex: 1;
    min-width: 0;
    overflow-y: auto;
    padding: 16px;
  }

  @media (max-width: 767px) {
    .sep {
      display: none;
    }

    .frame {
      flex-direction: column;
      overflow-y: auto;
    }

    .rules {
      width: auto;
      overflow: visible;
      border-right: 0;
      border-bottom: 1px solid var(--border);
    }

    .body {
      overflow: visible;
      padding: 12px;
    }
  }
</style>
