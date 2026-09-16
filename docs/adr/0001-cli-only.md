# ADR 0001 — The only LLM engine is the local Claude Code CLI (subscription)

**Date:** 2026-09-15 · **Status:** accepted (user requirement)

The user does not use the Claude API. Every model call in this project is a `claude -p`
subprocess (`lib/agents/claudeCliRunner.ts`) that reuses the user's Claude Code subscription
login from the macOS keychain. Consequences:

- No `@anthropic-ai/*` SDK imports, no `ANTHROPIC_API_KEY` anywhere (enforced by
  `tests/agents/cliOnly.test.ts`). The child env deletes `ANTHROPIC_*` and `CLAUDECODE*`.
- `--bare` must never be passed: it disables OAuth/keychain and returns "Not logged in".
- Prompts are written to stdin; `--output-format stream-json --include-partial-messages`
  gives token-level `text_delta` events used for the live typing view.
- Cost is displayed as turns / elapsed time / tokens; `total_cost_usd` is informational.
- Subagents come from `agent/.claude/agents/*.md`; skills from `agent/.claude/skills/`.
