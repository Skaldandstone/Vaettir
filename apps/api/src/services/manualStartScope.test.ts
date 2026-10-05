import { describe, expect, it, vi } from "vitest";
import type { Context } from "../trpc.js";
// No identity provider, real database, network or device is used in this file.
vi.mock("../clerk.js", () => ({
  verifyClerkSessionToken: vi.fn(),
  getOrCreateLocalUser: vi.fn(),
}));
import { manualExecutionRouter } from "../routers/manualExecution.js";

const request = {
  projectId: "synthetic-project",
  testCaseIds: ["synthetic-case"],
  idempotencyKey: "6135d014-27f2-43d6-b3c5-31a13f38cd4b",
};
function fixture() {
  const events: string[] = [];
  const runs = new Map<string, Record<string, unknown>>();
  const state = {
    revoked: false,
    readonly: false,
    suspended: false,
    remapped: false,
    moved: false,
    pending: false,
    closureOverflow: false,
  };
  const member = {
    userId: "synthetic-actor",
    organizationId: "synthetic-org",
    role: "EDITOR",
    seatType: "FULL",
  };
  const project = {
    id: request.projectId,
    organizationId: member.organizationId,
    qualityProfile: {},
    organization: { suspendedAt: null, stepFieldLabels: {} },
  };
  const db = {
    project: { findUnique: vi.fn(async () => project) },
    organization: { findUnique: vi.fn(async () => ({ suspendedAt: null })) },
    membership: { findUnique: vi.fn(async () => member) },
    $executeRaw: vi.fn(async () => 0),
    $queryRaw: vi.fn(async (parts: TemplateStringsArray) => {
      const sql = parts.join("?");
      if (sql.includes('FROM "Organization"')) {
        events.push("Organization");
        return [{ suspendedAt: state.suspended ? new Date() : null }];
      }
      if (sql.includes('FROM "Membership"')) {
        events.push("Membership");
        return state.revoked
          ? []
          : [
              {
                role: "EDITOR",
                seatType: state.readonly ? "READ_ONLY" : "FULL",
              },
            ];
      }
      if (sql.includes('FROM "Project"')) {
        events.push("Project");
        return [
          {
            organizationId: state.moved
              ? "synthetic-other-org"
              : member.organizationId,
          },
        ];
      }
      if (sql.includes('FROM "User"')) {
        events.push("User");
        return [
          {
            clerkUserId: state.remapped
              ? "synthetic-other-session-subject"
              : "synthetic-clerk-subject",
          },
        ];
      }
      if (sql.includes('FROM "TestRun"')) {
        events.push("TestRun");
        return [];
      }
      if (sql.includes("pg_advisory")) {
        events.push("advisory");
        return [];
      }
      throw Error("Unexpected synthetic SQL shape");
    }),
    testRun: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        events.push("run-body");
        return runs.get(where.id) ?? null;
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const id = String(data.id ?? "synthetic-run");
        runs.set(id, { ...data, id });
        return { id };
      }),
    },
    testCasePrerequisite: {
      findMany: vi.fn(async () =>
        state.closureOverflow
          ? [{ dependentId: "case-0", prerequisiteId: "case-1000" }]
          : [
              {
                dependentId: "synthetic-case",
                prerequisiteId: "synthetic-prerequisite",
              },
            ],
      ),
    },
    testCase: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.map((id) => ({
          id,
          title: "Synthetic reviewed procedure",
          validationDomain: "SOFTWARE",
          reviewStatus:
            state.pending && id === "synthetic-prerequisite"
              ? "PENDING_REVIEW"
              : "APPROVED",
          background: null,
          given: [],
          when: [],
          then: [],
          verificationProfile: {},
          dataset: null,
          sharedStepGroup: null,
          steps: [
            {
              order: 0,
              action: "Synthetic action",
              expectedActionOrData: null,
              expectedResult: "Synthetic expected result",
              expectedResponse: null,
              mediaAttachmentIds: [],
            },
          ],
        })),
      ),
    },
  };
  const prisma = {
    ...db,
    $transaction: vi.fn(
      async (
        callback: (tx: typeof db) => unknown,
        _options?: { timeout?: number; isolationLevel?: string },
      ) => callback(db),
    ),
  };
  const caller = manualExecutionRouter.createCaller({
    prisma,
    user: {
      id: member.userId,
      clerkUserId: "synthetic-clerk-subject",
      email: "synthetic@example.invalid",
      memberships: [member],
    },
  } as unknown as Context);
  return { caller, db, prisma, state, events, runs };
}

describe("manual start current authorization and reviewed closure without a database", () => {
  it("freezes approved prerequisites and preserves the original snapshot on durable replay", async () => {
    const f = fixture();
    const first = await f.caller.start(request);
    const saved = structuredClone(f.runs.get(first.testRunId));
    expect(saved?.manualTestCaseIds).toEqual([
      "synthetic-prerequisite",
      "synthetic-case",
    ]);
    f.state.pending = true; // Later edits do not replace the acknowledged baseline.
    const reads = f.db.testCase.findMany.mock.calls.length;
    expect(await f.caller.start(request)).toEqual(first);
    expect(f.db.testCase.findMany.mock.calls.length).toBe(reads);
    expect(f.db.testRun.create).toHaveBeenCalledTimes(1);
    expect(f.runs.get(first.testRunId)).toEqual(saved);
    expect(f.events.slice(0, 5)).toEqual([
      "Organization",
      "Membership",
      "Project",
      "User",
      "TestRun",
    ]);
    const advisory = f.events.indexOf("advisory");
    expect(advisory).toBeGreaterThan(f.events.indexOf("User"));
    expect(
      f.prisma.$transaction.mock.calls.every(
        (call) =>
          call[1]?.timeout === 20000 &&
          call[1]?.isolationLevel === "RepeatableRead",
      ),
    ).toBe(true);
  });
  it.each(["revoked", "readonly", "suspended", "remapped", "moved"] as const)(
    "refuses %s access before reading a replay body",
    async (change) => {
      const f = fixture();
      await f.caller.start(request);
      const reads = f.db.testRun.findUnique.mock.calls.length;
      f.state[change] = true;
      await expect(f.caller.start(request)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(f.db.testRun.findUnique.mock.calls.length).toBe(reads);
      expect(f.db.testRun.create).toHaveBeenCalledTimes(1);
    },
  );
  it.each(["revoked", "readonly", "suspended", "remapped", "moved"] as const)(
    "fresh non-durable starts also refuse %s current scope",
    async (change) => {
      const f = fixture();
      f.state[change] = true;
      await expect(
        f.caller.start({
          projectId: request.projectId,
          testCaseIds: request.testCaseIds,
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(f.db.testCase.findMany).not.toHaveBeenCalled();
      expect(f.db.testRun.create).not.toHaveBeenCalled();
    },
  );
  it("never reuses an actor's durable key for changed case scope", async () => {
    const f = fixture();
    await f.caller.start(request);
    await expect(
      f.caller.start({ ...request, testCaseIds: ["synthetic-other-case"] }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.db.testRun.create).toHaveBeenCalledTimes(1);
  });
  it("rejects an unreviewed prerequisite without partial snapshot creation or approval", async () => {
    const f = fixture();
    f.state.pending = true;
    await expect(f.caller.start(request)).rejects.toThrow(
      "has not been approved",
    );
    expect(f.db.testRun.create).not.toHaveBeenCalled();
    expect(f.state.pending).toBe(true);
  });
  it("rejects a 1,000-case selection whose dependency closure grows to 1,001 before fetching procedures", async () => {
    const f = fixture();
    f.state.closureOverflow = true;
    await expect(
      f.caller.start({
        ...request,
        testCaseIds: Array.from({ length: 1000 }, (_, i) => `case-${i}`),
      }),
    ).rejects.toThrow("more than 1,000");
    expect(f.db.testCase.findMany).not.toHaveBeenCalled();
    expect(f.db.testRun.create).not.toHaveBeenCalled();
  });
});
