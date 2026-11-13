// The prop firm's evaluation rules the risk simulator plays your trades through.
// The same for every session, and remembered between visits.

import { DEFAULT_EVAL_RULES, type EvalRules } from '$lib/engine/evalSim';
import { storage } from './storage.svelte';

const KEY = 'eval-rules';

const positive = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;

class EvalRulesStore {
  rules = $state<EvalRules>({ ...DEFAULT_EVAL_RULES });
  #loaded = false;

  async load(): Promise<void> {
    if (this.#loaded) return;
    this.#loaded = true;
    const saved = await storage.get<Partial<EvalRules>>(KEY);
    if (!saved) return;
    this.rules = {
      accountSize: positive(saved.accountSize, DEFAULT_EVAL_RULES.accountSize),
      targetPct: positive(saved.targetPct, DEFAULT_EVAL_RULES.targetPct),
      maxDrawdownPct: positive(saved.maxDrawdownPct, DEFAULT_EVAL_RULES.maxDrawdownPct),
      trailing: typeof saved.trailing === 'boolean' ? saved.trailing : DEFAULT_EVAL_RULES.trailing,
      dailyLossPct:
        typeof saved.dailyLossPct === 'number' && Number.isFinite(saved.dailyLossPct) && saved.dailyLossPct >= 0
          ? saved.dailyLossPct
          : DEFAULT_EVAL_RULES.dailyLossPct
    };
  }

  update(patch: Partial<EvalRules>): void {
    this.rules = { ...this.rules, ...patch };
    void storage.set(KEY, $state.snapshot(this.rules));
  }
}

export const evalRules = new EvalRulesStore();
