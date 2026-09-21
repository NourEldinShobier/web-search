---
name: web-search
description: Search the web, news, arXiv/SSRN papers or images, and read web pages or PDFs as compact markdown with the `web-search` CLI. Use for any online research, docs lookup, current events, fact checks or reading a URL — instead of WebSearch or WebFetch.
allowed-tools: Bash(web-search *)
---

# web-search

Run through Bash. Results are cached (searches 1h, pages 24h), so repeating a call is free.

## Do it yourself or delegate

- **Quick lookup** (one fact, one page): run the CLI yourself.
- **Research** (several sources, comparisons, a question with parts): spawn the `web-search:web-researcher` agent. It runs on Sonnet, does the searching and reading in its own context, and returns a short sourced report, so page text never fills your context. Give it one self-contained question with the context it needs.
- **How many agents:** each agent costs about 11k tokens before it does any work, so default to **one** agent, even for a broad question with several parts (it can cover them all). Spawn parallel agents (at most 3, in the same message) only when each part needs its own deep reading, such as comparing specs from different vendors' pages. Then combine their reports.

## Pick the command

| Need | Command |
|---|---|
| Find sources | `web-search search "query"` |
| Recent events | `web-search news "query"` or `search "query" --time w` (d, w, m, y) |
| Papers | `web-search papers "query"` (`--source ssrn` for SSRN) |
| Images | `web-search images "query"` |
| Read one page or PDF | `web-search read <url> --focus "what you need"` |
| Search and read in one go | `web-search search "query" --read 2` |
| Screenshot | `web-search screenshot <url>` (`-o file.png` to save) |

## Spend few tokens

1. Search first (5 results, about 400 tokens). Read only the 1–3 results that matter.
2. Always pass `--focus "<question>"` to `read`. It keeps only the relevant passages, often 90%+ fewer tokens than the full page.
3. Default page cap is 4000 tokens. Nothing is lost when a page is cut: the note at the end gives the exact `--offset` for the next part and a map of the remaining sections with their offsets. Need more? Jump to the section you want (`read <url> --offset N`) or read on in order; both come from the cache, so they're fast. Focused output shows each heading's `--offset` too, so you can read a whole section around a passage. Use `--max-tokens 0` only when you truly need the whole page at once.
4. Narrow big pages with `--selector "main"` or `--remove "nav,footer"`.
5. Read several URLs in one call; they run in parallel: `web-search read <url1> <url2> --focus "..."`.
6. Pipe: `web-search search "query" --urls | web-search read --focus "..."`.

## When something fails

- Exit 1 is a usage error (message says what to fix). Exit 2 is a network or API error: retry once, then try `--engine browser` for JavaScript-heavy pages or `--fresh` to bypass caches.
- `web-search --help` lists every option.
