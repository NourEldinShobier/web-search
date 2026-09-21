/**
 * TypeSafe Jev (https://docs.typesafe.ai/api): typed decisions in 70–500 ms. Used, when TYPESAFE_API_KEY is set,
 * to read the request (sources, time window, keyword query) and to judge whether each result is on topic.
 * Questions adapted from superagents-lab/jev-search src/lib/typesafe.ts (MIT, Copyright (c) 2026 Search1API).
 */
import { SOURCES } from './sources';

type Question =
  | { type: 'noul'; instructions: string; criteria?: { true?: string; false?: string } }
  | { type: 'choice'; instructions: string; criteria: Record<string, string> };

type Answer = { type: 'noul'; noul: number } | { type: 'choice'; choice: string; confidence: number };

export const jevKey = () => process.env.TYPESAFE_API_KEY;

async function ask(state: unknown, questions: Record<string, Question>, timeoutMs = 8_000): Promise<Record<string, Answer | undefined>> {
  const res = await fetch('https://api.typesafe.ai/v1/systemone', {
    method: 'POST',
    headers: { Authorization: `Bearer ${jevKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'jev-latest', state, questions }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    throw new Error(`Jev HTTP ${res.status}${res.status === 401 ? ' (check TYPESAFE_API_KEY)' : ''}`);
  }
  return ((await res.json()) as { answers?: Record<string, Answer> }).answers ?? {};
}

export type Window = 'any' | 'd' | 'w' | 'm';

const WINDOWS: Record<Window, string> = {
  any: 'The request does not ask for recent results; older, evergreen pages are fine',
  d: 'Only things from today or the last day',
  w: 'Things from the last several days, up to a week',
  m: 'Things from the last few weeks, up to a month',
};

export interface Intent {
  window: Window;
  /** Probability that the request wants each source. */
  sources: Record<string, number>;
  /** Index into the candidates passed in. */
  query: number;
}

export async function intent(request: string, candidates: string[], now = new Date()): Promise<Intent> {
  const questions: Record<string, Question> = {
    window: {
      type: 'choice',
      instructions:
        'Does the request in `request` ask for recent results, and if so how recent? Judge only from what the request says or clearly implies; `now` is the current date. A request with no time cue wants any time.',
      criteria: WINDOWS,
    },
  };
  for (const s of SOURCES) {
    questions[`source_${s.id}`] = {
      type: 'noul',
      instructions: `About \`request\`: ${s.ask.question}`,
      criteria: { true: s.ask.yes, false: s.ask.no },
    };
  }
  if (candidates.length > 1) {
    questions.query = {
      type: 'choice',
      instructions:
        'Which candidate in `candidates` is the best keyword query to send to a web search engine so the results match what the user is asking for in `request`? Prefer the candidate that keeps the subject and drops words about time, sources or phrasing that a search engine would treat as keywords.',
      criteria: Object.fromEntries(candidates.map((c, i) => [`c${i}`, c])),
    };
  }
  const answers = await ask({
    request,
    now: now.toISOString().slice(0, 10),
    candidates: Object.fromEntries(candidates.map((c, i) => [`c${i}`, c])),
  }, questions);

  const w = answers.window;
  const q = answers.query;
  const sources: Record<string, number> = {};
  for (const s of SOURCES) {
    const a = answers[`source_${s.id}`];
    sources[s.id] = a?.type === 'noul' ? a.noul : 0;
  }
  return {
    window: w?.type === 'choice' && w.choice in WINDOWS ? (w.choice as Window) : 'any',
    sources,
    query: q?.type === 'choice' ? Number(q.choice.slice(1)) || 0 : 0,
  };
}

const BATCH = 40;

/** Probability 0..1 that each result is about what was asked, in input order. */
export async function relevance(request: string, items: { source: string; title: string; snippet: string }[]): Promise<number[]> {
  const batches: (typeof items)[] = [];
  for (let i = 0; i < items.length; i += BATCH) batches.push(items.slice(i, i + BATCH));
  const scores = await Promise.all(
    batches.map(async (batch) => {
      const questions: Record<string, Question> = {};
      batch.forEach((_, i) => {
        questions[`r${i}`] = {
          type: 'noul',
          instructions: `Is \`results[${i}]\` about the subject the user asked for in \`request\`?`,
          criteria: {
            true: 'The title or snippet discusses the same subject the user asked about, even briefly or as one of several topics',
            false: 'The result is about something else that only shares words with the request (a different meaning of the same word, a different product, a person with the same name) or is unrelated',
          },
        };
      });
      const answers = await ask({ request, results: batch }, questions);
      return batch.map((_, i) => {
        const a = answers[`r${i}`];
        return a?.type === 'noul' ? a.noul : 0;
      });
    })
  );
  return scores.flat();
}
