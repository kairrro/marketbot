import { json } from '@sveltejs/kit';
import { feedRunning, generateFeed, lastFeed } from '$lib/server/news/service';

// The news feed: stories from the past days that were followed by a real price move.
// GET gives the last one made (and whether a new one is being made right now).
export function GET() {
  return json({ feed: lastFeed(), running: feedRunning() });
}

// Makes a new one. It reads the news and checks prices, so it takes up to half a minute.
export async function POST() {
  try {
    return json({ feed: await generateFeed(), running: false });
  } catch (err) {
    return json({ message: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
