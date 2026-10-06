import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MAX_MANUAL_CASES,
  freezeRunConfiguration,
  reviewedRunCasesMatch,
  runConfigurationScopeMatches,
  verifiedRunConfigurationAck,
} from "./run-configuration-request.ts";
import { retainAnalysisRequest } from "./analysis-request-recovery.ts";
const draft = () => ({
  projectId: "p",
  originalOrganizationId: "org",
  expectedClerkActorId: "actor",
  testCaseIds: ["case-a", "case-b"],
  expectedProfileHash: "a".repeat(64),
  executionContext: {
    configuration: " Original ",
    platform: " Web ",
    build: "",
    hardwareRevision: "",
    firmwareVersion: "",
    rig: "",
    batchOrLot: "",
    environment: "",
    calibrationReference: "",
    protocolReference: "",
  },
});
test("851 and1,000 complete cases can be reviewed, but duplicates or oversized scopes are refused", () => {
  assert.equal(MAX_MANUAL_CASES, 1000);
  for (const count of [851, 1000])
    assert.equal(
      freezeRunConfiguration(
        {
          ...draft(),
          testCaseIds: Array.from({ length: count }, (_, i) => `case-${i}`),
        },
        "uuid",
      ).testCaseIds.length,
      count,
    );
  for (const testCaseIds of [
    [],
    ["a", "a"],
    Array.from({ length: 1001 }, (_, i) => `case-${i}`),
  ])
    assert.throws(() =>
      freezeRunConfiguration({ ...draft(), testCaseIds }, "uuid"),
    );
});
test("frozen configuration retains exact case IDs, UUID and scope when background selection or entered text changes", () => {
  const input = draft();
  const request = freezeRunConfiguration(input, "retained-uuid");
  input.testCaseIds[0] = "different-case";
  input.executionContext.configuration = "Changed";
  assert.deepEqual(request.testCaseIds, ["case-a", "case-b"]);
  assert.equal(request.executionContext.configuration, "Original");
  assert.equal(request.idempotencyKey, "retained-uuid");
  assert.throws(() => request.testCaseIds.push("other"));
  assert.throws(() => {
    request.executionContext.build = "changed";
  });
  assert.equal(
    runConfigurationScopeMatches(request, {
      projectId: "p",
      organizationId: "org",
      clerkActorId: "actor",
    }),
    true,
  );
  for (const scope of [
    null,
    { projectId: "foreign", organizationId: "org", clerkActorId: "actor" },
    { projectId: "p", organizationId: "foreign", clerkActorId: "actor" },
    { projectId: "p", organizationId: "org", clerkActorId: "other" },
  ])
    assert.equal(runConfigurationScopeMatches(request, scope), false);
});
test("same-count replacement must be reviewed and a later rejection never erases an ambiguous original attempt", () => {
  assert.equal(reviewedRunCasesMatch(["a", "b"], ["a", "b"]), true);
  assert.equal(reviewedRunCasesMatch(["a", "b"], ["a", "c"]), false);
  assert.equal(reviewedRunCasesMatch(null, ["a"]), false);
  const definite = { data: { code: "BAD_REQUEST" } };
  assert.equal(retainAnalysisRequest(false, definite), false);
  assert.equal(retainAnalysisRequest(false, Error("Response lost")), true);
  assert.equal(retainAnalysisRequest(true, definite), true);
});
test("library configuration stays mounted through close, sends only retained scope and hides drafts when original access fails", () => {
  const page = readFileSync(
    new URL("../app/projects/[projectId]/test-cases/page.tsx", import.meta.url),
    "utf8",
  );
  const modal = readFileSync(
    new URL("../components/RunConfigurationModal.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(page, /runConfigurationOpen &&/);
  assert.match(page, /open=\{runConfigurationOpen\}/);
  assert.match(page, /testCaseIds=\{runSelection\}/);
  assert.match(page, /context.projectId !== projectId/);
  assert.match(page, /startRunMutation.mutateAsync\(\{\s*\.\.\.context/);
  assert.match(modal, /pendingRequest \?\?\s*freezeRunConfiguration/);
  assert.match(modal, /await onStart\(request\)/);
  assert.match(
    modal,
    /verifiedRunConfigurationAck\(request, acknowledgement\)/,
  );
  assert.match(page, /verifiedRunConfigurationAck\(context, acknowledgement\)/);
  assert.match(modal, /retainAnalysisRequest\(everAmbiguous.current, cause\)/);
  assert.match(modal, /!access.ready \?/);
  assert.match(modal, /Private configuration is hidden/);
  assert.match(
    modal,
    /disabled=\{\s*busy \|\| refreshing \|\| !!pendingRequest/,
  );
  assert.match(modal, /runConfigurationScopeMatches\(request/);
});
test("scoped run acknowledgements match the exact original UUID and actor; missing or changed echoes retain retry intent", () => {
  const request = freezeRunConfiguration(draft(), "retained-uuid");
  const ack = {
    testRunId: `manual_${"a".repeat(64)}`,
    originalOrganizationId: "org",
    expectedClerkActorId: "actor",
    idempotencyKey: "retained-uuid",
  };
  assert.equal(verifiedRunConfigurationAck(request, ack), true);
  for (const change of [
    { originalOrganizationId: "other" },
    { expectedClerkActorId: "other" },
    { idempotencyKey: "other" },
    { testRunId: "" },
  ])
    assert.equal(
      verifiedRunConfigurationAck(request, { ...ack, ...change }),
      false,
    );
  assert.equal(
    verifiedRunConfigurationAck(request, { testRunId: ack.testRunId }),
    false,
  );
  assert.equal(verifiedRunConfigurationAck(request, null), false);
});
