import { randomUUID, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { expect, it, vi } from "vitest";
import type { Prisma } from "@vaettir/db";
import type { Context } from "../trpc.js";
import { lockManualExecutionReadScope } from "./manualExecutionReadScope.js";
import { readManualRunCurrent } from "./manualRunCurrentRead.js";
import { manualRunReadsRouter } from "../routers/manualRunReads.js";
import { manualExecutionRouter } from "../routers/manualExecution.js";
import { manualRunCurrentReadKey } from "./manualRunCurrentReadSchema.js";
function nativeFixture(
  count: number,
  overrides: {
    dependencyFanout?: boolean;
    runBytes?: bigint;
    caseBytes?: bigint;
    resultBytes?: bigint;
    headBytes?: bigint;
    maxSteps?: bigint;
    headCount?: bigint;
    resultCount?: bigint;
    libraryCount?: number;
    libraryStepCount?: number;
    duplicateResults?: boolean;
    foreignCase?: boolean;
    role?: string;
    seatType?: string;
    clerkActorId?: string;
    suspended?: boolean;
  } = {},
) {
  const ids = Array.from({ length: count }, (_, i) => `synthetic-case-${i}`);
  const graph = Object.fromEntries(
    ids.map((id, i) => [
      id,
      overrides.dependencyFanout && i === 0 ? ids.slice(1) : [],
    ]),
  );
  const events: string[] = [];
  const tx = {
    $executeRaw: vi.fn(async () => 0),
    $queryRaw: vi.fn(async (parts: TemplateStringsArray) => {
      const sql = parts.join("?");
      if (sql.includes("transaction_isolation"))
        return [{ isolation: "repeatable read" }];
      if (sql.includes('FROM "TestRun" r JOIN "Project" p'))
        return [
          { projectId: "synthetic-project", organizationId: "synthetic-org" },
        ];
      if (sql.includes('FROM "Organization"') && sql.includes("FOR SHARE")) {
        events.push("Organization");
        return [{ suspendedAt: overrides.suspended ? new Date() : null }];
      }
      if (sql.includes('FROM "Membership"')) {
        events.push("Membership");
        return [
          {
            role: overrides.role ?? "EDITOR",
            seatType: overrides.seatType ?? "FULL",
          },
        ];
      }
      if (sql.includes('FROM "Project"') && sql.includes("FOR SHARE")) {
        events.push("Project");
        return [{ organizationId: "synthetic-org" }];
      }
      if (sql.includes('FROM "User"')) {
        events.push("User");
        return [{ clerkUserId: overrides.clerkActorId ?? "synthetic-clerk" }];
      }
      if (sql.includes(" AS manual")) {
        events.push("TestRun");
        return [{ projectId: "synthetic-project", manual: true }];
      }
      if (sql.includes('AS "scopeBytes"')) {
        events.push("run-size");
        return [
          {
            bytes: overrides.runBytes ?? 1024n,
            scopeBytes: 1024n,
            graphBytes: 1024n,
            count,
            uniqueCount: BigInt(count),
            invalidId: false,
            labelBytes: 100n,
          },
        ];
      }
      if (sql.includes('"manualTestCaseIds" AS ids')) {
        events.push("graph");
        return [{ ids, graph }];
      }
      if (sql.includes('AS "foreignCase"')) {
        events.push("relationships");
        return [
          {
            foreignCase: overrides.foreignCase ?? false,
            foreignLibrary: false,
            danglingLibrary: false,
          },
        ];
      }
      if (sql.includes("WITH scoped AS")) {
        events.push("case-size");
        return [
          {
            count: BigInt(count),
            bytes: overrides.caseBytes ?? 1024n,
            maxBytes: 200n,
            steps: BigInt(count),
            maxSteps: overrides.maxSteps ?? 1n,
            libraryBytes: 1024n,
          },
        ];
      }
      if (sql.includes("SELECT DISTINCT g.id,g.steps")) {
        events.push("libraries");
        return Array.from({ length: overrides.libraryCount ?? count }, () => ({
          steps: Array.from(
            { length: overrides.libraryStepCount ?? 1 },
            () => ({ action: "Synthetic approved step" }),
          ),
        }));
      }
      if (sql.includes('AS "duplicateCases"')) {
        events.push("results");
        return [
          {
            count: overrides.resultCount ?? BigInt(count),
            bytes: overrides.resultBytes ?? 1024n,
            maxBytes: 100n,
            duplicateCases: overrides.duplicateResults ?? false,
          },
        ];
      }
      if (sql.includes('AS "invalidScope"')) {
        events.push("heads");
        return [
          {
            count: overrides.headCount ?? BigInt(count),
            bytes: overrides.headBytes ?? 1024n,
            maxBytes: 100n,
            invalidScope: false,
          },
        ];
      }
      if (sql.includes("{datasetExecution,batchId}")) {
        events.push("batch");
        return [{ count: 0n, bytes: 0n, maxBytes: 0n }];
      }
      throw new Error("Unexpected synthetic native-query shape");
    }),
  };
  const input = {
    testRunId: "synthetic-run",
    projectId: "synthetic-project",
    originalOrganizationId: "synthetic-org",
    expectedClerkActorId: "synthetic-clerk",
  };
  return {
    tx,
    input,
    events,
    read: () =>
      lockManualExecutionReadScope(
        tx as unknown as Prisma.TransactionClient,
        "synthetic-actor",
        "synthetic-clerk",
        input,
      ),
  };
}
function fixture(
  count = 3,
  overrides: Parameters<typeof nativeFixture>[1] = {},
) {
  const base = nativeFixture(count, overrides),
    ids = Array.from({ length: count }, (_, i) => `synthetic-case-${i}`);
  const state = {
    run: {
      id: "synthetic-run",
      projectId: "synthetic-project",
      status: "RUNNING",
      manualTestCaseIds: ids,
      manualPrerequisites: Object.fromEntries(ids.map((id) => [id, []])),
      executionContext: null as unknown,
      project: { organization: { stepFieldLabels: {} } },
    },
    cases: ids.map((id) => ({
      id,
      displayId: null,
      title: ` Current ${id}\n `,
      background: null,
      validationDomain: "SOFTWARE",
      verificationProfile: {},
      given: [],
      when: [],
      then: [],
      steps: [
        {
          order: 7,
          action: " action\n ",
          expectedActionOrData: "",
          expectedResult: null,
          expectedResponse: " reply ",
          mediaAttachmentIds: [],
        },
      ],
      sharedStepGroup: null,
    })),
    results: ids.length
      ? [
          {
            testCaseId: ids[0]!,
            status: "PASS",
            note: " note\n ",
            observations: {
              specimen: "  preserved legacy normalization  ",
              measurements: [],
            },
          },
        ]
      : [],
  };
  const tx = Object.assign(base.tx, {
    testRun: {
      findUniqueOrThrow: vi.fn(async () => {
        base.events.push("private-run");
        return state.run;
      }),
    },
    testCase: {
      findMany: vi.fn(async () => {
        base.events.push("private-cases");
        return state.cases;
      }),
    },
    testResult: {
      findMany: vi.fn(async () => {
        base.events.push("private-results");
        return state.results;
      }),
    },
    manualStepResultHead: {
      aggregate: vi.fn(async () => ({ _sum: { currentPayloadBytes: 0 } })),
      findMany: vi.fn(async () => []),
    },
  });
  const db = {
    $transaction: vi.fn(
      async (work: (value: typeof tx) => unknown, options: unknown) => {
        expect(options).toEqual({
          isolationLevel: "RepeatableRead",
          timeout: 20000,
        });
        return work(tx);
      },
    ),
  };
  const input = {
    ...base.input,
    expectedNativeActorId: "synthetic-actor",
    requestId: randomUUID(),
  };
  const authority = { clerkActorId: "synthetic-clerk" };
  const context = {
    prisma: db,
    user: {
      id: "synthetic-actor",
      clerkUserId: "synthetic-clerk",
      memberships: [],
    },
    staff: null,
    authenticatedClerkSubject: "synthetic-clerk",
  } as unknown as Context;
  return {
    base,
    state,
    tx,
    db: db as never,
    input,
    authority,
    context,
    read: () =>
      readManualRunCurrent(db as never, "synthetic-actor", input, authority),
  };
}
it("new current whole-run route uses actual shared native read admission+one held RR projection, preserves READ_ONLY and nonce/native echo (mocked SQL, NOT RUN)", async () => {
  const h = fixture(3, { role: "VIEWER", seatType: "READ_ONLY" }),
    result = await h.read();
  expect(result.readContext).toEqual({
    requestId: h.input.requestId,
    requestedKey: manualRunCurrentReadKey(h.input),
    projection: "CURRENT_WHOLE_MANUAL_RUN_VIEW",
    scope: {
      projectId: h.input.projectId,
      testRunId: h.input.testRunId,
      organizationId: h.input.originalOrganizationId,
      actorId: h.input.expectedNativeActorId,
      actorClerkUserId: h.input.expectedClerkActorId,
    },
  });
  expect(h.base.events.slice(0, 5)).toEqual([
    "Organization",
    "Membership",
    "Project",
    "User",
    "TestRun",
  ]);
  expect(h.base.events.indexOf("batch")).toBeLessThan(
    h.base.events.indexOf("private-run"),
  );
  expect(h.db.$transaction).toHaveBeenCalledOnce();
  expect(result.view.canWrite).toBe(false);
  expect(result.view.cases[0]!.steps[0]).toEqual(h.state.cases[0]!.steps[0]);
  expect(result.view.cases[0]!.currentResult!.note).toBe(" note\n ");
  expect(result.view.cases[0]!.currentResult!.observations.specimen).toBe(
    "preserved legacy normalization",
  );
  expect(result.provenance.observations).toBe(
    "CURRENT_SUPPORTED_API_VIEW_NOT_RAW_NATIVE_JSON",
  );
});
it("legacy getter delegates same exact supported view with unchanged old request key and output, not a nested protected caller", async () => {
  const h = fixture(),
    newResult = await h.read(),
    oldResult = await manualExecutionRouter
      .createCaller(h.context)
      .getForExecution(h.base.input);
  expect(oldResult).toEqual(newResult.view);
  expect(oldResult).not.toHaveProperty("readContext");
  expect(h.db.$transaction).toHaveBeenCalledTimes(2);
});
it.each([undefined, null, {}, { clerkActorId: "" }])(
  "direct missing independent authority %j refuses even native identity discovery",
  async (authority) => {
    const h = fixture();
    await expect(
      readManualRunCurrent(
        h.db,
        "synthetic-actor",
        h.input,
        authority as never,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(h.db.$transaction).not.toHaveBeenCalled();
    expect(h.base.events).toEqual([]);
  },
);
it.each(["native", "Clerk", "org", "transport", "suspended", "seat"])(
  "current original %s mismatch refuses before private whole-run projection",
  async (kind) => {
    const h = fixture(
      3,
      kind === "suspended"
        ? { suspended: true }
        : kind === "seat"
          ? { seatType: "UNSUPPORTED" }
          : {},
    );
    if (kind === "native") h.input.expectedNativeActorId = "replacement";
    if (kind === "Clerk") h.input.expectedClerkActorId = "other";
    if (kind === "org") h.input.originalOrganizationId = "other";
    const authority =
      kind === "transport"
        ? { clerkActorId: "independent-other" }
        : h.authority;
    await expect(
      readManualRunCurrent(h.db, "synthetic-actor", h.input, authority),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(h.tx.testRun.findUniqueOrThrow).not.toHaveBeenCalled();
    if (kind === "native") {
      expect(h.db.$transaction).not.toHaveBeenCalled();
      expect(h.base.events).toEqual([]);
    }
  },
);
it.each([
  { foreignCase: true },
  { runBytes: 4194305n },
  { caseBytes: 8388609n },
  { duplicateResults: true },
  { maxSteps: 501n },
  { headCount: 25001n },
])(
  "existing native pointer/byte/step admission is not waived %#",
  async (overrides) => {
    const h = fixture(3, overrides);
    await expect(h.read()).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(h.tx.testRun.findUniqueOrThrow).not.toHaveBeenCalled();
  },
);
it("genuine empty planned scope and missing procedures remain explicit, never auto-healed or silently dropped", async () => {
  const empty = await fixture(0).read();
  expect(empty.view.plannedCaseIds).toEqual([]);
  expect(empty.view.cases).toEqual([]);
  expect(empty.view.scopeAvailability.plannedCount).toBe(0);
  const h = fixture();
  h.state.cases.pop();
  const missing = await h.read();
  expect(missing.view.plannedCaseIds).toHaveLength(3);
  expect(missing.view.cases).toHaveLength(2);
  expect(missing.view.unavailableCases).toEqual([
    {
      testCaseId: "synthetic-case-2",
      reason: "MISSING_CASE_AND_FROZEN_DEFINITION",
    },
  ]);
  expect(missing.view.scopeAvailability.complete).toBe(false);
});
it("native body scope disagreement cannot acquire concordant fabricated echo/provenance", async () => {
  const h = fixture();
  h.state.run.id = "different";
  await expect(h.read()).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
});
it.each([undefined, null])(
  "router missing verified subject %s never falls back to cached native Clerk mapping",
  async (subject) => {
    const h = fixture();
    h.context.authenticatedClerkSubject = subject as never;
    await expect(
      manualRunReadsRouter.createCaller(h.context).current(h.input),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(h.db.$transaction).not.toHaveBeenCalled();
  },
);
it("router independent verified subject succeeds despite stale cached Clerk mapping and locked remap refuses", async () => {
  const h = fixture();
  h.context.user!.clerkUserId = "cached-other";
  expect(
    (await manualRunReadsRouter.createCaller(h.context).current(h.input)).view
      .clerkActorId,
  ).toBe("synthetic-clerk");
  const remap = fixture(3, { clerkActorId: "remapped" });
  await expect(
    manualRunReadsRouter.createCaller(remap.context).current(remap.input),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(remap.tx.testRun.findUniqueOrThrow).not.toHaveBeenCalled();
});
it("fresh UUID produces distinct echoed read identity, not an old write receipt or reusable cached read token", async () => {
  const h = fixture(),
    first = await h.read();
  h.input.requestId = randomUUID();
  const next = await h.read();
  expect(next.view).toEqual(first.view);
  expect(next.readContext.requestId).not.toBe(first.readContext.requestId);
  expect(next.readContext.requestedKey).not.toBe(
    first.readContext.requestedKey,
  );
});
it("unchanged native Date step-recordedAt serializes as an ISO string on JSON wire, not browser Date runtime proof", async () => {
  const h = fixture(1),
    recordedAt = new Date("2026-09-01T00:00:00.123Z");
  h.state.run.executionContext = {
    version: 1,
    experience: null,
    profileHash: "a".repeat(64),
    configuration: {},
    stepFieldLabels: {},
    caseDefinitions: h.state.cases.map((testCase) => ({
      testCaseId: testCase.id,
      title: testCase.title,
      validationDomain: testCase.validationDomain,
      reviewStatus: "APPROVED",
      background: testCase.background,
      given: testCase.given,
      when: testCase.when,
      then: testCase.then,
      verificationProfile: {
        setup: "",
        safety: "",
        instruments: "",
        acceptanceCriteria: "",
      },
      steps: testCase.steps,
    })),
  };
  h.tx.manualStepResultHead.findMany.mockResolvedValue([
    {
      testCaseId: "synthetic-case-0",
      stepIndex: 0,
      revisionCount: 1,
      currentRevision: {
        id: "revision",
        status: "PASS",
        note: "",
        observations: {},
        evidenceAttachments: [],
        actorName: "Synthetic Actor",
        recordedAt,
        correctionReason: null,
        previousRevisionId: null,
        revisionNumber: 1,
      },
    },
  ] as never);
  const result = await h.read();
  expect(
    result.view.cases[0]!.stepResults[0]!.current!.recordedAt,
  ).toBeInstanceOf(Date);
  const wire = JSON.parse(JSON.stringify(result));
  expect(wire.view.cases[0].stepResults[0].current.recordedAt).toBe(
    "2026-09-01T00:00:00.123Z",
  );
  expect(typeof wire.view.cases[0].stepResults[0].current.recordedAt).toBe(
    "string",
  );
});
it("before/after extraction bounded projection/schema AST fingerprints are exactly preserved, old wire getter delegates", () => {
  const printer = ts.createPrinter(),
    source = readFileSync(
      new URL("./manualExecutionCurrentProjection.ts", import.meta.url),
      "utf8",
    ),
    ast = ts.createSourceFile(
      "projection.ts",
      source,
      ts.ScriptTarget.Latest,
      true,
    ),
    fn = ast.statements.find(ts.isFunctionDeclaration)!;
  const body = printer.printList(
    ts.ListFormat.MultiLine,
    ts.factory.createNodeArray(
      fn.body!.statements.slice(
        fn.body!.statements.findIndex(
          (statement) =>
            ts.isVariableStatement(statement) &&
            statement.declarationList.declarations.some(
              (declaration) => declaration.name.getText(ast) === "run",
            ),
        ),
      ),
    ),
    ast,
  );
  expect(createHash("sha256").update(body).digest("hex")).toBe(
    "0bb4fb8e8583cc274a7e666ced11c8794500e63e87c66e95f751d7eb59fb5e0c",
  );
  const ss = readFileSync(
      new URL("./manualRunCurrentReadSchema.ts", import.meta.url),
      "utf8",
    ),
    sa = ts.createSourceFile("schema.ts", ss, ts.ScriptTarget.Latest, true),
    declaration = sa.statements
      .filter(ts.isVariableStatement)
      .flatMap((s) => s.declarationList.declarations)
      .find(
        (d) => d.name.getText(sa) === "manualExecutionCurrentOutputSchema",
      )!;
  expect(
    createHash("sha256")
      .update(
        printer.printNode(
          ts.EmitHint.Unspecified,
          declaration.initializer!,
          sa,
        ),
      )
      .digest("hex"),
  ).toBe("87e403b7e4cd1cc115288adfa08c0f80dc0503610b34692536814cdc47a520e5");
  const router = readFileSync(
    new URL("../routers/manualExecution.ts", import.meta.url),
    "utf8",
  );
  expect(router).toContain(
    "readManualExecutionCurrentProjection(tx, ctx.user.id, ctx.user.clerkUserId, input)",
  );
  expect(source).not.toMatch(
    /\.\$transaction\(|createCaller\(|downloadFile|createViewUrl|classifyAndSuggest/,
  );
});
