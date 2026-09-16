import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, statSync, mkdirSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildArgs } from "../../lib/agents/claudeCliRunner";
import type { RunSpec } from "../../lib/agents/runner";
import { buildMcpConfig, writeResearchMcpConfig } from "../../lib/research/mcpConfig";
import { syncWikiSnapshot } from "../../lib/research/wikiSnapshot";

const spec: RunSpec = { runId: "r", sessionId: "s", cwd: "/tmp", addDirs: ["/w"], systemPromptAppend: "", prompt: "p", allowedTools: ["Read"], model: "opus", maxTurns: 3, wallTimeoutMs: 1000, idleTimeoutMs: 1000 };

describe("--mcp-config wiring", () => {
  it("is passed after --strict-mcp-config and before the variadic options", () => {
    const args = buildArgs({ ...spec, mcpConfigPath: "/d/mcp/gepa-data.json", tools: ["Read"] });
    const i = args.indexOf("--mcp-config");
    expect(i).toBeGreaterThan(args.indexOf("--strict-mcp-config"));
    expect(args[i + 1]).toBe("/d/mcp/gepa-data.json");
    expect(i).toBeLessThan(args.indexOf("--add-dir"));
    expect(i).toBeLessThan(args.indexOf("--allowedTools"));
    expect(buildArgs(spec)).not.toContain("--mcp-config");
  });
  it("loads project-scope settings only by default", () => {
    const args = buildArgs(spec);
    expect(args[args.indexOf("--setting-sources") + 1]).toBe("project");
    expect(buildArgs({ ...spec, settingSources: "user,project" })).toContain("user,project");
  });
  it("writes a secret-free config with absolute paths only when a source is configured", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "gepa-mcp-"));
    expect(writeResearchMcpConfig({ dir, repoRoot: "/repo", env: {} })).toBeNull();
    const file = writeResearchMcpConfig({ dir, repoRoot: "/repo", env: { KOSIS_KEY: "k" } });
    expect(file).toBe(path.join(dir, "gepa-data.json"));
    const json = JSON.parse(readFileSync(file!, "utf8"));
    expect(json).toEqual(buildMcpConfig("/repo"));
    expect(json.mcpServers["gepa-data"].command).toBe("/repo/node_modules/.bin/tsx");
    expect(json.mcpServers["gepa-data"].args).toEqual(["/repo/agent/mcp/server.ts"]);
    expect(readFileSync(file!, "utf8")).not.toContain("k\"");
    // data.go.kr key without any enabled service is not "configured"
    expect(writeResearchMcpConfig({ dir, repoRoot: "/repo", env: { DATA_GO_KR_KEY: "x" } })).toBeNull();
  });
});

describe("wiki snapshot", () => {
  it("copies only .md files, makes them read-only, and skips unchanged files on the next sync", () => {
    const src = mkdtempSync(path.join(tmpdir(), "wiki-src-"));
    const dst = mkdtempSync(path.join(tmpdir(), "wiki-dst-"));
    mkdirSync(path.join(src, "sub"));
    writeFileSync(path.join(src, "a.md"), "# a");
    writeFileSync(path.join(src, "sub", "b.md"), "# b");
    writeFileSync(path.join(src, "raw.xlsx"), "bin");
    writeFileSync(path.join(src, ".hidden.md"), "x");
    const r1 = syncWikiSnapshot(src, dst);
    expect(r1).toMatchObject({ total: 2, copied: 2 });
    expect(statSync(path.join(dst, "sub", "b.md")).mode & 0o777).toBe(0o444);
    const r2 = syncWikiSnapshot(src, dst);
    expect(r2.copied).toBe(0);
    // a changed source file is re-copied even though the copy is read-only
    writeFileSync(path.join(src, "a.md"), "# a2");
    utimesSync(path.join(src, "a.md"), new Date(), new Date(Date.now() + 5000));
    const r3 = syncWikiSnapshot(src, dst);
    expect(r3.copied).toBe(1);
    expect(readFileSync(path.join(dst, "a.md"), "utf8")).toBe("# a2");
    expect(() => syncWikiSnapshot(path.join(src, "nope"), dst)).toThrow(/GEPA_WIKI_DIR/);
  });
});
