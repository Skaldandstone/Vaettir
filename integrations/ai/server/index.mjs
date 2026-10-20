import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readConfig, readSummary, projectIdSchema } from "./client.mjs";

const config = readConfig();
const server = new McpServer(
  { name: "vaettir", version: "0.1.6" },
  {
    instructions:
      "Vaettir exposes only explicitly approved synthetic-project counts. Test content is unavailable. A denied or suppressed read must not be retried through generic APIs, browsers, exports, or alternate identities. Never request credentials in chat.",
  },
);
const result = (data) => ({
  content: [{ type: "text", text: JSON.stringify(data) }],
  structuredContent: data,
});
const annotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

server.registerTool(
  "vaettir_connection_status",
  {
    description:
      "Check whether this local Vaettir preview has connection configuration. This does not contact Vaettir or prove authorization or availability.",
    inputSchema: {},
    annotations,
  },
  async () =>
    result({
      configured: config !== null,
      preview: true,
      disclosure: "synthetic_aggregate_counts_only",
    }),
);

server.registerTool(
  "vaettir_project_summary",
  {
    description:
      "Read aggregate test-case, plan, and run counts for an explicitly approved synthetic Vaettir project. Requires an exact project ID supplied by the user or approved configuration. Customer content and regulated/proprietary/unclassified projects are blocked.",
    inputSchema: { projectId: projectIdSchema },
    annotations,
  },
  async ({ projectId }) => {
    try {
      return result(await readSummary(config, projectId));
    } catch {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: "Vaettir AI read unavailable or not permitted. Ask the workspace administrator to review the connection; do not bypass the disclosure policy.",
          },
        ],
      };
    }
  },
);

try {
  await server.connect(new StdioServerTransport());
} catch {
  process.stderr.write("Vaettir MCP could not start.\n");
  process.exitCode = 1;
}
