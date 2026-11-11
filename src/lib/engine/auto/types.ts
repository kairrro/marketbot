// The breakout strategy the automatic backtester runs: its settings with their
// defaults, and the shapes of what a run hands back. The rules in DEFAULTS are
// the strategy: the screen only lets the fee, the risk and the entry hours be
// changed, so the rest cannot be tweaked by accident. Change them here.

export const TIME_ZONE = 'America/Chicago';

export type Dir = 1 | -1;

/** The share of the position that calm mode takes off. */
export const PARTIAL_SHARE = 1 / 3;
export type BreakoutTf = '1h' | '4h';
export type ExitReason = 'stop' | 'trail' | 'end';
export type SkipReason = 'outside hours' | 'tiny stop' | 'too many open' | 'monthly stop';

export interface BreakoutSettings {
  /** The candles everything is judged on. */
  tf: BreakoutTf;
  /** Long: a candle closes above the highest high of this many candles before it. Short: below the lowest low. */
  entryLen: number;
  /** The stop is the lowest low (long) or highest high of the last this many candles, and trails it. */
  exitLen: number;
  shorts: boolean;
  /** Most trades open at once across all coins, and most in one direction. Coins move together, so this keeps one market move from being several losses. 0: no limit. */
  maxOpen: number;
  maxPerSide: number;
  /** "Calm mode": when price reaches this many R, a third of the position is taken off and the stop moves to the entry. 0: off. */
  partialR: number;
  /** Once the trades closed in a UTC month are down this many R, no new trades until the next month. 0: never. */
  monthlyStopR: number;
  /** A stop closer than this % of the entry price is too tight: the trade is skipped. */
  minStopPct: number;
  /** Fee on each side (entry and exit), in % of the position. Taken off every trade's R. */
  feePct: number;
  /** Only for the % figures in the summary: the account's risk per trade. */
  riskPct: number;
  /** Only enter when the entry candle closes within [windowFrom, windowTo), CT hours. */
  windowOn: boolean;
  windowFrom: number;
  windowTo: number;
  /** The prop firm's rules, only for the challenge odds in the summary: the profit target, the most the account may fall from its start, and the most it may lose in one UTC day, all in % of the starting balance. */
  targetPct: number;
  maxDrawdownPct: number;
  /** 0: the firm has no daily loss limit. */
  dailyLossPct: number;
  /** For the funded-account payouts in the summary: the account's size in $ and the share of profit paid to you, in %. */
  accountSize: number;
  profitSplitPct: number;
}

/**
 * A channel breakout on 1h candles with a trailing stop: enter on a 10-candle
 * breakout, trail the stop 40 candles back. Tested on 5.8 years (2021 to
 * October 2026) of BTC, ETH, SOL and BNB, XRP, DOGE: positive in every year,
 * about +0.14R a trade after fees, biggest drawdown near 20R (hence risk 0.25%).
 * Not a single lucky setting: every entry of 10 with a stop of 30 to 100 did
 * about as well. The textbook 20/20 was positive in only 2 of those 5 years.
 * The monthly stop of 3R is for the bad months: they are stretches of chop with
 * the usual number of trades and few winners, and stopping at -3R cut the worst
 * month from about -12R to -5R in every one of 30 random coin sets, for a few
 * more small losing months and a little less profit.
 */
export const DEFAULTS: BreakoutSettings = {
  tf: '1h',
  entryLen: 10,
  exitLen: 40,
  shorts: true,
  maxOpen: 2,
  maxPerSide: 1,
  partialR: 0,
  monthlyStopR: 3,
  minStopPct: 0.5,
  feePct: 0.045,
  riskPct: 0.25,
  windowOn: false,
  windowFrom: 10,
  windowTo: 22,
  targetPct: 8,
  maxDrawdownPct: 6,
  dailyLossPct: 4,
  accountSize: 50_000,
  profitSplitPct: 80
};

export interface Trade {
  /** 1, 2, 3… in the order the trades were entered, across every coin. */
  id: number;
  coin: string;
  side: 'long' | 'short';
  /** Open time of the candle that broke out. */
  signalTime: number;
  /** The highest high (long) or lowest low of the candles before the breakout candle. */
  breakoutLevel: number;
  /** Close of the breakout candle: the entry. */
  entryTime: number;
  entry: number;
  /** The stop the trade started with. */
  stop: number;
  /** Each time the trailing stop moved: the close of the candle that moved it, and the stop from then on. */
  trail: { time: number; stop: number }[];
  /** Calm mode: the third of the position taken off at the partial target, if the trade got there. */
  partial: { time: number; price: number } | null;
  /** Close of the candle it ended in. */
  exitTime: number;
  /** Where the rest of the position (all of it, with no partial) was closed. */
  exitPrice: number;
  exitReason: ExitReason;
  /** `r` is after fees; `grossR` is before, and `feeR` the fees in R. */
  r: number;
  grossR: number;
  feeR: number;
  /** Price decimals of the coin, for display. */
  precision: number;
}

export interface RunResult {
  trades: Trade[];
  /** Breakouts that were not traded, by why. */
  skipped: Partial<Record<SkipReason, number>>;
  /** The tested window. */
  from: number;
  to: number;
}
