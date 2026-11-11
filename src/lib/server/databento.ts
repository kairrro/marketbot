// CME futures candles (NQ, MNQ, ES, MES, YM, RTY, GC, CL) from Databento: real
// futures prices, around the clock, back to 2010, where Yahoo keeps 1 minute
// candles for 30 days and 5 to 30 minute candles for 60. Needs a Databento
// account (new accounts get free credits; the data is billed by size, and
// candles are small), with its key in .env as DATABENTO_API_KEY.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { env } from '$env/dynamic/private';
import { barsRequest, parseBars, type DatabentoSchema } from '$lib/data/databentoBars';
import { loadDays, type DayStore } from '$lib/data/databentoCache';
import type { Candle } from '$lib/engine/types';
import { StockError } from './stockError';

/** Days already downloaded, one file each, beside the database. Delete the folder to start over. */
const CACHE_DIR = join(dirname(process.env.DB_PATH ?? './data/market-bot.db'), 'databento');

const ENDPOINT = 'https://hist.databento.com/v0/timeseries.get_range';

export const databentoReady = () => Boolean(env.DATABENTO_API_KEY);

interface ErrorBody {
  detail?: { case?: string; message?: string } | string;
}

/** What Databento said went wrong, in its own words. */
const problem = (body: ErrorBody | null, status: number): string => {
  const detail = body?.detail;
  const message = typeof detail === 'string' ? detail : detail?.message;
  return message ? `Databento: ${message}` : `Databento returned ${status}`;
};

/** A day's candles kept as [t, o, h, l, c, v] rows. A file that cannot be read is a day not kept; one that cannot be written only means a download next time. */
function dayStore(coin: string, schema: DatabentoSchema): DayStore {
  const file = (day: number) => join(CACHE_DIR, `${coin}-${schema}-${new Date(day).toISOString().slice(0, 10)}.json`);
  return {
    read(day) {
      try {
        const rows = JSON.parse(readFileSync(file(day), 'utf8')) as number[][];
        return rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }));
      } catch {
        return null;
      }
    },
    write(day, candles) {
      try {
        mkdirSync(CACHE_DIR, { recursive: true });
        const path = file(day);
        const temp = `${path}.${process.pid}.tmp`;
        writeFileSync(temp, JSON.stringify(candles.map((c) => [c.t, c.o, c.h, c.l, c.c, c.v])));
        renameSync(temp, path);
      } catch {
        // Nothing to do: the day is fetched again next time.
      }
    }
  };
}

/** The one-minute or one-hour candles of a future that open from `from` up to `to`; days fetched before are not fetched again. */
export function databentoBars(coin: string, schema: DatabentoSchema, from: number, to: number): Promise<Candle[]> {
  return loadDays(from, to, Date.now(), dayStore(coin, schema), (start, end) => fetchBars(coin, schema, start, end));
}

/** The candles from Databento's servers that open from `from` up to `to`. */
async function fetchBars(coin: string, schema: DatabentoSchema, from: number, to: number): Promise<Candle[]> {
  const key = env.DATABENTO_API_KEY ?? '';
  let end = to;
  // The newest data is not served at once: if the end is too late, Databento says where it stops, and that is tried.
  // Twice at most: first the end of the data, then the end of what the licence covers.
  for (let attempt = 0; attempt < 3; attempt++) {
    let res: Response;
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${key}:`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: barsRequest(coin, schema, from, end)
      });
    } catch (err) {
      throw new StockError(`Could not reach Databento: ${err instanceof Error ? err.message : err}`);
    }
    if (res.ok) return parseBars(await res.text());

    const body: ErrorBody | null = await res.json().catch(() => null);
    if (res.status === 401 || res.status === 403) {
      throw new StockError('Databento turned down the key in .env (DATABENTO_API_KEY).');
    }
    if (res.status === 402) throw new StockError('Databento says the account is out of credit.');
    const detail = typeof body?.detail === 'string' ? body.detail : body?.detail?.message ?? '';
    // Where the data stops is in the message, as "available up to 2026-10-31 20:40:00" or "end time before 2026-10-31T12:50:30".
    const available = /available|end time before/i.test(detail)
      ? /(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/.exec(detail)
      : null;
    const limit = available ? Date.parse(`${available[1]}T${available[2]}Z`) : NaN;
    if (attempt < 2 && Number.isFinite(limit) && limit > from && limit < end) {
      end = limit;
      continue;
    }
    throw new StockError(problem(body, res.status));
  }
  throw new StockError('Databento did not answer.');
}
