import { json } from '@sveltejs/kit';
import { fetchQuotes, newsStatus } from '$lib/server/news/service';
import { getBrief, getSettings, latestBrief, listAssets, listBriefDates, recentAlerts } from '$lib/server/news/store';

// Everything the News page shows, in one request.
// GET ?date=YYYY-MM-DD  picks the morning brief of that day (default: today, Central time)
// GET ?week=YYYY-MM-DD  picks the weekly preview that starts on that Monday (default: the latest)
export async function GET({ url }) {
  const status = newsStatus();
  const date = url.searchParams.get('date') ?? status.today;
  const week = url.searchParams.get('week');
  const morning = getBrief('morning', date);
  const weekly = week ? getBrief('weekly', week) : latestBrief('weekly');
  const assets = listAssets();
  const prices: Record<string, number> = {};
  for (const q of await fetchQuotes(assets).catch(() => [])) prices[q.symbol] = q.price;
  return json({
    status,
    settings: getSettings(),
    assets,
    prices,
    morning: morning ? { ...morning.brief, discordSentAt: morning.discordSentAt } : null,
    weekly: weekly ? { ...weekly.brief, discordSentAt: weekly.discordSentAt } : null,
    morningDates: listBriefDates('morning'),
    weeklyDates: listBriefDates('weekly'),
    alerts: recentAlerts(Date.now() - 3 * 86_400_000, 60)
  });
}
