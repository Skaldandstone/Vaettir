// MODELED transaction snapshots/lock waits only. No PostgreSQL, native runtime,
// providers or integration acceptance. The actual service is invoked unchanged;
// an explicitly forced historical RR model demonstrates each previous failure.
import { randomUUID } from "node:crypto";
import { Prisma } from "@vaettir/db";
import { describe, expect, it, vi } from "vitest";
import { recordReviewedStep, reviewedStepRequestHash } from "./manualStepExecutionReview.js";
import type { ReviewedStepAck, ReviewedStepWriteInput } from "./manualStepExecutionReviewSchema.js";
import { qualityProfileHash } from "./qualityExperienceProfile.js";

type Scenario = "same-uuid" | "different-uuid" | "legacy-first";
type Isolation = "ReadCommitted" | "RepeatableRead";
function modeledWait(scenario: Scenario, forceHistoricalRepeatableRead = false) {
  const actor = { id: "synthetic-native", clerkUserId: "synthetic-clerk" };
  const scope = { projectId: "synthetic-project", organizationId: "synthetic-org", actorId: actor.id, actorClerkUserId: actor.clerkUserId };
  const steps = [0, 1].map(order => ({ order, action: ` exact action ${order} `, expectedActionOrData: "", expectedResult: null, expectedResponse: " raw\nresponse ", mediaAttachmentIds: [] }));
  const definition = { testCaseId: "synthetic-case", title: " Frozen ", validationDomain: "SOFTWARE", reviewStatus: "APPROVED", background: null, given: [""], when: [], then: [], verificationProfile: { setup: "", safety: "", instruments: "", acceptanceCriteria: "" }, steps };
  const run = { id: "synthetic-run", projectId: scope.projectId, manualTestCaseIds: [definition.testCaseId], manualPrerequisites: { [definition.testCaseId]: [] }, executionContext: { version: 1, caseDefinitions: [definition] } };
  const input: ReviewedStepWriteInput = {
    projectId: scope.projectId, testRunId: run.id, testCaseId: definition.testCaseId, stepIndex: 0,
    originalOrganizationId: scope.organizationId, expectedClerkActorId: actor.clerkUserId, expectedNativeActorId: actor.id,
    expectedProcedureHash: qualityProfileHash({ definition, graph: run.manualPrerequisites, orderedCaseIds: run.manualTestCaseIds }),
    expectedCurrentFingerprint: qualityProfileHash({ head: null, revision: null }), expectedRevisionId: null,
    status: "PASS", note: " exact\nnew note ", observations: { specimen: "", hardwareRevision: "", firmwareVersion: "", environment: " raw\nbench ", measurements: [] },
    evidenceAttachmentIds: [], correctionReason: null, idempotencyKey: randomUUID(), confirmed: true,
  };
  const accepted: ReviewedStepAck = {
    projectId: scope.projectId, testRunId: run.id, testCaseId: input.testCaseId, stepIndex: 0, scope,
    idempotencyKey: input.idempotencyKey, requestHash: reviewedStepRequestHash(input), revisionId: "synthetic-accepted-revision",
    caseStatus: null, recovered: false, provenance: "REVIEWED_REQUEST_BOUND_AT_WRITE",
  };
  const oldRevision = {
    id: accepted.revisionId, testRunId: run.id, testCaseId: input.testCaseId, stepIndex: 0, revisionNumber: 1,
    status: "PASS", caseStatusAtRecord: null, note: " original\nnote ", observations: input.observations,
    evidenceAttachmentIds: [], evidenceAttachments: [], actorId: actor.id, actorName: "Synthetic actor",
    recordedAt: new Date("2026-10-05T20:00:00.123Z"), correctionReason: null, previousRevisionId: null,
    idempotencyKey: scenario === "same-uuid" ? input.idempotencyKey : randomUUID(), requestHash: "a".repeat(64),
  };
  const committedHead = { testRunId: run.id, testCaseId: input.testCaseId, stepIndex: 0, currentRevisionId: oldRevision.id, revisionCount: 1, currentPayloadBytes: 2300, currentRevision: oldRevision };
  const events: string[] = [], budgets: Array<{ isolationLevel: string; timeout: number; maxWait: number }> = [];
  let isolation: Isolation = "RepeatableRead", capturedBeforeWait = false, competingCommit = false;
  // Only snapshot visibility is modeled. The parent tuple is intentionally
  // unchanged, matching the real wait hazard. No fabricated native ACK claim.
  const visibleCommit = () => isolation === "ReadCommitted" ? competingCommit : capturedBeforeWait;
  const tx = {
    $executeRaw: vi.fn(async () => { events.push("statement-timeout"); return 0; }),
    project: { findUnique: vi.fn(async () => { events.push("project-discovery-snapshot"); capturedBeforeWait = competingCommit; return { organizationId: scope.organizationId }; }) },
    $queryRaw: vi.fn(async (raw: readonly string[] | { sql: string }, ..._values: unknown[]) => {
      const sql = Array.isArray(raw) ? raw.join("?") : (raw as { sql: string }).sql;
      if (sql.includes('FROM "Organization"')) { events.push("organization-share"); return [{ suspendedAt: null }]; }
      if (sql.includes('FROM "Membership"')) { events.push("membership-share"); return [{ role: "EDITOR", seatType: "FULL" }]; }
      if (sql.includes("pg_advisory_xact_lock")) { events.push(sql.includes("ManualStepExecutionReview/v1") ? "global-actor-uuid-lock" : "project-advisory"); return []; }
      if (sql.includes('FROM "Project"')) { events.push("project-update-lock"); return [{ organizationId: scope.organizationId }]; }
      if (sql.includes('status::text AS status,left')) {
        events.push("run-update-lock-wait");
        // Deterministic modeled interleaving: a competing child transaction
        // commits while this transaction waits; the parent is not updated.
        competingCommit = true;
        events.push("competing-child-commit-before-lock-return");
        return [{ projectId: scope.projectId, status: "RUNNING", provider: "manual" }];
      }
      if (sql.includes('FROM "User"')) { events.push("native-actor-share"); return [{ clerkUserId: actor.clerkUserId }]; }
      if (sql.includes('FROM "AuditLog"')) { events.push("receipt-after-wait"); return [{ count: visibleCommit() && scenario === "same-uuid" ? 1n : 0n, bytes: 100n }]; }
      if (sql.includes('AS "runBytes"')) return [{ runBytes: 1000n, executionBytes: 500n, scopeBytes: 50n, graphBytes: 50n, cases: 1, uniqueCases: 1n, definitions: 1, steps: 2n, maxSteps: 2, graphKeys: 1n, graphEdges: 0n, invalidGraph: false, invalid: false, foreign: false }];
      if (sql.includes(" AS present")) return [{ present: true }];
      if (sql.includes('AS "selectedBytes"')) {
        const hasHead = visibleCommit() && scenario !== "legacy-first";
        return [{ count: hasHead ? 1n : 0n, caseHeads: hasHead ? 1n : 0n, bytes: hasHead ? 2300n : 0n, maxBytes: hasHead ? 2300n : 0n, selectedBytes: hasHead ? 2300n : 0n, invalid: false }];
      }
      if (sql.includes('"executionContext" IS NOT DISTINCT') || sql.includes("observations IS NOT DISTINCT")) return [{ exact: true }];
      if (sql.includes(" AS whole")) { events.push("case-mode-after-wait"); return [{ whole: 0n, results: visibleCommit() && scenario === "legacy-first" ? 1n : 0n, bytes: 0n, unsupported: false }]; }
      if (sql.includes("CASE WHEN octet_length(name)")) return [{ name: "Synthetic actor" }];
      if (sql.includes(" AS bytes")) return [{ bytes: 2300n }];
      throw Error("Unexpected modeled SQL; no database operation occurred");
    }),
    membership: { findUniqueOrThrow: vi.fn(async () => ({ role: "EDITOR", seatType: "FULL" })) },
    auditLog: {
      findFirst: vi.fn(async () => ({ organizationId: scope.organizationId, projectId: accepted.projectId, entityId: accepted.testRunId, metadata: accepted })),
      create: vi.fn(async () => { events.push("new-audit-write"); return {}; }),
    },
    testRun: { findUniqueOrThrow: vi.fn(async () => run) },
    manualStepResultRevision: {
      count: vi.fn(async () => 0), findFirst: vi.fn(async () => ({ id: accepted.revisionId })),
      create: vi.fn(async (arg: { data: { revisionNumber: number } }) => {
        events.push("new-revision-attempt");
        if (competingCommit && scenario !== "legacy-first" && arg.data.revisionNumber === 1)
          throw new Prisma.PrismaClientKnownRequestError("Modeled duplicate committed revision", { code: "P2002", clientVersion: "modeled-not-native", meta: { modelName: "ManualStepResultRevision", target: ["testRunId", "testCaseId", "stepIndex", "revisionNumber"] } });
        return { id: "synthetic-new-revision", revisionNumber: arg.data.revisionNumber };
      }),
    },
    manualStepResultHead: {
      findMany: vi.fn(async () => visibleCommit() && scenario !== "legacy-first" ? [committedHead] : []),
      create: vi.fn(async () => { events.push("new-step-head-write"); return {}; }), update: vi.fn(),
    },
    testResult: { findFirst: vi.fn(async () => visibleCommit() && scenario === "legacy-first" ? { id: "synthetic-legacy-result", status: "PASS" } : null), findMany: vi.fn(async () => []), count: vi.fn(async () => 0), create: vi.fn(), update: vi.fn() },
    testCaseAttachment: { findMany: vi.fn(() => { throw Error("Original empty evidence selection changed"); }) },
  };
  const db = {
    $transaction: vi.fn(async (work: (transaction: typeof tx) => unknown, options: (typeof budgets)[number]) => {
      budgets.push(options);
      expect(options).toMatchObject({ isolationLevel: "ReadCommitted" });
      expect(options.timeout + options.maxWait).toBeLessThanOrEqual(20000);
      isolation = forceHistoricalRepeatableRead ? "RepeatableRead" : "ReadCommitted";
      return work(tx);
    }),
  };
  return { actor, input, accepted, events, budgets, tx, db: db as unknown as Parameters<typeof recordReviewedStep>[0] };
}

describe("actual STEP service with explicit modeled stale-lock-wait snapshots (NOT native acceptance)", () => {
  it("same UUID sees the exact committed receipt after wait; historical RR instead attempts a duplicate revision", async () => {
    const h = modeledWait("same-uuid");
    expect(await recordReviewedStep(h.db, h.actor, h.input)).toEqual({ ...h.accepted, recovered: true });
    expect(h.tx.manualStepResultRevision.create).not.toHaveBeenCalled();
    expect(h.tx.auditLog.create).not.toHaveBeenCalled();
    expect(h.tx.testRun.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(h.events.slice(0, 10)).toEqual(["statement-timeout", "project-discovery-snapshot", "organization-share", "membership-share", "project-advisory", "project-update-lock", "native-actor-share", "run-update-lock-wait", "competing-child-commit-before-lock-return", "global-actor-uuid-lock"]);
    const old = modeledWait("same-uuid", true);
    await expect(recordReviewedStep(old.db, old.actor, old.input)).rejects.toMatchObject({ code: "P2002" });
    expect(old.db.$transaction).toHaveBeenCalledTimes(1); // Still NOT retryable.
    expect(old.tx.manualStepResultRevision.create).toHaveBeenCalledTimes(1);
  });
  it("different UUID sees changed head and refuses original CAS; historical RR tries the stale revision number", async () => {
    const h = modeledWait("different-uuid");
    await expect(recordReviewedStep(h.db, h.actor, h.input)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(h.tx.manualStepResultRevision.create).not.toHaveBeenCalled();
    expect(h.tx.auditLog.create).not.toHaveBeenCalled();
    expect(h.db.$transaction).toHaveBeenCalledTimes(1);
    const old = modeledWait("different-uuid", true);
    await expect(recordReviewedStep(old.db, old.actor, old.input)).rejects.toMatchObject({ code: "P2002" });
    expect(old.db.$transaction).toHaveBeenCalledTimes(1);
  });
  it("legacy-first committed result refuses new step mode; historical RR falsely admits the partial head", async () => {
    const h = modeledWait("legacy-first");
    await expect(recordReviewedStep(h.db, h.actor, h.input)).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining("whole-case observations") });
    expect(h.tx.manualStepResultRevision.create).not.toHaveBeenCalled();
    expect(h.tx.manualStepResultHead.create).not.toHaveBeenCalled();
    const old = modeledWait("legacy-first", true);
    expect(await recordReviewedStep(old.db, old.actor, old.input)).toMatchObject({ recovered: false, caseStatus: null });
    expect(old.tx.manualStepResultHead.create).toHaveBeenCalledTimes(1);
    expect(old.tx.auditLog.create).toHaveBeenCalledTimes(1);
  });
  it("a globally held same-UUID receipt from a different run/project is never rebound", async () => {
    const h = modeledWait("same-uuid");
    h.accepted.projectId = "different-original-project";
    h.accepted.testRunId = "different-original-run";
    await expect(recordReviewedStep(h.db, h.actor, h.input)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(h.events).toContain("global-actor-uuid-lock");
    expect(h.tx.manualStepResultRevision.create).not.toHaveBeenCalled();
    expect(h.tx.auditLog.create).not.toHaveBeenCalled();
    expect(h.tx.testRun.findUniqueOrThrow).not.toHaveBeenCalled();
  });
});
