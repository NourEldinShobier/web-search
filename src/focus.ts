/**
 * Token savers that run locally, after the page is fetched.
 * `focus` keeps only the blocks most relevant to a query (BM25), in page order.
 */

const CHARS_PER_TOKEN = 4;

const STOP = new Set(
  'a an and are as at be by for from how i in is it of on or that the this to was what when where which who why with'.split(' ')
);

export const estimateTokens = (s: string) => Math.ceil(s.length / CHARS_PER_TOKEN);

function terms(s: string): string[] {
  return (s.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}._+-]*/gu) ?? []).filter((t) => t.length > 1 && !STOP.has(t));
}

/** Cut at a block boundary near the budget. `maxTokens` 0 means no limit. */
export function truncate(md: string, maxTokens: number): string {
  if (!maxTokens || estimateTokens(md) <= maxTokens) return md;
  const limit = maxTokens * CHARS_PER_TOKEN;
  const cut = md.lastIndexOf('\n\n', limit);
  const kept = md.slice(0, cut > limit / 2 ? cut : limit);
  return `${kept}\n\n[truncated: ~${estimateTokens(md) - estimateTokens(kept)} more tokens. Use --focus "<question>" or --max-tokens 0]`;
}

interface Block {
  text: string;
  heading?: string;
  score: number;
  index: number;
}

export function focus(md: string, query: string, maxTokens: number): string {
  const q = [...new Set(terms(query))];
  if (!q.length) return truncate(md, maxTokens);

  const blocks: Block[] = [];
  let heading: string | undefined;
  for (const raw of md.split(/\n{2,}/)) {
    const text = raw.trim();
    if (!text) continue;
    if (/^#{1,6}\s/.test(text) && !text.includes('\n')) {
      heading = text;
      continue;
    }
    blocks.push({ text, heading, score: 0, index: blocks.length });
  }
  if (!blocks.length) return truncate(md, maxTokens);

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
  if (!ranked.length) return truncate(md, maxTokens);

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
  let lastHeading: string | undefined;
  let lastIndex = -2;
  for (const blk of chosen) {
    if (blk.index !== lastIndex + 1 && out.length) out.push('…');
    if (blk.heading && blk.heading !== lastHeading) out.push(blk.heading);
    lastHeading = blk.heading;
    out.push(blk.text.length > budget * CHARS_PER_TOKEN ? truncate(blk.text, budget) : blk.text);
    lastIndex = blk.index;
  }
  const skipped = blocks.length - chosen.length;
  if (skipped) out.push(`[focus: kept ${chosen.length} of ${blocks.length} blocks matching "${query}"]`);
  return out.join('\n\n');
}
