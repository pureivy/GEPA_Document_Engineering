/**
 * Writes the `--mcp-config` file for a research-capable run. The JSON carries no secrets: the
 * server inherits the keys from the `claude` child's environment (which inherits the Next
 * process env, i.e. .env/.env.local). Returns null when no public-data source is configured,
 * so runs without keys behave exactly as before (no MCP server, --strict-mcp-config only).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { researchDataSourcesStatus } from "./dataSources";
import { MCP_SERVER_NAME } from "./tools/register";

export function anyResearchSourceConfigured(env: Record<string, string | undefined> = process.env): boolean {
  const st = researchDataSourcesStatus(env);
  return (st.dataGoKr.keySet && st.dataGoKr.services.length > 0) || st.kosis || st.law || st.bizinfo;
}

export interface McpConfigOptions {
  /** directory to write the JSON into (default: <dataDir>/mcp) */
  dir: string;
  /** repo root — where node_modules/.bin/tsx and agent/mcp/server.ts live (default: process.cwd()) */
  repoRoot?: string;
  env?: Record<string, string | undefined>;
}

export function buildMcpConfig(repoRoot: string): { mcpServers: Record<string, { command: string; args: string[] }> } {
  return {
    mcpServers: {
      [MCP_SERVER_NAME]: {
        command: path.join(repoRoot, "node_modules", ".bin", "tsx"),
        args: [path.join(repoRoot, "agent", "mcp", "server.ts")],
      },
    },
  };
}

/** Writes (or refreshes) the config file and returns its absolute path, or null when nothing is configured. */
export function writeResearchMcpConfig(opts: McpConfigOptions): string | null {
  if (!anyResearchSourceConfigured(opts.env ?? process.env)) return null;
  const repoRoot = opts.repoRoot ?? process.cwd();
  mkdirSync(opts.dir, { recursive: true });
  const file = path.join(opts.dir, `${MCP_SERVER_NAME}.json`);
  writeFileSync(file, JSON.stringify(buildMcpConfig(repoRoot), null, 2) + "\n");
  return file;
}
