import { json } from '@sveltejs/kit';
import {
  addPerpWatch,
  deletePerpWatch,
  getPerpWatchlist,
  setPerpWatchArmed,
} from '$lib/server/db';

export function GET() {
  return json(getPerpWatchlist());
}

export async function POST({ request }) {
  const body = await request.json();

  const symbol = String(body.symbol ?? '').trim().toUpperCase();
  if (!symbol) {
    return json({ error: 'A symbol is required.' }, { status: 400 });
  }

  // A price alert is optional — a watch can just mean "scan this for AI setups."
  const hasPriceAlert = body.targetPrice != null && body.targetPrice !== '';
  if (!hasPriceAlert) {
    return json(addPerpWatch(symbol, null, null), { status: 201 });
  }

  const targetPrice = Number(body.targetPrice);
  const direction = body.direction === 'BELOW' ? 'BELOW' : 'ABOVE';

  if (!Number.isFinite(targetPrice) || targetPrice <= 0) {
    return json({ error: 'Target price must be a positive number, or omit it entirely.' }, { status: 400 });
  }

  return json(addPerpWatch(symbol, targetPrice, direction), { status: 201 });
}

export async function DELETE({ request }) {
  const body = await request.json();
  const id = Number(body.id);

  if (!Number.isInteger(id)) {
    return json({ error: 'Valid watchlist id is required.' }, { status: 400 });
  }

  deletePerpWatch(id);
  return json({ ok: true });
}

export async function PATCH({ request }) {
  const body = await request.json();
  const id = Number(body.id);
  const armed = Boolean(body.armed);

  if (!Number.isInteger(id)) {
    return json({ error: 'Valid watchlist id is required.' }, { status: 400 });
  }

  setPerpWatchArmed(id, armed);
  return json({ ok: true });
}
