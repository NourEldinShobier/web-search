# web-search

Web search and page reading for AI agents, using far fewer tokens.

A small [Bun](https://bun.sh) CLI plus a [Claude Code](https://code.claude.com) plugin. Claude uses it instead of its built-in `WebSearch` and `WebFetch`.

## Quick start (about 5 minutes)

1. Install [Bun](https://bun.sh) 1.1 or newer.
2. Get a free [Jina AI API key](https://jina.ai/?sui=apikey).
3. Save the key:
   ```bash
   export JINA_API_KEY=jina_...     # macOS / Linux
   setx JINA_API_KEY jina_...       # Windows, then open a new terminal
   ```
4. Add the plugin to Claude Code:
   ```bash
   claude plugin marketplace add NourEldinShobier/web-search
   claude plugin install web-search@web-search
   ```
5. Restart Claude Code.

That's it. Claude now searches with web-search whenever it needs the web.

**Optional, for smarter search:** add a [TypeSafe](https://typesafe.ai) key as `TYPESAFE_API_KEY`. Its Jev model reads each question, picks where to look (Reddit, GitHub, Stack Overflow, arXiv…) and how recent results must be, and drops off-topic results. In the benchmark below it raised results from the site the question asked for from 50% to 100%, and results inside the asked time window from 0% to 100%, for about 1 s more per search. It doesn't help plain factual questions.

**Check it works:** in a new session, type `/web-search:web-search bun 1.4 release notes`.

## Why use it

A typical web page is 20,000–100,000 tokens, and most of that is menus and links. web-search trims it before the agent sees it:

- **Focus:** `--focus "question"` keeps only the relevant passages, often 90% smaller.
- **Cap:** pages stop at 4,000 tokens, and the end of the output says where to read on. Nothing is lost.
- **Many sources at once:** the web, news, Reddit, Hacker News, GitHub, Stack Overflow, X, YouTube, Wikipedia and arXiv, merged by URL. Pages found by several sources rank higher.
- **Better results:** off-topic hits are dropped (by Jev if you have a TypeSafe key, otherwise Jina Reranker).
- **Cache:** repeat calls are free (searches are kept 1 hour, pages 24 hours).
- **Speed:** about 75 ms to start, 1–2 s per search; a search that also reads the top 2 pages takes about 2.6 s (median, benchmark below).

## Benchmark

The same 10 questions (facts, docs, a paper, an error message, a Reddit opinion question), measuring what the agent receives: tokens (characters ÷ 4), time, and whether the answer is in the output. web-search ran `search "<question>" --read 2` with an empty local cache. Run it yourself with `bun bench/run.ts`.

| | Tokens to the agent (10 questions) | Median per question | Median time | Answer in output |
|---|---|---|---|---|
| Jina Search directly (`s.jina.ai`) | 771,808 | 62,867 | 9.5 s | 10 / 10 |
| web-search, Jina only | 31,770 | 3,596 | 2.6 s | 10 / 10 |
| web-search + Jev | 33,230 | 3,674 | 5.2 s | 10 / 10 |

web-search sends the agent about 24x fewer tokens than Jina's search API and is about 3.5x faster, with the same answers found. Jev did not change the result on these factual questions.

**Where Jev matters:** 8 questions that name a site or a time window ("on reddit … this month", "stackoverflow answers for…", "apple news this week"), top 5 results of a plain `search "<question>"`. Run it with `bun bench/jev.ts`.

| | Right place (6 questions naming a site) | Dated inside the asked window (3 questions) | Median time |
|---|---|---|---|
| web-search, Jina only | 50% | 0% | 1.8 s |
| web-search + Jev | 100% | 100% | 2.6 s |

Without Jev, a plain search for Reddit opinions "this month" returned Reddit posts from 2024–2026 and one Hacker News page; with Jev, all five were Reddit posts from the past month. A result without a date counts as not recent; for the Apple question Jina-only returned undated topic pages, which may still be current. An agent can get the same effect without Jev by passing `--sources reddit --time m` itself; Jev does it from the plain question. Not measured: Claude Code's built-in WebSearch/WebFetch (the plugin's hook redirects them, and WebFetch summarizes pages with a separate model call, so its cost doesn't show up in the output size). Measured 2026-09-22 on one Windows machine.

## Commands

| Command | Does |
|---|---|
| `search "query"` | Web search |
| `news "query"` | News search |
| `papers "query"` | arXiv or SSRN papers |
| `images "query"` | Image search |
| `read <url>` | A web page or PDF as markdown |
| `screenshot <url>` | Screenshot of a page |

Every command takes `--json`. Commands can be piped together:

```bash
web-search search "bun sqlite" --urls | web-search read --focus "WAL mode"
```

## Examples

**Search**

```bash
web-search search "rust async runtimes"
web-search search "claude code plugins" --time w --read 2   # past week, read top 2
web-search search "framework laptop 16" --sources reddit,youtube   # pick the sources yourself
web-search news "open source llm" -n 3
web-search papers "speculative decoding"
```

**Read**

```bash
web-search read https://bun.com/docs/api/sqlite --focus "WAL mode"
web-search read https://arxiv.org/pdf/1706.03762 --focus "multi-head attention"
web-search read https://example.com/app --engine browser --selector main   # JavaScript-heavy page
```

**Long page cut off?** The output ends with the exact command to read the next part, plus a list of sections to jump to:

```bash
web-search read https://bun.com/blog/bun-v1.4 --offset 49200
```

## What the plugin adds to Claude Code

- The `web-search` command, available to Claude's Bash tool.
- A **skill** that tells Claude when and how to use it.
- A **`web-researcher` agent** (Sonnet) that researches in its own context and returns a short report with sources.
- A **hook** that sends `WebSearch` and `WebFetch` calls to web-search instead. Set `WEB_SEARCH_ALLOW_BUILTIN=1` to turn this off.

Details: [docs/claude-code.md](docs/claude-code.md).

## API keys

| Key | Needed? | What it adds |
|---|---|---|
| `JINA_API_KEY` | Yes | Search, reading, reranking ([free key](https://jina.ai/?sui=apikey)) |
| `TYPESAFE_API_KEY` | Optional | Jev picks sources, time window and query, and judges which results are on topic ([typesafe.ai](https://typesafe.ai)) |

## Use it without Claude Code

Any agent or terminal with a shell can use it (Codex, Cursor, Aider, scripts):

```bash
git clone https://github.com/NourEldinShobier/web-search
cd web-search
bun link
web-search --help
```

## Docs

- [docs/cli.md](docs/cli.md): every option
- [docs/claude-code.md](docs/claude-code.md): how the plugin works and how to turn parts off
- [docs/how-it-works.md](docs/how-it-works.md): design, cache and performance numbers

## Contributing

1. Keep changes small and add a test for new logic.
2. Run these before opening a PR:
   ```bash
   bun install
   bun test
   bunx tsc --noEmit
   ```
3. To try the plugin without installing it: `claude --plugin-dir .`

## Credits

- Built on [Jina AI](https://jina.ai)'s Reader, Search and Reranker APIs. Request options follow [jina-ai/reader](https://github.com/jina-ai/reader) and [jina-ai/MCP](https://github.com/jina-ai/MCP).
- Command design borrows from [jina-ai/cli](https://github.com/jina-ai/cli).
- Multi-source search, the Jev questions and query candidates are adapted from [superagents-lab/jev-search](https://github.com/superagents-lab/jev-search) (MIT, Copyright (c) 2026 Search1API).
- Jev by [TypeSafe](https://typesafe.ai).

## License

[MIT](LICENSE)
