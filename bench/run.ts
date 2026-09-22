/**
 * Benchmark: what an agent receives for the same question from
 *   A. Jina Search directly (s.jina.ai, which reads the top results in full),
 *   B. web-search with Jina only (TYPESAFE_API_KEY unset),
 *   C. web-search with Jev (TYPESAFE_API_KEY set).
 * Measures tokens handed to the agent (characters / 4), wall time, and whether the answer is in the output.
 * Run: bun bench/run.ts   (needs JINA_API_KEY; C also needs TYPESAFE_API_KEY). Local cache starts empty; Jina's own page cache is allowed, as in normal use.
 */
const QUESTIONS: [string, RegExp][] = [
  ['What port does PostgreSQL listen on by default?', /5432/],
  ['Who created the Rust programming language?', /Graydon Hoare/i],
  ['What does WAL stand for in SQLite WAL mode?', /write-ahead/i],
  ['Which HTTP status code means Too Many Requests?', /\b429\b/],
  ['Which PEP makes the Python GIL optional?', /PEP[ -]?703|\b703\b/i],
  ['Who are the authors of the paper Attention Is All You Need?', /Vaswani/i],
  ['What changed in Bun 1.4?', /rust/i],
  ['How do I clean up a subscription in React useEffect?', /return (a )?(cleanup|function)|cleanup function/i],
  ['What do people on Reddit think of the Framework Laptop 16?', /reddit\.com/i],
  ['How to fix TypeError: Cannot read properties of undefined (reading map) in React', /undefined/i],
];

const tokens = (s: string) => Math.round(s.length / 4);

async function jinaDirect(q: string): Promise<string> {
  const res = await fetch(`https://s.jina.ai/?q=${encodeURIComponent(q)}`, {
    headers: { Authorization: `Bearer ${process.env.JINA_API_KEY}`, Accept: 'text/plain' },
    signal: AbortSignal.timeout(90_000),
  });
  return res.ok ? res.text() : `HTTP ${res.status}`;
}

async function webSearch(q: string, jev: boolean): Promise<string> {
  const env = { ...process.env, WEB_SEARCH_CACHE_DIR: `${process.env.TEMP ?? '/tmp'}/ws-bench-${jev ? 'jev' : 'jina'}-${Date.now()}`, TYPESAFE_API_KEY: jev ? process.env.TYPESAFE_API_KEY ?? '' : '' };
  const p = Bun.spawn(['bun', `${import.meta.dir}/../src/cli.ts`, 'search', q, '--read', '2'], { env, stdout: 'pipe', stderr: 'ignore' });
  return new Response(p.stdout).text();
}

type Row = { tokens: number; ms: number; found: boolean };
const arms = { 'Jina directly': (q: string) => jinaDirect(q), 'web-search, Jina only': (q: string) => webSearch(q, false), 'web-search + Jev': (q: string) => webSearch(q, true) };
const results: Record<string, Row[]> = {};

for (const [q, answer] of QUESTIONS) {
  for (const [arm, run] of Object.entries(arms)) {
    const t = performance.now();
    const out = await run(q).catch((e) => `ERROR ${(e as Error).message}`);
    (results[arm] ??= []).push({ tokens: tokens(out), ms: Math.round(performance.now() - t), found: answer.test(out) });
    console.error(`${arm.padEnd(22)} ${String(tokens(out)).padStart(6)} tok ${String(Math.round(performance.now() - t)).padStart(6)} ms ${answer.test(out) ? 'found' : 'MISSING'}  ${q}`);
  }
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const lines = [
  `| | Tokens to the agent (total, ${QUESTIONS.length} questions) | Median tokens per question | Median time | Answer in output |`,
  '|---|---|---|---|---|',
  ...Object.entries(results).map(
    ([arm, rows]) =>
      `| ${arm} | ${sum(rows.map((r) => r.tokens)).toLocaleString('en-US')} | ${median(rows.map((r) => r.tokens)).toLocaleString('en-US')} | ${(median(rows.map((r) => r.ms)) / 1000).toFixed(1)} s | ${rows.filter((r) => r.found).length} / ${rows.length} |`
  ),
];
console.log(lines.join('\n'));
await Bun.write(`${import.meta.dir}/results.json`, JSON.stringify({ date: new Date().toISOString().slice(0, 10), questions: QUESTIONS.map(([q]) => q), results }, null, 2));
