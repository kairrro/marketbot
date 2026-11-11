import { json } from '@sveltejs/kit';
import { listModels } from '$lib/server/news/openrouter';

// The models OpenRouter offers, for the model picker.
export async function GET() {
  try {
    return json(await listModels());
  } catch (err) {
    return json({ message: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
