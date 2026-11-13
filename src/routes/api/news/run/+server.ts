import { json } from '@sveltejs/kit';
import { discordReady, sendTest } from '$lib/server/news/discord';
import { checkMoveAlerts, generateMorning, generateWeekly, runAlertCheck, sendStoredBrief } from '$lib/server/news/service';

// Things done by hand from the News page. Writing a brief never sends it anywhere:
// sending to Discord is its own button.
// POST { kind: 'morning' | 'weekly' | 'alerts' | 'send-morning' | 'send-weekly' | 'discord-test', date? }
export async function POST({ request }) {
  const body = (await request.json().catch(() => ({}))) as { kind?: string; date?: string; dry?: boolean };
  const date = typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : undefined;

  try {
    switch (body.kind) {
      case 'morning':
        return json({ brief: await generateMorning(date) });
      case 'weekly':
        return json({ brief: await generateWeekly(date) });
      case 'alerts':
        // By hand it checks whatever the time of day, so it can be tried out.
        return json({ run: await runAlertCheck(true) });
      case 'moves':
        // By hand it checks whatever the time of day. `dry` only looks: nothing is saved or sent.
        return json({ run: await checkMoveAlerts({ force: true, dry: body.dry === true }) });
      case 'send-morning':
      case 'send-weekly': {
        if (!discordReady()) return json({ message: 'No Discord webhook is set in .env.' }, { status: 400 });
        const kind = body.kind === 'send-morning' ? 'morning' : 'weekly';
        if (!date) return json({ message: 'A date is required.' }, { status: 400 });
        const sent = await sendStoredBrief(kind, date);
        return sent ? json({ ok: true }) : json({ message: 'There is no brief for that date yet.' }, { status: 404 });
      }
      case 'discord-test':
        if (!discordReady()) return json({ message: 'No Discord webhook is set in .env.' }, { status: 400 });
        await sendTest();
        return json({ ok: true });
      default:
        return json({ message: 'Unknown action.' }, { status: 400 });
    }
  } catch (err) {
    return json({ message: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
