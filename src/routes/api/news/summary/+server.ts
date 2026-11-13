import { json } from '@sveltejs/kit';
import { generateSummary, lastSummary, summaryRunning } from '$lib/server/news/service';

// The short version of the day. GET gives the last one made (and whether a new one is being made).
export function GET() {
  return json({ summary: lastSummary(), running: summaryRunning() });
}

// Makes a new one. It may read the news first, so it can take up to half a minute.
export async function POST() {
  try {
    return json({ summary: await generateSummary(), running: false });
  } catch (err) {
    return json({ message: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
