import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@vaettir/db";
import { lockManualExecutionReadScope } from "./manualExecutionReadScope.js";

// Exercise the actual access/preflight service against synthetic native-query
// responses only. No database connection, credentials or case bodies are used.
function fixture(
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
describe("bounded 1,000-case manual execution read admission", () => {
  it.each([851, 1000])(
    "admits %s case/graph/result/library collections through the actual service",
    async (count) => {
      const f = fixture(count);
      expect(await f.read()).toMatchObject({
        testRunId: "synthetic-run",
        organizationId: "synthetic-org",
        canWrite: true,
      });
      expect(f.events.slice(0, 5)).toEqual([
        "Organization",
        "Membership",
        "Project",
        "User",
        "TestRun",
      ]);
      expect(f.events).toContain("batch");
    },
  );
  it("admits 999 prerequisite references within an exact 1,000-case scope", async () => {
    const f = fixture(1000, { dependencyFanout: true });
    expect(await f.read()).toMatchObject({ canWrite: true });
  });
  it("refuses 1,001 cases before loading even the graph metadata", async () => {
    const f = fixture(1001);
    await expect(f.read()).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(f.events).not.toContain("graph");
  });
  it.each([
    { resultCount: 1001n },
    { libraryCount: 1001 },
    { maxSteps: 501n },
    { libraryStepCount: 501 },
    { headCount: 25001n },
    { duplicateResults: true },
    { foreignCase: true },
  ])(
    "retains independent step, head, relationship and duplicate guards %#",
    async (overrides) => {
      await expect(fixture(1000, overrides).read()).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
    },
  );
  it.each([
    { runBytes: 4n * 1024n * 1024n + 1n },
    { caseBytes: 8n * 1024n * 1024n + 1n },
    { resultBytes: 4n * 1024n * 1024n + 1n },
    { headBytes: 4n * 1024n * 1024n + 1n },
  ])("does not relax native byte budgets %#", async (overrides) => {
    await expect(fixture(851, overrides).read()).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });
  it("READ_ONLY readers remain readable but cannot acquire write authority", async () => {
    expect(
      await fixture(851, { role: "VIEWER", seatType: "READ_ONLY" }).read(),
    ).toMatchObject({ canWrite: false });
  });
  it.each([{ suspended: true }, { clerkActorId: "synthetic-remapped-clerk" }])(
    "fresh original actor/organization guards remain mandatory %#",
    async (overrides) => {
      const f = fixture(851, overrides);
      await expect(f.read()).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(f.events).not.toContain("run-size");
    },
  );
});
