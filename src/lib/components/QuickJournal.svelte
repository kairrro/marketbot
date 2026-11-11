<script lang="ts">
  // The small card that appears over the chart's corner when a trade closes:
  // two quick tags, and the voice note (or the typed note, where voice is not
  // available). Nothing in it blocks the chart, and the replay keeps its state.
  import { exitReasonOf, SETUP_TYPES } from '$lib/engine/journal';
  import { fmtR, sign } from '$lib/format';
  import { quick } from '$lib/state/quickJournal.svelte';
  import { sessions } from '$lib/state/sessions.svelte';
  import { ui } from '$lib/state/ui.svelte';
  import { voice } from '$lib/state/voice.svelte';

  const record = $derived(sessions.findTrade(ui.promptId ?? voice.tradeId));
  const tagging = $derived(ui.promptId != null && record?.id === ui.promptId);

  const rules = [
    { key: 'Y', followed: true, label: 'Yes' },
    { key: 'N', followed: false, label: 'No' }
  ];

  function focusIf(node: HTMLTextAreaElement) {
    if (voice.focusNote) node.focus();
  }
</script>

{#if record && (tagging || voice.active)}
  <aside class="quick" aria-label="Tag this trade">
    <header class="head">
      <span class={record.side === 'long' ? 'pos' : 'neg'}>{record.side === 'long' ? 'Long' : 'Short'}</span>
      <span class="strong">{record.coin}</span>
      <span class="num strong {sign(record.r)}">{fmtR(record.r)}</span>
      <span class="dim">{exitReasonOf(record) ?? ''}</span>
    </header>

    {#if tagging}
      <div class="row">
        <span class="cap">Setup</span>
        {#each SETUP_TYPES as type, i (type.id)}
          <button type="button" class="chip" class:on={quick.setup === type.id} onclick={() => quick.setSetup(type.id)}>
            <kbd>{i + 1}</kbd>
            {type.label}
          </button>
        {/each}
      </div>
      <div class="row">
        <span class="cap">Followed rules</span>
        {#each rules as rule (rule.key)}
          <button type="button" class="chip" class:on={quick.rules === rule.followed} onclick={() => quick.setRules(rule.followed)}>
            <kbd>{rule.key}</kbd>
            {rule.label}
          </button>
        {/each}
      </div>
      <p class="hint faint"><kbd>Esc</kbd> skip · hold <kbd>V</kbd> to speak a note</p>
    {/if}

    {#if voice.recording}
      <p class="rec" role="status"><span class="dot"></span>Recording… <span class="heard dim">{voice.heard}</span></p>
    {:else if voice.message}
      <p class="note" role="status">{voice.message}</p>
    {/if}

    {#if voice.typing}
      <textarea
        class="inp"
        rows="2"
        placeholder="Note (optional)"
        aria-label="Trade note"
        use:focusIf
        bind:value={() => record.notes, (notes) => sessions.updateTrade(record.id, { notes })}
        onkeydown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            voice.dismiss();
          }
        }}
      ></textarea>
    {/if}
  </aside>
{/if}

<style>
  .quick {
    position: absolute;
    bottom: 38px;
    left: 12px;
    z-index: 6;
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 268px;
    padding: 10px 12px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface);
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.42);
  }

  .head {
    display: flex;
    align-items: baseline;
    gap: 7px;
    font-size: 12.5px;
  }

  .strong {
    font-weight: 600;
  }

  .head .dim {
    margin-left: auto;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 5px;
  }

  .row .cap {
    flex: 1;
    letter-spacing: 0.04em;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding-left: 4px;
  }

  .chip kbd {
    min-width: 16px;
    padding: 0 3px;
    font-size: 10px;
    line-height: 14px;
  }

  .hint {
    font-size: 11px;
  }

  .hint kbd {
    min-width: 0;
    padding: 0 3px;
    font-size: 10px;
    line-height: 14px;
  }

  .rec {
    display: flex;
    align-items: baseline;
    gap: 7px;
    color: var(--red);
    font-size: 12px;
  }

  .heard {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .dot {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--red);
    animation: pulse 1s ease-in-out infinite;
  }

  @keyframes pulse {
    50% {
      opacity: 0.25;
    }
  }

  textarea.inp {
    min-height: 0;
    font-size: 12px;
  }
</style>
