<script lang="ts">
  import { fly } from 'svelte/transition';
  import { ui } from '$lib/state/ui.svelte';
</script>

<div class="toasts" aria-live="polite">
  {#each ui.toasts as toast (toast.id)}
    <button
      type="button"
      class="toast {toast.kind}"
      transition:fly={{ y: 8, duration: 140 }}
      onclick={() => ui.dismiss(toast.id)}
      title="Dismiss"
    >
      {toast.text}
    </button>
  {/each}
</div>

<style>
  .toasts {
    position: absolute;
    bottom: 40px;
    left: 50%;
    z-index: 8;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    width: min(460px, calc(100% - 180px));
    transform: translateX(-50%);
    pointer-events: none;
  }

  .toast {
    max-width: 100%;
    padding: 7px 12px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface-2);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
    color: var(--text);
    font-size: 12.5px;
    line-height: 1.4;
    text-align: center;
    pointer-events: auto;
  }

  .toast.good {
    border-color: var(--green);
    color: var(--green);
  }

  .toast.bad {
    border-color: var(--red);
    color: var(--red);
  }

  .toast.warn {
    border-color: var(--amber);
    color: var(--amber);
  }
</style>
