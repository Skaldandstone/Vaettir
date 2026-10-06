import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Prisma } from "@vaettir/db";
import { TRPCError } from "@trpc/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  previewReviewedStep,
  recordReviewedStep,
  reviewedStepRequestHash,
} from "./manualStepExecutionReview.js";
import { qualityProfileHash } from "./qualityExperienceProfile.js";
import type { ReviewedStepAck } from "./manualStepExecutionReviewSchema.js";
const rollback = (code = "P2034", meta?: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError(
    "Synthetic native failed transaction",
    { code, clientVersion: "fixture", ...(meta ? { meta } : {}) },
  );
let clock = 0;
beforeEach(() => {
  clock = 0;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
});
afterEach(() => {
  vi.restoreAllMocks();
});
function fixture() {
  const actor = { id: "native-original", clerkUserId: "clerk-original" };
  const scope = {
    projectId: "project",
    organizationId: "organization",
    actorId: actor.id,
    actorClerkUserId: actor.clerkUserId,
  };
  const definition = {
    testCaseId: "case",
    title: " Frozen title ",
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
      action: ` Action ${order} `,
      expectedActionOrData: " GET /synthetic ",
      expectedResult: "",
      expectedResponse: null,
      mediaAttachmentIds: [],
    })),
  };
  const run = {
    id: "run",
    projectId: "project",
    manualTestCaseIds: ["case"],
    manualPrerequisites: { case: [] },
    executionContext: { version: 1, caseDefinitions: [definition] },
  };
  const input = {
    projectId: "project",
    testRunId: "run",
    testCaseId: "case",
    stepIndex: 0,
    originalOrganizationId: "organization",
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
    status: "FAIL" as const,
    note: " \n exact observation \r\n ",
    observations: {
      specimen: "",
      hardwareRevision: "",
      firmwareVersion: "",
      environment: " raw environment ",
      measurements: [
        {
          name: " Meter\n serial ",
          unit: " V ",
          value: 2,
          instrument: " raw instrument ",
        },
      ],
    },
    evidenceAttachmentIds: [] as string[],
    correctionReason: null,
    idempotencyKey: randomUUID(),
    confirmed: true as const,
  };
  type Head = {
    testRunId: string;
    testCaseId: string;
    stepIndex: number;
    currentRevisionId: string;
    revisionCount: number;
    currentPayloadBytes: number;
    currentRevision: {
      id: string;
      testRunId: string;
      testCaseId: string;
      stepIndex: number;
      revisionNumber: number;
      status: "PASS";
      caseStatusAtRecord: null;
      note: string;
      observations: typeof input.observations;
      evidenceAttachmentIds: string[];
      evidenceAttachments: never[];
      actorId: string;
      actorName: string;
      recordedAt: Date;
      correctionReason: null;
      previousRevisionId: null;
      idempotencyKey: string;
      requestHash: string;
    };
  };
  const state = {
    role: "EDITOR",
    seatType: "FULL",
    suspendedAt: null as Date | null,
    nativeClerk: actor.clerkUserId,
    organizationId: "organization",
    status: "RUNNING",
    runBytes: 1000n,
    receipt: null as ReviewedStepAck | null,
    heads: [] as Head[],
  };
  const events: Array<{ attempt: number; event: string }> = [],
    transactions: object[] = [],
    budgets: Array<{
      isolationLevel: string;
      timeout: number;
      maxWait: number;
    }> = [];
  const writes: Array<{ attempt: number; data: Record<string, unknown> }> = [],
    auditWrites: ReviewedStepAck[] = [],
    requestParameters: unknown[][] = [];
  let failAt: "receipt" | "body" | null = "receipt",
    firstError: unknown = rollback(),
    afterRollback: () => void = () => {},
    secondError: unknown = undefined;
  const mark = (attempt: number, event: string) => {
    events.push({ attempt, event });
  };
  const makeTx = (attempt: number) => ({
    $executeRaw: vi.fn(async () => {
      mark(attempt, "native-timeout");
      return 0;
    }),
    $queryRaw: vi.fn(
      async (
        raw: readonly string[] | { sql: string; values: unknown[] },
        ...values: unknown[]
      ) => {
        const sql = Array.isArray(raw)
          ? raw.join("?")
          : (raw as { sql: string }).sql;
        requestParameters.push(
          Array.isArray(raw) ? values : (raw as { values: unknown[] }).values,
        );
        if (sql.includes('FROM "Organization"')) {
          mark(attempt, "org-lock");
          return [{ suspendedAt: state.suspendedAt }];
        }
        if (sql.includes('FROM "Membership"')) {
          mark(attempt, "membership-lock");
          return [{ role: state.role, seatType: state.seatType }];
        }
        if (sql.includes('FROM "Project"')) {
          mark(attempt, "project-lock");
          return [{ organizationId: state.organizationId }];
        }
        if (sql.includes('FROM "User"')) {
          mark(attempt, "native-clerk-lock");
          return [{ clerkUserId: state.nativeClerk }];
        }
        if (sql.includes("status::text AS status,left")) {
          mark(attempt, "run-lock");
          return [
            { projectId: "project", status: state.status, provider: "manual" },
          ];
        }
        if (sql.includes("pg_advisory_xact_lock")) {
          mark(
            attempt,
            sql.includes("ManualStepExecutionReview/v1")
              ? "uuid-lock"
              : "project-advisory",
          );
          return [];
        }
        if (sql.includes('FROM "AuditLog"')) {
          mark(attempt, "receipt-admission");
          if (failAt === "receipt" && attempt === 1) throw firstError;
          if (attempt === 2 && secondError !== undefined) throw secondError;
          return [
            {
              count: state.receipt ? 1n : 0n,
              bytes: state.receipt ? 1000n : 0n,
            },
          ];
        }
        if (sql.includes('AS "runBytes"')) {
          mark(attempt, "body-admission");
          if (failAt === "body" && attempt === 1) throw firstError;
          return [
            {
              runBytes: state.runBytes,
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
            },
          ];
        }
        if (sql.includes(" AS present")) return [{ present: true }];
        if (sql.includes('AS "selectedBytes"'))
          return [
            {
              count: BigInt(state.heads.length),
              caseHeads: BigInt(state.heads.length),
              bytes: state.heads.length ? 2300n : 0n,
              maxBytes: state.heads.length ? 2300n : 0n,
              selectedBytes: state.heads.length ? 2300n : 0n,
              invalid: false,
            },
          ];
        if (
          sql.includes('"executionContext" IS NOT DISTINCT') ||
          sql.includes("observations IS NOT DISTINCT")
        )
          return [{ exact: true }];
        if (sql.includes(" AS whole"))
          return [{ whole: 0n, results: 0n, bytes: 0n, unsupported: false }];
        if (sql.includes("CASE WHEN octet_length(name)"))
          return [{ name: "Synthetic original actor" }];
        if (sql.includes(" AS bytes")) return [{ bytes: 2300n }];
        throw Error("Unexpected mocked SQL; native SQL was not run");
      },
    ),
    project: {
      findUnique: vi.fn(async () => {
        mark(attempt, "project-discovery");
        return { organizationId: state.organizationId };
      }),
    },
    membership: {
      findUniqueOrThrow: vi.fn(async () => ({
        role: state.role,
        seatType: state.seatType,
      })),
    },
    auditLog: {
      findFirst: vi.fn(async () => {
        mark(attempt, "private-receipt");
        return state.receipt
          ? {
              organizationId: "organization",
              projectId: "project",
              entityId: "run",
              metadata: state.receipt,
            }
          : null;
      }),
      create: vi.fn(async (arg: { data: { metadata: ReviewedStepAck } }) => {
        mark(attempt, "audit-write");
        auditWrites.push(arg.data.metadata);
        return {};
      }),
    },
    testRun: {
      findUniqueOrThrow: vi.fn(async () => {
        mark(attempt, "private-run");
        return run;
      }),
    },
    manualStepResultRevision: {
      count: vi.fn(async () => 0),
      findFirst: vi.fn(async () => ({ id: state.receipt!.revisionId })),
      create: vi.fn(async (arg: { data: Record<string, unknown> }) => {
        mark(attempt, "revision-write");
        writes.push({ attempt, data: arg.data });
        return { id: "new-revision", revisionNumber: arg.data.revisionNumber };
      }),
    },
    manualStepResultHead: {
      findMany: vi.fn(async () => state.heads),
      create: vi.fn(async () => ({})),
      update: vi.fn(async () => ({})),
    },
    testResult: {
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
      count: vi.fn(async () => 0),
    },
    testCaseAttachment: {
      findMany: vi.fn(() => {
        throw Error("Original empty evidence selection was replaced");
      }),
    },
  });
  const db = {
    $transaction: vi.fn(
      async (
        work: (tx: ReturnType<typeof makeTx>) => unknown,
        budget: (typeof budgets)[number],
      ) => {
        const attempt = transactions.length + 1,
          tx = makeTx(attempt);
        transactions.push(tx);
        budgets.push(budget);
        try {
          return await work(tx);
        } catch (cause) {
          if (attempt === 1 && cause === firstError) afterRollback();
          throw cause;
        }
      },
    ),
  };
  const acceptedElsewhere = (): ReviewedStepAck => ({
    projectId: "project",
    testRunId: "run",
    testCaseId: "case",
    stepIndex: 0,
    scope,
    idempotencyKey: input.idempotencyKey,
    requestHash: reviewedStepRequestHash(input),
    revisionId: "accepted-by-other-pending-attempt",
    caseStatus: null,
    recovered: false,
    provenance: "REVIEWED_REQUEST_BOUND_AT_WRITE",
  });
  function changeHead() {
    state.heads = [
      {
        testRunId: "run",
        testCaseId: "case",
        stepIndex: 0,
        currentRevisionId: "changed-head",
        revisionCount: 1,
        currentPayloadBytes: 2300,
        currentRevision: {
          id: "changed-head",
          testRunId: "run",
          testCaseId: "case",
          stepIndex: 0,
          revisionNumber: 1,
          status: "PASS",
          caseStatusAtRecord: null,
          note: " retained old observation ",
          observations: structuredClone(input.observations),
          evidenceAttachmentIds: [],
          evidenceAttachments: [],
          actorId: "native-original",
          actorName: "Synthetic original actor",
          recordedAt: new Date("2026-10-05T20:00:00.123Z"),
          correctionReason: null,
          previousRevisionId: null,
          idempotencyKey: randomUUID(),
          requestHash: "a".repeat(64),
        },
      },
    ];
  }
  return {
    actor,
    scope,
    input,
    state,
    events,
    transactions,
    budgets,
    writes,
    auditWrites,
    requestParameters,
    db: db as never,
    setFirstError: (cause: unknown) => {
      firstError = cause;
    },
    setSecondError: (cause: unknown) => {
      secondError = cause;
    },
    onRollback: (fn: () => void) => {
      afterRollback = fn;
    },
    setFailure: (at: typeof failAt) => {
      failAt = at;
    },
    acceptedElsewhere,
    changeHead,
  };
}
describe("actual reviewed step service fresh rollback attempts; mocked native boundaries ONLY", () => {
  it.each([rollback(), rollback("P2010", { code: "40001" })])(
    "repeats real current locks/receipt before CAS in distinct transactions %s",
    async (cause) => {
      const h = fixture();
      h.setFirstError(cause);
      const ack = await recordReviewedStep(h.db, h.actor, h.input);
      expect(ack).toMatchObject({
        revisionId: "new-revision",
        requestHash: reviewedStepRequestHash(h.input),
        recovered: false,
        scope: h.scope,
      });
      expect(h.transactions).toHaveLength(2);
      expect(h.transactions[0]).not.toBe(h.transactions[1]);
      for (const attempt of [1, 2])
        expect(
          h.events
            .filter((e) => e.attempt === attempt)
            .map((e) => e.event)
            .slice(0, 9),
        ).toEqual([
          "native-timeout",
          "project-discovery",
          "org-lock",
          "membership-lock",
          "project-advisory",
          "project-lock",
          "native-clerk-lock",
          "run-lock",
          "uuid-lock",
        ]);
      expect(h.writes).toHaveLength(1);
      expect(h.writes[0]!.attempt).toBe(2);
      expect(h.budgets).toEqual([
        { isolationLevel: "ReadCommitted", maxWait: 5000, timeout: 15000 },
        { isolationLevel: "ReadCommitted", maxWait: 5000, timeout: 15000 },
      ]);
    },
  );
  it("captures and freezes exact original actor/body once, while the external caller draft remains editable", async () => {
    const h = fixture(),
      original = structuredClone(h.input),
      expectedHash = reviewedStepRequestHash(original);
    h.onRollback(() => {
      h.actor.id = "external-rebound-native";
      h.actor.clerkUserId = "external-rebound-clerk";
      h.input.note = "changed external text";
      h.input.observations.measurements[0]!.value = 999;
      h.input.observations.measurements[0]!.name = "changed external name";
      h.input.evidenceAttachmentIds.push("external-file");
      h.input.idempotencyKey = randomUUID();
      h.input.expectedProcedureHash = "b".repeat(64);
    });
    const ack = await recordReviewedStep(h.db, h.actor, h.input);
    expect(ack).toMatchObject({
      scope: h.scope,
      requestHash: expectedHash,
      idempotencyKey: original.idempotencyKey,
    });
    expect(h.writes[0]!.data).toMatchObject({
      actorId: "native-original",
      note: original.note,
      observations: original.observations,
      evidenceAttachmentIds: [],
    });
    expect(Object.isFrozen(h.input)).toBe(false);
    expect(Object.isFrozen(h.actor)).toBe(false);
    expect(Object.isFrozen(h.writes[0]!.data.observations)).toBe(true);
    expect(
      Object.isFrozen(
        (h.writes[0]!.data.observations as typeof original.observations)
          .measurements[0],
      ),
    ).toBe(true);
  });
  it.each([
    { seatType: "READ_ONLY" },
    { role: "VIEWER" },
    { suspendedAt: new Date() },
    { nativeClerk: "mapping-moved" },
    { organizationId: "reparented-org" },
  ])(
    "fresh authorization %s refuses before private retry receipt/body",
    async (change) => {
      const h = fixture();
      h.onRollback(() => {
        Object.assign(h.state, change);
      });
      await expect(
        recordReviewedStep(h.db, h.actor, h.input),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(h.transactions).toHaveLength(2);
      expect(h.writes).toHaveLength(0);
      expect(
        h.events.filter((e) => e.attempt === 2).map((e) => e.event),
      ).not.toContain("receipt-admission");
    },
  );
  it("fresh accepted same-UUID receipt recovers before completed/oversized later body", async () => {
    const h = fixture(),
      receipt = h.acceptedElsewhere();
    h.onRollback(() => {
      h.state.receipt = receipt;
      h.state.status = "PASSED";
      h.state.runBytes = 99999999n;
    });
    const ack = await recordReviewedStep(h.db, h.actor, h.input);
    expect(ack).toEqual({ ...receipt, recovered: true });
    expect(h.writes).toHaveLength(0);
    const second = h.events.filter((e) => e.attempt === 2).map((e) => e.event);
    expect(second).toContain("private-receipt");
    expect(second).not.toContain("body-admission");
    expect(second).not.toContain("private-run");
  });
  it("fresh changed current head produces original CAS CONFLICT, not a second correction or third retry", async () => {
    const h = fixture();
    h.onRollback(h.changeHead);
    await expect(
      recordReviewedStep(h.db, h.actor, h.input),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(h.transactions).toHaveLength(2);
    expect(h.writes).toHaveLength(0);
    expect(h.auditWrites).toHaveLength(0);
  });
  it.each([
    new TRPCError({ code: "FORBIDDEN" }),
    new TRPCError({ code: "CONFLICT" }),
    new TRPCError({ code: "PRECONDITION_FAILED" }),
    rollback("P2002"),
    rollback("P2028"),
    rollback("P1001"),
    { code: "P2034" },
    { code: "40001" },
    new Error("timeout 40001"),
  ])(
    "actual service does not retry arbitrary/business error %#",
    async (cause) => {
      const h = fixture();
      h.setFirstError(cause);
      await expect(recordReviewedStep(h.db, h.actor, h.input)).rejects.toBe(
        cause,
      );
      expect(h.transactions).toHaveLength(1);
      expect(h.writes).toHaveLength(0);
    },
  );
  it("preserves second native rollback as UNKNOWN and never manufactures semantic CONFLICT", async () => {
    const h = fixture(),
      second = rollback("P2010", { code: "40001" });
    h.setSecondError(second);
    await expect(recordReviewedStep(h.db, h.actor, h.input)).rejects.toBe(
      second,
    );
    expect(h.transactions).toHaveLength(2);
    expect(h.writes).toHaveLength(0);
  });
  it("exhausted monotonic budget preserves the first original error without another transaction", async () => {
    const h = fixture(),
      cause = rollback();
    h.setFirstError(cause);
    h.onRollback(() => {
      clock = 20000;
    });
    await expect(recordReviewedStep(h.db, h.actor, h.input)).rejects.toBe(
      cause,
    );
    expect(h.transactions).toHaveLength(1);
  });
  it("elapsed queue/transaction time reduces actual second options within original total", async () => {
    const h = fixture();
    h.onRollback(() => {
      clock = 9000;
    });
    await recordReviewedStep(h.db, h.actor, h.input);
    expect(h.budgets[1]).toEqual({
      isolationLevel: "ReadCommitted",
      timeout: 8250,
      maxWait: 2750,
    });
    expect(h.budgets[1]!.timeout + h.budgets[1]!.maxWait + 9000).toBe(20000);
  });
  it("preview retains old options and never acquires the write rollback retry policy", async () => {
    const h = fixture(),
      cause = rollback();
    h.setFirstError(cause);
    h.setFailure("body");
    await expect(
      previewReviewedStep(h.db, h.actor, {
        projectId: "project",
        testRunId: "run",
        testCaseId: "case",
        stepIndex: 0,
        readRequestId: randomUUID(),
      }),
    ).rejects.toBe(cause);
    expect(h.transactions).toHaveLength(1);
    expect(h.budgets).toEqual([
      { isolationLevel: "RepeatableRead", timeout: 20000, maxWait: 5000 },
    ]);
  });
  it("source parses/hashes once and retries only the same captured write transaction; no preview/provider/new UUID", () => {
    const source = readFileSync(
      new URL("./manualStepExecutionReview.ts", import.meta.url),
      "utf8",
    );
    const body = source.slice(
      source.indexOf("export async function recordReviewedStep("),
    );
    expect(
      body.match(/reviewedStepWriteInputSchema\.parse\(raw\)/g),
    ).toHaveLength(1);
    expect(body.match(/reviewedStepRequestHash\(input\)/g)).toHaveLength(1);
    expect(body).toContain(
      "actor = freezeReviewedStepValue({ id: actor.id, clerkUserId: actor.clerkUserId })",
    );
    expect(body).toContain(
      "freezeReviewedStepValue(reviewedStepWriteInputSchema.parse(raw))",
    );
    expect(body).toContain(
      "withReviewedStepRollback(budget => db.$transaction",
    );
    expect(body).not.toMatch(
      /previewReviewedStep\(|randomUUID\(|setTimeout\(|Promise\.race/,
    );
    expect(body).toContain("isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted");
  });
});
