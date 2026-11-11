import { CONFIG } from '$lib/config';
import { fetchPerpPrices } from '../kcex/client';
import {
  getPerpWatchlist,
  markPerpWatchTriggered,
} from '../db';
import { sendPerpPriceAlert } from '../discord/webhook';

// Stored on globalThis, not a module-scoped `let`: in dev, Vite hot-reloads
// this module on almost every server-file save, which would normally reset
// a module-scoped guard and either duplicate the interval or (since
// hooks.server.ts's own guard would then block re-starting) leave it dead
// until a full restart. globalThis survives the reload, so the
// already-running interval (still using last-loaded code, via its original
// closure) is correctly recognized as "already running" and left alone either way.
declare global {
  var __perpWatcherIntervalId: ReturnType<typeof setInterval> | undefined;
}

let checking = false;

async function checkPerpWatchlist(): Promise<void> {
  if (checking) return;
  checking = true;

  try {
    // A watch with no target price is "just watching for AI setups" — no price alert to check.
    const watches = getPerpWatchlist().filter((watch) => watch.armed && watch.targetPrice != null);
    if (watches.length === 0) return;

    const prices = await fetchPerpPrices([...new Set(watches.map((watch) => watch.symbol))]);

    for (const watch of watches) {
      const price = prices.get(watch.symbol);
      if (price === undefined) continue;

      const reached =
        watch.direction === 'ABOVE'
          ? price >= watch.targetPrice!
          : price <= watch.targetPrice!;

      if (!reached) continue;

      try {
        await sendPerpPriceAlert({
          id: watch.id,
          symbol: watch.symbol,
          price,
          targetPrice: watch.targetPrice!,
          direction: watch.direction!,
        });
        markPerpWatchTriggered(watch.id);
        console.log(`Perp watchlist: triggered ${watch.symbol} at ${price}`);
      } catch (err) {
        console.error(`Perp watchlist: failed to alert ${watch.symbol}:`, err);
      }
    }
  } catch (err) {
    console.error('Perp watchlist: check failed:', err);
  } finally {
    checking = false;
  }
}

export function startPerpWatchlist(): void {
  if (globalThis.__perpWatcherIntervalId) return;

  checkPerpWatchlist();
  globalThis.__perpWatcherIntervalId = setInterval(checkPerpWatchlist, CONFIG.perpWatchlist.pollIntervalMs);

  console.log(
    `Perp watchlist started (polling every ${CONFIG.perpWatchlist.pollIntervalMs / 1000}s).`
  );
}
