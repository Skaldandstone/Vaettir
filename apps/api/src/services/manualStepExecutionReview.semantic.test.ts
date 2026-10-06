import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@vaettir/db";
import { TRPCError } from "@trpc/server";
import type { ReviewedStepWriteInput } from "./manualStepExecutionReviewSchema.js";
const lock = vi.hoisted(() => vi.fn());
vi.mock("./manualRetestScope.js", () => ({ lockManualRetestAccess: lock }));
import {
  previewReviewedStep,
  recordReviewedStep,
  reviewedStepRequestHash,
} from "./manualStepExecutionReview.js";
import { qualityProfileHash } from "./qualityExperienceProfile.js";

const actor = { id: "native", clerkUserId: "clerk" };
const scope = {
  projectId: "project",
  organizationId: "org",
  actorId: actor.id,
  actorClerkUserId: actor.clerkUserId,
};
const observations = {
  specimen: "",
  hardwareRevision: "",
  firmwareVersion: "",
  environment: "",
  measurements: [],
};
function fixture() {
  const definition = {
    testCaseId: "case",
    title: "Frozen",
    validationDomain: "SOFTWARE",
    reviewStatus: "APPROVED",
    background: null,
    given: [],
    when: [],
    then: [],
    verificationProfile: {
      setup: "",
      safety: "",
      instruments: "",
      acceptanceCriteria: "",
    },
    steps: [0, 1].map((order) => ({
      order,
      action: `Exact ${order}`,
      expectedActionOrData: " GET /fixture ",
      expectedResult: "",
      expectedResponse: null,
      mediaAttachmentIds: [],
    })),
  };
  const run = {
    id: "run",
    projectId: "project",
    manualTestCaseIds: ["case"],
    manualPrerequisites: { case: [] as string[] },
    executionContext: { version: 1, caseDefinitions: [definition] },
  };
  const input: ReviewedStepWriteInput = {
    projectId: "project",
    testRunId: "run",
    testCaseId: "case",
    stepIndex: 0,
    originalOrganizationId: "org",
    expectedClerkActorId: actor.clerkUserId,
    expectedNativeActorId: actor.id,
    expectedProcedureHash: qualityProfileHash({
      definition,
      graph: run.manualPrerequisites,
      orderedCaseIds: run.manualTestCaseIds,
    }),
    expectedCurrentFingerprint: qualityProfileHash({
      head: null,
      revision: null,
    }),
    expectedRevisionId: null,
    status: "PASS",
    note: " raw \nprose ",
    observations,
    evidenceAttachmentIds: [],
    correctionReason: null,
    idempotencyKey: randomUUID(),
    confirmed: true,
  };
  const size = {
    runBytes: 1000n,
    executionBytes: 500n,
    scopeBytes: 50n,
    graphBytes: 50n,
    graphKeys: 1n,
    graphEdges: 0n,
    invalidGraph: false,
    cases: 1,
    uniqueCases: 1n,
    definitions: 1,
    steps: 2n,
    maxSteps: 2,
    invalid: false,
    foreign: false,
    emptyLegacySnapshot: false,
  };
  const headSize = {
    count: 0n,
    caseHeads: 0n,
    bytes: 0n,
    maxBytes: 0n,
    selectedBytes: 0n,
    invalid: false,
  };
  const mode = { whole: 0n, results: 0n, bytes: 50n, unsupported: false };
  const fileSize = { count: 1n, bytes: 100n, maxBytes: 100n, invalid: false };
  const flags = {
    status: "RUNNING",
    provider: "manual",
    present: true,
    exact: true,
    revisionExact: true,
    receipt: null as unknown,
    receiptCount: 0n,
  };
  const heads = [] as ReturnType<typeof storedHead>[];
  const prerequisites = [] as { testCaseId: string; status: string }[];
  const writes = vi.fn();
  const tx = {
    $queryRaw: vi.fn(async (raw: readonly string[] | { sql: string }) => {
      const sql = Array.isArray(raw)
        ? raw.join("?")
        : (raw as { sql: string }).sql;
      if (sql.includes("status::text AS status,left"))
        return [
          {
            projectId: "project",
            status: flags.status,
            provider: flags.provider,
          },
        ];
      if (sql.includes("pg_advisory_xact_lock")) return [];
      if (sql.includes('FROM "AuditLog"'))
        return [{ count: flags.receiptCount, bytes: 100n }];
      if (sql.includes('AS "runBytes"')) return [size];
      if (sql.includes(" AS present")) return [{ present: flags.present }];
      if (sql.includes('AS "selectedBytes"')) return [headSize];
      if (sql.includes('"executionContext" IS NOT DISTINCT'))
        return [{ exact: flags.exact }];
      if (sql.includes("observations IS NOT DISTINCT"))
        return [{ exact: flags.revisionExact }];
      if (sql.includes(" AS whole")) return [mode];
      if (sql.includes('FROM "TestCaseAttachment" a JOIN')) return [fileSize];
      if (sql.includes("CASE WHEN octet_length(name)"))
        return [{ name: "Synthetic author" }];
      if (sql.includes(" AS bytes")) return [{ bytes: 2300n }];
      if (sql.includes("set_config")) {
        writes();
        return [];
      }
      throw Error("Unexpected mocked SQL");
    }),
    membership: {
      findUniqueOrThrow: vi.fn(async () => ({
        role: "EDITOR",
        seatType: "FULL",
      })),
    },
    auditLog: { findFirst: vi.fn(async () => flags.receipt), create: writes },
    testRun: { findUniqueOrThrow: vi.fn(async () => run) },
    manualStepResultRevision: {
      count: vi.fn(async () => 0),
      findFirst: vi.fn(async () => ({ id: "accepted" })),
      create: vi.fn(async () => {
        writes();
        return { id: "new", revisionNumber: 1 };
      }),
    },
    manualStepResultHead: {
      findMany: vi.fn(async () => heads),
      create: writes,
      update: writes,
    },
    testResult: {
      findMany: vi.fn(async () => prerequisites),
      findFirst: vi.fn(async () => null),
      count: vi.fn(async () => 0),
      create: writes,
      update: writes,
    },
    testCaseAttachment: { findMany: vi.fn(async () => []) },
  };
  const db = {
    $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
  } as unknown as PrismaClient;
  lock.mockResolvedValue({
    projectId: "project",
    organizationId: "org",
    actorId: actor.id,
    clerkActorId: actor.clerkUserId,
  });
  return {
    db,
    tx,
    input,
    run,
    size,
    headSize,
    mode,
    fileSize,
    flags,
    heads,
    prerequisites,
    writes,
  };
}
function storedHead(count = 1) {
  return {
    testRunId: "run",
    testCaseId: "case",
    stepIndex: 0,
    currentRevisionId: "old",
    revisionCount: count,
    currentPayloadBytes: 2500,
    currentRevision: {
      id: "old",
      testRunId: "run",
      testCaseId: "case",
      stepIndex: 0,
      revisionNumber: count,
      status: "PASS",
      caseStatusAtRecord: null,
      note: " raw old ",
      observations,
      evidenceAttachmentIds: [],
      evidenceAttachments: [],
      actorId: actor.id,
      actorName: "Synthetic",
      recordedAt: new Date("2026-10-05T20:00:00.123Z"),
      correctionReason: null,
      previousRevisionId: null,
      idempotencyKey: randomUUID(),
      requestHash: "a".repeat(64),
    },
  };
}
type Fixture = ReturnType<typeof fixture>;
async function refusal(
  h: Fixture,
  code: TRPCError["code"],
  phrase?: string,
  input = h.input,
) {
  const error = await recordReviewedStep(h.db, actor, input).catch(
    (cause) => cause as unknown,
  );
  expect(error).toBeInstanceOf(TRPCError);
  expect(error).toMatchObject({ code });
  if (phrase) expect((error as TRPCError).message).toContain(phrase);
  expect(h.writes).not.toHaveBeenCalled();
}
async function reviewedCorrection(h: Fixture, count = 1) {
  h.heads.push(storedHead(count));
  Object.assign(h.headSize, { count: 1n, caseHeads: 1n });
  const preview = await previewReviewedStep(h.db, actor, {
    projectId: h.input.projectId,
    testRunId: h.input.testRunId,
    testCaseId: h.input.testCaseId,
    stepIndex: h.input.stepIndex,
    readRequestId: randomUUID(),
  });
  h.input.expectedRevisionId = "old";
  h.input.expectedCurrentFingerprint = preview.currentFingerprint!;
}
function emptyLegacy(h: Fixture) {
  Object.assign(h.size, {
    emptyLegacySnapshot: true,
    definitions: 1001,
    graphKeys: 0n,
    graphEdges: 0n,
    steps: 0n,
    maxSteps: 0,
  });
}
function prerequisite(h: Fixture) {
  const dependency = {
    ...h.run.executionContext.caseDefinitions[0]!,
    testCaseId: "dependency",
  };
  h.run.manualTestCaseIds.push("dependency");
  h.run.executionContext.caseDefinitions.push(dependency);
  Object.assign(h.run.manualPrerequisites, { dependency: [] });
  h.run.manualPrerequisites.case = ["dependency"];
  Object.assign(h.size, {
    cases: 2,
    uniqueCases: 2n,
    definitions: 2,
    graphKeys: 2n,
    graphEdges: 1n,
    steps: 4n,
  });
  h.input.expectedProcedureHash = qualityProfileHash({
    definition: h.run.executionContext.caseDefinitions[0],
    graph: h.run.manualPrerequisites,
    orderedCaseIds: h.run.manualTestCaseIds,
  });
}
beforeEach(() => lock.mockReset());
describe("reviewed step recognized business refusals; mocked native boundaries only", () => {
  it.each(["PASSED", "FAILED", "PARTIAL"])(
    "closed %s new write is actionable without body reads",
    async (status) => {
      const h = fixture();
      h.flags.status = status;
      await refusal(h, "BAD_REQUEST", "active manual run");
      expect(h.tx.testRun.findUniqueOrThrow).not.toHaveBeenCalled();
    },
  );
  it("unknown native status is unsupported, not a business refusal", async () => {
    const h = fixture();
    h.flags.status = "invented";
    await refusal(h, "PRECONDITION_FAILED");
  });
  it("accepted exact receipt recovers before all later business and byte gates", async () => {
    const h = fixture();
    h.flags.status = "PASSED";
    h.size.runBytes = 99999999n;
    h.flags.receiptCount = 1n;
    h.flags.receipt = {
      organizationId: "org",
      projectId: "project",
      entityId: "run",
      metadata: {
        projectId: "project",
        testRunId: "run",
        testCaseId: "case",
        stepIndex: 0,
        scope,
        idempotencyKey: h.input.idempotencyKey,
        requestHash: reviewedStepRequestHash(h.input),
        revisionId: "accepted",
        caseStatus: null,
        recovered: false,
        provenance: "REVIEWED_REQUEST_BOUND_AT_WRITE",
      },
    };
    expect(await recordReviewedStep(h.db, actor, h.input)).toMatchObject({
      recovered: true,
      revisionId: "accepted",
      requestHash: reviewedStepRequestHash(h.input),
    });
    expect(h.tx.testRun.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(h.writes).not.toHaveBeenCalled();
  });
  it("blank correction has its reasoned BAD_REQUEST", async () => {
    const h = fixture();
    await reviewedCorrection(h);
    h.input.correctionReason = " \n ";
    await refusal(h, "BAD_REQUEST", "Explain why");
  });
  it("revision cap stays PRE even alongside blank correction", async () => {
    const h = fixture();
    await reviewedCorrection(h, 100);
    await refusal(h, "PRECONDITION_FAILED");
  });
  it("stale CAS stays CONFLICT before blank reason", async () => {
    const h = fixture();
    await reviewedCorrection(h);
    h.input.expectedCurrentFingerprint = "f".repeat(64);
    await refusal(h, "CONFLICT", "baseline");
  });
  it("stored precision mismatch stays PRE before correction reason", async () => {
    const h = fixture();
    await reviewedCorrection(h);
    h.flags.revisionExact = false;
    await refusal(h, "PRECONDITION_FAILED");
  });
  it("measured Pass beyond limits is BAD_REQUEST", async () => {
    const h = fixture();
    await refusal(h, "BAD_REQUEST", "outside its recorded limits", {
      ...h.input,
      observations: {
        ...observations,
        measurements: [
          {
            name: " exact ",
            value: 2,
            unit: "V",
            instrument: "Meter",
            upperLimit: 1,
          },
        ],
      },
    });
  });
  it("native precision refusal precedes measured Pass classification", async () => {
    const h = fixture();
    h.flags.exact = false;
    await refusal(h, "PRECONDITION_FAILED", undefined, {
      ...h.input,
      observations: {
        ...observations,
        measurements: [
          {
            name: "x",
            value: 2,
            unit: "V",
            instrument: "Meter",
            upperLimit: 1,
          },
        ],
      },
    });
  });
  it.each([null, "FAIL", "BLOCKED", "SKIP"])(
    "missing/unpassed prerequisite %s is BAD_REQUEST",
    async (status) => {
      const h = fixture();
      prerequisite(h);
      if (status) h.prerequisites.push({ testCaseId: "dependency", status });
      await refusal(h, "BAD_REQUEST", "prerequisite cases with Pass");
    },
  );
  it.each(["duplicate", "foreign", "unsupported"])(
    "malformed prerequisite %s remains PRE",
    async (kind) => {
      const h = fixture();
      prerequisite(h);
      h.prerequisites.push({
        testCaseId: kind === "foreign" ? "other" : "dependency",
        status: kind === "unsupported" ? "unknown" : "PASS",
      });
      if (kind === "duplicate")
        h.prerequisites.push({ testCaseId: "dependency", status: "PASS" });
      await refusal(h, "PRECONDITION_FAILED");
    },
  );
  it("valid passed prerequisite remains writable with raw note", async () => {
    const h = fixture();
    prerequisite(h);
    h.prerequisites.push({ testCaseId: "dependency", status: "PASS" });
    await recordReviewedStep(h.db, actor, h.input);
    expect(h.tx.manualStepResultRevision.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ note: " raw \nprose " }),
      }),
    );
  });
  it.each(["null-id", "null-status", "false-status"])(
    "unsupported prerequisite scalar %s remains PRE",
    async (kind) => {
      const h = fixture();
      prerequisite(h);
      const row = { testCaseId: "dependency", status: "PASS" };
      Object.assign(
        row,
        kind === "null-id"
          ? { testCaseId: null }
          : { status: kind === "null-status" ? null : false },
      );
      h.prerequisites.push(row);
      await refusal(h, "PRECONDITION_FAILED");
    },
  );
  it("unavailable selected evidence is BAD before private file reads", async () => {
    const h = fixture();
    h.fileSize.count = 0n;
    await refusal(h, "BAD_REQUEST", "Selected evidence", {
      ...h.input,
      evidenceAttachmentIds: ["file"],
    });
    expect(h.tx.testCaseAttachment.findMany).not.toHaveBeenCalled();
  });
  it.each([
    { bytes: 163841n },
    { maxBytes: 8193n },
    { bytes: -1n },
    { maxBytes: -1n },
    { invalid: true },
    { count: 2n },
  ])("unsupported evidence metadata stays PRE %#", async (patch) => {
    const h = fixture();
    Object.assign(h.fileSize, { count: 0n }, patch);
    await refusal(h, "PRECONDITION_FAILED", undefined, {
      ...h.input,
      evidenceAttachmentIds: ["file"],
    });
    expect(h.tx.testCaseAttachment.findMany).not.toHaveBeenCalled();
  });
  it("native/projected evidence count mismatch remains PRE", async () => {
    const h = fixture();
    await refusal(h, "PRECONDITION_FAILED", undefined, {
      ...h.input,
      evidenceAttachmentIds: ["file"],
    });
    expect(h.tx.testCaseAttachment.findMany).toHaveBeenCalledOnce();
  });
  it.each([{ whole: 1n, results: 1n }, { results: 1n }])(
    "whole-case activation conflicts %#",
    async (patch) => {
      const h = fixture();
      Object.assign(h.mode, patch);
      await refusal(h, "CONFLICT", "whole-case observations");
    },
  );
  it.each(["missing-projection", "mixed-step-head"])(
    "inconsistent whole-case %s remains PRE",
    async (kind) => {
      const h = fixture();
      if (kind === "mixed-step-head") await reviewedCorrection(h);
      Object.assign(h.mode, {
        whole: 1n,
        results: kind === "mixed-step-head" ? 1n : 0n,
      });
      await refusal(h, "PRECONDITION_FAILED");
    },
  );
  it.each([
    { whole: 2n },
    { results: 2n },
    { bytes: 262145n },
    { bytes: -1n },
    { unsupported: true },
  ])("unsupported mode neighbor remains PRE %#", async (patch) => {
    const h = fixture();
    Object.assign(h.mode, { whole: 1n }, patch);
    await refusal(h, "PRECONDITION_FAILED");
  });
  it("unexplained derived projection remains PRE rather than whole-case conflict", async () => {
    const h = fixture();
    await reviewedCorrection(h);
    h.mode.results = 1n;
    await refusal(h, "PRECONDITION_FAILED");
  });
  it("invalid requested coordinate is BAD after complete admission", async () => {
    const h = fixture();
    await refusal(h, "BAD_REQUEST", "not part of the frozen", {
      ...h.input,
      stepIndex: 2,
    });
  });
  it.each(["precision", "graph", "head", "order"])(
    "invalid coordinate with corrupt %s remains PRE",
    async (kind) => {
      const h = fixture();
      if (kind === "precision") h.flags.exact = false;
      if (kind === "graph") h.run.manualPrerequisites.case = ["case"];
      if (kind === "head") h.headSize.invalid = true;
      if (kind === "order")
        h.run.executionContext.caseDefinitions[0]!.steps[0]!.order = 1;
      await refusal(h, "PRECONDITION_FAILED", undefined, {
        ...h.input,
        stepIndex: 2,
      });
    },
  );
  it("exact admitted empty legacy snapshot explains frozen structured requirement before body read", async () => {
    const h = fixture();
    emptyLegacy(h);
    await refusal(h, "BAD_REQUEST", "frozen structured");
    expect(h.tx.testRun.findUniqueOrThrow).not.toHaveBeenCalled();
  });
  it.each([
    { foreign: true },
    { invalid: true },
    { runBytes: 4194305n },
    { uniqueCases: 0n },
    { maxSteps: 1 },
    { emptyLegacySnapshot: false },
  ])("legacy neighboring native bounds remain PRE %#", async (patch) => {
    const h = fixture();
    emptyLegacy(h);
    Object.assign(h.size, patch);
    await refusal(h, "PRECONDITION_FAILED");
  });
  it.each(["missing-case", "head-corruption", "existing-head"])(
    "legacy identity/head %s remains PRE",
    async (kind) => {
      const h = fixture();
      emptyLegacy(h);
      if (kind === "missing-case") h.flags.present = false;
      if (kind === "head-corruption") h.headSize.invalid = true;
      if (kind === "existing-head") h.headSize.count = 1n;
      await refusal(h, "PRECONDITION_FAILED");
    },
  );
  it.each(["legacy", "coordinate", "whole"])(
    "read preview %s retains original unsupported recovery contract",
    async (kind) => {
      const h = fixture();
      if (kind === "legacy") emptyLegacy(h);
      if (kind === "whole") Object.assign(h.mode, { whole: 1n, results: 1n });
      const output = await previewReviewedStep(h.db, actor, {
        projectId: "project",
        testRunId: "run",
        testCaseId: "case",
        stepIndex: kind === "coordinate" ? 2 : 0,
        readRequestId: randomUUID(),
      });
      expect(output).toMatchObject({
        supported: false,
        canRecover: true,
        canRecord: false,
        frozenDefinition: null,
        current: null,
        procedureHash: null,
      });
      expect(output.blockedReason).toContain("native bounds");
      expect(h.writes).not.toHaveBeenCalled();
    },
  );
});
