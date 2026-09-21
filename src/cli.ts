#!/usr/bin/env bun
/** web-search: search the web and read pages as compact markdown, built for AI agents. */
import { parseArgs } from 'node:util';
import { ApiError, read, screenshot, search, type Page, type SearchItem, type SearchOptions, type SearchType } from './jina';
import { focus, truncate } from './focus';
import { cached } from './cache';
import { keepRelevant, rerank } from './rerank';
import { decide, q } from './hook';

const HELP = `web-search — web search and page reading for AI agents (Jina Search, Reader and Reranker)

Usage:
  web-search search <query> [-n 5] [--time d|w|m|y] [--site host] [--read K]
  web-search news <query>   [same options as search]
  web-search papers <query> [--source arxiv|ssrn] [-n 5]
  web-search images <query> [-n 5]
  web-search read <url...>  [--focus "question"] [--max-tokens 4000] [--selector css]
  web-search screenshot <url> [--full] [-o file.png]
Pages and PDFs both work with read.

Search options:
  -n, --num N        results to show (default 5)
  --time d|w|m|y     only results from the past day, week, month or year
  --read K           also read the top K results, focused on the query
  --urls             print only URLs, one per line (pipe into "web-search read")
  --no-rerank        keep all results (default: rerank and drop off-topic ones)
  --site, --gl, --hl restrict to a site, country, language

Read options (URLs can also come from stdin, one per line):
  --focus "q"        keep only the passages relevant to q (big token saver)
  --max-tokens N     per page, default 4000 (1500 with search --read); 0 = no limit
  --offset N         start at character N; long pages end with the next offset
                     and a list of remaining sections, so nothing is out of reach
  --selector css     only this part of the page; --remove css drops parts
  --links, --images  append link / image lists
  --engine browser   render JavaScript-heavy pages (slower); curl = fastest
  --timeout S        seconds, default 30

Common: --json (structured output), --fresh (skip the 1h/24h cache), -h, --help
Env: JINA_API_KEY (needed for search; raises read limits), WEB_SEARCH_CACHE_DIR (default ~/.cache/web-search)
Exit codes: 0 ok, 1 usage error, 2 API/network error`;

class UsageError extends Error {}

const HOUR = 3_600_000;
const out = (s: string) => process.stdout.write(s.endsWith('\n') ? s : `${s}\n`);
const warn = (s: string) => process.stderr.write(`web-search: ${s}\n`);

function int(v: unknown, fallback: number): number {
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new UsageError(`expected a whole number, got "${v}"`);
  return n;
}

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

const clip = (s = '', n = 220) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = { status: 'fulfilled', value: await fn(items[i]!) };
      } catch (reason) {
        results[i] = { status: 'rejected', reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

type Values = Record<string, string | boolean | undefined>;

async function readPage(url: string, v: Values, focusQuery: string | undefined, maxTokens: number): Promise<Page> {
  const opts = {
    selector: v.selector as string | undefined,
    remove: v.remove as string | undefined,
    links: Boolean(v.links),
    images: Boolean(v.images),
    engine: v.engine as 'browser' | 'curl' | 'auto' | undefined,
    fresh: Boolean(v.fresh),
    timeoutSec: int(v.timeout, 30),
  };
  const key = `p|${url}|${opts.selector}|${opts.remove}|${opts.links}|${opts.images}|${opts.engine}`;
  const page = await cached(key, 24 * HOUR, opts.fresh, () => read(url, opts));

  // Offsets refer to this exact text, so the follow-up command repeats every option that shapes it.
  const readCmd = [
    `web-search read ${q(url)}`,
    opts.selector && `--selector ${q(opts.selector)}`,
    opts.remove && `--remove ${q(opts.remove)}`,
    opts.links && '--links',
    opts.images && '--images',
    opts.engine && `--engine ${opts.engine}`,
  ]
    .filter(Boolean)
    .join(' ');
  const md = page.content ?? '';
  const offset = v.offset === undefined ? undefined : int(v.offset, 0);
  // An explicit --offset means "read in order from here", so it takes precedence over --focus.
  const content =
    focusQuery && offset === undefined ? focus(md, focusQuery, maxTokens, readCmd) : truncate(md, maxTokens, offset, readCmd);
  return { ...page, content };
}

function formatPage(p: Page): string {
  const lines = [`# ${p.title || host(p.url)}`, [p.url, p.publishedTime].filter(Boolean).join(' · ')];
  // Jina's "cached snapshot" notice is noise for us; we have --fresh.
  if (p.warning && !/cached snapshot/i.test(p.warning)) lines.push(`> ${clip(p.warning, 200)}`);
  lines.push('', p.content.trim());
  if (p.links && Object.keys(p.links).length) {
    lines.push('', '## Links', ...Object.entries(p.links).slice(0, 40).map(([t, u]) => `- ${clip(t, 80)}: ${u}`));
  }
  if (p.images && Object.keys(p.images).length) {
    lines.push('', '## Images', ...Object.entries(p.images).slice(0, 20).map(([t, u]) => `- ${clip(t, 80)}: ${u}`));
  }
  return lines.join('\n');
}

function formatResults(items: SearchItem[], type: SearchType): string {
  if (!items.length) return 'No results.';
  return items
    .map((it, i) => {
      if (type === 'images') {
        const size = it.imageWidth ? ` — ${it.imageWidth}x${it.imageHeight}` : '';
        return `${i + 1}. ${clip(it.title, 120)}${size}\n   image: ${it.imageUrl}\n   page: ${it.url}`;
      }
      const meta = [host(it.url), it.date].filter(Boolean).join(' · ');
      const snippet = clip(it.description);
      return `${i + 1}. ${clip(it.title, 120)} — ${meta}\n   ${it.url}${snippet ? `\n   ${snippet}` : ''}`;
    })
    .join('\n');
}

async function cmdSearch(type: SearchType, query: string, v: Values) {
  if (!query) throw new UsageError('a search query is required');
  if (!process.env.JINA_API_KEY) throw new UsageError('search needs JINA_API_KEY (free key: https://jina.ai/?sui=apikey)');
  const n = int(v.num, 5);
  const useRerank = type !== 'images' && !v['no-rerank'];
  const fetchN = useRerank ? Math.min(20, n * 2) : Math.min(20, n);
  const fresh = Boolean(v.fresh);
  const time = v.time as SearchOptions['time'];
  if (time && !['d', 'w', 'm', 'y'].includes(time)) throw new UsageError('--time must be d, w, m or y');
  const opts: SearchOptions = { type, num: fetchN, site: v.site as string, gl: v.gl as string, hl: v.hl as string, time };

  let items = await cached(`s|${JSON.stringify([query, opts])}`, type === 'news' ? HOUR / 4 : HOUR, fresh, () =>
    search(query, opts)
  );

  if (useRerank && items.length > 1) {
    try {
      const scores = await cached(`r|${query}|${items.map((i) => i.url).join(' ')}`, HOUR, fresh, () =>
        rerank(query, items.map((i) => `${i.title}\n${i.description ?? ''}`), process.env.JINA_API_KEY!)
      );
      items = keepRelevant(items, scores);
    } catch (e) {
      warn(`rerank skipped: ${(e as Error).message}`);
    }
  }
  items = items.slice(0, n);

  const readK = type === 'images' ? 0 : int(v.read, 0);
  const pages = readK
    ? await mapLimit(items.slice(0, readK), 5, (it) => readPage(it.url, v, query, int(v['max-tokens'], 1500)))
    : [];

  if (v.json) {
    const read = pages.map((p, i) => (p.status === 'fulfilled' ? p.value : { url: items[i]!.url, error: String((p.reason as Error).message) }));
    out(JSON.stringify({ query, type, results: items, ...(readK ? { pages: read } : {}) }));
  } else if (v.urls) {
    out(items.map((i) => i.url).join('\n'));
  } else {
    out(formatResults(items, type));
    pages.forEach((p, i) =>
      out(`\n---\n\n${p.status === 'fulfilled' ? formatPage(p.value) : `# ${items[i]!.url}\n[read failed: ${(p.reason as Error).message}]`}`)
    );
  }
}

async function cmdRead(urls: string[], v: Values) {
  if (!urls.length && !process.stdin.isTTY) urls = (await Bun.stdin.text()).split(/\s+/).filter((u) => /^https?:\/\//.test(u));
  if (!urls.length) throw new UsageError('read needs at least one URL');
  const maxTokens = int(v['max-tokens'], 4000);
  const results = await mapLimit(urls, 5, (u) => readPage(u, v, v.focus as string | undefined, maxTokens));
  const failed = results.filter((r) => r.status === 'rejected').length;
  if (v.json) {
    out(JSON.stringify(results.map((r, i) => (r.status === 'fulfilled' ? r.value : { url: urls[i], error: (r.reason as Error).message }))));
  } else {
    out(
      results
        .map((r, i) => (r.status === 'fulfilled' ? formatPage(r.value) : `# ${urls[i]}\n[read failed: ${(r.reason as Error).message}]`))
        .join('\n\n---\n\n')
    );
  }
  if (failed === urls.length) throw new ApiError('all reads failed');
}

async function cmdScreenshot(url: string | undefined, v: Values) {
  if (!url) throw new UsageError('screenshot needs a URL');
  const imageUrl = await screenshot(url, Boolean(v.full));
  if (v.output) {
    const res = await fetch(imageUrl);
    if (!res.ok) throw new ApiError(`download failed: HTTP ${res.status}`);
    await Bun.write(String(v.output), res);
    out(String(v.output));
  } else out(imageUrl);
}

async function cmdHook() {
  const decision = decide(JSON.parse((await Bun.stdin.text()) || '{}'));
  if (decision) out(JSON.stringify(decision));
}

async function main(argv: string[]) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      num: { type: 'string', short: 'n' },
      site: { type: 'string' },
      gl: { type: 'string' },
      hl: { type: 'string' },
      time: { type: 'string' },
      source: { type: 'string' },
      read: { type: 'string' },
      urls: { type: 'boolean' },
      'no-rerank': { type: 'boolean' },
      focus: { type: 'string' },
      'max-tokens': { type: 'string' },
      offset: { type: 'string' },
      selector: { type: 'string' },
      remove: { type: 'string' },
      links: { type: 'boolean' },
      images: { type: 'boolean' },
      engine: { type: 'string' },
      timeout: { type: 'string' },
      full: { type: 'boolean' },
      output: { type: 'string', short: 'o' },
      json: { type: 'boolean' },
      fresh: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const [cmd, ...rest] = positionals;
  if (values.help || !cmd) return out(HELP);
  const v = values as Values;
  const query = rest.join(' ').trim();
  switch (cmd) {
    case 'search':
      return cmdSearch('web', query, v);
    case 'news':
      return cmdSearch('news', query, v);
    case 'images':
      return cmdSearch('images', query, v);
    case 'papers': {
      const source = (v.source ?? 'arxiv') as string;
      if (source !== 'arxiv' && source !== 'ssrn') throw new UsageError('--source must be arxiv or ssrn');
      return cmdSearch(source, query, v);
    }
    case 'read':
      return cmdRead(rest, v);
    case 'screenshot':
      return cmdScreenshot(rest[0], v);
    case 'hook':
      return cmdHook();
    default:
      throw new UsageError(`unknown command "${cmd}". Run web-search --help`);
  }
}

// A reader that stops early (| head) is not an error.
process.stdout.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EPIPE') process.exit(0);
});

try {
  await main(Bun.argv.slice(2));
} catch (err) {
  const e = err as Error & { code?: string };
  warn(e.message);
  process.exit(e instanceof UsageError || e.code?.startsWith('ERR_PARSE_ARGS') ? 1 : 2);
}
