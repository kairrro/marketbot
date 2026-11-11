import { describe, expect, it } from 'vitest';
import { barsRequest, DATABENTO_START, isDatabentoFuture, parseBars } from './databentoBars';

const CSV = [
  'ts_event,rtype,publisher_id,instrument_id,open,high,low,close,volume',
  '2024-06-03T13:30:00.000000000Z,33,1,42140864,19000.25,19004.50,18998.00,19003.75,812',
  '2024-06-03T13:31:00.000000000Z,33,1,42140864,19003.75,19006.00,19001.25,19002.00,640'
].join('\n');

describe('parseBars', () => {
  it('reads candles by the names in the header, in ms, with the bar open time', () => {
    const candles = parseBars(CSV);
    expect(candles).toEqual([
      { t: Date.UTC(2024, 5, 3, 13, 30), o: 19000.25, h: 19004.5, l: 18998, c: 19003.75, v: 812 },
      { t: Date.UTC(2024, 5, 3, 13, 31), o: 19003.75, h: 19006, l: 19001.25, c: 19002, v: 640 }
    ]);
  });

  it('copes with Windows line endings, a trailing newline and a different column order', () => {
    const csv = 'close,volume,open,low,high,ts_event\r\n10.5,3,10,9.5,11,2024-01-02T00:00:00.000000000Z\r\n';
    expect(parseBars(csv)).toEqual([{ t: Date.UTC(2024, 0, 2), o: 10, h: 11, l: 9.5, c: 10.5, v: 3 }]);
  });

  it('skips rows that are not numbers, and returns nothing for an empty or unknown file', () => {
    expect(parseBars(`${CSV}\n2024-06-03T13:32:00.000000000Z,33,1,1,,,,,`)).toHaveLength(2);
    expect(parseBars('')).toEqual([]);
    expect(parseBars('a,b,c\n1,2,3')).toEqual([]);
  });
});

describe('barsRequest', () => {
  it('asks for the volume-rolled continuous contract in CSV, with readable prices and times', () => {
    const body = barsRequest('NQ', 'ohlcv-1m', Date.UTC(2024, 5, 3, 13, 30), Date.UTC(2024, 5, 4));
    expect(Object.fromEntries(body)).toEqual({
      dataset: 'GLBX.MDP3',
      symbols: 'NQ.v.0',
      stype_in: 'continuous',
      schema: 'ohlcv-1m',
      start: '2024-06-03T13:30:00',
      end: '2024-06-04T00:00:00',
      encoding: 'csv',
      pretty_px: 'true',
      pretty_ts: 'true'
    });
  });
});

describe('the futures it serves', () => {
  it('knows the Nasdaq contracts, and the micros start later', () => {
    expect(isDatabentoFuture('NQ')).toBe(true);
    expect(isDatabentoFuture('MNQ')).toBe(true);
    expect(isDatabentoFuture('QQQ')).toBe(false);
    expect(DATABENTO_START.MNQ).toBeGreaterThan(DATABENTO_START.NQ);
  });
});
