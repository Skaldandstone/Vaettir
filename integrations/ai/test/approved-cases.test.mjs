import assert from "node:assert/strict";
import { test } from "node:test";
import { readApprovedCases, readConfig } from "../server/client.mjs";
const config = readConfig({ VAETTIR_AI_BASE_URL: "https://vaettir.example", VAETTIR_AI_TOKEN: "vai_" + "a".repeat(64) });
const value = { policyVersion: 1, disclosure: "approved_case_snapshot", snapshot: { version: 1, organizationId: "org", projectId: "project", classificationVersion: 1, fields: ["title"], cases: [{ id: "c1", title: "Synthetic navigation" }] } };
test("reads only the dedicated selected-case endpoint without redirects or caching", async () => {
  const result = await readApprovedCases(config, "project", async (url, options) => {
    assert.equal(url.pathname, "/api/integrations/ai/v1/approved-cases"); assert.equal(options.redirect, "error"); assert.equal(options.cache, "no-store");
    return Response.json(value);
  }); assert.deepEqual(result, value);
});
test("refuses foreign, broadened, malformed and oversized responses", async () => {
  for (const changed of [
    { ...value, snapshot: { ...value.snapshot, projectId: "foreign" } },
    { ...value, snapshot: { ...value.snapshot, cases: [{ ...value.snapshot.cases[0], given: ["NOT_APPROVED"] }] } },
    { ...value, snapshot: { ...value.snapshot, cases: [{ id: "c1" }] } },
    { ...value, snapshot: { ...value.snapshot, cases: [{ id: "c1", title: "x".repeat(145_000) }] } },
  ]) await assert.rejects(readApprovedCases(config, "project", async () => Response.json(changed)), /unavailable or not permitted/);
});
test("does not retry denied reads or expose provider errors", async () => {
  let calls = 0;
  await assert.rejects(readApprovedCases(config, "project", async () => { calls++; return Response.json({ secret: "DO_NOT_EXPOSE" }, { status: 403 }); }), /^Error: Vaettir AI read unavailable or not permitted\.$/);
  assert.equal(calls, 1);
});
