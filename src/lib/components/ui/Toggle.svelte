<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    checked,
    onchange,
    children
  }: { checked: boolean; onchange: (checked: boolean) => void; children: Snippet } = $props();
</script>

<button type="button" class="toggle" role="switch" aria-checked={checked} onclick={() => onchange(!checked)}>
  <span class="track" class:on={checked}><span class="thumb"></span></span>
  <span class="text">{@render children()}</span>
</button>

<style>
  .toggle {
    display: flex;
    align-items: center;
    gap: 9px;
    width: 100%;
    color: var(--text);
  }

  .track {
    flex: none;
    width: 28px;
    height: 16px;
    padding: 2px;
    border-radius: 999px;
    background: var(--border-strong);
    transition: background-color 0.15s;
  }

  .track.on {
    background: var(--accent);
  }

  .thumb {
    display: block;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #fff;
    transition: transform 0.15s;
  }

  .track.on .thumb {
    transform: translateX(12px);
  }

  .text {
    flex: 1;
    min-width: 0;
  }
</style>
