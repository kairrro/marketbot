import { CONFIG } from '$lib/config';
import { env } from '$env/dynamic/private';

function getWebhookUrl(): string {
  return env.DISCORD_WEBHOOK_URL || CONFIG.discord.webhookUrl;
}

// Falls back to the main webhook if a dedicated one isn't set, so this
// still works even if you haven't configured NEW_LISTING_DISCORD_WEBHOOK_URL yet.
function getNewListingWebhookUrl(): string {
  return env.NEW_LISTING_DISCORD_WEBHOOK_URL || getWebhookUrl();
}

export async function sendNewListingAlert(symbol: string): Promise<void> {
  const url = getNewListingWebhookUrl();
  if (!url) {
    console.warn('No Discord webhook URL configured — skipping new listing alert.');
    return;
  }

  const embed = {
    title: `🆕 New KCEX Listing: ${symbol}`,
    description: 'A new contract symbol just appeared on KCEX.',
    color: 0x3b82f6,
    fields: [
      { name: 'Symbol', value: symbol, inline: true },
    ],
    timestamp: new Date().toISOString(),
  };

  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ embeds: [embed] }),
  });
}

export async function sendTestAlert(): Promise<{ ok: boolean; status?: number; error?: string }> {
  const url = getNewListingWebhookUrl();
  if (!url) {
    return { ok: false, error: 'No Discord webhook URL configured.' };
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '✅ Test alert from KCX listing watcher.' }),
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface PerpPriceAlert {
  id: number;
  symbol: string;
  price: number;
  targetPrice: number;
  direction: 'ABOVE' | 'BELOW';
}

export async function sendPerpPriceAlert(alert: PerpPriceAlert): Promise<void> {
  const url = getNewListingWebhookUrl();
  if (!url) {
    console.warn('No Discord webhook URL configured — skipping perp price alert.');
    return;
  }

  const embed = {
    title: `🎯 Perp Price Alert: ${alert.symbol}`,
    color: 0x22c55e,
    fields: [
      { name: 'Current Price', value: `${alert.price}`, inline: true },
      { name: 'Target', value: `${alert.direction === 'ABOVE' ? '≥' : '≤'} ${alert.targetPrice}`, inline: true },
    ],
    timestamp: new Date().toISOString(),
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ embeds: [embed] }),
  });

  if (!res.ok) {
    throw new Error(`Discord webhook returned ${res.status}`);
  }
}
