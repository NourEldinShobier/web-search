/**
 * Optional Search1API client (https://www.search1api.com), used when SEARCH1API_API_KEY is set.
 * Adds more engines per source: Google, DuckDuckGo, Yandex, and Reddit, Hacker News, GitHub, X, YouTube,
 * Wikipedia and arXiv's own search. Request shape follows superagents-lab/jev-search (MIT, Copyright (c) 2026 Search1API).
 */
import { ApiError, type SearchItem } from './jina';

export const search1apiKey = () => process.env.SEARCH1API_API_KEY;

const TIME = { d: 'day', w: 'week', m: 'month', y: 'year' } as const;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–' };

/** Snippets come back with HTML entities left in. */
const decode = (s = '') =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n: string) => ENTITIES[n.toLowerCase()] ?? m);

export async function search(
  query: string,
  opts: { service: string; site?: string; time?: keyof typeof TIME; num?: number }
): Promise<SearchItem[]> {
  const res = await fetch(`https://api.search1api.com/${opts.service === 'hackernews' ? 'news' : 'search'}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${search1apiKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      search_service: opts.service,
      max_results: opts.num ?? 8,
      include_sites: opts.site ? [opts.site] : [],
      ...(opts.time ? { time_range: TIME[opts.time] } : {}),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ApiError(`Search1API ${opts.service} HTTP ${res.status}: ${text.slice(0, 120)}`, res.status);
  }
  const body = (await res.json()) as { results?: { title?: string; link?: string; snippet?: string; published_date?: string }[] };
  return (body.results ?? [])
    .filter((r) => typeof r.link === 'string' && typeof r.title === 'string')
    .map((r) => ({ title: decode(r.title), url: r.link!, description: decode(r.snippet), date: r.published_date ?? undefined }));
}
