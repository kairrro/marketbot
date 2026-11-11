<script lang="ts">
  // The sidebar of the main app. Same palette and controls as the backtester.
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import Icon, { type IconName } from '../ui/Icon.svelte';

  interface Item {
    href: string;
    label: string;
    icon: IconName;
    /** Exact match only (the home page is a prefix of every path). */
    exact?: boolean;
    hint?: string;
  }

  const groups: { title: string; items: Item[] }[] = [
    {
      title: 'Markets',
      items: [
        { href: '/', label: 'Discover', icon: 'compass', exact: true },
        { href: '/watchlist', label: 'Watchlist', icon: 'eye' }
      ]
    },
    {
      title: 'Tools',
      items: [
        { href: '/news', label: 'News', icon: 'news' },
        { href: '/backtest', label: 'Backtest', icon: 'candles', hint: 'Opens full screen' }
      ]
    }
  ];

  const isActive = (item: Item, path: string) => (item.exact ? path === item.href : path === item.href || path.startsWith(`${item.href}/`));

  interface Status {
    aiReady: boolean;
    botRunning: boolean;
    windowOpen: boolean;
  }

  let status = $state<Status | null>(null);

  async function loadStatus() {
    try {
      const res = await fetch('/api/news/status');
      if (res.ok) status = await res.json();
    } catch {
      status = null;
    }
  }

  onMount(() => {
    void loadStatus();
    const timer = setInterval(loadStatus, 60_000);
    return () => clearInterval(timer);
  });

  const bot = $derived.by(() => {
    if (!status) return { tone: 'off', title: 'News bot', sub: 'Checking…' };
    if (!status.botRunning) return { tone: 'off', title: 'News bot is off', sub: 'Brief and alerts paused' };
    if (!status.aiReady) return { tone: 'warn', title: 'News bot', sub: 'Add an OpenRouter key' };
    return { tone: 'on', title: 'News bot', sub: status.windowOpen ? 'Watching headlines now' : 'Next: morning brief 8:00 CT' };
  });
</script>

<aside class="nav">
  <a class="brand" href="/" aria-label="Marketbot home">
    <span class="mark"><Icon name="candles" size={15} /></span>
    <span class="word">Marketbot</span>
  </a>

  <nav aria-label="Main">
    {#each groups as group (group.title)}
      <p class="cap group">{group.title}</p>
      {#each group.items as item (item.href)}
        {@const active = isActive(item, $page.url.pathname)}
        <a class="item" class:active href={item.href} aria-current={active ? 'page' : undefined} title={item.hint}>
          <span class="ico"><Icon name={item.icon} size={16} /></span>
          <span class="label">{item.label}</span>
          {#if item.hint}<span class="go"><Icon name="arrow" size={12} /></span>{/if}
        </a>
      {/each}
    {/each}
  </nav>

  <a class="foot" href="/news?tab=setup" title="News bot settings">
    <span class="dot {bot.tone}"></span>
    <span class="foot-text">
      <span class="foot-title">{bot.title}</span>
      <span class="foot-sub">{bot.sub}</span>
    </span>
  </a>
</aside>

<style>
  .nav {
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 224px;
    padding: 14px 10px 12px;
    border-right: 1px solid var(--border);
    background: var(--surface);
    overflow-y: auto;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 4px 8px 16px;
  }

  .mark {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: 8px;
    background: linear-gradient(140deg, var(--accent-hover), #2b63d6);
    color: #fff;
    box-shadow: 0 2px 10px var(--accent-glow);
    transition:
      transform 0.25s var(--ease),
      box-shadow 0.25s;
  }

  .brand:hover .mark {
    transform: rotate(-6deg) scale(1.06);
    box-shadow: 0 3px 14px var(--accent-glow);
  }

  .word {
    font-size: 15px;
    font-weight: 600;
    letter-spacing: -0.02em;
  }

  nav {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
  }

  .group {
    padding: 14px 10px 6px;
  }

  .group:first-child {
    padding-top: 2px;
  }

  .item {
    position: relative;
    display: flex;
    align-items: center;
    gap: 10px;
    height: 34px;
    padding: 0 10px;
    border-radius: var(--radius-sm);
    color: var(--text-2);
    font-weight: 500;
    transition:
      background-color 0.14s,
      color 0.14s;
  }

  /* The active bar grows in from the middle, so a change of page reads as movement. */
  .item::before {
    content: '';
    position: absolute;
    left: -10px;
    top: 7px;
    bottom: 7px;
    width: 3px;
    border-radius: 0 3px 3px 0;
    background: var(--accent);
    box-shadow: 0 0 10px var(--accent-glow);
    transform: scaleY(0);
    transition: transform 0.22s var(--ease);
  }

  .ico {
    display: grid;
    place-items: center;
    transition:
      color 0.14s,
      transform 0.2s var(--ease);
  }

  .item:hover {
    background: var(--surface-2);
    color: var(--text);
  }

  .item:hover .ico {
    color: var(--accent-hover);
    transform: translateX(1px);
  }

  .item.active {
    background: var(--accent-soft);
    color: var(--text);
  }

  .item.active::before {
    transform: scaleY(1);
  }

  .item.active .ico {
    color: var(--accent-hover);
  }

  .label {
    flex: 1;
  }

  .go {
    color: var(--text-3);
    opacity: 0;
    transform: translate(-3px, 3px);
    transition:
      opacity 0.15s,
      transform 0.2s var(--ease);
  }

  .item:hover .go {
    opacity: 1;
    transform: none;
  }

  .foot {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 8px;
    padding: 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface-2);
    transition:
      border-color 0.15s,
      background-color 0.15s;
  }

  .foot:hover {
    border-color: var(--border-strong);
    background: var(--surface-3);
  }

  .foot-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
    line-height: 1.3;
  }

  .foot-title {
    font-size: 12px;
    font-weight: 500;
  }

  .foot-sub {
    overflow: hidden;
    color: var(--text-3);
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .dot {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--text-3);
  }

  .dot.on {
    background: var(--green);
    box-shadow: 0 0 0 0 rgba(53, 179, 137, 0.5);
    animation: pulse 2.4s ease-out infinite;
  }

  .dot.warn {
    background: var(--amber);
  }

  @keyframes pulse {
    0% {
      box-shadow: 0 0 0 0 rgba(53, 179, 137, 0.45);
    }
    70%,
    100% {
      box-shadow: 0 0 0 7px rgba(53, 179, 137, 0);
    }
  }

  /* Narrow screens: the sidebar becomes a bar along the top. */
  @media (max-width: 767px) {
    .nav {
      flex-direction: row;
      align-items: center;
      gap: 6px;
      width: 100%;
      padding: 8px 10px;
      border-right: 0;
      border-bottom: 1px solid var(--border);
      overflow-x: auto;
      overflow-y: hidden;
    }

    .brand {
      padding: 0 6px 0 2px;
    }

    .word,
    .group,
    .foot-text,
    .go {
      display: none;
    }

    nav {
      flex-direction: row;
      flex: 1;
    }

    .item {
      height: 32px;
    }

    .item::before {
      left: 8px;
      right: 8px;
      top: auto;
      bottom: -9px;
      width: auto;
      height: 2px;
      border-radius: 2px 2px 0 0;
      transform: scaleX(0);
    }

    .item.active::before {
      transform: scaleX(1);
    }

    .foot {
      margin: 0;
      padding: 8px;
    }
  }
</style>
