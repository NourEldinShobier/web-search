/**
 * Token savers that run locally, after the page is fetched.
 * `focus` keeps only the blocks most relevant to a query (BM25), in page order.
 */

const CHARS_PER_TOKEN = 4;

const STOP = new Set(
  'a an and are as at be by for from how i in is it of on or that the this to was what when where which who why with'.split(' ')
);

export const estimateTokens = (s: string) => Math.ceil(s.length / CHARS_PER_TOKEN);

/** Words, plus the parts of dotted/dashed names, so "webview" matches "Bun.WebView" and "bun.webview" still matches whole. */
function terms(s: string): string[] {
  const out: string[] = [];
  for (const t of s.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}._+-]*/gu) ?? []) {
    out.push(t);
    if (/[._+-]/.test(t)) out.push(...t.split(/[._+-]+/));
  }
  return out.filter((t) => t.length > 1 && !STOP.has(t));
}

const MAX_OUTLINE = 12;

/**
 * Return one page of `md` starting at character `offset`, cut at a block boundary near the budget.
 * When text remains, the note gives the exact offset of the next part and the offsets of the
 * remaining section headings, so nothing is ever out of reach. `maxTokens` 0 means no limit.
 */
export function truncate(md: string, maxTokens: number, offset = 0, readCmd = 'web-search read <url>'): string {
  const start = Math.min(Math.max(0, offset), md.length);
  const rest = md.slice(start).replace(/^\s+/, '');
  const restStart = md.length - rest.length;
  const prefix = start ? `[continuing at offset ${restStart} of ${md.length} characters]\n\n` : '';
  if (!maxTokens || estimateTokens(rest) <= maxTokens) return prefix + rest;

  const limit = maxTokens * CHARS_PER_TOKEN;
  const boundary = rest.lastIndexOf('\n\n', limit);
  const cut = boundary > limit / 2 ? boundary : limit;
  const next = restStart + cut;

  // Section map of the unseen part: the deepest heading level that still fits, so it spans the page.
  const headings = [...md.slice(next).matchAll(/^(#{1,3})[ \t]+(.+)$/gm)].map((m) => ({
    level: m[1]!.length,
    title: m[2]!.trim().slice(0, 80),
    offset: next + m.index!,
  }));
  let picked = headings.filter((h) => h.level === Math.min(...headings.map((x) => x.level)));
  for (const level of [2, 3]) {
    const deeper = headings.filter((h) => h.level <= level);
    if (deeper.length <= MAX_OUTLINE) picked = deeper;
  }
  const outline = picked.slice(0, MAX_OUTLINE).map((h) => `  ${h.title} → --offset ${h.offset}`);
  if (picked.length > MAX_OUTLINE) outline.push(`  …${picked.length - MAX_OUTLINE} more sections; page on to see them`);

  const note = [
    `[shown: ~${estimateTokens(rest.slice(0, cut))} tokens, up to ${Math.round((next / md.length) * 100)}% of a ~${estimateTokens(md)}-token page. Nothing is lost:`,
    `  next part: ${readCmd} --offset ${next}`,
    ...(outline.length ? ['  remaining sections (jump with its --offset):', ...outline] : []),
    `  or narrow it: --focus "<question>" · everything at once: --max-tokens 0]`,
  ].join('\n');
  return `${prefix}${rest.slice(0, cut)}\n\n${note}`;
}

interface Block {
  text: string;
  heading?: { text: string; offset: number };
  score: number;
  index: number;
}

export function focus(md: string, query: string, maxTokens: number, readCmd = 'web-search read <url>'): string {
  const q = [...new Set(terms(query))];
  if (!q.length) return truncate(md, maxTokens, 0, readCmd);

  const blocks: Block[] = [];
  let heading: Block['heading'];
  let pos = 0;
  for (const part of md.split(/(\n{2,})/)) {
    const at = pos;
    pos += part.length;
    const text = part.trim();
    if (!text) continue;
    if (/^#{1,6}\s/.test(text) && !text.includes('\n')) {
      heading = { text, offset: at };
      continue;
    }
    blocks.push({ text, heading, score: 0, index: blocks.length });
  }
  if (!blocks.length) return truncate(md, maxTokens, 0, readCmd);

  // BM25 over blocks; the heading counts as part of its block.
  const docs = blocks.map((b) => terms(`${b.heading ?? ''} ${b.text}`));
  const avg = docs.reduce((n, d) => n + d.length, 0) / docs.length || 1;
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
  const k1 = 1.2, b = 0.75, N = docs.length;
  docs.forEach((d, i) => {
    const tf = new Map<string, number>();
    for (const t of d) tf.set(t, (tf.get(t) ?? 0) + 1);
    let s = 0;
    for (const t of q) {
      const f = tf.get(t);
      if (!f) continue;
      const n = df.get(t)!;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      s += (idf * f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.length) / avg));
    }
    blocks[i]!.score = s;
  });

  const ranked = blocks.filter((x) => x.score > 0).sort((x, y) => y.score - x.score);
  if (!ranked.length) return truncate(md, maxTokens, 0, readCmd);

  const budget = maxTokens || Infinity;
  const chosen: Block[] = [];
  let used = 0;
  for (const blk of ranked) {
    const cost = estimateTokens(blk.text);
    if (used + cost > budget && chosen.length) continue;
    chosen.push(blk);
    used += cost;
    if (used >= budget) break;
  }
  chosen.sort((x, y) => x.index - y.index);

  const out: string[] = [];
  let lastHeading: Block['heading'];
  let lastIndex = -2;
  for (const blk of chosen) {
    if (blk.index !== lastIndex + 1 && out.length) out.push('…');
    // The offset lets the agent read the whole section around a passage.
    if (blk.heading && blk.heading !== lastHeading) out.push(`${blk.heading.text}  (--offset ${blk.heading.offset})`);
    lastHeading = blk.heading;
    out.push(blk.text.length > budget * CHARS_PER_TOKEN ? `${blk.text.slice(0, budget * CHARS_PER_TOKEN)}…` : blk.text);
    lastIndex = blk.index;
  }
  const skipped = blocks.length - chosen.length;
  if (skipped) {
    out.push(
      `[focus: kept ${chosen.length} of ${blocks.length} blocks matching "${query}". Nothing is lost: read a section in full with ${readCmd} --offset <heading offset>, or the page in order from --offset 0]`
    );
  }
  return out.join('\n\n');
}
