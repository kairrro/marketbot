import { json } from '@sveltejs/kit';
import { LookupError, lookupStock } from '$lib/server/news/service';

// The stock finder. GET ?symbol=AMD
export async function GET({ url }) {
  try {
    return json(await lookupStock(url.searchParams.get('symbol') ?? ''));
  } catch (err) {
    const status = err instanceof LookupError ? err.status : 502;
    return json({ message: err instanceof Error ? err.message : String(err) }, { status });
  }
}
