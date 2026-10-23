import { expect, it } from "vitest";
import { runHistoryReadKey } from "@vaettir/api/src/services/runHistoryReadSchema";
import {
  admitRunHistoryAccess,
  admitRunHistoryPage,
  freezeRunHistory,
  runHistoryPageFingerprint,
  type RunHistoryOrigin,
  type RunHistoryPage,
  type RunHistoryPageData,
  type RunHistoryReadSnapshot,
} from "./run-history-reader";
export const runFixtureOrigin: RunHistoryOrigin = {
  projectId: "p",
  organizationId: "o",
  clerkActorId: "cl",
  nativeActorId: "n",
};
export function runFixtureInput(): RunHistoryPage {
  return {
    projectId: "p",
    originalOrganizationId: "o",
    expectedClerkActorId: "cl",
    expectedNativeActorId: "n",
    requestId: "fd4f8aaf-a6ec-4d25-a193-b9413ec13c25",
    limit: 1,
    asOf: "2026-09-02T00:00:00.000Z",
  };
}
export function runFixturePage(input = runFixtureInput()): RunHistoryPageData {
  return {
    readContext: {
      requestId: input.requestId,
      requestedKey: runHistoryReadKey(input),
      projection: "PAGE",
      scope: {
        projectId: "p",
        organizationId: "o",
        actorId: "n",
        actorClerkUserId: "cl",
      },
      asOf: input.asOf,
    },
    rows: [
      {
        id: "run-b",
        ciProvider: "manual",
        ciRunUrl: "https://example.invalid/private",
        commitSha: "manual",
        branch: "manual",
        status: "RUNNING",
        startedAt: "2026-09-01T00:00:00.000Z",
        finishedAt: null,
        resultCount: 1,
        startedByEmail: "private@example.invalid",
        progress: {
          total: 2,
          recorded: 1,
          remaining: 1,
          percentComplete: 50,
          pass: 1,
          fail: 0,
          blocked: 0,
          skip: 0,
          flaky: 0,
          other: 0,
        },
        progressUnavailableReason: null,
        progressBasis: "PLANNED_IDENTITIES_CURRENT_RESULTS",
      },
    ],
    limit: input.limit,
    hasMore: true,
    nextBefore: { id: "run-b", startedAt: "2026-09-01T00:00:00.000Z" },
    limitations: ["Current bounded page, not globally frozen."],
  };
}
export function runFixtureSnapshot(): RunHistoryReadSnapshot {
  return {
    origin: { ...runFixtureOrigin },
    observedSessionId: "A",
    epoch: 1,
    revision: 1,
    receivedAt: "2026-09-02T00:00:01.000Z",
    page: runFixturePage(),
  };
}
it("current native original bootstrap/page nonce and exact anchor are independently decoded, not implied by cache time", () => {
  const input = runFixtureInput(),
    page = runFixturePage(input);
  expect(admitRunHistoryPage(page, input, runFixtureOrigin)).toEqual(page);
  const { limit: _limit, asOf: _asOf, ...access } = input;
  const data = {
    readContext: {
      requestId: access.requestId,
      requestedKey: runHistoryReadKey(access),
      projection: "ACCESS",
      scope: page.readContext.scope,
      asOf: input.asOf,
    },
  };
  expect(admitRunHistoryAccess(data, access, null)?.origin).toEqual(
    runFixtureOrigin,
  );
  expect(admitRunHistoryPage(data, input, runFixtureOrigin)).toBeNull();
  expect(admitRunHistoryAccess(page, access, null)).toBeNull();
});
it.each([
  "nonce",
  "key",
  "native",
  "org",
  "Clerk",
  "anchor",
  "limit",
  "unknown",
  "null",
  "before",
])(
  "%s mismatch/unsupported payload is withheld without baseline substitution",
  (kind) => {
    const input = runFixtureInput(),
      page = runFixturePage(input);
    if (kind === "nonce")
      page.readContext.requestId = "fd4f8aaf-a6ec-4d25-a193-b9413ec13c26";
    if (kind === "key") page.readContext.requestedKey = "cached-other";
    if (kind === "native") page.readContext.scope.actorId = "other";
    if (kind === "org") page.readContext.scope.organizationId = "other";
    if (kind === "Clerk") page.readContext.scope.actorClerkUserId = "other";
    if (kind === "anchor") page.readContext.asOf = "2026-09-03T00:00:00.000Z";
    if (kind === "limit") page.limit = 2;
    if (kind === "unknown") Object.assign(page, { future: true });
    if (kind === "before")
      input.before = { id: "run-b", startedAt: page.rows[0]!.startedAt };
    expect(
      admitRunHistoryPage(
        kind === "null" ? null : page,
        input,
        runFixtureOrigin,
      ),
    ).toBeNull();
  },
);
it("unavailable progress remains NULL+reason, empty authorized page stays explicitly scoped and nested decoded DTO freezes", () => {
  const input = runFixtureInput(),
    page = runFixturePage(input);
  page.rows[0]!.progress = null;
  page.rows[0]!.progressUnavailableReason = "Retained head mismatch, not zero.";
  const decoded = admitRunHistoryPage(page, input, runFixtureOrigin)!;
  expect(decoded.rows[0]?.progress).toBeNull();
  expect(Object.isFrozen(decoded.rows)).toBe(true);
  expect(Object.isFrozen(decoded.rows[0])).toBe(true);
  expect(() => {
    decoded.rows[0]!.status = "PASS";
  }).toThrow();
  const empty = { ...page, rows: [], hasMore: false, nextBefore: null };
  expect(admitRunHistoryPage(empty, input, runFixtureOrigin)).toEqual(empty);
});
it("fingerprint covers nonce/native/frame/session/anchor/time/native cache revision/data, all frozen values stay exact", () => {
  const first = runFixtureSnapshot(),
    fingerprint = runHistoryPageFingerprint(first);
  for (const change of [
    (v: RunHistoryReadSnapshot) => Object.assign(v, { observedSessionId: "B" }),
    (v: RunHistoryReadSnapshot) => Object.assign(v, { epoch: 2 }),
    (v: RunHistoryReadSnapshot) => Object.assign(v, { revision: 2 }),
    (v: RunHistoryReadSnapshot) => {
      v.page.rows[0]!.branch = "changed";
    },
    (v: RunHistoryReadSnapshot) => {
      v.page.readContext.requestId = "fd4f8aaf-a6ec-4d25-a193-b9413ec13c26";
    },
  ]) {
    const next = structuredClone(first);
    change(next);
    expect(runHistoryPageFingerprint(next)).not.toBe(fingerprint);
  }
  expect(freezeRunHistory(first)).toBe(first);
  expect(Object.isFrozen(first.page.rows[0]!.progress)).toBe(true);
});
