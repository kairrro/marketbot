// Generic OHLCV candle shape, shared across exchange clients.

export interface Candle {
  time: number; // candle open time, seconds since epoch
  open: number;
  high: number;
  low: number;
  close: number;
}
