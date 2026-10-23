import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "../trpc.js";
import { atlassianQualityRouter } from "./atlassianQuality.js";

const binding = {
  appId: "ari:cloud:ecosystem::app/743bf96f-0f9f-4fed-981a-ea3fc318d15d",
  installationId:
    "ari:cloud:ecosystem::installation/10000000-0000-4000-8000-000000000001",
  environmentId:
    "ari:cloud:ecosystem::environment/d2844601-7a1f-4e4e-9b77-e0d4d3682c50",
  cloudId: "10000000-0000-4000-8000-000000000002",
  siteOrigin: "https://company.atlassian.net",
  product: "jira" as const,
  targetId: "10",
};
const request = {
  projectId: "project",
  organizationId: "org",
  connectionId: "10000000-0000-4000-8000-000000000003",
  expectedVersion: 0,
  requestId: "10000000-0000-4000-8000-000000000004",
  binding,
  snapshotIds: [],
  closureSnapshotIds: [],
  releaseLinks: [],
  shareTicketTests: true,
  approveTargetSharing: true as const,
};
type Row = {
  id: string;
  entityId: string;
  entityType: string;
  organizationId: string;
  projectId: string;
  metadata: Record<string, unknown>;
};
function fixture(role = "ADMIN", seatType = "FULL") {
  const rows: Row[] = [];
  const actor = {
    id: "actor",
    clerkUserId: "clerk",
    memberships: [{ organizationId: "org", role, seatType }],
  };
  const state = { role, seatType, moved: false };
  const match = (r: Row, where: Record<string, unknown>) =>
    Object.entries(where).every(
      ([key, value]) => r[key as keyof Row] === value,
    );
  const db = {
    user: {
      findUnique: vi.fn(async () => ({
        ...actor,
        memberships: [
          { organizationId: "org", role: state.role, seatType: state.seatType },
        ],
      })),
    },
    organization: { findUnique: vi.fn(async () => ({ suspendedAt: null })) },
    project: {
      findUnique: vi.fn(async () => ({
        id: "project",
        organizationId: state.moved ? "foreign" : "org",
      })),
    },
    auditLog: {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        rows.filter((r) => match(r, where)),
      ),
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) =>
          rows.find((r) => r.id === where.id) ?? null,
      ),
      create: vi.fn(async ({ data }: { data: Row }) => {
        rows.push(data);
        return data;
      }),
    },
    projectReportSnapshot: { findMany: vi.fn(async () => []) },
    release: { findFirst: vi.fn(async () => null) },
    testRun: { count: vi.fn(async () => 0) },
    $queryRaw: vi.fn(async (strings: TemplateStringsArray) =>
      strings.join("").includes('"Membership"')
        ? [{ role: state.role, seatType: state.seatType }]
        : strings.join("").includes('"Project"')
          ? [{ organizationId: state.moved ? "foreign" : "org" }]
          : [{ suspendedAt: null }],
    ),
  };
  const prisma = {
    ...db,
    $transaction: async <T>(work: (tx: typeof db) => Promise<T>) => {
      const before = [...rows];
      try {
        return await work(db);
      } catch (error) {
        rows.splice(0, rows.length, ...before);
        throw error;
      }
    },
  };
  const caller = atlassianQualityRouter.createCaller({
    user: actor,
    authenticatedClerkSubject: "clerk",
    prisma,
  } as unknown as Context);
  return { caller, db, rows, state };
}
beforeEach(() => {
  vi.stubEnv("VAETTIR_FORGE_APP_ID", binding.appId);
  vi.stubEnv("VAETTIR_FORGE_ENVIRONMENT_ID", binding.environmentId);
});
afterEach(() => vi.unstubAllEnvs());
describe("administrator-owned explicit Atlassian sharing", () => {
  it("requires fresh full-seat admin authority, not a stale context or paid feature entitlement", async () => {
    for (const [role, seat] of [
      ["EDITOR", "FULL"],
      ["VIEWER", "FULL"],
      ["ADMIN", "READ_ONLY"],
    ]) {
      const f = fixture(role, seat);
      await expect(f.caller.publish(request)).rejects.toThrow();
      expect(f.db.auditLog.create).not.toHaveBeenCalled();
    }
    const f = fixture();
    f.state.role = "EDITOR";
    await expect(f.caller.publish(request)).rejects.toThrow();
    const moved = fixture();
    moved.state.moved = true;
    await expect(moved.caller.publish(request)).rejects.toThrow();
  });
  it("is idempotent without falsely reporting old approvals as currently active after revocation", async () => {
    const f = fixture();
    expect(await f.caller.publish(request)).toMatchObject({
      state: "APPROVED",
      version: 1,
    });
    expect(await f.caller.publish(request)).toMatchObject({
      state: "APPROVED",
      version: 1,
    });
    expect(f.rows).toHaveLength(1);
    const id = f.rows[0]!.entityId,
      revoke = {
        projectId: "project",
        organizationId: "org",
        id,
        requestId: "10000000-0000-4000-8000-000000000005",
      };
    await f.caller.revoke(revoke);
    expect(await f.caller.publish(request)).toMatchObject({
      state: "REVOKED",
      version: 2,
    });
    await f.caller.publish({
      ...request,
      expectedVersion: 2,
      requestId: "10000000-0000-4000-8000-000000000006",
    });
    expect(await f.caller.revoke(revoke)).toMatchObject({
      state: "APPROVED",
      version: 3,
    });
    expect(f.rows).toHaveLength(3);
  });
  it("refuses stale approvals, retargeting an existing connection, foreign evidence, or reusing an intent for changed scope", async () => {
    const f = fixture();
    await f.caller.publish(request);
    await expect(
      f.caller.publish({ ...request, snapshotIds: ["a".repeat(64)] }),
    ).rejects.toThrow();
    await expect(
      f.caller.publish({
        ...request,
        requestId: "10000000-0000-4000-8000-000000000007",
      }),
    ).rejects.toThrow(/Sharing changed/);
    await expect(
      f.caller.publish({
        ...request,
        expectedVersion: 1,
        requestId: "10000000-0000-4000-8000-000000000007",
        binding: { ...binding, targetId: "20" },
      }),
    ).rejects.toThrow(/new connection/);
    await expect(
      f.caller.publish({
        ...request,
        expectedVersion: 1,
        requestId: "10000000-0000-4000-8000-000000000007",
        releaseLinks: [
          {
            jiraVersionId: "45",
            releaseId: "foreign",
            runIds: ["foreign-run"],
          },
        ],
      }),
    ).rejects.toThrow(/existing project release/);
    expect(f.rows).toHaveLength(1);
  });
});
