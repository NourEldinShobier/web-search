# How it works

## Pipeline

```
search:  query ─► svip.jina.ai (SERP) ─► Jina Reranker ─► drop off-topic ─► top N ─► [read top K]
read:    url   ─► r.jina.ai (markdown) ─► --focus (BM25) or token cap ─► output
                        ▲
                 local SQLite cache (search 1h, news 15m, pages 24h)
```

| File | Role |
|---|---|
| `src/cli.ts` | Argument parsing, commands, output formatting |
| `src/jina.ts` | Jina Search (`svip.jina.ai`), Reader (`r.jina.ai`) and screenshot client, with one retry on dropped connections, 5xx and 429 |
| `src/rerank.ts` | Jina Reranker call and the relevance cutoff |
| `src/focus.ts` | `--focus` passage selection and token-cap truncation |
| `src/cache.ts` | SQLite cache using Bun's built-in `bun:sqlite` |
| `src/hook.ts` | The Claude Code `PreToolUse` redirect |

There are no runtime dependencies beyond Bun.

## Search

Search posts to `svip.jina.ai`, which returns search-engine results (title, URL, snippet, date) without visiting each page. The same endpoint handles web, news, images, arXiv and SSRN through `type` and `domain` fields, and time filters through `tbs`. In our tests it answered in about 1.1–1.3 s, against about 2.5 s for `s.jina.ai`, which also crawls every result.

When reranking is on (the default for everything except images), the CLI fetches twice as many results as requested, scores each title and snippet against the query with `jina-reranker-v2-base-multilingual` (about 250 ms), and keeps results scoring at least half the best score (and at least 0.3), best first. The cutoff is relative so that broad queries with many good hits keep them. If reranking fails, the unranked results are used and a warning goes to stderr.

## Reading

Reading posts the URL to `r.jina.ai`, which fetches the page (optionally in a headless browser), extracts the main content, and converts it to markdown. PDFs are handled the same way. The CLI sets:

- `X-Retain-Links: text`: keep link text, drop URLs (about 25% fewer tokens on link-heavy pages). `--links` restores them.
- `X-Retain-Images: none`: no image markup. `--images` appends an image list instead.
- `X-Target-Selector` / `X-Remove-Selector` / `X-Engine` / `X-Timeout` / `X-No-Cache` from the matching options.

## `--focus`

The page is split into blocks at blank lines. Each heading is attached to the blocks under it. Blocks are scored against the focus question with BM25, a standard keyword-relevance formula (k1 = 1.2, b = 0.75, common stop-words removed). The highest-scoring blocks are kept until the token budget is reached, then printed in their original page order with their headings. `…` marks skipped text and a footer says how many blocks were kept. If no block matches, it falls back to the plain token cap.

It runs locally in a few milliseconds and costs no API calls. It is keyword matching, not semantic search: phrase the focus with words likely to appear on the page.

Tokens are estimated as characters ÷ 4.

## Cache

Every search, rerank and page read is stored in `~/.cache/web-search/cache.db` (SQLite, WAL mode, so parallel processes don't block each other). The key is a hash of the request. Entries older than a week are pruned occasionally. A broken or unwritable cache never fails a command; it just isn't used. `--fresh` bypasses it.

## Performance

Measured on one Windows machine; expect similar ratios elsewhere.

| | Python `jina-cli` | web-search |
|---|---|---|
| Start-up, warm | 340–480 ms | about 75 ms |
| `read example.com` | 3.8–4.1 s | 0.43–0.70 s |
| Repeat call (cached) | same as first | about 115 ms |
| Search | about 2.5 s (`s.jina.ai`) | 1.1–1.3 s, 1.7 s with reranking |

Token effect on one long blog post (the Bun 1.4 release notes): full page about 97,000 tokens; default cap about 4,000; `--focus` with a 600-token budget returned just the relevant section.
