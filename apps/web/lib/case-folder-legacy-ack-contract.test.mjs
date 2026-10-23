// Authored source-only. Morning real QueryClient fixture must retain a legacy
// UUID/payload across lost response and identity return, then recover one ACK.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = readFileSync(
  new URL("../components/TestCaseFolders.tsx", import.meta.url),
  "utf8",
);
const success = source.slice(
  source.indexOf("onSuccess: (result)"),
  source.indexOf("onError: (error)"),
);
test("legacy ACK uses immutable mounted origin and does not alter exact request scope or UUID", () => {
  assert.match(
    success,
    /const acknowledgementScope = input\?\.expectedScope \?\? origin/,
  );
  assert.match(success, /!acknowledgementScope/);
  assert.match(
    success,
    /!input\.expectedScope && origin\?\.projectId !== input\.projectId/,
  );
  for (const comparison of [
    "result.requestId !== input.requestId",
    "result.projectId !== input.projectId",
    "result.organizationId !== acknowledgementScope.organizationId",
    "result.clerkActorId !== acknowledgementScope.clerkActorId",
  ])
    assert.ok(success.includes(comparison), comparison);
  const validation = success.slice(0, success.indexOf("const destination"));
  assert.doesNotMatch(validation, /input\.(?:requestId|expectedScope)\s*=/);
  assert.doesNotMatch(
    validation,
    /list\.data|project\.data|liveScope\.current/,
  );
  assert.ok(source.includes("if (!origin && currentAccess && organizationId)"));
  assert.ok(source.includes("mutation.mutate(pending)"));
});
