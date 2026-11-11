<script lang="ts" generics="T extends string | number">
  // A row of mutually exclusive options, like a compact radio group.
  interface Option {
    value: T;
    label: string;
    title?: string;
  }

  let {
    options,
    value,
    onchange,
    label,
    stretch = false,
    mono = false,
    compact = false
  }: {
    options: readonly Option[];
    value: T;
    onchange: (value: T) => void;
    /** Accessible name for the group. */
    label: string;
    /** Fill the available width with equal segments. */
    stretch?: boolean;
    mono?: boolean;
    /** Tighter segments, for a row with many options. */
    compact?: boolean;
  } = $props();
</script>

<div class="seg" class:stretch class:compact role="radiogroup" aria-label={label}>
  {#each options as option (option.value)}
    <button
      type="button"
      role="radio"
      class:num={mono}
      class:on={option.value === value}
      aria-checked={option.value === value}
      title={option.title}
      onclick={() => onchange(option.value)}
    >
      {option.label}
    </button>
  {/each}
</div>

<style>
  .seg {
    display: inline-flex;
    height: var(--ctl);
    padding: 2px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
  }

  .seg.stretch {
    display: flex;
  }

  .seg button {
    flex: 1 1 0;
    min-width: 30px;
    padding: 0 8px;
    border-radius: 4px;
    color: var(--text-2);
    font-size: 12px;
    font-weight: 500;
    text-align: center;
    white-space: nowrap;
    transition:
      background-color 0.12s,
      color 0.12s;
  }

  .seg.compact button {
    min-width: 26px;
    padding: 0 6px;
  }

  .seg button:hover {
    color: var(--text);
  }

  .seg button.on {
    background: var(--surface-3);
    color: var(--text);
    box-shadow: inset 0 0 0 1px var(--border-strong);
  }
</style>
