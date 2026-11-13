<script lang="ts">
  // Drawing tools (horizontal level, rectangle zone, measure) and the
  // market-session highlights switch.
  import { SESSION_MAX_TF_MS } from '$lib/engine/marketSessions';
  import { display } from '$lib/state/display.svelte';
  import { replay } from '$lib/state/replay.svelte';
  import { sessions } from '$lib/state/sessions.svelte';
  import { ui, type Tool } from '$lib/state/ui.svelte';
  import { PLAYBOOK_TF_MS } from '$lib/strategy/playbook';
  import Icon, { type IconName } from './ui/Icon.svelte';

  const tools: { id: Tool; icon: IconName; label: string; title: string }[] = [
    { id: 'level', icon: 'level', label: 'Level', title: 'Horizontal level (L), then click the chart' },
    { id: 'zone', icon: 'zone', label: 'Zone', title: 'Rectangle zone (R): click one corner, move, click the other' },
    { id: 'measure', icon: 'measure', label: 'Measure', title: 'Measure (M), or Shift+drag on the chart' }
  ];

  const coin = $derived(replay.info?.coin ?? null);
  const drawings = $derived(sessions.levelsFor(coin).length + sessions.zonesFor(coin).length);
  const sessionsTitle = $derived(
    `Session highs and lows: Asia, London, New York.${
      replay.tfMs > SESSION_MAX_TF_MS ? ' Shown on 1h and below.' : ''
    } Pick which ones in Settings.`
  );

  const playbookTitle = $derived(
    `Playbook: opening range, day bias and setups (Chicago time).${
      replay.tfMs !== PLAYBOOK_TF_MS ? ' Shown on 1m only.' : ''
    }`
  );

  function clearDrawings() {
    if (!coin) return;
    sessions.clearDrawings(coin);
    ui.clearSelection();
    ui.toast(`Levels and zones cleared for ${coin}.`);
  }
</script>

<div class="group">
  {#each tools as tool (tool.id)}
    <button
      type="button"
      class="btn tool"
      class:on={ui.tool === tool.id}
      disabled={!coin}
      onclick={() => ui.toggleTool(tool.id)}
      title={tool.title}
      aria-label={tool.label}
    >
      <Icon name={tool.icon} size={14} />
      <span class="text">{tool.label}</span>
    </button>
  {/each}
  <span class="divider"></span>
  <button
    type="button"
    class="btn tool"
    class:on={display.sessions}
    aria-pressed={display.sessions}
    onclick={() => (display.sessions = !display.sessions)}
    title={sessionsTitle}
    aria-label="Sessions"
  >
    <Icon name="sessions" size={14} />
    <span class="text">Sessions</span>
  </button>
  <button
    type="button"
    class="btn tool"
    class:on={display.playbook}
    aria-pressed={display.playbook}
    onclick={() => display.setPlaybook(!display.playbook)}
    title={playbookTitle}
    aria-label="Playbook"
  >
    <Icon name="playbook" size={14} />
    <span class="text">Playbook</span>
  </button>
  {#if drawings > 0}
    <button
      type="button"
      class="btn quiet square"
      onclick={clearDrawings}
      title="Clear all {drawings} level{drawings === 1 ? '' : 's'} and zones on {coin}"
      aria-label="Clear levels and zones"
    >
      <Icon name="trash" size={14} />
    </button>
  {/if}
</div>

<style>
  .group {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  /* Drawing tools on the left, what the chart shows on the right. */
  .divider {
    width: 1px;
    height: 16px;
    background: var(--border);
  }

  /* On narrower screens the tools shrink to icons so the bar stays on one row. */
  @media (max-width: 1700px) {
    .tool {
      width: var(--ctl);
      padding: 0;
    }

    .text {
      display: none;
    }
  }
</style>
