# Claude Code plugin

The plugin has four parts. Each one works on its own, and you can turn off the ones you don't want.

## 1. The CLI on PATH

`bin/web-search` (and `bin/web-search.cmd` on Windows) runs `src/cli.ts` with Bun. Claude Code adds a plugin's `bin/` folder to the PATH of its Bash tool, so Claude can call `web-search` directly. Bun must be installed and on your PATH.

## 2. The skill

`skills/web-search/SKILL.md` tells Claude which command fits which need and how to keep token use low (search first, read few pages, always use `--focus`). Claude loads it automatically when a task involves online research, or you can call it directly:

```
/web-search:web-search what changed in the latest TypeScript release?
```

The skill also decides between doing a quick lookup itself and handing research to the agent below.

## 3. The `web-researcher` agent

`agents/web-researcher.md` defines a subagent that runs on Sonnet, researches one question with the CLI and returns a report of under 300 words: a direct answer, key facts with source URLs, and any gaps or conflicts between sources. The pages it reads stay in its own context, so only the report reaches your main conversation.

It is set up to spend few tokens:

- `omitClaudeMd: true`: it skips your CLAUDE.md files, since its own prompt says everything it needs.
- Its first call searches and reads the top results in one step (`search --read 2`), and it makes at most 4 calls.
- The skill starts one agent per question by default. Every subagent carries a fixed cost of roughly 11,000 tokens (Claude Code's system prompt and tool definitions) before it does any work, so parallel agents are used only when each part of a question needs its own deep reading.

To use it yourself, ask Claude to "use the web-researcher agent to ..." or let the skill decide.

## 4. The hook

`hooks/hooks.json` registers a `PreToolUse` hook on `WebSearch` and `WebFetch`. When Claude calls either tool, the hook denies the call and replies with the equivalent `web-search` command. For `WebFetch`, the prompt becomes `--focus`:

```
WebFetch(url: "https://bun.com/blog", prompt: "release date")
  → Use the web-search CLI via Bash instead ...: web-search read "https://bun.com/blog" --focus "release date"
```

This also applies inside subagents, because hooks fire for every tool call. URLs on `claude.ai` (artifact links need your signed-in session), `localhost` and `127.0.0.1` are let through.

To turn the redirect off, set `WEB_SEARCH_ALLOW_BUILTIN=1`, for example in the `env` block of `~/.claude/settings.json`:

```json
{ "env": { "WEB_SEARCH_ALLOW_BUILTIN": "1" } }
```

## Making Claude prefer it everywhere

The skill and hook are usually enough. For a firmer rule, add a line to your `~/.claude/CLAUDE.md`:

```markdown
- Online research: use the `web-search` CLI via Bash, never WebSearch/WebFetch. Search first, read only the 1–3 results that matter, always with `--focus`.
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| `web-search: command not found` in Claude's Bash tool | Restart Claude Code after installing; check `claude plugin list` shows `web-search` enabled. |
| `search needs JINA_API_KEY` | Set the variable, then restart Claude Code so it inherits it. |
| Hook errors mentioning `bun` | Install Bun and make sure `bun --version` works in a new terminal. |
| A page times out | Retry with `--timeout 60`, or `--engine browser` for JavaScript-heavy sites. |
| Results look stale | Add `--fresh` to skip both caches. |

## Updating

```bash
claude plugin marketplace update web-search
claude plugin update web-search@web-search
```
