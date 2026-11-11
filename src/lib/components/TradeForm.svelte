<script lang="ts">
  // Journal fields: followed rules, tags, notes. All optional, and saved as
  // they change. Used by the panel that opens when a trade closes and by the
  // journal.
  import { TAGS, type TradeRecord } from '$lib/engine/journal';
  import { sessions } from '$lib/state/sessions.svelte';
  import Segmented from './ui/Segmented.svelte';

  let { trade }: { trade: TradeRecord } = $props();

  const rules = [
    { value: 'yes', label: 'Yes' },
    { value: 'no', label: 'No' }
  ] as const;

  const rulesValue = $derived(trade.followedRules == null ? '' : trade.followedRules ? 'yes' : 'no');
  const update = (patch: Partial<TradeRecord>) => sessions.updateTrade(trade.id, patch);

  function toggleTag(tag: string) {
    update({ tags: trade.tags.includes(tag) ? trade.tags.filter((t) => t !== tag) : [...trade.tags, tag] });
  }
</script>

<div class="form">
  <div class="field row">
    <p class="cap">Followed rules?</p>
    <Segmented
      label="Followed rules?"
      options={rules}
      value={rulesValue}
      onchange={(value) => update({ followedRules: value === 'yes' })}
    />
  </div>

  <div class="field">
    <p class="cap">Tags</p>
    <div class="chips">
      {#each TAGS as tag (tag)}
        <button
          type="button"
          class="chip"
          class:on={trade.tags.includes(tag)}
          aria-pressed={trade.tags.includes(tag)}
          onclick={() => toggleTag(tag)}
        >
          {tag}
        </button>
      {/each}
    </div>
  </div>

  <div class="field">
    <p class="cap">Notes</p>
    <textarea
      class="inp"
      bind:value={() => trade.notes, (notes) => update({ notes })}
      rows="3"
      placeholder="What did you see? What would you do differently?"
      aria-label="Notes"
    ></textarea>
  </div>
</div>

<style>
  .form {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .field.row {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }
</style>
