import { json } from '@sveltejs/kit';
import { newsStatus } from '$lib/server/news/service';

// A small answer for the sidebar: is the news bot on, does it have a key.
export function GET() {
  return json(newsStatus());
}
