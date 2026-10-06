import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { readRunHistoryAccess, readRunHistoryPage } from "./runHistoryRead.js";
import { runHistoryReadKey } from "./runHistoryReadSchema.js";
function fixture() {
  const input = {
    projectId: "p",
    originalOrganizationId: "o",
    expectedClerkActorId: "cl",
    expectedNativeActorId: "n",
    requestId: randomUUID(),
    limit: 2,
    asOf: "2026-09-02T00:00:00.000Z",
  };
  const row = (id: string) => ({
    id,
    ciProvider: "manual",
    ciRunUrl: null,
    commitSha: "manual",
    branch: "manual",
    status: "RUNNING",
    startedAt: new Date("2026-09-01T00:00:00Z"),
    finishedAt: null,
    startedByEmail: "synthetic@example.com",
    resultCount: 1n,
    plannedIds: ["case-a", "case-b"],
    scopeSupported: true,
    headMismatch: false,
  });
  const events: string[] = [],
    state = {
      organizationId: "o",
      role: "VIEWER",
      seatType: "READ_ONLY",
      suspendedAt: null as Date | null,
      nativeClerk: "cl",
      nativeExists: true,
      cursor: true,
      foreign: false,
      runs: 2n,
      metadataBytes: 2000n,
      projectionBytes: 200n,
      groups: 2n,
      results: 2n,
      heads: 0n,
      timeSupported: true,
      invalid: false,
      rows: [row("run-b"), row("run-a")],
      outcomes: [
        {
          testRunId: "run-a",
          testCaseId: "case-a" as string | null,
          status: "PASS",
          count: 1n,
        },
        {
          testRunId: "run-b",
          testCaseId: "case-a" as string | null,
          status: "FAIL",
          count: 1n,
        },
      ],
    };
  const tx = {
    $executeRaw: vi.fn(async () => 0),
    project: {
      findUnique: vi.fn(async () => ({ organizationId: state.organizationId })),
    },
    $queryRaw: vi.fn(async (raw: readonly string[] | { sql: string }) => {
      const sql = Array.isArray(raw)
        ? raw.join("?")
        : (raw as { sql: string }).sql;
      if (sql.includes('FROM "Organization"')) {
        events.push("org-auth");
        return [{ suspendedAt: state.suspendedAt }];
      }
      if (sql.includes('FROM "Membership"')) {
        events.push("membership-auth");
        return [{ role: state.role, seatType: state.seatType }];
      }
      if (sql.includes('FROM "Project"') && sql.includes("FOR SHARE")) {
        events.push("project-auth");
        return [{ organizationId: state.organizationId }];
      }
      if (sql.includes('FROM "User"') && sql.includes("FOR SHARE")) {
        events.push("native-clerk-auth");
        return state.nativeExists ? [{ clerkUserId: state.nativeClerk }] : [];
      }
      if (sql.includes(" AS present")) {
        events.push("cursor");
        return [{ present: state.cursor }];
      }
      if (sql.includes(" AS foreign")) {
        events.push("relationships");
        return [{ foreign: state.foreign }];
      }
      if (sql.includes('AS "metadataBytes"')) {
        events.push("native-admission");
        return [
          {
            runs: state.runs,
            metadataBytes: state.metadataBytes,
            projectionBytes: state.projectionBytes,
            groups: state.groups,
            results: state.results,
            heads: state.heads,
            timeSupported: state.timeSupported,
            invalid: state.invalid,
          },
        ];
      }
      if (sql.includes('AS "resultCount"')) {
        events.push("metadata-projection");
        return state.rows;
      }
      if (sql.includes('AS "testCaseId"')) {
        events.push("status-projection");
        return state.outcomes;
      }
      throw Error("Unexpected mocked run-history SQL");
    }),
  };
  const db = {
    $transaction: vi.fn(
      async (run: (tx: typeof tx) => unknown, options: unknown) => {
        expect(options).toMatchObject({
          isolationLevel: "RepeatableRead",
          timeout: 10000,
          maxWait: 5000,
        });
        return run(tx);
      },
    ),
  };
  return { input, state, events, tx, db: db as never };
}
describe("additive current native run-history metadata reader, mocked SQL NOT RUN", () => {
  it("bootstrap/page echo original native/org/Clerk/request nonce and exact page anchor; Viewer is not upgraded", async () => {
    const h = fixture(),
      access = await readRunHistoryAccess(
        h.db,
        "n",
        {
          projectId: "p",
          originalOrganizationId: "o",
          expectedClerkActorId: "cl",
          requestId: h.input.requestId,
        },
        { clerkActorId: "cl" },
      );
    expect(access.readContext).toMatchObject({
      projection: "ACCESS",
      requestId: h.input.requestId,
      scope: {
        projectId: "p",
        organizationId: "o",
        actorId: "n",
        actorClerkUserId: "cl",
      },
    });
    const page = await readRunHistoryPage(h.db, "n", h.input, {
      clerkActorId: "cl",
    });
    expect(page.readContext).toEqual({
      projection: "PAGE",
      requestId: h.input.requestId,
      requestedKey: runHistoryReadKey(h.input),
      asOf: h.input.asOf,
      scope: access.readContext.scope,
    });
    expect(page.rows.map((row) => row.id)).toEqual(["run-b", "run-a"]);
    expect(page.rows[0]?.progress).toMatchObject({
      total: 2,
      recorded: 1,
      remaining: 1,
      percentComplete: 50,
      pass: 0,
      fail: 1,
    });
    expect(page.rows[0]?.progressBasis).toBe(
      "PLANNED_IDENTITIES_CURRENT_RESULTS",
    );
    expect(page.rows[0]).not.toHaveProperty("plannedIds");
    expect(h.events.indexOf("native-clerk-auth")).toBeLessThan(
      h.events.indexOf("relationships"),
    );
    expect(h.events.indexOf("native-admission")).toBeLessThan(
      h.events.indexOf("metadata-projection"),
    );
    expect(h.state.seatType).toBe("READ_ONLY");
  });
  it.each(["organization", "native", "Clerk", "suspension", "membership"])(
    "current %s refusal precedes private metadata/count admission",
    async (kind) => {
      const h = fixture();
      if (kind === "organization") h.state.organizationId = "other";
      if (kind === "native") h.input.expectedNativeActorId = "other";
      if (kind === "Clerk") h.state.nativeClerk = "other";
      if (kind === "suspension") h.state.suspendedAt = new Date();
      if (kind === "membership") h.state.role = "REMOVED";
      await expect(
        readRunHistoryPage(h.db, "n", h.input, { clerkActorId: "cl" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(h.events).not.toContain("relationships");
      expect(h.events).not.toContain("native-admission");
      expect(h.events).not.toContain("metadata-projection");
    },
  );
  it("foreign actual case/revision/result pointers refuse whole query before native bytes, not statistics", async () => {
    const h = fixture();
    h.state.foreign = true;
    await expect(
      readRunHistoryPage(h.db, "n", h.input, { clerkActorId: "cl" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(h.events).not.toContain("native-admission");
    expect(h.events).not.toContain("metadata-projection");
  });
  it.each([
    { metadataBytes: 131073n },
    { projectionBytes: 16776000n, metadataBytes: 2000n },
    { groups: 100001n },
    { results: 100001n },
    { heads: 100001n },
    { runs: 4n },
    { projectionBytes: -1n },
    { projectionBytes: 3000000000n },
    { invalid: true },
    { timeSupported: false },
  ])(
    "complete native admission %o refuses before private projection",
    async (patch) => {
      const h = fixture();
      Object.assign(h.state, patch);
      await expect(
        readRunHistoryPage(h.db, "n", h.input, { clerkActorId: "cl" }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(h.events).not.toContain("metadata-projection");
      expect(h.events).not.toContain("status-projection");
    },
  );
  it("lookahead is admitted but not returned/exported; equal timestamp keyset uses explicit C ordering", async () => {
    const h = fixture();
    h.state.rows.push({ ...h.state.rows[0]!, id: "run-0" });
    h.state.outcomes.push({
      testRunId: "run-0",
      testCaseId: "case-a",
      status: "SKIP",
      count: 1n,
    });
    h.state.runs = 3n;
    h.state.groups = 3n;
    h.state.results = 3n;
    const page = await readRunHistoryPage(h.db, "n", h.input, {
      clerkActorId: "cl",
    });
    expect(page.rows).toHaveLength(2);
    expect(page.hasMore).toBe(true);
    expect(page.nextBefore).toEqual({
      id: "run-a",
      startedAt: "2026-09-01T00:00:00.000Z",
    });
    const sql = h.tx.$queryRaw.mock.calls
      .map(([raw]) =>
        Array.isArray(raw) ? raw.join("?") : (raw as { sql: string }).sql,
      )
      .join("\n");
    expect(sql).toContain('r.id COLLATE "C" DESC');
    expect(sql).toContain('r."startedAt"<=');
  });
  it("unavailable/changed/foreign cursor refuses before run population; cursor is only a same-project locator", async () => {
    const h = fixture();
    h.state.cursor = false;
    await expect(
      readRunHistoryPage(
        h.db,
        "n",
        {
          ...h.input,
          before: { id: "cursor", startedAt: "2026-09-01T00:00:00.000Z" },
        },
        { clerkActorId: "cl" },
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(h.events.at(-1)).toBe("cursor");
    expect(h.events).not.toContain("relationships");
  });
  it.each([
    "scope",
    "head",
    "conflicting-status",
    "unsupported-identity",
    "nonarray-scope",
    "duplicate-scope",
  ])(
    "%s remains explicit unavailable progress, never zero/complete",
    async (kind) => {
      const h = fixture();
      if (kind === "scope") {
        h.state.rows[0]!.scopeSupported = false;
        h.state.rows[0]!.plannedIds = null as never;
      }
      if (kind === "head") h.state.rows[0]!.headMismatch = true;
      if (kind === "conflicting-status") {
        h.state.rows[0]!.resultCount = 2n;
        h.state.outcomes.push({
          testRunId: "run-b",
          testCaseId: "case-a",
          status: "PASS",
          count: 1n,
        });
        h.state.groups = 3n;
        h.state.results = 3n;
      }
      if (kind === "unsupported-identity")
        h.state.rows[0]!.plannedIds = ["case-a", "\u0001bad"];
      if (kind === "nonarray-scope")
        h.state.rows[0]!.plannedIds = "retained-invalid" as never;
      if (kind === "duplicate-scope")
        h.state.rows[0]!.plannedIds = ["case-a", "case-a"];
      const page = await readRunHistoryPage(h.db, "n", h.input, {
        clerkActorId: "cl",
      });
      expect(page.rows[0]?.progress).toBeNull();
      expect(page.rows[0]?.progressUnavailableReason).toContain(
        "No partial or zero progress",
      );
    },
  );
  it("CI counts raw ingested observations including unmatched, not manual planned completion", async () => {
    const h = fixture();
    h.state.rows[0]!.ciProvider = "synthetic-ci";
    h.state.rows[0]!.plannedIds = null as never;
    h.state.rows[0]!.resultCount = 7n;
    h.state.outcomes[1] = {
      testRunId: "run-b",
      testCaseId: null,
      status: "PASS",
      count: 7n,
    };
    h.state.results = 8n;
    const page = await readRunHistoryPage(h.db, "n", h.input, {
      clerkActorId: "cl",
    });
    expect(page.rows[0]).toMatchObject({
      progressBasis: "CI_INGESTED_RESULTS",
      progress: { total: 7, recorded: 7, remaining: 0 },
    });
    expect(page.limitations.join(" ")).toContain("no planned CI denominator");
  });
  it("authorized empty page is not unavailable progress or whole-project zero; missing admitted rows refuse", async () => {
    const h = fixture();
    h.state.rows = [];
    h.state.outcomes = [];
    h.state.runs = 0n;
    h.state.groups = 0n;
    h.state.results = 0n;
    expect(
      await readRunHistoryPage(h.db, "n", h.input, { clerkActorId: "cl" }),
    ).toMatchObject({ rows: [], hasMore: false, nextBefore: null });
    h.state.runs = 1n;
    await expect(
      readRunHistoryPage(h.db, "n", h.input, { clerkActorId: "cl" }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
  it("Unicode DTO width mismatch and count/projection disagreement refuse generically without clipping", async () => {
    for (const kind of ["width", "count"]) {
      const h = fixture();
      if (kind === "width") h.state.rows[0]!.ciProvider = "😀".repeat(129);
      else h.state.rows[0]!.resultCount = 3n;
      await expect(
        readRunHistoryPage(h.db, "n", h.input, { clerkActorId: "cl" }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    }
  });
  it("source contracts admit native ID widths and actual head pointers, no fabricated step tenant columns/body export; SQL not executed", () => {
    const source = readFileSync(
      new URL("./runHistoryRead.ts", import.meta.url),
      "utf8",
    );
    for (const text of [
      'coalesce(octet_length(r."manualTestCaseIds"::text),0)<=1048576',
      "r.\"executionContext\"->>'version'='1'",
      'v."testRunId"<>h."testRunId"',
      'v."testCaseId"<>h."testCaseId"',
      'v."testResultId"<>h."testResultId"',
      "e.status<>v.status",
      "heads.count<definition.steps AND e.id IS NOT NULL",
    ])
      expect(source).toContain(text);
    expect(source).toMatch(
      /admission\.projectionBytes\s*\+\s*admission\.metadataBytes\s*>\s*16777216n/,
    );
    expect(source).toContain('SELECT r.id FROM "TestRun" r WHERE');
    expect(source).not.toContain("SELECT r.*");
    expect(source).toContain(
      'CASE WHEN cardinality(r."manualTestCaseIds") BETWEEN 0 AND 1000',
    );
    expect(source).not.toContain("octet_length(concat");
    expect(source).toContain("date_trunc('milliseconds'");
    expect(source).toContain(
      'extract(year FROM r."startedAt") BETWEEN 1 AND 9999',
    );
    expect(source).toMatch(/admission\.timeSupported\s*!==\s*true/);
    expect(source).not.toMatch(
      /select:[^;]*observations|\.testResult\.(create|update)|downloadFile|recomputeFlaky/,
    );
  });
  it.each(["missing-finish", "future-start", "invalid-start"])(
    "native %s cannot become inferred NULL or outside-anchor evidence",
    async (kind) => {
      const h = fixture();
      if (kind === "missing-finish")
        h.state.rows[0]!.finishedAt = undefined as never;
      if (kind === "future-start")
        h.state.rows[0]!.startedAt = new Date("2026-09-03T00:00:00Z");
      if (kind === "invalid-start")
        h.state.rows[0]!.startedAt = new Date("invalid");
      await expect(
        readRunHistoryPage(h.db, "n", h.input, { clerkActorId: "cl" }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    },
  );
  it.each(["reversed-ids", "reversed-time", "cursor-bound"])(
    "actual %s projection is refused, not silently sorted/rebased",
    async (kind) => {
      const h = fixture();
      if (kind === "reversed-ids") h.state.rows.reverse();
      if (kind === "reversed-time")
        h.state.rows[1]!.startedAt = new Date("2026-09-01T01:00:00Z");
      const input =
        kind === "cursor-bound"
          ? {
              ...h.input,
              before: { id: "run-b", startedAt: "2026-09-01T00:00:00.000Z" },
            }
          : h.input;
      await expect(
        readRunHistoryPage(h.db, "n", input, { clerkActorId: "cl" }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(h.events).not.toContain("status-projection");
    },
  );
  it("mock native submillisecond/unsupported-calendar admission refuses before Date/metadata conversion", async () => {
    const h = fixture();
    h.state.timeSupported = false;
    await expect(
      readRunHistoryPage(h.db, "n", h.input, { clerkActorId: "cl" }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(h.events).not.toContain("metadata-projection");
    expect(h.events).not.toContain("status-projection");
  });
});
