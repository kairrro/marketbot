// Global keyboard shortcuts:
//   →  next candle        Shift+→  +10 candles      Space  play / pause
//   B  long               S  short                  (opens the position tool)
//   L  level tool         R  zone (rectangle) tool  M  measure tool
//   A  ATR on / off
//   Enter  confirm trade  Esc  cancel               Delete  remove selected drawing
//   ↑/↓  previous / next trade while the journal is open (JournalDrawer.svelte)
//   1 Trend  2 Range  Y / N  followed rules   (only while the tag popup is open)
//   V  hold to record a voice note for the last closed trade

import { chartBridge } from './chartBridge';
import { display } from './display.svelte';
import { quick } from './quickJournal.svelte';
import { replay } from './replay.svelte';
import { sessions } from './sessions.svelte';
import { trade } from './trade.svelte';
import { ui, type Tool } from './ui.svelte';
import { voice } from './voice.svelte';

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName);
}

/** Esc backs out of one thing at a time, most transient first. */
function escape(): void {
  if (ui.summaryOpen) {
    ui.summaryOpen = false;
    return;
  }
  if (chartBridge.cancelDrawing?.()) return;
  if (ui.tool !== 'none') {
    ui.tool = 'none';
    return;
  }
  if (trade.draft) {
    trade.cancel();
    ui.toast('Trade cancelled.');
    return;
  }
  if (ui.promptId || voice.active) {
    ui.promptId = null;
    voice.dismiss();
    return;
  }
  ui.clearSelection();
}

function deleteSelected(): void {
  const coin = replay.info?.coin;
  if (!coin) return;
  if (ui.selectedZone) sessions.removeZone(coin, ui.selectedZone);
  if (ui.selectedLevel) sessions.removeLevel(coin, ui.selectedLevel);
  ui.clearSelection();
}

const TOOL_KEYS: Record<string, Tool> = { l: 'level', r: 'zone', m: 'measure' };

/** Letting go of V ends the voice note. Works wherever focus is, so a note is never left recording. */
export function handleKeyUp(event: KeyboardEvent): void {
  if (event.key.toLowerCase() === 'v') voice.stop();
}

export function handleKey(event: KeyboardEvent): void {
  if (event.ctrlKey || event.metaKey || event.altKey) return;

  if (isTyping(event.target)) {
    // Esc leaves the field; everything else belongs to the field.
    if (event.key === 'Escape') (event.target as HTMLElement).blur();
    return;
  }

  // A focused button would also react to Space / Enter. The shortcut wins.
  const consume = () => {
    event.preventDefault();
    if (document.activeElement instanceof HTMLButtonElement) document.activeElement.blur();
  };

  const key = event.key.toLowerCase();
  if ((key === 'b' || key === 's') && !event.shiftKey) {
    if (replay.info) trade.begin(key === 'b' ? 'long' : 'short');
    return;
  }

  if (key === 'a' && !event.shiftKey) {
    display.atr = !display.atr;
    return;
  }

  // Hold V to talk. Held-down repeats are ignored; letting go is handleKeyUp.
  if (key === 'v' && !event.shiftKey) {
    if (!event.repeat) voice.start();
    return;
  }
  if (!event.shiftKey && quick.key(key)) return;

  const tool = TOOL_KEYS[key];
  if (tool) {
    if (replay.info) ui.toggleTool(tool);
    return;
  }

  switch (event.key) {
    case 'ArrowRight':
      consume();
      replay.pause();
      if (event.shiftKey) replay.stepN(10);
      else replay.step();
      break;
    case ' ':
      consume();
      replay.toggle();
      break;
    case 'Enter':
      if (trade.draft) {
        consume();
        trade.confirm();
      }
      break;
    case 'Delete':
    case 'Backspace':
      deleteSelected();
      break;
    case 'Escape':
      escape();
      break;
  }
}
