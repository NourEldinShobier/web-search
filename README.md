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

**Check it works:** in a new session, type `/web-search:web-search bun 1.4 release notes`.

## Why use it

A typical web page is 20,000–100,000 tokens, and most of that is menus and links. web-search trims it before the agent sees it:

- **Focus:** `--focus "question"` keeps only the relevant passages, often 90% smaller.
- **Cap:** pages stop at 4,000 tokens, and the end of the output says where to read on. Nothing is lost.
- **Better results:** search results are reranked and off-topic hits are dropped.
- **Cache:** repeat calls are free (searches are kept 1 hour, pages 24 hours).
- **Speed:** about 75 ms to start, 1–2 s per search, under 1 s per page.

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
- The search-then-rerank design comes from [superagents-lab/jev-search](https://github.com/superagents-lab/jev-search) (MIT, Copyright (c) 2026 Search1API).

## License

[MIT](LICENSE)
