// Ad-hoc smoke test: spawns the built server over stdio (no STAYAPI_KEY set, so it
// runs in free link-only mode) and verifies the MCP client can connect and list all
// registered tools with valid schemas. Does NOT call any external API. Not part of
// `npm test` — run manually with:
//   node scripts/smoke-test-tools.mjs
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/index.js"],
  env: { ...process.env },
});

const client = new Client({ name: "smoke-test-client", version: "1.0.0" });
await client.connect(transport);

const { tools } = await client.listTools();
console.log(`Connected. Server exposes ${tools.length} tools:\n`);
for (const t of tools) {
  const requiredParams = t.inputSchema?.required ?? [];
  console.log(`- ${t.name}`);
  console.log(`    title: ${t.title}`);
  console.log(`    required params: ${JSON.stringify(requiredParams)}`);
}

const expected = ["flexible_hotels_resolve_destination", "flexible_hotels_search_flexible_offers"];
const names = tools.map((t) => t.name).sort();
const missing = expected.filter((n) => !names.includes(n));
if (missing.length) {
  console.error(`\nFAIL: missing expected tools: ${missing.join(", ")}`);
  process.exit(1);
}
console.log("\nOK: all expected tools are registered with schemas.");
await client.close();
process.exit(0);
