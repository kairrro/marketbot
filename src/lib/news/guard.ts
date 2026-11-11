// The one hard rule of the news brief: it never says which way a price will go.
// The AI is told that in its prompt, and this is the lock behind it. Every piece
// of text the AI writes goes through here before it is stored, shown or sent,
// and anything that reads like a call on direction (or a trade) is thrown out.

const DIRECTION_WORDS = [
  'bullish',
  'bearish',
  'bull',
  'bear',
  'bulls',
  'bears',
  'rally',
  'rallies',
  'rallied',
  'rallying',
  'surge',
  'surges',
  'surged',
  'surging',
  'soar',
  'soars',
  'soared',
  'soaring',
  'plunge',
  'plunges',
  'plunged',
  'plunging',
  'plummet',
  'plummets',
  'plummeted',
  'tumble',
  'tumbles',
  'tumbled',
  'tumbling',
  'crash',
  'crashes',
  'crashed',
  'crashing',
  'skyrocket',
  'skyrockets',
  'skyrocketed',
  'sink',
  'sinks',
  'slump',
  'slumps',
  'slumped',
  'pump',
  'pumps',
  'dump',
  'dumps',
  'upside',
  'downside',
  'uptrend',
  'downtrend',
  'upward',
  'downward',
  'breakout',
  'breakdown',
  'tailwind',
  'headwind',
  'rebound',
  'rebounds'
];

const PATTERNS: RegExp[] = [
  new RegExp(`\\b(?:${DIRECTION_WORDS.join('|')})\\b`, 'i'),
  // "will go up", "could fall", "expected to rise", "set to drop"...
  /\b(?:will|could|may|might|should|likely to|expected to|set to|poised to|about to|going to|gonna)\s+(?:\w+\s+)?(?:rise|rises|fall|falls|drop|drops|climb|climbs|jump|jumps|gain|gains|lose|loses|slide|slides|increase|increases|decrease|decreases|go up|go down|move up|move down|move higher|move lower|head higher|head lower|trade higher|trade lower|pop|dip|extend gains|extend losses)\b/i,
  /\b(?:go|goes|going|went|move|moves|moving|head|heads|heading|push|pushes|pushing|send|sends|sending|drive|drives|driving)\s+(?:\w+\s+){0,2}(?:up|down|higher|lower)\b/i,
  // "stocks up", "oil is lower", "yields rise"
  /\b(?:stocks?|shares?|prices?|futures|index|indexes|yields?|oil|crude|gold|nasdaq|nq|gc|cl|markets?)\s+(?:are\s+|is\s+|were\s+|was\s+)?(?:up|down|higher|lower|rise|rises|rose|fall|falls|fell|drop|drops|dropped|climb|climbs|climbed|gain|gains|gained|lose|loses|lost|jump|jumps|jumped)\b/i,
  /\b(?:price|prices)\s+(?:target|will|to)\b/i,
  // Trade talk.
  /\b(?:buy|buys|buying|bought|sell|sells|selling|sold)\b/i,
  /\b(?:go|going|went)\s+(?:long|short)\b/i,
  /\b(?:long|short)\s+(?:position|positions|setup|bias|trade|side)\b/i,
  /\b(?:buy|sell)\s+(?:the\s+)?(?:dip|rip)\b/i,
  /\b(?:positive|negative|good news|bad news)\s+for\b/i,
  /\b(?:direction|directional|bias)\b/i
];

/** The first reason `text` reads as a call on direction, or null when it is fine. */
export function findBanned(text: string): string | null {
  for (const pattern of PATTERNS) {
    const m = pattern.exec(text);
    if (m) return m[0];
  }
  return null;
}

export const isClean = (text: string): boolean => findBanned(text) === null;

/** `text` when it is clean, `fallback` when not. */
export function cleanText(text: string, fallback: string): string {
  return isClean(text) ? text : fallback;
}

/** Every banned phrase found in the strings, for telling the AI what to fix. */
export function bannedIn(texts: readonly string[]): string[] {
  const found: string[] = [];
  for (const t of texts) {
    const hit = findBanned(t);
    if (hit) found.push(hit);
  }
  return found;
}
