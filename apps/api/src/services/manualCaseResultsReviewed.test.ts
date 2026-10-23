import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";
const locks = vi.hoisted(() => ({
  access: vi.fn(),
  prerequisites: vi.fn(),
  dependents: vi.fn(),
}));
vi.mock("./manualRetestScope.js", () => ({
  lockManualRetestAccess: locks.access,
}));
vi.mock("./manualStepExecution.js", () => ({
  requirePassedPrerequisites: locks.prerequisites,
  protectExecutedDependents: locks.dependents,
}));
import {
  accessReviewedManualCaseResult,
  previewReviewedManualCaseResult,
  historyReviewedManualCaseResult,
  recordReviewedManualCaseResult,
  manualCaseReviewedRequestHash,
} from "./manualCaseResultsReviewed.js";
import {
  manualCaseResultWriteSchema,
  manualCaseResultWriteKey,
  manualCaseReviewedWriteSchema,
  manualCaseReviewedWriteKey,
  manualCaseExactObservationsSchema,
} from "./manualCaseResultSchema.js";
import { qualityProfileHash } from "./qualityExperienceProfile.js";
const scope = {
    projectId: "p",
    organizationId: "o",
    actorId: "n",
    clerkActorId: "cl",
  },
  actor = { id: "n", clerkUserId: "cl" };
function fixture(count = 851, expectedIsolation: "ReadCommitted" | "RepeatableRead" | Array<"ReadCommitted" | "RepeatableRead"> = "ReadCommitted") {
  const ids = Array.from({ length: count }, (_, i) =>
      i === 0 ? "c" : `c${i}`,
    ),
    graph = Object.fromEntries(ids.map((id) => [id, [] as string[]]));
  const definitions = ids.map((testCaseId) => ({
    testCaseId,
    title: " Raw\n title ",
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
    steps: [],
  }));
  const run = {
    id: "r",
    manualPrerequisites: graph,
    manualTestCaseIds: ids,
    executionContext: {
      version: 1,
      caseDefinitions: definitions,
      retainedContext: { blank: "", boolean: false, nested: [null, 0] },
    },
  };
  const events: string[] = [],
    state = {
      prior: null as null | Record<string, unknown>,
      role: "EDITOR",
      seatType: "FULL",
      status: "RUNNING",
      step: 0,
      foreign: 0,
      runBytes: 50000n,
      runCount: count,
      roundtrip: true,
      observationRoundtrip: true,
      result: null as null | {
        id: string;
        status: "FAIL";
        note: string | null;
        observations: unknown;
      },
      head: null as unknown,
      historyBytes: 0n,
      historyCount: 0,
      headsBytes: 0n,
      resultsBytes: 0n,
    };
  const input = {
    mode: "EXACT" as const,
    projectId: "p",
    testRunId: "r",
    testCaseId: "c",
    expectedScope: { projectId: "p", organizationId: "o", clerkActorId: "cl" },
    expectedNativeActorId: "n",
    readRequestId: randomUUID(),
    expectedFrozenEvidenceHash: qualityProfileHash({
      executionContext: run.executionContext,
      manualPrerequisites: graph,
      manualTestCaseIds: ids,
    }),
    expectedRevisionId: null,
    expectedCurrentFingerprint: qualityProfileHash({
      projectId: "p",
      testRunId: "r",
      testCaseId: "c",
      result: null,
      head: null,
    }),
    status: "FAIL" as const,
    note: " Raw\n note ",
    observations: {
      environment: " Raw\n environment ",
      measurements: [
        {
          name: " Voltage ",
          unit: " V ",
          value: 2,
          instrument: " Meter\n raw ",
        },
      ],
    },
    correctionReason: null,
    idempotencyKey: randomUUID(),
  };
  const { readRequestId, ...write } = input;
  const tx = {
    $queryRaw: vi.fn(async (raw: { sql: string } | readonly string[]) => {
      const sql = Array.isArray(raw)
        ? raw.join("?")
        : (raw as { sql: string }).sql;
      if (sql.includes("AS planned")) {
        events.push("run-identity");
        return [
          {
            projectId: "p",
            provider: "manual",
            status: state.status,
            planned: true,
          },
        ];
      }
      if (sql.includes('AS "runBytes"')) {
        events.push("native-run-admission");
        return [
          {
            count: state.runCount,
            unique: count,
            idsBytes: 10000n,
            graphBytes: 10000n,
            runBytes: state.runBytes,
            foreign: state.foreign,
            invalid: 0,
          },
        ];
      }
      if (sql.includes('"executionContext" IS NOT DISTINCT')) {
        events.push("frozen-roundtrip");
        return [{ exact: state.roundtrip }];
      }
      if (sql.includes('SELECT "displayId"')) return [{ displayId: "TC-1" }];
      if (
        sql.includes('"ManualCaseResultRevision"') &&
        !sql.includes('"ManualCaseResultHead"') &&
        sql.includes("AS count")
      ) {
        events.push("history-admission");
        return [{ count: state.historyCount, bytes: state.historyBytes }];
      }
      if (sql.includes('"ManualCaseResultHead"')) {
        events.push("head-admission");
        return [{ count: 0, bytes: state.headsBytes, foreign: 0, invalid: 0 }];
      }
      if (sql.includes('count(DISTINCT r."testCaseId")')) {
        events.push("results-admission");
        return [
          {
            count: 0,
            unique: 0,
            bytes: state.resultsBytes,
            foreign: 0,
            maxBytes: 0n,
          },
        ];
      }
      if (sql.includes('FROM "TestResult" r')) {
        events.push("selected-result-admission");
        return [{ count: state.result ? 1 : 0, bytes: 1000n }];
      }
      if (sql.includes("observations IS NOT DISTINCT")) {
        events.push("result-roundtrip");
        return [{ exact: state.observationRoundtrip }];
      }
      if (sql.includes("SELECT (octet_length(concat(")) {
        events.push("incoming-native-bytes");
        return [{ bytes: 3000n }];
      }
      throw Error("Unexpected mocked reviewed SQL: " + sql);
    }),
    membership: {
      findUniqueOrThrow: vi.fn(async () => ({
        role: state.role,
        seatType: state.seatType,
      })),
    },
    testRun: {
      findUniqueOrThrow: vi.fn(async () => {
        events.push("private-run-body");
        return run;
      }),
    },
    manualStepResultHead: { count: vi.fn(async () => state.step) },
    manualCaseResultHead: {
      findUnique: vi.fn(async () => state.head),
      create: vi.fn(async () => ({})),
      update: vi.fn(async () => ({})),
    },
    manualCaseResultRevision: {
      findUnique: vi.fn(async () => {
        events.push("receipt");
        return state.prior;
      }),
      create: vi.fn(async (arg: { data: Record<string, unknown> }) => {
        events.push("revision-write");
        return {
          id: "revision",
          testResultId: arg.data.testResultId as string,
          revisionNumber: 1,
        };
      }),
    },
    testResult: {
      findFirst: vi.fn(async () => {
        events.push("private-result-body");
        return state.result;
      }),
      create: vi.fn(async () => {
        events.push("result-write");
        return { id: "result" };
      }),
      update: vi.fn(async () => ({})),
    },
    user: {
      findUniqueOrThrow: vi.fn(async () => ({ name: "Synthetic member" })),
    },
  };
  let transactionIndex = 0;
  const db = {
    $transaction: vi.fn(
      async (fn: (arg: typeof tx) => unknown, opts: unknown) => {
        expect(opts).toMatchObject({
          isolationLevel: Array.isArray(expectedIsolation) ? expectedIsolation[transactionIndex++] : expectedIsolation,
          timeout: 20000,
        });
        return fn(tx);
      },
    ),
  };
  locks.access.mockImplementation(async () => {
    events.push("native-current-auth");
    return scope;
  });
  return {
    state,
    run,
    write,
    read: {
      projectId: "p",
      testRunId: "r",
      testCaseId: "c",
      expectedScope: write.expectedScope,
      expectedNativeActorId: "n",
      readRequestId,
    },
    events,
    tx,
    db: db as never,
  };
}
beforeEach(() => {
  Object.values(locks).forEach((f) => f.mockReset());
});
describe("whole-case reviewed native contracts MOCKED SQL only, no native execution", () => {
  it("qualifies every unnested frozen identity and retains tenant parameter bindings in generated admission SQL (not PostgreSQL acceptance)", async () => {
    const h = fixture(2);
    await recordReviewedManualCaseResult(h.db, actor, h.write);
    const admission = h.tx.$queryRaw.mock.calls.find(([raw]) => Array.isArray(raw) && raw.join("?").includes('AS "runBytes"'));
    if (!admission || !Array.isArray(admission[0])) throw Error("The actual native admission template was not called.");
    const sql = admission[0].join("?");
    expect(sql.match(/AS frozen_case\(case_id\)/g)).toHaveLength(3);
    expect(sql).toContain('count(DISTINCT frozen_case.case_id)::int');
    expect(sql).toContain('LEFT JOIN "TestCase" c ON c.id=frozen_case.case_id AND c."projectId"=? WHERE c.id IS NULL');
    expect(sql).toContain('WHERE frozen_case.case_id IS NULL OR length(frozen_case.case_id)=0 OR length(frozen_case.case_id)>200');
    expect(sql).toContain('FROM "TestRun" r WHERE r.id=? AND r."projectId"=?');
    expect(sql).not.toMatch(/\b(?:DISTINCT id|c\.id=id|WHERE id IS NULL)\b/);
    // Template-tag arguments are captured at the synthetic native boundary.
    // They are not interpolated into SQL, nor are mocked rows parser proof.
    const taggedCall = admission as unknown as readonly [readonly string[], ...unknown[]];
    expect(taggedCall.slice(1)).toEqual(["p", "r", "p"]);
    expect(h.events.indexOf("native-run-admission")).toBeLessThan(h.events.indexOf("private-run-body"));
  });
  it("history nonce/raw observation/SQL-NULL vs JSON-NULL classification are bounded before bodies and not normalized", async () => {
    const h = fixture(851, "RepeatableRead"),
      rows = [
        {
          id: "v",
          revisionNumber: 1,
          testResultId: "t",
          status: "FAIL",
          note: " \n raw ",
          observations: { retired: [null, false, 0, " \n "] },
          actorLabel: "Native actor",
          recordedAt: new Date(0),
          correctionReason: " raw reason ",
          previousRevisionId: null,
          legacyPrior: null,
        },
      ];
    const revisions = Object.assign(h.tx.manualCaseResultRevision, {
        findMany: vi.fn(async (args: { select?: unknown }) =>
          args.select ? [{ id: "v", payloadBytes: 1000 }] : rows,
        ),
        findFirst: vi.fn(async () => null),
      }),
      prior = h.tx.$queryRaw.getMockImplementation()!;
    let kind: "SQL_NULL" | "JSON_NULL" = "SQL_NULL",
      oversize = false;
    h.tx.$queryRaw.mockImplementation(async (raw) => {
      const sql = Array.isArray(raw)
        ? raw.join("?")
        : (raw as { sql: string }).sql;
      if (sql.includes('SELECT "projectId" FROM "TestCase"'))
        return [{ projectId: "p" }] as never;
      if (sql.includes('AS "identityBytes"'))
        return [
          {
            count: 1,
            identityBytes: 1n,
            maxIdentity: 1,
            invalid: 0,
            foreign: 0,
          },
        ] as never;
      if (
        sql.includes('AS "maxBytes"') &&
        sql.includes('"ManualCaseResultRevision"')
      )
        return [
          { count: 1, bytes: oversize ? 1048577n : 1000n, maxBytes: 1000n },
        ] as never;
      if (sql.includes('AS "legacySqlNull"'))
        return [
          {
            exact: true,
            legacySqlNull: kind === "SQL_NULL",
            legacyJsonNull: kind === "JSON_NULL" ? true : null,
          },
        ] as never;
      return prior(raw);
    });
    for (kind of ["SQL_NULL", "JSON_NULL"]) {
      const page = await historyReviewedManualCaseResult(h.db, actor, {
        ...h.read,
        limit: 10,
      });
      expect(page.readContext).toMatchObject({
        projection: "HISTORY",
        requestId: h.read.readRequestId,
        scope,
      });
      expect(page.revisions[0]).toMatchObject({
        legacyPriorKind: kind,
        result: { note: " \n raw ", observations: rows[0]!.observations },
      });
    }
    revisions.findMany.mockClear();
    oversize = true;
    await expect(
      historyReviewedManualCaseResult(h.db, actor, { ...h.read, limit: 10 }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(revisions.findMany).toHaveBeenCalledTimes(1);
    expect(revisions.findMany.mock.calls[0]![0]).toHaveProperty("select");
  });
  it("new exact parsing retains whitespace/empty/unset and legacy canonical parsing/key remains unchanged", () => {
    const h = fixture();
    const raw = {
      ...h.write,
      observations: { environment: " \n ", measurements: [] },
      note: "",
    };
    expect(manualCaseReviewedWriteSchema.parse(raw)).toMatchObject({
      note: "",
      observations: { environment: " \n " },
    });
    const legacy = manualCaseResultWriteSchema.parse({
      projectId: h.write.projectId,
      testRunId: h.write.testRunId,
      testCaseId: h.write.testCaseId,
      expectedScope: h.write.expectedScope,
      expectedRevisionId: null,
      expectedCurrentFingerprint: h.write.expectedCurrentFingerprint,
      status: "FAIL",
      note: " raw ",
      observations: { environment: " raw ", measurements: [] },
      correctionReason: null,
      idempotencyKey: h.write.idempotencyKey,
    });
    expect(legacy.observations.environment).toBe("raw");
  });
  it("legacy parsed recovery uses exactly the old canonical key/hash and cannot create a write", async () => {
    const h = fixture();
    const request = manualCaseResultWriteSchema.parse({
      projectId: "p",
      testRunId: "r",
      testCaseId: "c",
      expectedScope: h.write.expectedScope,
      expectedRevisionId: null,
      expectedCurrentFingerprint: h.write.expectedCurrentFingerprint,
      status: "FAIL",
      note: " raw ",
      observations: { environment: " raw ", measurements: [] },
      correctionReason: null,
      idempotencyKey: randomUUID(),
    });
    const envelope = {
      mode: "LEGACY_PARSED" as const,
      expectedNativeActorId: "n",
      request,
    };
    expect(manualCaseReviewedWriteKey(envelope)).toBe(
      manualCaseResultWriteKey(request),
    );
    expect(request.observations.environment).toBe("raw");
    await expect(
      recordReviewedManualCaseResult(h.db, actor, envelope),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(h.events).toEqual(["native-current-auth", "receipt"]);
    expect(h.tx.testResult.create).not.toHaveBeenCalled();
    h.state.prior = {
      id: "v",
      projectId: "p",
      testRunId: "r",
      testCaseId: "c",
      testResultId: "t",
      revisionNumber: 1,
      actorClerkUserId: "cl",
      requestHash: manualCaseReviewedRequestHash(envelope),
    };
    expect(
      (await recordReviewedManualCaseResult(h.db, actor, envelope)).recovered,
    ).toBe(true);
  });
  it.each(["native", "FULL", "Clerk"])(
    "%s authorization refusal precedes private receipt and bodies",
    async (kind) => {
      const h = fixture();
      if (kind === "native") h.write.expectedNativeActorId = "changed";
      else locks.access.mockRejectedValue(new TRPCError({ code: "FORBIDDEN" }));
      await expect(
        recordReviewedManualCaseResult(h.db, actor, h.write),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(h.events).not.toContain("receipt");
      expect(h.tx.testRun.findUniqueOrThrow).not.toHaveBeenCalled();
    },
  );
  it("exact accepted UUID recovers before later completed/step mode/byte/count caps", async () => {
    const h = fixture();
    h.state.prior = {
      id: "v",
      projectId: "p",
      testRunId: "r",
      testCaseId: "c",
      testResultId: "t",
      revisionNumber: 1,
      actorClerkUserId: "cl",
      requestHash: manualCaseReviewedRequestHash(h.write),
    };
    h.state.status = "COMPLETED";
    h.state.step = 1;
    h.state.runCount = 1001;
    h.state.runBytes = 999999999n;
    h.state.historyBytes = 999999999n;
    expect(
      await recordReviewedManualCaseResult(h.db, actor, h.write),
    ).toMatchObject({ recovered: true, mode: "EXACT", scope });
    expect(h.events).toEqual(["native-current-auth", "receipt"]);
    expect(h.tx.testResult.create).not.toHaveBeenCalled();
  });
  it.each([851, 1000])(
    "admits complete %s identity cohort under existing native bounds and preserves raw observation",
    async (count) => {
      const h = fixture(count);
      expect(
        await recordReviewedManualCaseResult(h.db, actor, h.write),
      ).toMatchObject({ recovered: false, revisionNumber: 1 });
      const saved = h.tx.manualCaseResultRevision.create.mock.calls[0]![0].data;
      expect(saved.note).toBe(" Raw\n note ");
      expect(saved.observations).toEqual(h.write.observations);
      expect(h.events.indexOf("native-run-admission")).toBeLessThan(
        h.events.indexOf("private-run-body"),
      );
      expect(h.events.indexOf("results-admission")).toBeLessThan(
        h.events.indexOf("private-result-body"),
      );
    },
  );
  it.each([
    { runCount: 1001 },
    { foreign: 1 },
    { runBytes: 4194305n },
    { headsBytes: 4194305n },
    { historyBytes: 16777217n },
    { historyCount: 10000 },
    { resultsBytes: 4194305n },
  ])(
    "complete native bounds refuse before corresponding private bodies/writes",
    async (patch) => {
      const h = fixture();
      Object.assign(h.state, patch);
      await expect(
        recordReviewedManualCaseResult(h.db, actor, h.write),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(h.tx.testResult.create).not.toHaveBeenCalled();
      expect(h.events).not.toContain("private-result-body");
    },
  );
  it("frozen JSON precision/unsupported complete schema refuses no defaulting or live content", async () => {
    const h = fixture();
    h.state.roundtrip = false;
    await expect(
      recordReviewedManualCaseResult(h.db, actor, h.write),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(h.tx.testResult.create).not.toHaveBeenCalled();
    h.state.roundtrip = true;
    (
      h.run.executionContext.caseDefinitions[0] as Record<string, unknown>
    ).retired = "retained";
    await expect(
      recordReviewedManualCaseResult(h.db, actor, h.write),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
  it("current unknown/JSON-null retained root remains read-only and no replacement; precision refusal generic", async () => {
    const h = fixture(851, ["RepeatableRead", "ReadCommitted", "RepeatableRead"]);
    h.state.result = {
      id: "legacy",
      status: "FAIL",
      note: null,
      observations: null,
    };
    const preview = await previewReviewedManualCaseResult(h.db, actor, h.read);
    expect(preview.current?.observations).toBeNull();
    expect(preview.canWrite).toBe(false);
    h.write.expectedCurrentFingerprint = preview.currentFingerprint;
    h.write.correctionReason = " Explicit correction ";
    await expect(
      recordReviewedManualCaseResult(h.db, actor, h.write),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    h.state.observationRoundtrip = false;
    await expect(
      previewReviewedManualCaseResult(h.db, actor, h.read),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(h.tx.testResult.update).not.toHaveBeenCalled();
  });
  it("preview fresh nonce/native scope and independent read-only recovery signal do not load run bodies for access", async () => {
    const h = fixture(851, "RepeatableRead");
    h.state.seatType = "READ_ONLY";
    h.state.runBytes = 999999999n;
    expect(
      await accessReviewedManualCaseResult(h.db, actor, h.read),
    ).toMatchObject({
      readContext: {
        requestId: h.read.readRequestId,
        projection: "ACCESS",
        canRecover: false,
        scope,
      },
    });
    expect(h.events).toEqual(["native-current-auth"]);
    expect(h.tx.testRun.findUniqueOrThrow).not.toHaveBeenCalled();
  });
  it("unknown exact observation fields and whitespace-only reading identity refuse instead of dropping", () => {
    expect(
      manualCaseExactObservationsSchema.safeParse({ retained: true }).success,
    ).toBe(false);
    expect(
      manualCaseExactObservationsSchema.safeParse({
        measurements: [{ name: " ", unit: "V", value: 2 }],
      }).success,
    ).toBe(false);
    expect(
      manualCaseExactObservationsSchema.parse({
        environment: "",
        measurements: [],
      }),
    ).toEqual({ environment: "", measurements: [] });
  });
  it("source full native current author lock is inside transaction and prior receipt precedes later body/mode/status limits", () => {
    const source = readFileSync(
        new URL("./manualCaseResultsReviewed.ts", import.meta.url),
        "utf8",
      ),
      body = source.slice(
        source.indexOf("export async function recordReviewedManualCaseResult"),
      );
    expect(body.indexOf("lockedScope(tx, actor, read, true)")).toBeLessThan(
      body.indexOf("manualCaseResultRevision.findUnique"),
    );
    expect(body.indexOf("return ack(receipt, true)")).toBeLessThan(
      body.indexOf("lockRunIdentity(tx, read, true)"),
    );
    expect(body).not.toMatch(/return execute\(\)/);
  });
});
