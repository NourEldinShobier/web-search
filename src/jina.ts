/** Thin client for Jina's hosted Reader (r.jina.ai) and Search (s.jina.ai) APIs. */

export class ApiError extends Error {
  constructor(message: string, readonly status = 0) {
    super(message);
  }
}

export type SearchType = 'web' | 'images' | 'news' | 'arxiv' | 'ssrn';

export interface SearchItem {
  title: string;
  url: string;
  description?: string;
  date?: string;
  imageUrl?: string;
  imageWidth?: number;
  imageHeight?: number;
}

export interface Page {
  title: string;
  url: string;
  content: string;
  description?: string;
  publishedTime?: string;
  links?: Record<string, string>;
  images?: Record<string, string>;
  warning?: string;
}

export interface SearchOptions {
  type?: SearchType;
  num?: number;
  site?: string;
  gl?: string;
  hl?: string;
  /** Past day, week, month or year. */
  time?: 'd' | 'w' | 'm' | 'y';
}

export interface ReadOptions {
  selector?: string;
  remove?: string;
  links?: boolean;
  images?: boolean;
  engine?: 'browser' | 'curl' | 'auto';
  fresh?: boolean;
  timeoutSec?: number;
}

function headers(extra: Record<string, string | undefined>): Record<string, string> {
  const h: Record<string, string> = { Accept: 'application/json' };
  const key = process.env.JINA_API_KEY;
  if (key) h.Authorization = `Bearer ${key}`;
  for (const [k, v] of Object.entries(extra)) if (v !== undefined) h[k] = v;
  return h;
}

async function call<T>(url: string, init: RequestInit, timeoutMs: number, retry = true): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    const err = e as Error;
    if (err.name === 'TimeoutError') throw new ApiError(`timed out after ${timeoutMs / 1000}s`);
    // Jina sometimes drops the socket on large cold crawls; one retry usually lands.
    if (retry) return Bun.sleep(500).then(() => call<T>(url, init, timeoutMs, false));
    throw new ApiError(err.message);
  }
  if (retry && (res.status === 429 || res.status >= 500)) {
    await res.body?.cancel().catch(() => {});
    await Bun.sleep(res.status === 429 ? 2000 : 500);
    return call<T>(url, init, timeoutMs, false);
  }
  const text = await res.text();
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  if (!res.ok || !body) {
    const msg = body?.readableMessage ?? body?.message ?? text.slice(0, 200);
    const hint =
      res.status === 401 || res.status === 403 ? ' (check JINA_API_KEY)'
      : res.status === 429 ? ' (rate limited; set JINA_API_KEY for a higher quota)'
      : '';
    throw new ApiError(`HTTP ${res.status}: ${msg}${hint}`, res.status);
  }
  return (body.data ?? body) as T;
}

/** Search through svip.jina.ai: SERP-only (no page reads), about 2x faster than s.jina.ai. */
export async function search(query: string, opts: SearchOptions = {}): Promise<SearchItem[]> {
  const type = opts.type ?? 'web';
  const body: Record<string, unknown> = {
    q: opts.site ? `${query} site:${opts.site}` : query,
    num: Math.min(opts.num ?? 10, 20),
  };
  if (type === 'news' || type === 'images') body.type = type;
  if (type === 'arxiv' || type === 'ssrn') body.domain = type;
  if (opts.time) body.tbs = `qdr:${opts.time}`;
  if (opts.gl) body.gl = opts.gl;
  if (opts.hl) body.hl = opts.hl;
  const data = await call<{ results?: any[] }>(
    'https://svip.jina.ai/',
    { method: 'POST', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify(body) },
    30_000
  );
  return (data.results ?? []).map((r) => ({
    title: r.title ?? '',
    url: r.url ?? r.link ?? '',
    description: r.snippet ?? r.description,
    date: r.date,
    imageUrl: r.imageUrl,
    imageWidth: r.width ?? r.imageWidth,
    imageHeight: r.height ?? r.imageHeight,
  }));
}

export async function read(url: string, opts: ReadOptions = {}): Promise<Page> {
  const timeoutSec = opts.timeoutSec ?? 30;
  return call<Page>(
    'https://r.jina.ai/',
    {
      method: 'POST',
      headers: headers({
        'Content-Type': 'application/json',
        'X-Retain-Images': opts.images ? undefined : 'none',
        'X-With-Images-Summary': opts.images ? 'true' : undefined,
        // Inline link URLs roughly double page tokens; keep the text, list URLs only on --links.
        'X-Retain-Links': opts.links ? undefined : 'text',
        'X-With-Links-Summary': opts.links ? 'true' : undefined,
        'X-Target-Selector': opts.selector,
        'X-Remove-Selector': opts.remove,
        'X-Engine': opts.engine,
        'X-No-Cache': opts.fresh ? 'true' : undefined,
        'X-Timeout': String(timeoutSec),
      }),
      body: JSON.stringify({ url }),
    },
    (timeoutSec + 10) * 1000
  );
}

export async function screenshot(url: string, fullPage = false): Promise<string> {
  const mode = fullPage ? 'pageshot' : 'screenshot';
  const data = await call<{ screenshotUrl?: string; pageshotUrl?: string }>(
    'https://r.jina.ai/',
    {
      method: 'POST',
      headers: headers({ 'Content-Type': 'application/json', 'X-Respond-With': mode }),
      body: JSON.stringify({ url }),
    },
    60_000
  );
  const out = fullPage ? data.pageshotUrl : data.screenshotUrl;
  if (!out) throw new ApiError('no screenshot URL in response');
  return out;
}
