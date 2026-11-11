// Ties a session to what is on screen. Opening a session brings back its
// chart — the candles it downloaded, the replay position, and any trade that
// was still open — and that state is saved continuously as it changes.

import { fmtTime } from './display.svelte';
import { loadPrefs } from './prefs.svelte';
import { replay } from './replay.svelte';
import { sessionData, type SavedView } from './sessionData';
import { sessions, type Session } from './sessions.svelte';
import { storage } from './storage.svelte';
import { tested } from './tested.svelte';
import { trade } from './trade.svelte';
import { ui } from './ui.svelte';

/** The replay position is written at most this often while it is changing. */
const SAVE_EVERY_MS = 300;

class Workspace {
  /** True once the active session and its chart have been brought back. */
  ready = $state(false);

  // While a session is being opened the screen still shows the previous one,
  // so nothing may be saved until the swap is complete.
  #suspended = true;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #pending: { id: string; view: SavedView } | null = null;

  async init(): Promise<void> {
    if (this.ready) return;
    await sessions.init();
    await loadPrefs();
    await tested.init();
    // Without this the browser is free to evict saved sessions and candles.
    void storage.requestPersistence();
    await this.#open(sessions.activeId);
    this.#suspended = false;
    this.ready = true;

    // Do not lose the last few candles when the tab is closed or hidden.
    window.addEventListener('pagehide', () => this.flush());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.flush();
    });
  }

  /** What would be saved right now, or null when there is no chart. */
  #view(): SavedView | null {
    const snapshot = replay.snapshot();
    return snapshot ? { ...snapshot, open: trade.open, meta: trade.meta, pending: trade.pending } : null;
  }

  /**
   * Call from an $effect. It re-runs whenever the replay position or the open
   * trade changes.
   *
   * Saving is throttled, not debounced: the first change starts the clock and
   * later ones do not push it back. With a debounce, a replay left playing
   * would never go quiet long enough to be saved at all.
   */
  watch(): void {
    const view = this.#view();
    const id = sessions.activeId;
    if (this.#suspended || !view) return;
    this.#pending = { id, view };
    if (!this.#timer) this.#timer = setTimeout(() => this.flush(), SAVE_EVERY_MS);
  }

  /** Writes any pending save immediately. */
  flush(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    const pending = this.#pending;
    this.#pending = null;
    if (pending) void sessionData.saveView(pending.id, pending.view);
  }

  /** Shows a session's saved chart, or an empty one if it has none. */
  async #open(id: string): Promise<void> {
    ui.selectedLevel = null;
    ui.selectedZone = null;
    ui.promptId = null;
    ui.detailId = null;
    ui.tool = 'none';

    const view = await sessionData.loadView(id);
    if (!view) {
      trade.restore(null, null);
      replay.clear();
      return;
    }

    const candles = (await sessionData.loadCandles(id, view)) ?? [];
    if (replay.restore(view, candles)) {
      trade.restore(view.open, view.meta, view.pending ?? null);
      return;
    }

    // The position is known but its candles are not there (storage was cleared,
    // or a write never finished). Keep the market and the place in time, so one
    // press of Load downloads the candles and resumes exactly where it was.
    trade.restore(null, null);
    replay.clear(
      {
        kind: 'warn',
        text: `The saved candles for ${view.coin} could not be read.`,
        hint: `Press Load to download them again. The replay will resume at ${fmtTime(view.cursorTime)}.`
      },
      view
    );
  }

  /** Runs a change of active session with saving held off around it. */
  async #swap(change: () => Session | null | void | Promise<Session | null | void>): Promise<void> {
    this.flush();
    this.#suspended = true;
    try {
      await change();
      await this.#open(sessions.activeId);
    } finally {
      this.#suspended = false;
    }
  }

  switchTo(id: string): Promise<void> {
    return this.#swap(() => sessions.switchTo(id));
  }

  async create(name: string): Promise<Session> {
    let created!: Session;
    await this.#swap(() => {
      created = sessions.create(name);
    });
    return created;
  }

  async duplicate(): Promise<Session | null> {
    let copy: Session | null = null;
    await this.#swap(async () => {
      copy = await sessions.duplicate(sessions.activeId);
    });
    return copy;
  }

  remove(id: string): Promise<void> {
    return this.#swap(() => sessions.remove(id));
  }

  async importFile(raw: unknown): Promise<Session> {
    let imported!: Session;
    await this.#swap(async () => {
      imported = await sessions.importFile(raw);
    });
    return imported;
  }
}

export const workspace = new Workspace();
