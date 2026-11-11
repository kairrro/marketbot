// Session statistics. Trades are taken in array order (the order they were
// closed), which is also the order of the equity curve.

export interface StatTrade {
  r: number;
  pnl: number;
}

export interface Stats {
  trades: number;
  wins: number;
  losses: number;
  /** 0–100, or null with no trades. */
  winRate: number | null;
  totalR: number;
  avgR: number | null;
  avgWinR: number | null;
  avgLossR: number | null;
  /** Gross $ won / gross $ lost. Infinity when there are wins and no losses. */
  profitFactor: number | null;
  netPnl: number;
  maxDrawdownR: number;
  worstLosingStreak: number;
  /** Cumulative R after each trade, starting from 0 before the first. */
  equity: number[];
}

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const mean = (values: number[]) => (values.length ? sum(values) / values.length : null);

export function computeStats(trades: readonly StatTrade[]): Stats {
  const wins = trades.filter((trade) => trade.r > 0);
  const losses = trades.filter((trade) => trade.r <= 0);
  const grossWin = sum(wins.map((trade) => trade.pnl));
  const grossLoss = -sum(losses.map((trade) => trade.pnl));

  const equity = [0];
  let peak = 0;
  let maxDrawdownR = 0;
  let streak = 0;
  let worstLosingStreak = 0;
  for (const trade of trades) {
    const total = equity[equity.length - 1] + trade.r;
    equity.push(total);
    peak = Math.max(peak, total);
    maxDrawdownR = Math.max(maxDrawdownR, peak - total);
    streak = trade.r <= 0 ? streak + 1 : 0;
    worstLosingStreak = Math.max(worstLosingStreak, streak);
  }

  const totalR = equity[equity.length - 1];
  return {
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length ? (wins.length / trades.length) * 100 : null,
    totalR,
    avgR: trades.length ? totalR / trades.length : null,
    avgWinR: mean(wins.map((trade) => trade.r)),
    avgLossR: mean(losses.map((trade) => trade.r)),
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : null,
    netPnl: sum(trades.map((trade) => trade.pnl)),
    maxDrawdownR,
    worstLosingStreak,
    equity
  };
}
