/** PreToolUse hook: send WebSearch/WebFetch to the web-search CLI instead. */

const q = (s: string) => `"${s.replace(/["\\$`]/g, '\\$&')}"`;

/** Returns the hook JSON to print, or null to let the tool call through. */
export function decide(input: { tool_name?: string; tool_input?: Record<string, unknown> }): object | null {
  if (process.env.WEB_SEARCH_ALLOW_BUILTIN === '1') return null;
  const ti = input.tool_input ?? {};
  let command: string;
  if (input.tool_name === 'WebSearch') {
    command = `web-search search ${q(String(ti.query ?? ''))}`;
  } else if (input.tool_name === 'WebFetch') {
    const url = String(ti.url ?? '');
    // claude.ai artifact links need the signed-in WebFetch; local URLs aren't web research.
    try {
      const host = new URL(url).hostname;
      if (host === 'claude.ai' || host.endsWith('.claude.ai') || host === 'localhost' || host === '127.0.0.1') return null;
    } catch {
      return null;
    }
    const prompt = String(ti.prompt ?? '').slice(0, 200);
    command = `web-search read ${q(url)}${prompt ? ` --focus ${q(prompt)}` : ''}`;
  } else {
    return null;
  }
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `Use the web-search CLI via Bash instead (faster, cached, fewer tokens): ${command}  — run \`web-search --help\` for options.`,
    },
  };
}
