import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import {
  manualRunCurrentReadInput,
  manualRunCurrentReadOutput,
  manualRunCurrentReadKey,
} from "./manualRunCurrentReadSchema.js";
function fixture() {
  const input = {
      projectId: "p",
      testRunId: "run",
      originalOrganizationId: "o",
      expectedClerkActorId: "cl",
      expectedNativeActorId: "n",
      requestId: randomUUID(),
    },
    view = {
      testRunId: "run",
      projectId: "p",
      organizationId: "o",
      originalOrganizationId: "o",
      actorId: "n",
      clerkActorId: "cl",
      canWrite: false,
      readRequestKey:
        '{"testRunId":"run","projectId":"p","originalOrganizationId":"o","expectedClerkActorId":"cl"}',
      plannedCaseIds: [] as string[],
      unavailableCases: [] as Array<{
        testCaseId: string;
        reason: "MISSING_CASE_AND_FROZEN_DEFINITION";
      }>,
      scopeAvailability: {
        plannedCount: 0,
        availableCount: 0,
        unavailableCount: 0,
        complete: true,
        procedureBasis: "LEGACY_CURRENT_CASE_DEFINITIONS",
      },
      status: "RUNNING",
      stepFieldLabels: {},
      executionContext: null,
      datasetBatchRuns: [],
      cases: [],
    },
    output = {
      readContext: {
        requestId: input.requestId,
        requestedKey: manualRunCurrentReadKey(input),
        projection: "CURRENT_WHOLE_MANUAL_RUN_VIEW",
        scope: {
          projectId: "p",
          testRunId: "run",
          organizationId: "o",
          actorId: "n",
          actorClerkUserId: "cl",
        },
      },
      view,
      provenance: {
        procedures: "LEGACY_CURRENT_CASE_DEFINITIONS",
        observations: "CURRENT_SUPPORTED_API_VIEW_NOT_RAW_NATIVE_JSON",
        history: "CURRENT_HEADS_NOT_COMPLETE_REVISION_HISTORY",
        media: "IDENTIFIER_REFERENCES_NO_FILES_FETCHED",
      },
    };
  return { input, output };
}
it("new strict read requires original project/run/org/Clerk/nonce, bootstrap native pin optional only; no legacy input defaults or inferred scope", () => {
  const f = fixture();
  expect(manualRunCurrentReadInput.parse(f.input)).toEqual(f.input);
  for (const key of [
    "projectId",
    "testRunId",
    "originalOrganizationId",
    "expectedClerkActorId",
    "requestId",
  ] as const) {
    const missing = { ...f.input };
    delete (missing as Record<string, unknown>)[key];
    expect(manualRunCurrentReadInput.safeParse(missing).success).toBe(false);
  }
  const { expectedNativeActorId: _native, ...initial } = f.input;
  expect(manualRunCurrentReadInput.parse(initial)).toEqual(initial);
  expect(
    manualRunCurrentReadInput.safeParse({ ...f.input, configuration: {} })
      .success,
  ).toBe(false);
});
it.each(["", "a\0b", "\ud800", "x".repeat(201)])(
  "unsupported current original identity %j refuses without trim or alternate encoding",
  (id) => {
    expect(
      manualRunCurrentReadInput.safeParse({
        ...fixture().input,
        expectedNativeActorId: id,
      }).success,
    ).toBe(false);
  },
);
it("exact echoed whole-view shape preserves old read key/readonly permission and honestly declares current supported projection, not raw JSON/audit/history/files", () => {
  const f = fixture(),
    result = manualRunCurrentReadOutput.parse(f.output);
  expect(result.view).toEqual(f.output.view);
  expect(result.readContext.requestedKey).toBe(
    manualRunCurrentReadKey(f.input),
  );
  expect(result.view.canWrite).toBe(false);
  expect(result.provenance.observations).toBe(
    "CURRENT_SUPPORTED_API_VIEW_NOT_RAW_NATIVE_JSON",
  );
  expect(result.provenance.history).toBe(
    "CURRENT_HEADS_NOT_COMPLETE_REVISION_HISTORY",
  );
  expect(result.provenance.media).toBe(
    "IDENTIFIER_REFERENCES_NO_FILES_FETCHED",
  );
  expect(
    manualRunCurrentReadOutput.safeParse({ ...f.output, history: [] }).success,
  ).toBe(false);
});
it("scoped unavailable identity remains a supported readonly response rather than fabricated zero or an empty executable case", () => {
  const f = fixture();
  f.output.view.plannedCaseIds = ["missing"];
  f.output.view.unavailableCases = [
    { testCaseId: "missing", reason: "MISSING_CASE_AND_FROZEN_DEFINITION" },
  ];
  Object.assign(f.output.view.scopeAvailability, {
    plannedCount: 1,
    unavailableCount: 1,
    complete: false,
  });
  const result = manualRunCurrentReadOutput.parse(f.output);
  expect(result.view.cases).toEqual([]);
  expect(result.view.plannedCaseIds).toEqual(["missing"]);
  expect(result.view.scopeAvailability.unavailableCount).toBe(1);
});
it.each([
  "project",
  "run",
  "actor",
  "org",
  "Clerk",
  "basis",
  "partition",
  "count",
  "complete",
])(
  "%s scope/provenance/partition disagreement refuses the entire new DTO",
  (kind) => {
    const f = fixture();
    if (kind === "project") f.output.readContext.scope.projectId = "other";
    if (kind === "run") f.output.view.testRunId = "other";
    if (kind === "actor") f.output.view.actorId = "replacement";
    if (kind === "org") f.output.view.originalOrganizationId = "other";
    if (kind === "Clerk") f.output.view.clerkActorId = "other";
    if (kind === "basis")
      f.output.provenance.procedures = "FROZEN_RUN_DEFINITIONS";
    if (kind === "partition") f.output.view.plannedCaseIds = ["dropped"];
    if (kind === "count") f.output.view.scopeAvailability.plannedCount = 1;
    if (kind === "complete") f.output.view.scopeAvailability.complete = false;
    expect(manualRunCurrentReadOutput.safeParse(f.output).success).toBe(false);
  },
);
it("new current request key binds original actor/run/native/tenant/nonce while absent native bootstrap pin remains absent", () => {
  const f = fixture(),
    key = manualRunCurrentReadKey(f.input);
  for (const changed of [
    { ...f.input, requestId: randomUUID() },
    { ...f.input, testRunId: "other" },
    { ...f.input, expectedNativeActorId: "other" },
    { ...f.input, originalOrganizationId: "other" },
    { ...f.input, expectedClerkActorId: "other" },
  ])
    expect(manualRunCurrentReadKey(changed)).not.toBe(key);
  const { expectedNativeActorId: _native, ...initial } = f.input;
  expect(manualRunCurrentReadKey(initial)).not.toContain(
    "expectedNativeActorId",
  );
});
