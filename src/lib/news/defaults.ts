import type { NewsSettings } from './types';

export interface DefaultAsset {
  kind: 'market' | 'stock' | 'topic';
  symbol: string;
  name: string;
  keywords: string[];
}

/** What is tracked on a fresh install. Everything here can be removed, and brought back with Reset. */
export const DEFAULT_ASSETS: readonly DefaultAsset[] = [
  {
    kind: 'market',
    symbol: 'NQ',
    name: 'Nasdaq 100 futures',
    keywords: ['Nasdaq', 'Nasdaq 100', 'NQ futures', 'tech stocks', 'QQQ']
  },
  {
    kind: 'market',
    symbol: 'GC',
    name: 'Gold futures',
    keywords: ['gold', 'bullion', 'gold price', 'XAU', 'safe haven']
  },
  {
    kind: 'market',
    symbol: 'CL',
    name: 'Crude oil futures',
    keywords: ['crude oil', 'oil prices', 'WTI', 'Brent', 'OPEC', 'EIA', 'oil inventories', 'Strait of Hormuz', 'refinery']
  },
  { kind: 'stock', symbol: 'NVDA', name: 'Nvidia', keywords: ['Nvidia', 'NVDA', 'Jensen Huang'] },
  { kind: 'stock', symbol: 'AAPL', name: 'Apple', keywords: ['Apple', 'AAPL', 'Tim Cook', 'iPhone'] },
  { kind: 'stock', symbol: 'MSFT', name: 'Microsoft', keywords: ['Microsoft', 'MSFT', 'Satya Nadella', 'Azure'] },
  { kind: 'stock', symbol: 'AMZN', name: 'Amazon', keywords: ['Amazon', 'AMZN', 'Andy Jassy', 'AWS'] },
  { kind: 'stock', symbol: 'GOOGL', name: 'Alphabet', keywords: ['Alphabet', 'Google', 'GOOGL', 'Sundar Pichai'] },
  { kind: 'stock', symbol: 'META', name: 'Meta', keywords: ['Meta Platforms', 'Facebook', 'Instagram', 'Zuckerberg'] },
  { kind: 'stock', symbol: 'TSLA', name: 'Tesla', keywords: ['Tesla', 'TSLA', 'Elon Musk'] },
  { kind: 'stock', symbol: 'AVGO', name: 'Broadcom', keywords: ['Broadcom', 'AVGO', 'Hock Tan'] },
  {
    kind: 'topic',
    symbol: 'FED',
    name: 'Fed and rates',
    keywords: ['Federal Reserve', 'Fed', 'FOMC', 'Powell', 'interest rates', 'rate cut', 'rate hike']
  },
  {
    kind: 'topic',
    symbol: 'INFLATION',
    name: 'CPI and PPI',
    keywords: ['CPI', 'PPI', 'PCE', 'inflation report', 'consumer prices']
  },
  {
    kind: 'topic',
    symbol: 'JOBS',
    name: 'Jobs reports',
    keywords: ['jobs report', 'nonfarm payrolls', 'unemployment rate', 'jobless claims', 'payrolls']
  },
  {
    kind: 'topic',
    symbol: 'TARIFFS',
    name: 'Tariffs and trade',
    keywords: ['tariff', 'tariffs', 'trade war', 'export controls', 'trade deal']
  },
  {
    kind: 'topic',
    symbol: 'GEOPOLITICS',
    name: 'War and geopolitics',
    keywords: ['war', 'missile', 'airstrike', 'sanctions', 'ceasefire', 'Ukraine', 'Iran', 'Israel', 'Taiwan', 'Middle East']
  },
  {
    kind: 'topic',
    symbol: 'OPEC',
    name: 'OPEC',
    keywords: ['OPEC', 'OPEC+', 'output cut', 'oil production quota']
  }
];

export const DEFAULT_MODEL = 'anthropic/claude-haiku-5.5';

/** Models to pick from in one click. Anything on OpenRouter can be typed in too. */
export const MODEL_PRESETS: readonly { id: string; label: string; note: string }[] = [
  { id: 'anthropic/claude-haiku-5.5', label: 'Claude Haiku 5.5', note: 'Fast and cheap. The default.' },
  { id: 'anthropic/claude-sonnet-5.5', label: 'Claude Sonnet 5.5', note: 'Sharper judgement, costs more.' },
  { id: 'openai/gpt-6-luna', label: 'GPT-6 Luna', note: 'Fast and cheap.' },
  { id: 'deepseek/deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash', note: 'Cheapest.' }
];

export const DEFAULT_SETTINGS: NewsSettings = {
  model: DEFAULT_MODEL,
  morningTime: '08:00',
  weeklyDay: 0,
  weeklyTime: '18:00',
  alertWindows: [
    { start: '08:30', end: '10:00' },
    { start: '12:00', end: '15:00' }
  ],
  alertMinImpact: 'high',
  maxAlertsPerHour: 3,
  pollMinutes: 2,
  freshMinutes: 30,
  discordBrief: true,
  discordAlerts: true,
  discordWeekly: true,
  moveAlerts: true,
  moveAlertRatio: 2,
  showLow: false
};
