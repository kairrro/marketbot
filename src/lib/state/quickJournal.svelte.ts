// The quick tags asked when a trade closes: Setup (1 Trend, 2 Range) and
// Followed rules (Y / N). The popup closes by itself once both are answered.

import type { SetupType } from '$lib/engine/journal';
import { sessions } from './sessions.svelte';
import { ui } from './ui.svelte';
import { voice } from './voice.svelte';

class QuickJournal {
  /** What has been answered in this popup. A rule-break guess already on the trade does not count. */
  setup = $state<SetupType | null>(null);
  rules = $state<boolean | null>(null);

  /** Opens the popup for a trade that just closed. */
  begin(tradeId: string): void {
    voice.dismiss();
    this.setup = null;
    this.rules = null;
    ui.promptId = tradeId;
  }

  setSetup(type: SetupType): void {
    if (!ui.promptId) return;
    sessions.updateTrade(ui.promptId, { setupType: type });
    this.setup = type;
    this.#closeWhenDone();
  }

  setRules(followed: boolean): void {
    if (!ui.promptId) return;
    sessions.updateTrade(ui.promptId, { followedRules: followed });
    this.rules = followed;
    this.#closeWhenDone();
  }

  /** Handles a key (lower case) while the popup is open. True when it was one of ours. */
  key(key: string): boolean {
    if (!ui.promptId) return false;
    if (key === '1') this.setSetup('trend');
    else if (key === '2') this.setSetup('range');
    else if (key === 'y') this.setRules(true);
    else if (key === 'n') this.setRules(false);
    else return false;
    return true;
  }

  #closeWhenDone(): void {
    if (this.setup != null && this.rules != null) ui.promptId = null;
  }
}

export const quick = new QuickJournal();
