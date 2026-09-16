/**
 * GEPA public-data MCP server (stdio). Spawned by the `claude -p` child of a research run via
 * `--mcp-config`; keys come from the process environment (see lib/research/dataSources.ts).
 * Tool handlers live in lib/research/tools/* and are pure (params, env, fetch) functions so
 * they can be unit-tested with fixtures.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerResearchTools } from "../../lib/research/tools/register";

async function main(): Promise<void> {
  const server = new McpServer({ name: "gepa-data", version: "0.1.0" });
  registerResearchTools(server, process.env);
  await server.connect(new StdioServerTransport());
}

main().catch((e: unknown) => {
  console.error("[gepa-data] fatal:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
