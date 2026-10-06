import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  ciRunDetailAccessInput,
  ciRunDetailPageInput,
  ciRunDetailPageOutput,
  ciRunDetailResult,
  ciRunDetailReadKey,
  ciRunDetailCompareId,
} from "./ciRunDetailReadSchema.js";
function input() {
  return {
    projectId: "p",
    testRunId: "run",
    originalOrganizationId: "o",
    expectedClerkActorId: "cl",
    expectedNativeActorId: "n",
    requestId: randomUUID(),
    throughResultId: "result-z",
    limit: 20,
  };
}
function result() {
  return {
    id: "result-a",
    testRunId: "run",
    testCaseId: "case",
    linkState: "LINKED_CURRENT_CASE",
    linkedCase: {
      id: "case",
      displayId: null,
      title: "",
      archived: false,
      reviewStatus: "APPROVED",
      source: null,
      provenance: "CURRENT_CASE_METADATA_NOT_FROZEN_EXECUTION_DEFINITION",
    },
    externalTestId: null,
    externalFilePath: " reported/file.ts ",
    status: "FAIL",
    durationMs: null,
    errorMessage: "",
    note: " exact\n note ",
    artifacts: [],
    bodyProvenance: "CURRENT_STORED_RESULT_NOT_IMMUTABLE_HISTORY",
  };
}
it("new reader requires independent nonce/original pins and explicit page limit, no inferred defaults", () => {
  const value = input();
  expect(ciRunDetailPageInput.parse(value)).toEqual(value);
  for (const key of [
    "projectId",
    "testRunId",
    "originalOrganizationId",
    "expectedClerkActorId",
    "expectedNativeActorId",
    "requestId",
    "limit",
  ] as const) {
    const absent = { ...value };
    delete (absent as Record<string, unknown>)[key];
    expect(ciRunDetailPageInput.safeParse(absent).success).toBe(false);
  }
  const { throughResultId: _anchor, limit: _limit, ...access } = value;
  expect(ciRunDetailAccessInput.safeParse(access).success).toBe(true);
  delete (access as Record<string, unknown>).expectedNativeActorId;
  expect(ciRunDetailAccessInput.safeParse(access).success).toBe(true);
});
it.each([0, 51, 1.5, NaN])(
  "page limit %s refuses instead of hidden partial reads",
  (limit) => {
    expect(ciRunDetailPageInput.safeParse({ ...input(), limit }).success).toBe(
      false,
    );
  },
);
it.each(["", "a\0b", "\ud800", "x".repeat(201)])(
  "unsupported original/result identity %j fails new read validation",
  (id) => {
    expect(
      ciRunDetailPageInput.safeParse({ ...input(), testRunId: id }).success,
    ).toBe(false);
  },
);
it("ID window cursors respect UTF8 C order, empty windows cannot acquire cursor or a chronological timestamp", () => {
  expect(
    ciRunDetailPageInput.safeParse({ ...input(), throughResultId: null })
      .success,
  ).toBe(true);
  expect(
    ciRunDetailPageInput.safeParse({
      ...input(),
      throughResultId: null,
      afterId: "result-a",
    }).success,
  ).toBe(false);
  expect(
    ciRunDetailPageInput.safeParse({ ...input(), afterId: "result-zz" })
      .success,
  ).toBe(false);
  expect(
    ciRunDetailPageInput.safeParse({ ...input(), startedAt: "2026-09-01" })
      .success,
  ).toBe(false);
  expect(ciRunDetailCompareId("\u{10000}", "\ue000")).toBeGreaterThan(0);
});
it("raw NULL/empty/whitespace note/error and linked blank case title remain distinct, not unmatched or coalesced", () => {
  const row = ciRunDetailResult.parse(result());
  expect(row.errorMessage).toBe("");
  expect(row.note).toBe(" exact\n note ");
  expect(row.linkState).toBe("LINKED_CURRENT_CASE");
  expect(row.linkedCase!.title).toBe("");
  expect(row.linkedCase!.displayId).toBeNull();
  expect(ciRunDetailResult.parse({ ...result(), note: null }).note).toBeNull();
  expect(
    ciRunDetailResult.safeParse({ ...result(), linkState: "UNMATCHED" })
      .success,
  ).toBe(false);
});
it("strict current page DTO rejects unknown bodies, identity mismatch or inconsistent counts", () => {
  const value = input(),
    page = {
      readContext: {
        requestId: value.requestId,
        requestedKey: ciRunDetailReadKey(value),
        projection: "PAGE",
        scope: {
          projectId: "p",
          testRunId: "run",
          organizationId: "o",
          actorId: "n",
          actorClerkUserId: "cl",
        },
      },
      header: {
        id: "run",
        projectId: "p",
        ciProvider: "github",
        branch: "",
        commitSha: "",
        status: "FAILED",
        startedAt: "2026-09-01T00:00:00.000Z",
        finishedAt: null,
      },
      throughResultId: value.throughResultId,
      rows: [result()],
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
      limitations: [],
    };
  expect(ciRunDetailPageOutput.safeParse(page).success).toBe(true);
  for (const changed of [
    { ...page, observations: {} },
    { ...page, summary: { ...page.summary, total: 0 } },
    { ...page, throughResultId: null },
    { ...page, throughResultId: "result-0" },
    {
      ...page,
      summary: { ...page.summary, total: 2, fail: 2 },
      rows: [{ ...result(), id: "result-b" }, result()],
    },
    { ...page, header: { ...page.header, ciProvider: "manual" } },
    {
      ...page,
      header: { ...page.header, startedAt: "2026-09-01T00:00:00.123456Z" },
    },
  ])
    expect(ciRunDetailPageOutput.safeParse(changed).success).toBe(false);
});
it("native integer duration is exact including retained negative values, no float/NULL substitution", () => {
  expect(
    ciRunDetailResult.parse({ ...result(), durationMs: -1 }).durationMs,
  ).toBe(-1);
  expect(
    ciRunDetailResult.safeParse({ ...result(), durationMs: 0.1 }).success,
  ).toBe(false);
  expect(
    ciRunDetailResult.safeParse({ ...result(), durationMs: 2147483648 })
      .success,
  ).toBe(false);
});
it("read key binds original actor/run/window/limit/cursor and preserves supported whitespace", () => {
  const value = input(),
    key = ciRunDetailReadKey(value);
  for (const changed of [
    { ...value, testRunId: "other" },
    { ...value, requestId: randomUUID() },
    { ...value, originalOrganizationId: "other" },
    { ...value, limit: 1 },
    { ...value, throughResultId: null },
    { ...value, afterId: "result-a" },
  ])
    expect(ciRunDetailReadKey(changed)).not.toBe(key);
  expect(ciRunDetailReadKey({ ...value, testRunId: " run " })).toContain(
    " run ",
  );
});
