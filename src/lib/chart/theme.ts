// Chart colours come from the same CSS variables as the rest of the UI, so
// there is one palette. Canvas drawing needs concrete values, hence this reader.

export interface ChartTheme {
  bg: string;
  surface: string;
  grid: string;
  border: string;
  text: string;
  textMuted: string;
  accent: string;
  green: string;
  red: string;
  level: string;
  sessionAsia: string;
  sessionLondon: string;
  sessionNewYork: string;
  fontUi: string;
  fontMono: string;
}

const FALLBACK: ChartTheme = {
  bg: '#0d0d0d',
  surface: '#1a1a1a',
  grid: '#181818',
  border: '#272727',
  text: '#e6e6e6',
  textMuted: '#8e8e8e',
  accent: '#4c8dff',
  green: '#35b389',
  red: '#e5565b',
  level: '#9a9a9a',
  sessionAsia: '#a27ff0',
  sessionLondon: '#45b6cc',
  sessionNewYork: '#e0779f',
  fontUi: "'Inter', system-ui, sans-serif",
  fontMono: "'JetBrains Mono', ui-monospace, monospace"
};

const VARS: Record<keyof ChartTheme, string> = {
  bg: '--bg',
  surface: '--surface-2',
  grid: '--grid',
  border: '--border',
  text: '--text',
  textMuted: '--text-2',
  accent: '--accent',
  green: '--green',
  red: '--red',
  level: '--level',
  sessionAsia: '--session-asia',
  sessionLondon: '--session-london',
  sessionNewYork: '--session-ny',
  fontUi: '--font-ui',
  fontMono: '--font-mono'
};

export function readTheme(el: HTMLElement): ChartTheme {
  const style = getComputedStyle(el);
  const theme = { ...FALLBACK };
  for (const key of Object.keys(VARS) as (keyof ChartTheme)[]) {
    const value = style.getPropertyValue(VARS[key]).trim();
    if (value) theme[key] = value;
  }
  return theme;
}

/** '#rrggbb' -> 'rgba(r, g, b, a)'. Other colour formats are returned untouched. */
export function alpha(color: string, opacity: number): string {
  const hex = /^#([0-9a-f]{6})$/i.exec(color)?.[1];
  if (!hex) return color;
  const n = parseInt(hex, 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${opacity})`;
}
