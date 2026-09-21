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

  test('falls back to truncation when nothing matches', () => {
    expect(focus(page, 'kubernetes', 1000)).toBe(page);
  });

  test('respects the token budget', () => {
    const long = Array.from({ length: 50 }, (_, i) => `Block ${i} mentions rust and bun.`).join('\n\n');
    expect(estimateTokens(focus(long, 'rust', 40))).toBeLessThan(80);
  });
});

describe('truncate', () => {
  test('leaves short text alone and marks cut text', () => {
    expect(truncate('short', 100)).toBe('short');
    expect(truncate('x'.repeat(1000), 10)).toContain('[truncated:');
    expect(truncate('x'.repeat(1000), 0)).toHaveLength(1000);
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
