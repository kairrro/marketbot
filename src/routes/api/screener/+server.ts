import { json } from '@sveltejs/kit';
import { getInterestingCoins } from '$lib/server/screener/screener';

export async function GET() {
  return json(await getInterestingCoins());
}
