import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";

test("packaged stdio server initializes, lists only safe tools, and denies unconfigured reads", async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL("../dist/server.mjs", import.meta.url))],
    // Override rather than inherit a developer's configured credentials.
    env: { VAETTIR_AI_BASE_URL: "", VAETTIR_AI_TOKEN: "" },
    stderr: "pipe",
  });
  const client = new Client({
    name: "vaettir-synthetic-contract-test",
    version: "1.0.0",
  });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), [
      "vaettir_connection_status",
      "vaettir_project_summary",
    ]);
    assert.ok(
      tools.every(
        (t) => t.annotations.readOnlyHint && !t.annotations.destructiveHint,
      ),
    );
    const status = await client.callTool({
      name: "vaettir_connection_status",
      arguments: {},
    });
    assert.equal(status.structuredContent.configured, false);
    const denied = await client.callTool({
      name: "vaettir_project_summary",
      arguments: { projectId: "synthetic-project" },
    });
    assert.equal(denied.isError, true);
    assert.match(denied.content[0].text, /not permitted/);
    const unknown = await client.callTool({
      name: "testCases.list",
      arguments: {},
    });
    assert.equal(unknown.isError, true);
  } finally {
    await client.close();
  }
});
