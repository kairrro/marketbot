<script lang="ts">
  // Candle-replay backtester. This file is only the frame: each area is its own
  // component in $lib/components, and all logic lives in $lib/state and $lib/engine.
  import '$lib/styles/backtester.css';
  import { onMount } from 'svelte';
  import ChartPane from '$lib/components/ChartPane.svelte';
  import JournalDrawer from '$lib/components/JournalDrawer.svelte';
  import QuickJournal from '$lib/components/QuickJournal.svelte';
  import Sidebar from '$lib/components/Sidebar.svelte';
  import SessionSummary from '$lib/components/SessionSummary.svelte';
  import Toasts from '$lib/components/Toasts.svelte';
  import TopBar from '$lib/components/TopBar.svelte';
  import { savePrefs } from '$lib/state/prefs.svelte';
  import { handleKey, handleKeyUp } from '$lib/state/shortcuts';
  import { voice } from '$lib/state/voice.svelte';
  import { workspace } from '$lib/state/workspace.svelte';

  onMount(() => {
    // Loads the sessions and brings back the active one's chart.
    void workspace.init();

    // Set by hand rather than with <title>, so the rest of the app gets its
    // own tab title back when you navigate away.
    const previousTitle = document.title;
    document.title = 'Backtester';
    return () => {
      document.title = previousTitle;
    };
  });

  $effect(savePrefs);
  // Keeps the session's replay position and open trade saved as they change.
  $effect(() => workspace.watch());
</script>

<svelte:head>
  <link
    rel="stylesheet"
    href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap"
  />
</svelte:head>

<svelte:window onkeydown={handleKey} onkeyup={handleKeyUp} onblur={() => voice.stop()} />

<div class="bt">
  {#if workspace.ready}
    <TopBar />
    <div class="frame">
      <main class="main">
        <div class="stage">
          <ChartPane />
          <QuickJournal />
          <SessionSummary />
          <Toasts />
        </div>
        <JournalDrawer />
      </main>
      <Sidebar />
    </div>
  {:else}
    <p class="boot dim">Loading…</p>
  {/if}
</div>

<style>
  .frame {
    flex: 1;
    display: flex;
    min-height: 0;
  }

  .main {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }

  .stage {
    position: relative;
    flex: 1;
    display: flex;
    min-height: 0;
    /* The journal can be dragged over the whole chart area: nothing of the chart may show through. */
    overflow: hidden;
  }

  .boot {
    margin: auto;
  }
</style>
