<script lang="ts">
  import './layout.css';
  import '$lib/styles/app.css';
  import favicon from '$lib/assets/favicon.svg';
  import { page } from '$app/stores';
  import AppNav from '$lib/components/shell/AppNav.svelte';

  let { children } = $props();

  // The backtester is a full-screen tool with its own top bar and styles, so
  // it renders without the sidebar shell.
  const fullscreen = $derived($page.url.pathname.startsWith('/backtest'));
</script>

<svelte:head>
  <link rel="icon" href={favicon} />
  <link
    rel="stylesheet"
    href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap"
  />
</svelte:head>

{#if fullscreen}
  {@render children()}
{:else}
  <div class="app">
    <AppNav />
    <main class="content">
      {@render children()}
    </main>
  </div>
{/if}

<style>
  .content {
    flex: 1;
    min-width: 0;
    overflow-y: auto;
  }

  @media (max-width: 767px) {
    :global(.app) {
      flex-direction: column;
    }
  }
</style>
