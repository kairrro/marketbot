import { json } from '@sveltejs/kit';
import { addAsset, listAssets, removeAsset, restoreDefaultAssets, updateAsset } from '$lib/server/news/store';
import type { AssetKind } from '$lib/news/types';

const KINDS: AssetKind[] = ['market', 'stock', 'topic'];

const words = (v: unknown): string[] | undefined =>
  Array.isArray(v) ? v.map(String) : typeof v === 'string' ? v.split(',').map((s) => s.trim()) : undefined;

export function GET() {
  return json(listAssets());
}

// Add a market, a stock or a topic. A ticker alone is enough: { kind: 'stock', symbol: 'AMD' }.
export async function POST({ request }) {
  const body = await request.json().catch(() => ({}));
  if (!KINDS.includes(body.kind)) return json({ message: 'kind must be market, stock or topic.' }, { status: 400 });
  try {
    const asset = addAsset({ kind: body.kind, symbol: String(body.symbol ?? ''), name: body.name, keywords: words(body.keywords) });
    return json(asset, { status: 201 });
  } catch (err) {
    return json({ message: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}

export async function PATCH({ request }) {
  const body = await request.json().catch(() => ({}));
  const id = Number(body.id);
  if (!Number.isInteger(id)) return json({ message: 'An id is required.' }, { status: 400 });
  updateAsset(id, {
    enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
    name: typeof body.name === 'string' ? body.name : undefined,
    keywords: words(body.keywords)
  });
  return json(listAssets());
}

export async function DELETE({ request }) {
  const body = await request.json().catch(() => ({}));
  const id = Number(body.id);
  if (!Number.isInteger(id)) return json({ message: 'An id is required.' }, { status: 400 });
  removeAsset(id);
  return json(listAssets());
}

// Brings back any starting asset that was removed.
export function PUT() {
  const added = restoreDefaultAssets();
  return json({ added, assets: listAssets() });
}
