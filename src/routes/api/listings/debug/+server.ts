import { json } from '@sveltejs/kit';
import {
  checkForNewListings,
  simulateNewListing,
  getWatcherStatus,
} from '$lib/server/listings/listingWatcher';
import { sendTestAlert } from '$lib/server/discord/webhook';

export async function GET({ url }) {
  const action = url.searchParams.get('action') ?? 'status';

  switch (action) {
    case 'status':
      return json(getWatcherStatus());

    case 'check':
      await checkForNewListings();
      return json({ ranCheck: true, status: getWatcherStatus() });

    case 'simulate': {
      const removed = simulateNewListing();
      return json({
        removedFromBaseline: removed,
        note: removed
          ? `Now call ?action=check — ${removed} should be detected as "new" and trigger a real Discord alert.`
          : 'No baseline yet — hit ?action=check first so the watcher has a symbol list to simulate from.',
      });
    }

    case 'test-alert': {
      const result = await sendTestAlert();
      return json(result);
    }

    default:
      return json({ error: `Unknown action: ${action}` }, { status: 400 });
  }
}