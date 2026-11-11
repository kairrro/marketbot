// Session actions shared by the top-bar menu and the Settings tab. These add
// the user-facing parts (confirmations, toasts, file dialogs) around the stores.

import { toCsv } from '$lib/engine/journal';
import { download, pickTextFile, slug } from './files';
import { sessions } from './sessions.svelte';
import { trade } from './trade.svelte';
import { ui } from './ui.svelte';
import { workspace } from './workspace.svelte';

// Every session keeps its own chart and its own open trade, so switching is
// always safe: what you leave behind is saved and waiting when you come back.

export async function switchSession(id: string): Promise<void> {
  if (id === sessions.activeId) return;
  await workspace.switchTo(id);
  ui.toast(`Switched to ${sessions.active.name}.`);
}

export async function createSession(name: string): Promise<void> {
  const session = await workspace.create(name);
  ui.toast(`Created ${session.name}.`);
}

export async function duplicateSession(): Promise<void> {
  const copy = await workspace.duplicate();
  if (copy) ui.toast(`Duplicated as ${copy.name}.`);
}

export async function deleteSession(): Promise<void> {
  const { id, name, trades } = sessions.active;
  const parts = [
    trades.length ? `${trades.length} trade${trades.length === 1 ? '' : 's'}` : '',
    trade.open ? 'its open trade' : trade.pending ? 'its limit order' : '',
    'its saved candles'
  ].filter(Boolean);
  if (!window.confirm(`Delete session "${name}" with ${parts.join(', ')}? This cannot be undone.`)) return;
  await workspace.remove(id);
  ui.toast(`Deleted ${name}.`);
}

export function resetTrades(): void {
  const count = sessions.trades.length;
  if (count === 0) return ui.toast('No trades to reset.');
  if (!window.confirm(`Delete all ${count} logged trades in "${sessions.active.name}"?`)) return;
  sessions.resetTrades();
  ui.promptId = null;
  ui.detailId = null;
  ui.toast('Trades reset.');
}

export async function exportSession(): Promise<void> {
  workspace.flush();
  const file = await sessions.exportFile();
  if (!file) return;
  download(`backtest-${slug(file.session.name)}.json`, JSON.stringify(file), 'application/json');
}

export async function importSession(): Promise<void> {
  const text = await pickTextFile('.json,application/json');
  if (text == null) return;
  try {
    const session = await workspace.importFile(JSON.parse(text));
    ui.toast(`Imported ${session.name} (${session.trades.length} trades).`);
  } catch (err) {
    ui.toast(err instanceof SyntaxError ? 'That file is not valid JSON.' : (err as Error).message, 'warn');
  }
}

export function exportCsv(): void {
  if (sessions.trades.length === 0) return ui.toast('No trades to export yet.');
  download(`backtest-${slug(sessions.active.name)}.csv`, toCsv(sessions.trades), 'text/csv');
}
