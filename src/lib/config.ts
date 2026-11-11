// Central place for every tunable threshold. Change behavior here, not in strategy files.

export const CONFIG = {

  // --- Perpetual futures watchlist (price target alerts) ---

  perpWatchlist: {
    pollIntervalMs: 15_000,
  },

  // --- New listing watcher ---

  listingWatcher: {

    // How often to poll KCEX's contract ticker list for new symbols.
    // Keep this reasonably conservative to avoid hammering the endpoint.
    pollIntervalMs: 300_000, // 2 minutes

  },

  // --- Market screener (finds candidates worth adding to the watchlist) ---

  screener: {

    topCount: 25, // gainers/losers shown

    cacheTtlMs: 60_000, // don't re-fetch/re-rank all tickers more often than this

    // Liquidity is a risk flag, not a filter — a thin coin can still have a
    // genuinely good chart setup, it just means bad slippage executing it.
    // Tiers by 24h notional volume; below `low` still shows, just flagged.
    liquidityTiers: {
      high: 500_000,
      medium: 100_000,
      low: 25_000,
    },

    newListingWindowMs: 24 * 60 * 60_000, // "new" = first seen within this long ago

  },

  // --- Discord ---

  discord: {

    webhookUrl: '',

  },

} as const;
