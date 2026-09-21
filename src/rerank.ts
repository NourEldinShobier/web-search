/** Relevance reranking with Jina Reranker (https://jina.ai/reranker), same key as search. */

const MODEL = 'jina-reranker-v2-base-multilingual';

/** Returns relevance 0..1 per document, in input order. */
export async function rerank(query: string, documents: string[], apiKey: string, timeoutMs = 8_000): Promise<number[]> {
  const res = await fetch('https://api.jina.ai/v1/rerank', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, query, documents, return_documents: false }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    throw new Error(`rerank HTTP ${res.status}`);
  }
  const json = (await res.json()) as { results: { index: number; relevance_score: number }[] };
  const scores = new Array<number>(documents.length).fill(0);
  for (const r of json.results) scores[r.index] = r.relevance_score;
  return scores;
}

/**
 * Keep results scoring at least half the best score (and at least 0.3), best first.
 * Relative, so a broad query with many good hits keeps them all.
 */
export function keepRelevant<T>(items: T[], scores: number[]): T[] {
  const best = Math.max(...scores);
  const cutoff = Math.max(0.3, best * 0.5);
  const kept = items
    .map((item, i) => ({ item, s: scores[i] ?? 0 }))
    .filter((x) => x.s >= cutoff)
    // Rounded so near-ties keep the incoming order (source agreement, then rank).
    .sort((a, b) => Math.round(b.s * 100) - Math.round(a.s * 100))
    .map((x) => x.item);
  return kept.length ? kept : items;
}
