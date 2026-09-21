# web-search

Fast, token-efficient web research for AI coding agents. A small Bun CLI that searches the web and reads pages and PDFs as compact markdown, plus a [Claude Code](https://code.claude.com) plugin that makes Claude use it instead of the built-in `WebSearch` and `WebFetch`.

```bash
web-search search "bun 1.4 release notes"
web-search read https://arxiv.org/pdf/1706.03762 --focus "multi-head attention"
```

## Why

Agents spend a lot of their context on web pages. A typical docs or blog page is 20,000–100,000 tokens of markdown, most of it navigation, links and text the agent never needed. web-search cuts that down before it reaches the model:

- **`--focus "question"`** keeps only the passages relevant to a question (local BM25 ranking), often 90%+ smaller than the full page.
- **Link URLs are stripped** to their text by default, making pages about a quarter smaller.
- **Pages are capped** at 4,000 tokens by default, without losing anything: the cut ends with the offset of the next part and a map of the remaining sections, so an agent can read on or jump to the part it needs (served from cache).
- **Search results are reranked** and off-topic hits are dropped, so the agent reads fewer, better results.
- **Everything is cached** locally (searches 1 hour, pages 24 hours), so repeated calls from parallel agents are free.

It's also fast: about 75 ms to start, 1–2 s per search and under 1 s for most page reads.

## What it can do

| Command | What it does |
|---|---|
| `search` | Web search with snippets; optional time filter, site filter and reading of the top results |
| `news` | News search |
| `papers` | arXiv or SSRN paper search |
| `images` | Image search (image URL, size and source page) |
| `read` | Read one or more web pages or PDFs as markdown |
| `screenshot` | Screenshot a page (URL or saved file) |

All commands support `--json` and read input from pipes, so they compose: `web-search search "bun sqlite" --urls | web-search read --focus "WAL mode"`.

## Requirements

- [Bun](https://bun.sh) 1.1 or newer on your `PATH`.
- A [Jina AI API key](https://jina.ai/?sui=apikey) in `JINA_API_KEY`. The free tier is enough to start. Search and reranking need the key; page reading works without one at a lower rate limit.

```bash
export JINA_API_KEY=jina_...          # macOS / Linux
setx JINA_API_KEY jina_...            # Windows (new terminals)
```

## Install

### As a Claude Code plugin

```bash
claude plugin marketplace add NourEldinShobier/web-search
claude plugin install web-search@web-search
```

Restart Claude Code. The plugin adds:

- the `web-search` command to the PATH of Claude's Bash tool,
- a **skill** that tells Claude when and how to use it,
- a **`web-researcher` agent** (Sonnet) that researches a question in its own context and returns a short, sourced report,
- a **hook** that redirects `WebSearch` and `WebFetch` calls to the CLI.

See [docs/claude-code.md](docs/claude-code.md) for how each part works and how to turn parts off.

### As a standalone CLI (any agent or terminal)

```bash
git clone https://github.com/NourEldinShobier/web-search
cd web-search
bun link          # puts `web-search` on your PATH
web-search --help
```

Any agent with shell access (Codex, Cursor, Aider, your own scripts) can then call it. `web-search --help` is written to be read by an agent.

## Examples

```bash
# Five results with snippets
web-search search "rust async runtimes comparison"

# Only the past week, then read the two best results focused on the query
web-search search "claude code plugins" --time w --read 2

# News, papers, images
web-search news "open source llm" -n 3
web-search papers "speculative decoding"
web-search papers "corporate governance" --source ssrn
web-search images "ferris crab"

# Read pages or PDFs, keeping only what matters
web-search read https://bun.com/docs/api/sqlite --focus "WAL mode"
web-search read https://example.com/a https://example.com/b --focus "pricing" --max-tokens 1500

# JavaScript-heavy page, only the main element
web-search read https://example.com/app --engine browser --selector main

# Screenshot to a file
web-search screenshot https://example.com -o page.png
```

Full reference: [docs/cli.md](docs/cli.md). Design and internals: [docs/how-it-works.md](docs/how-it-works.md).

## Development

```bash
bun install
bun test
bunx tsc --noEmit
claude --plugin-dir .   # try the plugin without installing it
```

Issues and pull requests are welcome. Keep changes small, add a test for new logic, and run the three commands above before opening a PR.

## Credits

- Built on [Jina AI](https://jina.ai)'s Reader, Search and Reranker APIs. Request options follow [jina-ai/reader](https://github.com/jina-ai/reader) and [jina-ai/MCP](https://github.com/jina-ai/MCP).
- Command design borrows from [jina-ai/cli](https://github.com/jina-ai/cli).
- Parts of the search client are adapted from [superagents-lab/jev-search](https://github.com/superagents-lab/jev-search) (MIT, Copyright (c) 2026 Search1API).

## License

[MIT](LICENSE)
