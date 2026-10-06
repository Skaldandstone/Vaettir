import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import type { Context } from "../trpc.js";
const { readScope } = vi.hoisted(() => ({ readScope: vi.fn() }));
vi.mock("../services/manualExecutionReadScope.js", () => ({
  lockManualExecutionReadScope: readScope,
}));
import { manualExecutionRouter } from "./manualExecution.js";
function fixture() {
  const events: string[] = [],
    definition = (id: string) => ({
      testCaseId: id,
      title: ` Frozen ${id}\n `,
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
      steps: [
        {
          order: 8,
          action: " action\n ",
          expectedActionOrData: "",
          expectedResult: null,
          expectedResponse: " response ",
          mediaAttachmentIds: [],
        },
      ],
    }),
    state = {
      run: {
        id: "run",
        projectId: "p",
        ciProvider: "manual",
        status: "RUNNING",
        manualTestCaseIds: ["a", "b", "missing"],
        manualPrerequisites: { a: [], b: ["missing"], missing: [] },
        executionContext: null as unknown,
        project: { organization: { stepFieldLabels: {} } },
      },
      cases: ["a", "b"].map((id) => ({
        id,
        displayId: `CASE-${id}`,
        title: `Current ${id}`,
        background: null,
        validationDomain: "SOFTWARE",
        verificationProfile: {},
        given: [],
        when: [],
        then: [],
        steps: [],
        sharedStepGroup: null,
      })),
      results: [
        { testCaseId: "a", status: "PASS", note: null, observations: {} },
      ],
      bounds: { count: 3, scopeBytes: 20n, contextBytes: 0n },
      current: [
        { id: "a", foreign: false },
        { id: "b", foreign: false },
      ],
      nativeRole: "EDITOR",
      nativeSeat: "FULL",
    };
  const tx = {
    project: {
      findUnique: vi.fn(async () => {
        events.push("current-project");
        return {
          id: "p",
          organizationId: "o",
          organization: { suspendedAt: null },
        };
      }),
    },
    membership: {
      findUnique: vi.fn(async () => {
        events.push("current-member");
        return { role: state.nativeRole, seatType: state.nativeSeat };
      }),
    },
    organization: { findUnique: vi.fn(async () => ({ suspendedAt: null })) },
    testRun: {
      findUniqueOrThrow: vi.fn(async () => {
        events.push("run-body");
        return state.run;
      }),
      update: vi.fn(async (input: { data: { status: string } }) => {
        events.push("update");
        return input.data;
      }),
    },
    testCase: {
      findMany: vi.fn(async () => {
        events.push("case-body");
        return state.cases;
      }),
    },
    testResult: {
      findMany: vi.fn(async () => {
        events.push("result-body");
        return state.results;
      }),
    },
    manualStepResultHead: {
      aggregate: vi.fn(async () => ({ _sum: { currentPayloadBytes: 0 } })),
      findMany: vi.fn(async () => []),
    },
    $queryRaw: vi.fn(async (raw: readonly string[] | { sql: string }) => {
      const sql = Array.isArray(raw)
        ? raw.join("?")
        : (raw as { sql: string }).sql;
      if (sql.includes("FOR UPDATE")) {
        events.push("run-lock");
        return [{ id: "run" }];
      }
      if (sql.includes('AS "contextBytes"')) {
        events.push("availability-bounds");
        return [state.bounds];
      }
      if (sql.includes("FOR SHARE OF c")) {
        events.push("case-identity-locks");
        return state.current;
      }
      if (sql.includes("set_config")) {
        events.push("finalize-local");
        return [];
      }
      throw Error("Unexpected mocked availability query");
    }),
  };
  const db = {
    ...tx,
    $transaction: vi.fn(async (work: (value: typeof tx) => unknown) =>
      work(tx),
    ),
  };
  readScope.mockImplementation(async () => {
    events.push("read-auth");
    return {
      testRunId: "run",
      projectId: "p",
      organizationId: "o",
      originalOrganizationId: "o",
      actorId: "n",
      clerkActorId: "cl",
      canWrite: true,
      readRequestKey: '{"testRunId":"run"}',
    };
  });
  const caller = manualExecutionRouter.createCaller({
    prisma: db,
    user: {
      id: "n",
      clerkUserId: "cl",
      memberships: [{ organizationId: "o", role: "EDITOR", seatType: "FULL" }],
    },
    staff: null,
  } as unknown as Context);
  return {
    state,
    tx,
    events,
    caller,
    definition,
    freeze: () => {
      state.run.executionContext = {
        version: 1,
        experience: null,
        profileHash: "a".repeat(64),
        configuration: {},
        stepFieldLabels: { expectedResponse: "Reply" },
        caseDefinitions: state.run.manualTestCaseIds.map(definition),
      };
    },
  };
}
it("actual router read keeps full planned denominator and readonly missing IDs while available procedures/prerequisite graph stay unchanged (mocked scope, no native SQL)", async () => {
  const h = fixture(),
    result = await h.caller.getForExecution({ testRunId: "run" });
  expect(result.plannedCaseIds).toEqual(["a", "b", "missing"]);
  expect(result.cases.map((row) => row.testCaseId)).toEqual(["a", "b"]);
  expect(result.unavailableCases).toEqual([
    { testCaseId: "missing", reason: "MISSING_CASE_AND_FROZEN_DEFINITION" },
  ]);
  expect(result.scopeAvailability).toMatchObject({
    plannedCount: 3,
    availableCount: 2,
    unavailableCount: 1,
    complete: false,
  });
  expect(result.cases[1]!.prerequisiteIds).toEqual(["missing"]);
  expect(h.events.indexOf("read-auth")).toBeLessThan(
    h.events.indexOf("run-body"),
  );
  expect(h.tx.testRun.update).not.toHaveBeenCalled();
});
it("deleted current cases with complete frozen scope retain all original multiline/null/blank/stored step fields, not current mutable substitutes", async () => {
  const h = fixture();
  h.freeze();
  h.state.cases = [];
  const result = await h.caller.getForExecution({ testRunId: "run" });
  expect(result.cases).toHaveLength(3);
  expect(result.unavailableCases).toEqual([]);
  expect(result.cases[0]!.title).toBe(" Frozen a\n ");
  expect(result.cases[0]!.displayId).toBeNull();
  expect(result.cases[0]!.steps[0]).toEqual(h.definition("a").steps[0]);
  expect(result.scopeAvailability.procedureBasis).toBe(
    "FROZEN_RUN_DEFINITIONS",
  );
});
it("existing incomplete/unsupported frozen snapshot is refused rather than falling back to current case procedures", async () => {
  const h = fixture();
  h.freeze();
  (
    h.state.run.executionContext as { caseDefinitions: unknown[] }
  ).caseDefinitions.pop();
  await expect(
    h.caller.getForExecution({ testRunId: "run" }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(h.tx.testRun.update).not.toHaveBeenCalled();
});
it("current locked read refusal still precedes body/availability projection; the partition helper does not become authority", async () => {
  const h = fixture();
  readScope.mockRejectedValue(new Error("Current original scope refused"));
  await expect(h.caller.getForExecution({ testRunId: "run" })).rejects.toThrow(
    /Current original/,
  );
  expect(h.tx.testRun.findUniqueOrThrow).not.toHaveBeenCalled();
});
it("actual completion independently locks run/case identities and refuses missing procedure before results/status/update/finalize writes", async () => {
  const h = fixture();
  await expect(h.caller.complete({ testRunId: "run" })).rejects.toMatchObject({
    code: "PRECONDITION_FAILED",
  });
  expect(h.events.indexOf("run-lock")).toBeLessThan(
    h.events.indexOf("availability-bounds"),
  );
  expect(h.events).toContain("case-identity-locks");
  expect(h.events).not.toContain("result-body");
  expect(h.events).not.toContain("finalize-local");
  expect(h.tx.testRun.update).not.toHaveBeenCalled();
});
it("available legacy untested scope remains completable as PARTIAL without changing existing rollup semantics", async () => {
  const h = fixture();
  h.state.current.push({ id: "missing", foreign: false });
  const result = await h.caller.complete({ testRunId: "run" });
  expect(result.status).toBe("PARTIAL");
  expect(h.tx.testRun.update).toHaveBeenCalledOnce();
  expect(h.events.indexOf("case-identity-locks")).toBeLessThan(
    h.events.indexOf("update"),
  );
});
it("complete frozen definitions allow deleted-current-case read-only context, preserve planned count and existing unfinished rollup", async () => {
  const h = fixture();
  h.freeze();
  h.state.current = [];
  expect((await h.caller.complete({ testRunId: "run" })).status).toBe(
    "PARTIAL",
  );
});
it("foreign current case is never masked as missing or cleared by an otherwise complete frozen definition", async () => {
  const h = fixture();
  h.freeze();
  h.state.current[0]!.foreign = true;
  await expect(h.caller.complete({ testRunId: "run" })).rejects.toMatchObject({
    code: "PRECONDITION_FAILED",
  });
  expect(h.tx.testRun.update).not.toHaveBeenCalled();
});
it("a locked native count or invalid planned scope cannot reach current case identity projection or finalization", async () => {
  for (const kind of ["count", "duplicate"]) {
    const h = fixture();
    if (kind === "count") h.state.bounds.count = 2;
    else h.state.run.manualTestCaseIds = ["a", "a", "missing"];
    await expect(h.caller.complete({ testRunId: "run" })).rejects.toMatchObject(
      { code: "PRECONDITION_FAILED" },
    );
    expect(h.events).not.toContain("case-identity-locks");
    expect(h.tx.testRun.update).not.toHaveBeenCalled();
  }
});
it.each(["scope", "context", "count", "negative", "integer"])(
  "native-shaped %s admission refuses before further procedure/identity projection and write (mock response, not SQL proof)",
  async (kind) => {
    const h = fixture();
    if (kind === "scope") h.state.bounds.scopeBytes = 524289n;
    if (kind === "context") h.state.bounds.contextBytes = 4194305n;
    if (kind === "count") h.state.bounds.count = 1001;
    if (kind === "negative") h.state.bounds.contextBytes = -1n;
    if (kind === "integer") h.state.bounds.count = 1.5;
    await expect(h.caller.complete({ testRunId: "run" })).rejects.toMatchObject(
      { code: "PRECONDITION_FAILED" },
    );
    expect(h.events).not.toContain("case-identity-locks");
    expect(h.tx.testRun.update).not.toHaveBeenCalled();
  },
);
it("current FULL editor authorization remains necessary before availability/finalization, closed status cannot be reopened by this refusal guard", async () => {
  for (const kind of ["seat", "closed"]) {
    const h = fixture();
    h.freeze();
    if (kind === "seat") h.state.nativeSeat = "READ_ONLY";
    else h.state.run.status = "PASSED";
    await expect(h.caller.complete({ testRunId: "run" })).rejects.toMatchObject(
      { code: kind === "seat" ? "FORBIDDEN" : "BAD_REQUEST" },
    );
    expect(h.events).not.toContain("availability-bounds");
    expect(h.tx.testRun.update).not.toHaveBeenCalled();
  }
});
it("source admission is additive only, original writes/rollup/request hashes are not replaced by availability metadata", () => {
  const source = readFileSync(
    new URL("./manualExecution.ts", import.meta.url),
    "utf8",
  );
  expect(source).toContain("cases: availability.availableCaseIds");
  expect(source).toContain(
    "requireCompleteManualRunScopeAvailability(availability)",
  );
  expect(source).toContain("FOR SHARE OF c");
  expect(source).toContain(
    "const status = manualRunStatus(run.manualTestCaseIds.length",
  );
  expect(source).not.toContain(
    ".filter((c): c is NonNullable<typeof c> => c !== null)",
  );
});
