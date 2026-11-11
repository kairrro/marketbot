// Transient UI state: which tab is open, which tool is armed, toasts.

export type SidebarTab = 'trade' | 'stats' | 'settings';

/** What the next click on the chart does. */
export type Tool = 'none' | 'level' | 'zone' | 'measure' | 'moveStop';

export type ToastKind = 'info' | 'good' | 'bad' | 'warn';

export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

class UiStore {
  tab = $state<SidebarTab>('trade');
  tool = $state<Tool>('none');
  journalOpen = $state(false);
  /** Height of the open journal in px, as last dragged. */
  journalHeight = $state(360);
  /** The journal fills the whole chart area. */
  journalFull = $state(false);
  /** The journal's edge is being dragged: the chart holds its size until it is let go. */
  journalResizing = $state(false);

  // At most one drawing is selected at a time.
  selectedLevel = $state<string | null>(null);
  selectedZone = $state<string | null>(null);

  /** Trade whose quick-tag popup is showing. */
  promptId = $state<string | null>(null);
  /** The session summary covers the chart area. */
  summaryOpen = $state(false);
  /** Trade selected in the journal. */
  detailId = $state<string | null>(null);
  /** The what-if closes trades by the 1-hour rule, as you would have. */
  whatIfTimeRule = $state(true);

  toasts = $state<Toast[]>([]);

  #nextToast = 1;

  toast(text: string, kind: ToastKind = 'info', ms = 3600): void {
    const id = this.#nextToast++;
    this.toasts.push({ id, kind, text });
    setTimeout(() => this.dismiss(id), ms);
  }

  dismiss(id: number): void {
    this.toasts = this.toasts.filter((toast) => toast.id !== id);
  }

  toggleTool(tool: Tool): void {
    this.tool = this.tool === tool ? 'none' : tool;
  }

  selectLevel(id: string | null): void {
    this.selectedLevel = id;
    if (id) this.selectedZone = null;
  }

  selectZone(id: string | null): void {
    this.selectedZone = id;
    if (id) this.selectedLevel = null;
  }

  clearSelection(): void {
    this.selectedLevel = null;
    this.selectedZone = null;
  }
}

export const ui = new UiStore();
