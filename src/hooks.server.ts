import { startListingWatcher } from '$lib/server/listings/listingWatcher';
import { startNewsBot } from '$lib/server/news/scheduler';
import { startPerpWatchlist } from '$lib/server/watchlist/perpWatcher';

// Each start* function guards itself via a globalThis flag (see perpWatcher.ts)
// — calling both unconditionally here is safe and, unlike
// a wrapper guard around this whole block, means an edit to one watcher's
// file can't leave it stuck stopped just because this file already "ran once."
startListingWatcher();
startPerpWatchlist();
startNewsBot();

export async function handle({ event, resolve }) {
  return resolve(event);
}
