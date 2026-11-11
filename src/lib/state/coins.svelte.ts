// Each source's list of coins, fetched once per visit the first time the coin
// field is used.

import { COIN_SUGGESTIONS, fetchCoins, type CoinInfo, type Source } from '$lib/data';

const FALLBACK: CoinInfo[] = COIN_SUGGESTIONS.map((coin) => ({ coin, volume: 0 }));

class CoinLists {
  #lists = $state.raw<Partial<Record<Source, CoinInfo[]>>>({});
  #loading = new Set<Source>();

  /** The source's coins, or a few well-known ones until the list arrives (or if it cannot be fetched). */
  get(source: Source): CoinInfo[] {
    return this.#lists[source] ?? FALLBACK;
  }

  async load(source: Source): Promise<void> {
    if (this.#lists[source] || this.#loading.has(source)) return;
    this.#loading.add(source);
    try {
      this.#lists = { ...this.#lists, [source]: await fetchCoins(source) };
    } catch {
      // The fallback stays; the next time the field is used it tries again.
    } finally {
      this.#loading.delete(source);
    }
  }
}

export const coinLists = new CoinLists();
