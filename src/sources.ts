/**
 * Places `search` can look, and how each one is searched.
 * Source list and Jev questions adapted from superagents-lab/jev-search (MIT, Copyright (c) 2026 Search1API).
 */
import type { SearchType } from './jina';

/** One engine call. `jina` is always available; `search1api` lanes need SEARCH1API_API_KEY. */
export interface Lane {
  engine: 'jina' | 'search1api';
  /** Jina search type, or the Search1API `search_service`. */
  type?: SearchType;
  service?: string;
  /** Restrict a general engine to one site. */
  site?: string;
  /** False for engines that ignore time filters. */
  time?: boolean;
}

export interface Source {
  id: string;
  description: string;
  /** Yes/no question Jev answers to decide whether the request wants this source. */
  ask: { question: string; yes: string; no: string };
  lanes: Lane[];
  /** Searched when the request does not single out any source. */
  defaultOn?: boolean;
}

const jina = (site?: string, type?: SearchType): Lane => ({ engine: 'jina', site, type });
const s1 = (service: string, site?: string, time = true): Lane => ({ engine: 'search1api', service, site, time });

const WEB_ASK = {
  question: 'Would general web pages (news, articles, blogs, docs) help answer this request?',
  yes: 'The request is a general question, or asks for news, articles, coverage, docs or blog posts',
  no: 'The request only makes sense on a specific platform such as Reddit, GitHub, arXiv or YouTube',
};

export const SOURCES: readonly Source[] = [
  {
    id: 'web',
    description: 'The open web: news sites, blogs, documentation',
    ask: WEB_ASK,
    lanes: [jina(), s1('google'), s1('duckduckgo'), s1('yandex')],
    defaultOn: true,
  },
  {
    id: 'news',
    description: 'News articles',
    ask: {
      question: 'Is the user asking for news coverage of an event, launch or announcement?',
      yes: 'The request asks what happened, the latest news, an announcement or a launch',
      no: 'The request asks for opinions, how-tos, code, papers or background facts',
    },
    lanes: [jina(undefined, 'news')],
  },
  {
    id: 'reddit',
    description: 'Reddit posts and comment threads',
    ask: {
      question: 'Would Reddit threads fit this request?',
      yes: 'The request names Reddit or a subreddit, or asks what people are saying, their experiences, recommendations, opinions or discussion',
      no: 'The request is a factual lookup or asks for official sources, code, papers or videos',
    },
    lanes: [jina('reddit.com'), s1('google', 'reddit.com'), s1('reddit')],
  },
  {
    id: 'hackernews',
    description: 'Hacker News threads and comments',
    ask: {
      question: 'Would Hacker News threads fit this request?',
      yes: 'The request names Hacker News or HN, or asks what developers or the tech community are saying, their reactions, opinions or discussion about a technical topic',
      no: 'The request is a factual lookup, or is about something outside technology and startups',
    },
    lanes: [jina('news.ycombinator.com'), s1('google', 'news.ycombinator.com'), s1('hackernews')],
  },
  {
    id: 'github',
    description: 'GitHub repositories, issues, pull requests and releases',
    ask: {
      question: 'Is the user looking for code: repositories, releases, issues, pull requests or open source projects?',
      yes: 'The request names GitHub, or asks for repos, libraries, releases, issues, PRs, or open source tools',
      no: 'The request is about discussion, news or opinions rather than code',
    },
    lanes: [jina('github.com'), s1('google', 'github.com'), s1('github')],
  },
  {
    id: 'stackoverflow',
    description: 'Stack Overflow questions and answers',
    ask: {
      question: 'Is the user trying to fix a programming error or find how to do something in code?',
      yes: 'The request contains an error message, or asks how to do a specific task in a language, library or tool',
      no: 'The request is not a programming problem',
    },
    lanes: [jina('stackoverflow.com'), s1('google', 'stackoverflow.com')],
  },
  {
    id: 'x',
    description: 'Posts on X (formerly Twitter)',
    ask: {
      question: 'Would posts on X (Twitter) fit this request?',
      yes: 'The request names X, Twitter or tweets, or asks what people are saying about a product, launch, announcement, company or person, especially in tech; launches and news break on X first',
      no: 'The request is a factual lookup, or asks for long-form content such as tutorials, papers or documentation',
    },
    lanes: [jina('x.com'), s1('x')],
  },
  {
    id: 'youtube',
    description: 'Videos on YouTube',
    ask: {
      question: 'Is the user asking for videos?',
      yes: 'The request mentions videos, YouTube, talks, tutorials to watch, or channels',
      no: 'The request is not about video content',
    },
    lanes: [jina('youtube.com'), s1('youtube')],
  },
  {
    id: 'wikipedia',
    description: 'Encyclopedia articles on Wikipedia',
    ask: {
      question: 'Is the user asking for encyclopedic facts, definitions, background or history?',
      yes: 'The request asks what or who something is, how it works, its history or background facts',
      no: 'The request asks for opinions, news, recent events, code, papers or videos',
    },
    lanes: [jina('wikipedia.org'), s1('wikipedia', undefined, false)],
  },
  {
    id: 'arxiv',
    description: 'Academic papers and preprints on arXiv',
    ask: {
      question: 'Is the user asking for academic papers, research or preprints?',
      yes: 'The request mentions papers, research, arXiv, studies or preprints',
      no: 'The request is not about academic research',
    },
    lanes: [jina(undefined, 'arxiv'), s1('arxiv')],
  },
];

export const SOURCE_IDS = SOURCES.map((s) => s.id);

export function sourceById(id: string): Source | undefined {
  return SOURCES.find((s) => s.id === id);
}

/** Lanes to run for a source, given which engines have keys. */
export function lanesFor(source: Source, search1api: boolean): Lane[] {
  return source.lanes.filter((l) => l.engine === 'jina' || search1api);
}

const TRACKING = /^(utm_|ref$|ref_|fbclid|gclid|igshid|share_id|rdt|si$|feature$|lang$|s$|t$)/i;

/** Host + path + content-identifying query params, so the same page from two engines merges. */
export function canonicalUrl(url: string): string {
  try {
    const u = new URL(url);
    let host = u.hostname.toLowerCase().replace(/^(www|m|old)\./, '');
    if (host === 'twitter.com') host = 'x.com';
    const path = u.pathname.replace(/\/+$/, '').toLowerCase();
    const params = [...u.searchParams.entries()]
      .filter(([k]) => !TRACKING.test(k))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, val]) => `${k}=${val}`)
      .join('&');
    return `${host}${path}${params ? `?${params}` : ''}`;
  } catch {
    return url;
  }
}
