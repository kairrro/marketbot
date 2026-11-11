// A small RSS reader: just enough for the news feeds the brief reads. No
// dependency, and it never throws on odd input.

import type { RawHeadline } from './noise';

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tag(block: string, name: string): string {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(block);
  return m ? decode(m[1]) : '';
}

/** A short stable id for a headline: its link, or its title and time when there is none. */
export function headlineId(link: string, title: string, publishedAt: number): string {
  return link ? link.slice(0, 200) : `${title.slice(0, 120)}@${publishedAt}`;
}

/** The items of an RSS feed. `fallbackSource` names the outlet when the feed does not. */
export function parseRss(xml: string, fallbackSource = ''): RawHeadline[] {
  const out: RawHeadline[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = m[1];
    const title = tag(block, 'title');
    const publishedAt = Date.parse(tag(block, 'pubDate'));
    if (!title || !Number.isFinite(publishedAt)) continue;
    const link = tag(block, 'link');
    const source = tag(block, 'source') || fallbackSource;
    out.push({ id: headlineId(link, title, publishedAt), title, source, url: link, publishedAt });
  }
  return out;
}
