import { json } from '@sveltejs/kit';
import { backtestProgress, lastBacktest, runBacktest } from '$lib/server/news/backtest';

// The past-data test. GET gives the last result and how a running one is doing.
export function GET() {
  return json({ progress: backtestProgress(), result: lastBacktest() });
}

// Starts a run in the background and answers at once. Poll GET for progress.
export function POST() {
  if (backtestProgress().running) return json({ started: false, progress: backtestProgress() });
  void runBacktest().catch((err) => console.error('News backtest failed:', err));
  return json({ started: true, progress: backtestProgress() });
}
