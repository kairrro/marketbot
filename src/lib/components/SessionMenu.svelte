<script lang="ts">
  // Session switcher: pick a session, or create / rename / duplicate / delete /
  // export / import one.
  import {
    createSession,
    deleteSession,
    duplicateSession,
    exportSession,
    importSession,
    switchSession
  } from '$lib/state/sessionActions';
  import { sessions } from '$lib/state/sessions.svelte';
  import Icon from './ui/Icon.svelte';

  let open = $state(false);
  /** Which inline name form is showing, if any. */
  let editing = $state<'new' | 'rename' | null>(null);
  let name = $state('');
  let root: HTMLDivElement;

  function close() {
    open = false;
    editing = null;
  }

  function edit(mode: 'new' | 'rename') {
    editing = mode;
    name = mode === 'rename' ? sessions.active.name : '';
  }

  function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    if (editing === 'new') createSession(name);
    else sessions.rename(sessions.activeId, name);
    close();
  }

  /** Runs a menu action and closes the menu. */
  function run(action: () => void | Promise<void>) {
    close();
    void action();
  }

  function focusOnMount(node: HTMLInputElement) {
    node.focus();
    node.select();
  }
</script>

<svelte:window
  onmousedown={(event) => {
    if (open && !root.contains(event.target as Node)) close();
  }}
/>

<div class="menu" bind:this={root}>
  <button
    type="button"
    class="btn trigger"
    aria-haspopup="menu"
    aria-expanded={open}
    title="Session"
    onclick={() => (open ? close() : (open = true))}
  >
    <span class="name">{sessions.active.name}</span>
    <Icon name="chevron" size={14} />
  </button>

  {#if open}
    <div
      class="popover"
      role="menu"
      tabindex="-1"
      onkeydown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          close();
        }
      }}
    >
      <p class="cap">Sessions</p>
      <ul class="list">
        {#each sessions.list as session (session.id)}
          <li>
            <button type="button" class="item" role="menuitem" onclick={() => run(() => switchSession(session.id))}>
              <span class="tick">
                {#if session.id === sessions.activeId}<Icon name="check" size={14} />{/if}
              </span>
              <span class="name">{session.name}</span>
              <span class="count num">{session.trades.length}</span>
            </button>
          </li>
        {/each}
      </ul>

      <div class="rule"></div>

      {#if editing}
        <form class="rename" onsubmit={submit}>
          <input
            class="inp"
            bind:value={name}
            placeholder={editing === 'new' ? 'New session name' : 'Session name'}
            aria-label="Session name"
            maxlength="60"
            use:focusOnMount
          />
          <button type="submit" class="btn primary" disabled={!name.trim()}>
            {editing === 'new' ? 'Create' : 'Save'}
          </button>
        </form>
      {:else}
        <button type="button" class="item" role="menuitem" onclick={() => edit('new')}>
          <Icon name="plus" size={14} /> New session…
        </button>
        <button type="button" class="item" role="menuitem" onclick={() => edit('rename')}>
          <Icon name="edit" size={14} /> Rename
        </button>
        <button type="button" class="item" role="menuitem" onclick={() => run(duplicateSession)}>
          <Icon name="copy" size={14} /> Duplicate
        </button>
        <button type="button" class="item" role="menuitem" onclick={() => run(exportSession)}>
          <Icon name="download" size={14} /> Export JSON
        </button>
        <button type="button" class="item" role="menuitem" onclick={() => run(importSession)}>
          <Icon name="upload" size={14} /> Import JSON…
        </button>
        <div class="rule"></div>
        <button type="button" class="item danger" role="menuitem" onclick={() => run(deleteSession)}>
          <Icon name="trash" size={14} /> Delete session…
        </button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .menu {
    position: relative;
  }

  .trigger {
    max-width: 190px;
    justify-content: space-between;
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .popover {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    z-index: 30;
    width: 260px;
    padding: 6px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface-2);
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4);
  }

  .cap {
    padding: 6px 8px 4px;
  }

  .list {
    max-height: 240px;
    overflow-y: auto;
  }

  .item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    height: 30px;
    padding: 0 8px;
    border-radius: var(--radius-sm);
    color: var(--text);
  }

  .item:hover {
    background: var(--surface-3);
  }

  .item.danger:hover {
    color: var(--red);
  }

  .item .name {
    flex: 1;
  }

  .tick {
    width: 14px;
    color: var(--accent);
  }

  .count {
    color: var(--text-3);
    font-size: 11.5px;
  }

  .rule {
    height: 1px;
    margin: 6px 0;
    background: var(--border);
  }

  .rename {
    display: flex;
    gap: 6px;
    margin: 0;
    padding: 2px;
  }
</style>
