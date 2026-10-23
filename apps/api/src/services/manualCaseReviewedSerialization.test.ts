// MODELED snapshots/lock waits only, not PostgreSQL or native acceptance.
// Both the actual recorder and its actual namespace/access helper execute.
// Historical RR is forced only at the synthetic transaction boundary.
import { randomUUID } from "node:crypto";
import { Prisma } from "@vaettir/db";
import { describe, expect, it, vi } from "vitest";
import { recordReviewedManualCaseResult, manualCaseReviewedRequestHash } from "./manualCaseResultsReviewed.js";
import type { ManualCaseReviewedExactWrite } from "./manualCaseResultSchema.js";
import { qualityProfileHash } from "./qualityExperienceProfile.js";

type Scenario = "same-uuid" | "different-uuid" | "partial-step";
type Isolation = "ReadCommitted" | "RepeatableRead";
function modeledWait(scenario: Scenario, forceHistoricalRepeatableRead = false) {
  const actor = { id: "synthetic-native", clerkUserId: "synthetic-clerk" };
  const scope = { projectId: "synthetic-project", organizationId: "synthetic-org", actorId: actor.id, clerkActorId: actor.clerkUserId };
  const definition = {
    testCaseId: "synthetic-case", title: " Frozen\nprocedure ", validationDomain: "SOFTWARE", reviewStatus: "APPROVED",
    background: null, given: [""], when: [], then: [],
    verificationProfile: { setup: "", safety: "", instruments: "", acceptanceCriteria: "" },
    steps: [{ order: 0, action: " raw\naction ", expectedActionOrData: "", expectedResult: null, expectedResponse: " raw\nresponse ", mediaAttachmentIds: [] }],
  };
  const run = { id: "synthetic-run", manualTestCaseIds: [definition.testCaseId], manualPrerequisites: { [definition.testCaseId]: [] }, executionContext: { version: 1, caseDefinitions: [definition] } };
  const input: ManualCaseReviewedExactWrite = {
    mode: "EXACT", projectId: scope.projectId, testRunId: run.id, testCaseId: definition.testCaseId,
    expectedScope: { projectId: scope.projectId, organizationId: scope.organizationId, clerkActorId: actor.clerkUserId },
    expectedNativeActorId: actor.id,
    expectedFrozenEvidenceHash: qualityProfileHash({ executionContext: run.executionContext, manualPrerequisites: run.manualPrerequisites, manualTestCaseIds: run.manualTestCaseIds }),
    expectedRevisionId: null,
    expectedCurrentFingerprint: qualityProfileHash({ projectId: scope.projectId, testRunId: run.id, testCaseId: definition.testCaseId, result: null, head: null }),
    status: "FAIL", note: " exact\nreviewed note ", observations: { environment: "", measurements: [] }, correctionReason: null, idempotencyKey: randomUUID(),
  };
  const receipt = {
    id: "synthetic-accepted-revision", projectId: scope.projectId, testRunId: run.id, testCaseId: definition.testCaseId,
    testResultId: "synthetic-result", revisionNumber: 1, actorClerkUserId: actor.clerkUserId,
    requestHash: manualCaseReviewedRequestHash(input),
  };
  const committedResult = { id: receipt.testResultId, status: "FAIL", note: " exact\nold note ", observations: { environment: "", measurements: [] } };
  const committedHead = { organizationId: scope.organizationId, projectId: scope.projectId, testResultId: receipt.testResultId, currentRevisionId: receipt.id, revisionCount: 1, currentPayloadBytes: 3000 };
  const events: string[] = [], budgets: Array<{ isolationLevel: Isolation; timeout: number }> = [];
  const currentAuthority = { role: "EDITOR", seatType: "FULL", suspendedAt: null as Date | null, clerkUserId: actor.clerkUserId };
  let isolation: Isolation = "RepeatableRead", capturedBeforeWait = false, competingCommit = false;
  const visibleCommit = () => isolation === "ReadCommitted" ? competingCommit : capturedBeforeWait;
  const visibleWholeCase = () => visibleCommit() && scenario !== "partial-step";
  const tx = {
    $executeRaw: vi.fn(async () => { events.push("statement-timeout"); return 0; }),
    project: { findUnique: vi.fn(async () => { events.push("identity-discovery-snapshot"); capturedBeforeWait = competingCommit; return { organizationId: scope.organizationId }; }) },
    $queryRaw: vi.fn(async (raw: readonly string[] | { sql: string }, ..._values: unknown[]) => {
      const sql = Array.isArray(raw) ? raw.join("?") : (raw as { sql: string }).sql;
      if (sql.includes('FROM "Organization"')) { events.push("organization-share"); return [{ suspendedAt: currentAuthority.suspendedAt }]; }
      if (sql.includes('FROM "Membership"')) { events.push("membership-share"); return [{ role: currentAuthority.role, seatType: currentAuthority.seatType }]; }
      if (sql.includes("pg_advisory_xact_lock")) {
        events.push("project-advisory-wait");
        // A conforming predecessor commits child evidence before the common
        // namespace lock returns. The parent row itself remains unchanged.
        competingCommit = true;
        events.push("competing-child-commit-before-lock-return");
        return [];
      }
      if (sql.includes('FROM "Project"')) { events.push("project-update-lock"); return [{ organizationId: scope.organizationId }]; }
      if (sql.includes('FROM "User"')) { events.push("native-actor-share"); return [{ clerkUserId: currentAuthority.clerkUserId }]; }
      if (sql.includes("AS planned")) { events.push("run-update-lock"); return [{ projectId: scope.projectId, provider: "manual", status: "RUNNING", planned: true }]; }
      if (sql.includes('AS "runBytes"')) return [{ count: 1, unique: 1, idsBytes: 100n, graphBytes: 100n, runBytes: 3000n, foreign: 0, invalid: 0 }];
      if (sql.includes('"executionContext" IS NOT DISTINCT') || sql.includes("observations IS NOT DISTINCT") || sql.includes('v."testResultId"=r.id')) return [{ exact: true }];
      if (sql.includes('SELECT "displayId"')) return [{ displayId: "TC-1" }];
      if (sql.includes('"ManualCaseResultRevision"') && !sql.includes('"ManualCaseResultHead"') && sql.includes("AS count"))
        return [{ count: visibleWholeCase() ? 1 : 0, bytes: visibleWholeCase() ? 3000n : 0n }];
      if (sql.includes('"ManualCaseResultHead"')) return [{ count: visibleWholeCase() ? 1 : 0, bytes: visibleWholeCase() ? 3000n : 0n, foreign: 0, invalid: 0 }];
      if (sql.includes('count(DISTINCT r."testCaseId")')) return [{ count: visibleWholeCase() ? 1 : 0, unique: visibleWholeCase() ? 1 : 0, bytes: visibleWholeCase() ? 1000n : 0n, maxBytes: visibleWholeCase() ? 1000n : 0n, foreign: 0 }];
      if (sql.includes('FROM "TestResult" r')) return [{ count: visibleWholeCase() ? 1 : 0, bytes: visibleWholeCase() ? 1000n : 0n }];
      if (sql.includes("SELECT (octet_length(concat(")) return [{ bytes: 3000n }];
      throw Error("Unexpected modeled SQL; no database operation occurred");
    }),
    membership: { findUniqueOrThrow: vi.fn(async () => ({ role: currentAuthority.role, seatType: currentAuthority.seatType })) },
    manualCaseResultRevision: {
      findUnique: vi.fn(async () => { events.push("receipt-after-namespace-wait"); return visibleCommit() && scenario === "same-uuid" ? receipt : null; }),
      create: vi.fn(async () => {
        events.push("new-revision-attempt");
        if (competingCommit && scenario !== "partial-step")
          throw new Prisma.PrismaClientKnownRequestError("Modeled duplicate committed revision", { code: "P2002", clientVersion: "modeled-not-native", meta: { modelName: "ManualCaseResultRevision", target: ["testRunId", "testCaseId", "revisionNumber"] } });
        // This boundary deliberately does not simulate native mixed-mode SQL
        // guards. Reaching it under old RR is evidence of stale admission only.
        throw Error("Modeled stale mode reached write boundary; native outcome is not simulated");
      }),
    },
    manualCaseResultHead: {
      findUnique: vi.fn(async () => { events.push("current-head-after-wait"); return visibleWholeCase() ? committedHead : null; }),
      create: vi.fn(), update: vi.fn(),
    },
    manualStepResultHead: { count: vi.fn(async () => { events.push("case-mode-after-wait"); return visibleCommit() && scenario === "partial-step" ? 1 : 0; }) },
    testRun: { findUniqueOrThrow: vi.fn(async () => { events.push("private-run-body"); return run; }) },
    testResult: {
      findFirst: vi.fn(async () => visibleWholeCase() ? committedResult : null), count: vi.fn(async () => 0), update: vi.fn(),
      create: vi.fn(async () => {
        events.push("new-result-attempt");
        return { id: "synthetic-new-result" };
      }),
    },
    user: { findUniqueOrThrow: vi.fn(async () => ({ name: "Synthetic member" })) },
  };
  const db = {
    $transaction: vi.fn(async (work: (transaction: typeof tx) => unknown, options: (typeof budgets)[number]) => {
      budgets.push(options);
      expect(options).toEqual({ isolationLevel: "ReadCommitted", timeout: 20000 });
      isolation = forceHistoricalRepeatableRead ? "RepeatableRead" : options.isolationLevel;
      return work(tx);
    }),
  };
  return { actor, input, scope, receipt, events, budgets, currentAuthority, tx, db: db as unknown as Parameters<typeof recordReviewedManualCaseResult>[0] };
}

describe("actual whole-case recorder/access with modeled stale namespace waits (NOT native acceptance)", () => {
  it("same UUID recovers the exact committed receipt after wait; historical RR misses it and attempts duplicate revision", async () => {
    const h = modeledWait("same-uuid"), retained = structuredClone(h.input);
    expect(await recordReviewedManualCaseResult(h.db, h.actor, h.input)).toEqual({ scope: h.scope, testRunId: h.input.testRunId, testCaseId: h.input.testCaseId, resultId: h.receipt.testResultId, revisionId: h.receipt.id, revisionNumber: 1, idempotencyKey: h.input.idempotencyKey, requestHash: h.receipt.requestHash, recovered: true, mode: "EXACT" });
    expect(h.events).toEqual(["statement-timeout", "identity-discovery-snapshot", "organization-share", "membership-share", "project-advisory-wait", "competing-child-commit-before-lock-return", "project-update-lock", "native-actor-share", "receipt-after-namespace-wait"]);
    expect(h.tx.testRun.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(h.tx.testResult.create).not.toHaveBeenCalled();
    expect(h.tx.manualCaseResultRevision.create).not.toHaveBeenCalled();
    expect(h.input).toEqual(retained);
    expect(h.db.$transaction).toHaveBeenCalledTimes(1);
    expect(h.tx.manualCaseResultRevision.findUnique.mock.calls[0]).toEqual([{ where: { organizationId_actorId_idempotencyKey: { organizationId: h.scope.organizationId, actorId: h.actor.id, idempotencyKey: h.input.idempotencyKey } }, select: { id: true, projectId: true, testRunId: true, testCaseId: true, testResultId: true, revisionNumber: true, requestHash: true, actorClerkUserId: true } }]);
    const old = modeledWait("same-uuid", true);
    await expect(recordReviewedManualCaseResult(old.db, old.actor, old.input)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(old.tx.testResult.create).toHaveBeenCalledTimes(1);
    expect(old.tx.manualCaseResultRevision.create).toHaveBeenCalledTimes(1);
    expect(old.db.$transaction).toHaveBeenCalledTimes(1);
  });
  it("different UUID sees changed head and refuses original CAS; historical RR attempts stale revision creation", async () => {
    const h = modeledWait("different-uuid");
    await expect(recordReviewedManualCaseResult(h.db, h.actor, h.input)).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining("current observation changed") });
    expect(h.events).toContain("current-head-after-wait");
    expect(h.tx.testResult.create).not.toHaveBeenCalled();
    expect(h.tx.manualCaseResultRevision.create).not.toHaveBeenCalled();
    const old = modeledWait("different-uuid", true);
    await expect(recordReviewedManualCaseResult(old.db, old.actor, old.input)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(old.tx.testResult.create).toHaveBeenCalledTimes(1);
    expect(old.tx.manualCaseResultRevision.create).toHaveBeenCalledTimes(1);
    expect(old.db.$transaction).toHaveBeenCalledTimes(1);
  });
  it("committed partial STEP head refuses whole-case mode; historical RR reaches a stale write boundary", async () => {
    const h = modeledWait("partial-step");
    await expect(recordReviewedManualCaseResult(h.db, h.actor, h.input)).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining("immutable steps") });
    expect(h.tx.testRun.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(h.tx.testResult.create).not.toHaveBeenCalled();
    expect(h.tx.manualCaseResultRevision.create).not.toHaveBeenCalled();
    const old = modeledWait("partial-step", true);
    await expect(recordReviewedManualCaseResult(old.db, old.actor, old.input)).rejects.toThrow("Modeled stale mode reached write boundary");
    expect(old.tx.testResult.create).toHaveBeenCalledTimes(1);
    expect(old.tx.manualCaseResultRevision.create).toHaveBeenCalledTimes(1);
    expect(old.db.$transaction).toHaveBeenCalledTimes(1);
  });
  it.each(["project", "Clerk actor"])("an original UUID receipt with foreign %s is never rebound", async kind => {
    const h = modeledWait("same-uuid");
    if (kind === "project") h.receipt.projectId = "different-original-project";
    else h.receipt.actorClerkUserId = "different-original-clerk";
    await expect(recordReviewedManualCaseResult(h.db, h.actor, h.input)).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining("different original observation") });
    expect(h.tx.testRun.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(h.tx.testResult.create).not.toHaveBeenCalled();
    expect(h.tx.manualCaseResultRevision.create).not.toHaveBeenCalled();
    expect(h.db.$transaction).toHaveBeenCalledTimes(1);
  });
  it.each(["role", "seat", "suspension", "Clerk", "native pin"])("current %s refusal precedes accepted receipt recovery", async kind => {
    const h = modeledWait("same-uuid");
    if (kind === "role") h.currentAuthority.role = "VIEWER";
    else if (kind === "seat") h.currentAuthority.seatType = "READ_ONLY";
    else if (kind === "suspension") h.currentAuthority.suspendedAt = new Date(0);
    else if (kind === "Clerk") h.currentAuthority.clerkUserId = "remapped-native-clerk";
    else h.input.expectedNativeActorId = "different-original-native";
    await expect(recordReviewedManualCaseResult(h.db, h.actor, h.input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(h.tx.manualCaseResultRevision.findUnique).not.toHaveBeenCalled();
    expect(h.tx.testRun.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(h.tx.testResult.create).not.toHaveBeenCalled();
    expect(h.db.$transaction).toHaveBeenCalledTimes(1);
  });
});
