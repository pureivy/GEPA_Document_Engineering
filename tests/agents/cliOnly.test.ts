/**
 * Guard: the only LLM engine is the local Claude Code CLI. No Anthropic SDK, no API key.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..", "..");
const SCAN_DIRS = ["lib", "app", "scripts"];
const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".mts", ".cts", ".json"]);
/** The env-deletion list in the CLI runner is the one legitimate mention of the key name. */
const EXEMPT_FILES = new Set([path.join("lib", "agents", "claudeCliRunner.ts")]);
const FORBIDDEN = ["@anthropic-ai/", "ANTHROPIC_API_KEY", "anthropic.messages", "api.anthropic.com"];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (EXTENSIONS.has(path.extname(name))) out.push(full);
  }
  return out;
}

describe("CLI-only guard", () => {
  it("has no Anthropic SDK imports or API key references in lib/, app/, scripts/", () => {
    const hits: string[] = [];
    let scanned = 0;
    for (const dir of SCAN_DIRS) {
      const abs = path.join(ROOT, dir);
      let files: string[] = [];
      try {
        files = walk(abs);
      } catch {
        continue;
      }
      for (const file of files) {
        const rel = path.relative(ROOT, file);
        if (EXEMPT_FILES.has(rel)) continue;
        scanned++;
        const text = readFileSync(file, "utf8");
        for (const needle of FORBIDDEN) {
          if (text.includes(needle)) hits.push(`${rel}: ${needle}`);
        }
      }
    }
    expect(scanned).toBeGreaterThan(0);
    expect(hits).toEqual([]);
  });

  it("the CLI runner strips API/Bedrock/Vertex/nested-session keys and never uses --bare or a budget flag", async () => {
    const mod = await import("../../lib/agents/claudeCliRunner");
    const env = mod.buildChildEnv({
      HOME: "/home/u",
      PATH: "/bin",
      ...Object.fromEntries(mod.STRIPPED_ENV_KEYS.map((k) => [k, "x"])),
      CLAUDE_CODE_ENTRYPOINT: "cli",
      CLAUDE_CODE_SSE_PORT: "1",
    });
    expect(Object.keys(env).filter(mod.isStrippedEnvKey)).toEqual([]);
    expect(env.HOME).toBe("/home/u");
    expect(env.NO_COLOR).toBe("1");
    const args = mod.buildArgs({
      runId: "r",
      sessionId: "s",
      cwd: "/repo/agent",
      addDirs: ["/data/p1"],
      systemPromptAppend: "persona",
      prompt: "hello",
      allowedTools: ["Read", "Write"],
      maxTurns: 3,
      wallTimeoutMs: 1000,
      idleTimeoutMs: 1000,
    });
    expect(args).not.toContain("--bare");
    expect(args).not.toContain("--max-budget-usd");
    expect(args).not.toContain("hello"); // prompt goes to stdin
    expect(args.slice(0, 2)).toEqual(["-p", "--verbose"]);
    expect(args).toContain("--include-partial-messages");
    expect(args.slice(-5)).toEqual(["--add-dir", "/data/p1", "--allowedTools", "Read", "Write"]);
    expect(args).toContain("--session-id");
    expect(args).toContain("--strict-mcp-config"); // default: no MCP servers inherited
    expect(args).not.toContain("--tools");
    const restricted = mod.buildArgs({
      runId: "r",
      sessionId: "s",
      cwd: "/repo/agent",
      addDirs: [],
      systemPromptAppend: "",
      prompt: "hi",
      allowedTools: [],
      tools: ["Read", "Write"],
      strictMcpConfig: false,
      maxTurns: 1,
      wallTimeoutMs: 1,
      idleTimeoutMs: 1,
    });
    expect(restricted).not.toContain("--strict-mcp-config");
    expect(restricted.slice(restricted.indexOf("--tools"), restricted.indexOf("--tools") + 2)).toEqual(["--tools", "Read,Write"]);
    const resumed = mod.buildArgs({
      runId: "r",
      sessionId: "s",
      resumeSessionId: "old",
      cwd: "/repo/agent",
      addDirs: [],
      systemPromptAppend: "",
      prompt: "hi",
      allowedTools: [],
      maxTurns: 1,
      wallTimeoutMs: 1,
      idleTimeoutMs: 1,
    });
    expect(resumed).toContain("--resume");
    expect(resumed).not.toContain("--session-id");
    expect(resumed).not.toContain("--append-system-prompt");
  });
});
