/** Plans a search (which sources, time window, query), searches every source in parallel through Jina and merges by URL. */
import { search as jinaSearch, type SearchItem, type SearchType } from './jina';
import { SOURCE_IDS, canonicalUrl, sourceById, type Lane } from './sources';
import { buildCandidates } from './candidates';
import { intent, jevKey } from './jev';
import { cached } from './cache';

export type Time = 'd' | 'w' | 'm' | 'y';

export interface Plan {
  query: string;
  time?: Time;
  /** Source ids, or `site:<host>` for --site, or a bare search type (images, ssrn). */
  sources: string[];
  /** Who chose the sources and window. */
  by: 'jev' | 'default' | 'user';
}

export interface Hit extends SearchItem {
  /** Sources that returned this URL. */
  sources: string[];
  /** Best rank it had in any lane, 1-based. */
  position: number;
}

const HOUR = 3_600_000;
/** Jev's probability above which a request is taken to want a source (from jev-search). */
const WANTS = 0.6;

export function parseSources(value: string): string[] {
  if (value === 'all') return [...SOURCE_IDS];
  const ids = [...new Set(value.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean))];
  const bad = ids.filter((id) => !sourceById(id));
  if (bad.length || !ids.length) throw new Error(`unknown source "${bad[0] ?? value}"; use: ${SOURCE_IDS.join(', ')}, all`);
  return ids;
}

/** Sources Jev thinks the request wants; the default sources when it singles none out. */
export function pickSources(probabilities: Record<string, number>): string[] {
  const wanted = SOURCE_IDS.filter((id) => (probabilities[id] ?? 0) >= WANTS && id !== 'web');
  if (!wanted.length) return ['web'];
  return (probabilities.web ?? 0) >= WANTS ? ['web', ...wanted] : wanted;
}

export async function plan(
  type: SearchType,
  request: string,
  opts: { sources?: string[]; time?: Time; site?: string; fresh: boolean },
  warn: (s: string) => void
): Promise<Plan> {
  const fixed =
    opts.site ? [`site:${opts.site}`]
    : opts.sources ?? (type === 'web' ? undefined : [type]);
  const base: Plan = { query: request, time: opts.time, sources: fixed ?? ['web'], by: fixed ? 'user' : 'default' };
  // Jev reads plain-language web requests; typed commands (news, papers, images) already say what they want.
  if (type !== 'web' || !jevKey() || (fixed && opts.time)) return base;
  try {
    const candidates = buildCandidates(request);
    const day = new Date().toISOString().slice(0, 10);
    const got = await cached(`i|${day}|${request}`, HOUR, opts.fresh, () => intent(request, candidates));
    return {
      query: candidates[got.query] ?? request,
      time: opts.time ?? (got.window === 'any' ? undefined : got.window),
      sources: fixed ?? pickSources(got.sources),
      by: fixed ? 'user' : 'jev',
    };
  } catch (e) {
    warn(`Jev skipped: ${(e as Error).message}`);
    return base;
  }
}

function laneOf(id: string): Lane {
  if (id.startsWith('site:')) return { site: id.slice(5) };
  return sourceById(id)?.lane ?? { type: id as SearchType };
}

const inflight = new Map<string, Promise<SearchItem[]>>();

/** One search call, cached on disk and shared in-process, so a speculative call is reused rather than repeated. */
export function runLane(lane: Lane, query: string, time: Time | undefined, num: number, fresh: boolean): Promise<SearchItem[]> {
  const key = `l|${JSON.stringify([lane, query, time, num])}`;
  let p = inflight.get(key);
  if (!p) {
    const ttl = lane.type === 'news' ? HOUR / 4 : HOUR;
    p = cached(key, ttl, fresh, () => jinaSearch(query, { type: lane.type, site: lane.site, time, num }));
    inflight.set(key, p);
  }
  return p;
}

export function webLane(): Lane {
  return laneOf('web');
}

/** Merges results by canonical URL. Order: most sources agreeing, then best position. */
export function merge(results: { source: string; items: SearchItem[] }[]): Hit[] {
  const byUrl = new Map<string, Hit>();
  for (const { source, items } of results) {
    items.forEach((it, i) => {
      if (!it.url) return;
      const key = canonicalUrl(it.url);
      const found = byUrl.get(key);
      if (!found) return void byUrl.set(key, { ...it, sources: [source], position: i + 1 });
      if (!found.sources.includes(source)) found.sources.push(source);
      found.position = Math.min(found.position, i + 1);
      if ((it.description?.length ?? 0) > (found.description?.length ?? 0)) found.description = it.description;
      found.date ??= it.date;
    });
  }
  return [...byUrl.values()].sort((a, b) => b.sources.length - a.sources.length || a.position - b.position);
}

export async function gather(p: Plan, num: number, fresh: boolean, warn: (s: string) => void): Promise<Hit[]> {
  const tasks = p.sources.map((id) => ({ id, lane: laneOf(id) }));
  const settled = await Promise.allSettled(tasks.map((t) => runLane(t.lane, p.query, p.time, num, fresh)));
  const ok: { source: string; items: SearchItem[] }[] = [];
  settled.forEach((r, i) => {
    const { id } = tasks[i]!;
    if (r.status === 'fulfilled') ok.push({ source: id, items: r.value });
    else warn(`${id} failed: ${(r.reason as Error).message}`);
  });
  if (!ok.length) throw (settled[0] as PromiseRejectedResult).reason;
  return merge(ok);
}
