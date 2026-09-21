# CLI reference

```
web-search <command> [arguments] [options]
```

## Commands

### `search <query>`

Web search. Prints the top results with title, site, date, URL and a short snippet.

| Option | Default | Meaning |
|---|---|---|
| `-n, --num N` | 5 | Results to show (max 20) |
| `--time d\|w\|m\|y` | any | Only results from the past day, week, month or year |
| `--site host` | | Restrict to one site, e.g. `--site github.com` |
| `--gl code` | | Country, e.g. `us`, `de` |
| `--hl code` | | Language, e.g. `en`, `fr` |
| `--read K` | 0 | Also read the top K results, focused on the query |
| `--max-tokens N` | 1500 | Per-page cap when using `--read` |
| `--urls` | | Print only URLs, one per line (for piping into `read`) |
| `--no-rerank` | | Keep all results instead of dropping off-topic ones |

### `news <query>`

News search. Same options as `search`. News results are cached for 15 minutes instead of 1 hour.

### `papers <query>`

Academic search. `--source arxiv` (default) or `--source ssrn`. Takes the `search` options except `--site`.

### `images <query>`

Image search. Prints the title, image URL, pixel size and the page the image is on. Takes `-n`, `--gl`, `--hl`, `--time`, `--json`.

### `read <url...>`

Reads web pages or PDFs and prints them as markdown. Several URLs are read in parallel (up to 5 at a time). With no URL arguments, URLs are read from stdin, one per line.

| Option | Default | Meaning |
|---|---|---|
| `--focus "question"` | | Keep only the passages relevant to the question |
| `--max-tokens N` | 4000 | Cap per page; `0` means no limit |
| `--selector css` | | Only return this part of the page, e.g. `main`, `article` |
| `--remove css` | | Drop these parts, e.g. `nav,footer,.ads` |
| `--links` | | Keep link URLs inline and append a list of the page's links |
| `--images` | | Append a list of the page's images |
| `--engine browser\|curl\|auto` | auto | `browser` renders JavaScript (slower); `curl` is fastest |
| `--timeout S` | 30 | Seconds to wait for the page |

### `screenshot <url>`

Prints a temporary URL of a screenshot of the page. `--full` captures the full page; `-o file.png` downloads it instead.

## Common options

| Option | Meaning |
|---|---|
| `--json` | Structured output instead of text |
| `--fresh` | Skip both the local cache and Jina's cache |
| `-h, --help` | Show help |

## Environment

| Variable | Meaning |
|---|---|
| `JINA_API_KEY` | Jina key. Required for `search`, `news`, `papers`, `images` and reranking; raises rate limits for `read`. |
| `WEB_SEARCH_CACHE_DIR` | Where the cache database lives. Default `~/.cache/web-search`. |
| `WEB_SEARCH_ALLOW_BUILTIN` | Set to `1` to stop the Claude Code hook redirecting `WebSearch`/`WebFetch`. |

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Usage error: bad option, missing argument or missing API key. The message says what to fix. |
| 2 | API or network error. Worth retrying once; for stubborn pages try `--engine browser` or `--fresh`. |

## JSON output

`search --json`:

```json
{
  "query": "bun 1.4",
  "type": "web",
  "results": [{ "title": "...", "url": "...", "description": "...", "date": "Aug 20, 2026" }],
  "pages": [{ "title": "...", "url": "...", "content": "..." }]
}
```

`pages` appears only with `--read`. Image results carry `imageUrl`, `imageWidth` and `imageHeight`.

`read --json` prints an array with one object per URL: `{ title, url, content, publishedTime?, links?, images? }`, or `{ url, error }` for a page that failed.
