import { describe, expect, test } from 'bun:test';
import { focus, truncate, estimateTokens } from '../src/focus';
import { decide } from '../src/hook';
import { keepRelevant } from '../src/rerank';

describe('keepRelevant', () => {
  test('drops results under half the best score and sorts best first', () => {
    expect(keepRelevant(['a', 'b', 'c', 'd'], [0.75, 0.82, 0.38, 0.12])).toEqual(['b', 'a']);
  });

  test('keeps everything when nothing clears the floor', () => {
    expect(keepRelevant(['a', 'b'], [0.1, 0.2])).toEqual(['a', 'b']);
  });
});

const page = [
  '# Guide',
  'Intro paragraph about nothing in particular.',
  '## Install',
  'Run the installer and wait.',
  '## Caching',
  'The cache uses SQLite in WAL mode so parallel readers never block.',
  'Unrelated closing words about the weather.',
].join('\n\n');

describe('focus', () => {
  test('keeps the matching block with its heading and drops the rest', () => {
    const out = focus(page, 'sqlite wal cache', 1000);
    expect(out).toContain('## Caching');
    expect(out).toContain('WAL mode');
    expect(out).not.toContain('weather');
    expect(out).toContain('[focus: kept 1 of 4 blocks');
  });

  test('matches parts of dotted names', () => {
    const doc = ['Intro text.', '## API', 'Use Bun.WebView to take screenshots.', 'Other stuff.'].join('\n\n');
    expect(focus(doc, 'webview', 100)).toContain('Bun.WebView');
  });

  test('falls back to truncation when nothing matches', () => {
    expect(focus(page, 'kubernetes', 1000)).toBe(page);
  });

  test('respects the token budget', () => {
    const long = Array.from({ length: 50 }, (_, i) => `Block ${i} mentions rust and bun.`).join('\n\n');
    const content = focus(long, 'rust', 40).replace(/\n\n\[focus:[\s\S]*$/, '');
    expect(estimateTokens(content)).toBeLessThan(60);
  });
});

describe('truncate', () => {
  test('leaves short text alone and marks cut text', () => {
    expect(truncate('short', 100)).toBe('short');
    expect(truncate('x'.repeat(1000), 10)).toContain('--offset 40');
    expect(truncate('x'.repeat(1000), 0)).toHaveLength(1000);
  });

  test('paging with the offsets it prints loses no text', () => {
    const doc = Array.from({ length: 60 }, (_, i) => (i % 10 === 0 ? `## Section ${i}` : `Paragraph ${i} ${'word '.repeat(i % 7 + 3)}`)).join('\n\n');
    const seen: string[] = [];
    let offset: number | undefined = 0;
    for (let guard = 0; offset !== undefined && guard < 100; guard++) {
      const page = truncate(doc, 60, offset);
      const next = page.match(/next part: .* --offset (\d+)/)?.[1];
      seen.push(page.replace(/^\[continuing[^\]]*\]\n\n/, '').replace(/\n\n\[shown:[\s\S]*$/, ''));
      offset = next === undefined ? undefined : Number(next);
    }
    const blocks = (s: string) => s.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
    expect(blocks(seen.join('\n\n'))).toEqual(blocks(doc));
  });

  test('lists remaining sections with offsets that land on them', () => {
    const doc = ['intro '.repeat(100), '## Alpha', 'a', '## Beta', 'b'].join('\n\n');
    const page = truncate(doc, 50);
    const off = Number(page.match(/Beta → --offset (\d+)/)![1]);
    expect(doc.slice(off).startsWith('## Beta')).toBe(true);
    expect(truncate(doc, 50, off)).toContain('## Beta\n\nb');
  });
});

describe('hook', () => {
  const reason = (r: any) => r?.hookSpecificOutput?.permissionDecisionReason as string;

  test('redirects WebSearch to web-search search', () => {
    expect(reason(decide({ tool_name: 'WebSearch', tool_input: { query: 'bun "1.4"' } }))).toContain(
      'web-search search "bun \\"1.4\\""'
    );
  });

  test('redirects WebFetch with the prompt as --focus', () => {
    const r = reason(decide({ tool_name: 'WebFetch', tool_input: { url: 'https://bun.com/blog', prompt: 'release date' } }));
    expect(r).toContain('web-search read "https://bun.com/blog" --focus "release date"');
  });

  test('lets claude.ai, localhost and other tools through', () => {
    expect(decide({ tool_name: 'WebFetch', tool_input: { url: 'https://claude.ai/code/artifact/x' } })).toBeNull();
    expect(decide({ tool_name: 'WebFetch', tool_input: { url: 'http://localhost:3000' } })).toBeNull();
    expect(decide({ tool_name: 'Bash', tool_input: {} })).toBeNull();
  });
});

import { merge, parseSources, pickSources } from '../src/multi';
import { buildCandidates } from '../src/candidates';

describe('multi-source search', () => {
  test('merges the same page from two engines and ranks agreement first', () => {
    const hits = merge([
      { source: 'web', items: [{ title: 'A', url: 'https://a.com/x' }, { title: 'B', url: 'https://www.b.com/y/?utm_source=z' }] },
      { source: 'reddit', items: [{ title: 'B', url: 'https://b.com/y', description: 'longer snippet' }] },
    ]);
    expect(hits.map((h) => h.url)).toEqual(['https://www.b.com/y/?utm_source=z', 'https://a.com/x']);
    expect(hits[0]).toMatchObject({ sources: ['web', 'reddit'], engines: 2, position: 1, description: 'longer snippet' });
  });

  test('Jev source probabilities: specific sources win, web only when also wanted', () => {
    expect(pickSources({ web: 0.2, reddit: 0.9 })).toEqual(['reddit']);
    expect(pickSources({ web: 0.8, reddit: 0.9, github: 0.7 })).toEqual(['web', 'reddit', 'github']);
    expect(pickSources({ web: 0.3 })).toEqual(['web']);
  });

  test('--sources validates names', () => {
    expect(parseSources('Reddit, github,reddit')).toEqual(['reddit', 'github']);
    expect(() => parseSources('myspace')).toThrow(/unknown source "myspace"/);
    expect(parseSources('all')).toContain('arxiv');
  });

  test('query candidates drop time and source words', () => {
    expect(buildCandidates('what are people saying about bun 1.4 on reddit this week')).toContain('bun 1.4');
  });
});
