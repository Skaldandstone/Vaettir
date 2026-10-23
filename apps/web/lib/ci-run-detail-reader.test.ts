import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { ciRunDetailReadKey } from "@vaettir/api/src/services/ciRunDetailReadSchema";
import {
  admitCiRunDetailAccess,
  admitCiRunDetailPage,
  type CiRunDetailAccessInput,
  type CiRunDetailPageInput,
  type CiRunDetailPage,
} from "./ci-run-detail-reader";
function fixture() {
  const origin = {
      projectId: "p",
      testRunId: "run",
      organizationId: "o",
      clerkActorId: "cl",
      nativeActorId: "n",
    },
    input: CiRunDetailPageInput = {
      projectId: "p",
      testRunId: "run",
      originalOrganizationId: "o",
      expectedClerkActorId: "cl",
      expectedNativeActorId: "n",
      requestId: randomUUID(),
      throughResultId: "result-z",
      limit: 20,
    },
    accessInput: CiRunDetailAccessInput = {
      projectId: "p",
      testRunId: "run",
      originalOrganizationId: "o",
      expectedClerkActorId: "cl",
      requestId: randomUUID(),
    },
    scope = {
      projectId: "p",
      testRunId: "run",
      organizationId: "o",
      actorClerkUserId: "cl",
      actorId: "n",
    },
    access = {
      readContext: {
        requestId: accessInput.requestId,
        requestedKey: ciRunDetailReadKey(accessInput),
        projection: "ACCESS",
        scope,
      },
      throughResultId: "result-z",
      limitations: [],
    },
    page: CiRunDetailPage = {
      readContext: {
        requestId: input.requestId,
        requestedKey: ciRunDetailReadKey(input),
        projection: "PAGE",
        scope,
      },
      header: {
        id: "run",
        projectId: "p",
        ciProvider: "github",
        branch: "",
        commitSha: " ",
        status: "FAILED",
        startedAt: "2026-09-01T00:00:00.000Z",
        finishedAt: null,
      },
      throughResultId: "result-z",
      rows: [
        {
          id: "result-a",
          testRunId: "run",
          testCaseId: "case",
          linkState: "LINKED_CURRENT_CASE",
          linkedCase: {
            id: "case",
            displayId: "CASE-1",
            title: "",
            archived: false,
            reviewStatus: "APPROVED",
            source: null,
            provenance: "CURRENT_CASE_METADATA_NOT_FROZEN_EXECUTION_DEFINITION",
          },
          externalTestId: null,
          externalFilePath: "captured.ts",
          status: "FAIL",
          durationMs: 0,
          errorMessage: "",
          note: " exact\n note ",
          artifacts: [],
          bodyProvenance: "CURRENT_STORED_RESULT_NOT_IMMUTABLE_HISTORY",
        },
      ],
      summary: {
        total: 1,
        pass: 0,
        fail: 1,
        skip: 0,
        flaky: 0,
        blocked: 0,
        other: 0,
      },
      limit: 20,
      hasMore: false,
      nextAfterId: null,
      limitations: ["Current ID window, not immutable history"],
    };
  return { input, accessInput, origin, access, page };
}
it("access admission requires completed exact nonce/native scope, immutable original run ID and no schema dependency", () => {
  const f = fixture(),
    admitted = admitCiRunDetailAccess(f.access, f.accessInput, null);
  expect(admitted!.origin).toEqual(f.origin);
  expect(Object.isFrozen(admitted!.data.readContext.scope)).toBe(true);
  for (const change of [
    { ...f.accessInput, requestId: randomUUID() },
    { ...f.accessInput, testRunId: "other" },
    { ...f.accessInput, expectedNativeActorId: "replacement" },
    { ...f.accessInput, originalOrganizationId: "foreign" },
  ])
    expect(admitCiRunDetailAccess(f.access, change, f.origin)).toBeNull();
  expect(admitCiRunDetailAccess(null, f.accessInput, null)).toBeNull();
  expect(
    admitCiRunDetailAccess({ ...f.access, unknown: true }, f.accessInput, null),
  ).toBeNull();
});
it("exact blank/NULL/zero strings survive immutable admission without coalescing or altering caller-owned raw data", () => {
  const f = fixture(),
    admitted = admitCiRunDetailPage(f.page, f.input, f.origin)!;
  expect(admitted.rows[0]!.linkedCase!.title).toBe("");
  expect(admitted.rows[0]!.externalTestId).toBeNull();
  expect(admitted.rows[0]!.durationMs).toBe(0);
  expect(admitted.rows[0]!.errorMessage).toBe("");
  expect(admitted.rows[0]!.note).toBe(" exact\n note ");
  expect(admitted.header.commitSha).toBe(" ");
  expect(Object.isFrozen(admitted.rows[0]!.linkedCase)).toBe(true);
  f.page.rows[0]!.note = "changed externally";
  expect(admitted.rows[0]!.note).toBe(" exact\n note ");
});
it.each([
  "nonce",
  "key",
  "scope",
  "window",
  "limit",
  "cursor",
  "NULL",
  "unknown",
  "manual",
  "count",
])("%s mismatch refuses entire page, no partial replacement", (kind) => {
  const f = fixture();
  if (kind === "nonce") f.page.readContext.requestId = randomUUID();
  if (kind === "key") f.page.readContext.requestedKey = "other";
  if (kind === "scope") f.page.readContext.scope.testRunId = "foreign";
  if (kind === "window") f.page.throughResultId = "result-y";
  if (kind === "limit") f.page.limit = 19;
  if (kind === "cursor") {
    f.input.afterId = "result-a";
    f.page.readContext.requestedKey = ciRunDetailReadKey(f.input);
  }
  if (kind === "manual") f.page.header.ciProvider = "manual";
  if (kind === "count") f.page.summary.total = 0;
  const raw =
    kind === "NULL"
      ? null
      : kind === "unknown"
        ? { ...f.page, privateExtra: {} }
        : f.page;
  expect(admitCiRunDetailPage(raw, f.input, f.origin)).toBeNull();
});
it("combined serialized DTO oversize refuses, including JSON quote/control expansion without clipping", () => {
  const f = fixture();
  f.page.rows = Array.from({ length: 5 }, (_, index) => ({
    ...f.page.rows[0]!,
    id: `result-${index}`,
    note: "\u0001".repeat(20000),
  }));
  f.page.summary.total = 5;
  f.page.summary.fail = 5;
  expect(admitCiRunDetailPage(f.page, f.input, f.origin)).toBeNull();
  expect(f.page.rows).toHaveLength(5);
  expect(f.page.rows[0]!.note).toHaveLength(20000);
});
it("actual native NULL linkage is unmatched, blank linked title never is", () => {
  const f = fixture();
  f.page.rows[0]!.testCaseId = null;
  f.page.rows[0]!.linkedCase = null;
  f.page.rows[0]!.linkState = "UNMATCHED";
  expect(
    admitCiRunDetailPage(f.page, f.input, f.origin)!.rows[0]!.linkState,
  ).toBe("UNMATCHED");
  f.page.rows[0]!.testCaseId = "case";
  expect(admitCiRunDetailPage(f.page, f.input, f.origin)).toBeNull();
});
