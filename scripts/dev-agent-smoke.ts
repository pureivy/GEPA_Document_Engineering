/**
 * Smoke test for the Claude Code CLI runner.
 *
 *   pnpm tsx scripts/dev-agent-smoke.ts ["custom prompt"]
 *
 * Spawns the real CLI (subscription login) with a trivial prompt, prints every event,
 * asserts `result.ok`, and exits non-zero on failure (2 when the CLI is not logged in).
 */
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import {
  buildArgs,
  buildChildEnv,
  ClaudeCliRunner,
  isStrippedEnvKey,
  resolveClaudeBin,
  STRIPPED_ENV_KEYS,
  STRIPPED_ENV_PREFIXES,
} from "../lib/agents/claudeCliRunner";
import type { RunSpec } from "../lib/agents/runner";

async function main(): Promise<number> {
  const prompt = process.argv.slice(2).join(" ").trim() || "안녕이라고 한 단어로만 답해";
  const cwd = path.join(process.cwd(), "agent");
  mkdirSync(cwd, { recursive: true });

  // Guard: the env builder must not leak API / Bedrock / Vertex / nested-session keys.
  const env = buildChildEnv({
    ...process.env,
    ...Object.fromEntries(STRIPPED_ENV_KEYS.map((k) => [k, "leak"])),
    ...Object.fromEntries(STRIPPED_ENV_PREFIXES.map((p) => [`${p}PROBE`, "leak"])),
  });
  const leaked = Object.keys(env).filter(isStrippedEnvKey);
  if (leaked.length) {
    console.error("FAIL: child env still contains guarded keys:", leaked);
    return 1;
  }
  if (env.NO_COLOR !== "1") {
    console.error("FAIL: NO_COLOR not set in child env");
    return 1;
  }

  const spec: RunSpec = {
    runId: randomUUID(),
    sessionId: randomUUID(),
    cwd,
    addDirs: [],
    systemPromptAppend: "",
    prompt,
    allowedTools: ["Read"],
    model: "opus",
    maxTurns: 2,
    wallTimeoutMs: 120_000,
    idleTimeoutMs: 90_000,
  };

  console.log(`bin: ${resolveClaudeBin()}`);
  console.log(`args: ${buildArgs(spec).join(" ")}`);
  console.log(`cwd: ${cwd}`);
  console.log(`prompt(stdin): ${prompt}`);
  console.log("---");

  const runner = new ClaudeCliRunner();
  const abort = new AbortController();
  process.on("SIGINT", () => abort.abort());

  let resultOk = false;
  let notLoggedIn = false;
  let sawInit = false;
  let text = "";
  const counts: Record<string, number> = {};
  const started = Date.now();

  for await (const ev of runner.run(spec, abort.signal)) {
    counts[ev.type] = (counts[ev.type] ?? 0) + 1;
    switch (ev.type) {
      case "init":
        sawInit = true;
        console.log(`[init] session=${ev.sessionId} model=${ev.model} tools=${ev.tools.length}${ev.agents ? ` agents=${ev.agents.length}` : ""}`);
        break;
      case "text.delta":
        text += ev.text;
        process.stdout.write(ev.text);
        break;
      case "assistant.text":
        process.stdout.write("\n");
        console.log(`[assistant.text] ${ev.text.length} chars`);
        break;
      case "tool.start":
        console.log(`[tool.start] ${ev.name} ${ev.toolUseId}`);
        break;
      case "tool.input":
        console.log(`[tool.input] ${ev.name} ${JSON.stringify(ev.input).slice(0, 200)}`);
        break;
      case "tool.result":
        console.log(`[tool.result] ${ev.name ?? "?"} error=${ev.isError} ${ev.content.length} chars`);
        break;
      case "subagent.start":
        console.log(`[subagent.start] ${ev.agent}: ${ev.description}`);
        break;
      case "subagent.end":
        console.log(`[subagent.end] ${ev.toolUseId}`);
        break;
      case "thinking":
        break;
      case "stderr":
        process.stderr.write(`[stderr] ${ev.text}`);
        break;
      case "error":
        console.error(`[error] ${ev.message}${ev.hint ? `\n  hint: ${ev.hint}` : ""}`);
        if (ev.hint && /claude login/.test(ev.hint)) notLoggedIn = true;
        break;
      case "result":
        resultOk = ev.ok;
        console.log(
          `[result] ok=${ev.ok} subtype=${ev.subtype ?? ""} turns=${ev.turns} duration=${ev.durationMs}ms cost=$${ev.costUsd.toFixed(4)}${ev.error ? ` error=${ev.error}` : ""}`,
        );
        break;
      default:
        console.log(`[${(ev as { type: string }).type}]`);
    }
  }

  console.log("---");
  console.log(`events: ${JSON.stringify(counts)} in ${Date.now() - started}ms`);
  console.log(`final text: ${JSON.stringify(text.trim().slice(0, 200))}`);

  if (notLoggedIn) {
    console.error("FAIL: Claude Code CLI is not logged in. Run `claude login` and retry.");
    return 2;
  }
  if (!sawInit) {
    console.error("FAIL: no init event received");
    return 1;
  }
  if (!resultOk) {
    console.error("FAIL: result.ok is false");
    return 1;
  }
  console.log("OK");
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
