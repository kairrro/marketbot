import { json } from '@sveltejs/kit';
import { getSettings, saveSettings } from '$lib/server/news/store';

export function GET() {
  return json(getSettings());
}

// Any subset of the settings. Bad values fall back to the defaults, never an error.
export async function PUT({ request }) {
  const body = await request.json().catch(() => ({}));
  return json(saveSettings(body));
}
