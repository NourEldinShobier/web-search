/**
 * Does Jev pick the right place and time window? `bun bench/jev.ts` (needs JINA_API_KEY and TYPESAFE_API_KEY).
 * For questions that name a site or a time window, compares the top 5 results of a plain
 * `web-search search "<question>"` with Jina only against the same call with Jev.
 *   right place:  share of results from the site the question asks for
 *   recent enough: share of results dated inside the window the question asks for (undated counts as not recent)
 * Local cache starts empty for each arm.
 */
const DAY = 86_400_000;
const CASES: { q: string; site?: string; days?: number }[] = [
  { q: 'what do people on reddit think of the framework laptop 16 this month', site: 'reddit.com', days: 30 },
  { q: 'hacker news discussion about the bun 1.4 rust rewrite', site: 'news.ycombinator.com' },
  { q: 'github repos with claude code plugins', site: 'github.com' },
  { q: 'stackoverflow answers for CORS error when calling fetch on localhost', site: 'stackoverflow.com' },
  { q: 'youtube video reviews of the pixel 11', site: 'youtube.com' },
  { q: 'what are people saying on twitter about the gpt-6 launch', site: 'x.com' },
  { q: 'latest apple news this week', days: 7 },
  { q: 'nvidia announcements in the past month', days: 30 },
];

/** Jina dates look like "Sep 17, 2026" or "3 days ago". */
export function ageDays(date: string | undefined, now = Date.now()): number | null {
  if (!date) return null;
  const rel = /(\d+)\s+(minute|hour|day|week|month|year)s?\s+ago/i.exec(date);
  if (rel) {
    const unit = { minute: 1 / 1440, hour: 1 / 24, day: 1, week: 7, month: 30, year: 365 }[rel[2]!.toLowerCase() as 'day'];
    return Number(rel[1]) * unit;
  }
  const t = Date.parse(date);
  return Number.isNaN(t) ? null : (now - t) / DAY;
}

const onSite = (url: string, site: string) => {
  const host = new URL(url).hostname.replace(/^(www|old|m)\./, '');
  return host === site || host.endsWith(`.${site}`) || (site === 'x.com' && host === 'twitter.com');
};

type Result = { url: string; date?: string };
async function run(q: string, jev: boolean) {
  const env = { ...process.env, WEB_SEARCH_CACHE_DIR: `${process.env.TEMP ?? '/tmp'}/ws-jevbench-${jev}-${Date.now()}`, TYPESAFE_API_KEY: jev ? process.env.TYPESAFE_API_KEY ?? '' : '' };
  const t = performance.now();
  const p = Bun.spawn(['bun', `${import.meta.dir}/../src/cli.ts`, 'search', q, '-n', '5', '--json'], { env, stdout: 'pipe', stderr: 'ignore' });
  const out = JSON.parse((await new Response(p.stdout).text()) || '{}') as { results?: Result[]; plan?: { sources: string[]; time?: string } };
  return { results: out.results ?? [], plan: out.plan, ms: Math.round(performance.now() - t) };
}

if (import.meta.main) {
  const share = (xs: boolean[]) => (xs.length ? xs.filter(Boolean).length / xs.length : 0);
  const totals = { false: { place: [] as number[], recent: [] as number[], ms: [] as number[] }, true: { place: [] as number[], recent: [] as number[], ms: [] as number[] } };
  for (const c of CASES) {
    for (const jev of [false, true]) {
      const r = await run(c.q, jev);
      const t = totals[`${jev}`];
      t.ms.push(r.ms);
      const place = c.site ? share(r.results.map((x) => onSite(x.url, c.site!))) : undefined;
      const recent = c.days ? share(r.results.map((x) => (ageDays(x.date) ?? Infinity) <= c.days!)) : undefined;
      if (place !== undefined) t.place.push(place);
      if (recent !== undefined) t.recent.push(recent);
      console.error(
        `${jev ? 'Jev     ' : 'Jina    '} ${String(r.ms).padStart(5)} ms  place ${place === undefined ? ' -  ' : `${Math.round(place * 100)}%`.padStart(4)}  recent ${recent === undefined ? ' -  ' : `${Math.round(recent * 100)}%`.padStart(4)}  ${jev && r.plan ? `[${r.plan.sources.join(',')}${r.plan.time ? ` ${r.plan.time}` : ''}] ` : ''}${c.q}`
      );
    }
  }
  const avg = (xs: number[]) => `${Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100)}%`;
  const med = (xs: number[]) => `${([...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]! / 1000).toFixed(1)} s`;
  console.log(
    [
      `| | Right place (${totals.false.place.length} questions naming a site) | Recent enough (${totals.false.recent.length} questions naming a time) | Median time |`,
      '|---|---|---|---|',
      `| web-search, Jina only | ${avg(totals.false.place)} | ${avg(totals.false.recent)} | ${med(totals.false.ms)} |`,
      `| web-search + Jev | ${avg(totals.true.place)} | ${avg(totals.true.recent)} | ${med(totals.true.ms)} |`,
    ].join('\n')
  );
}
