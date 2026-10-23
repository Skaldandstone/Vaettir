import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@vaettir/db";
import type { ForgeIdentity } from "./forgeInvocation.js";
vi.mock("./reportPlanCaseScope.js", () => ({
  readReportPlanCaseScope: async () => ({ caseIds: ["case"], limitations: [] }),
}));
import {
  captureJiraRelease,
  readJiraReleaseQuality,
  readSharedClosure,
} from "./jiraReleaseEvidence.js";

const identity: ForgeIdentity = {
  appId: "ari:cloud:ecosystem::app/743bf96f-0f9f-4fed-981a-ea3fc318d15d",
  installationId:
    "ari:cloud:ecosystem::installation/10000000-0000-4000-8000-000000000001",
  environmentId:
    "ari:cloud:ecosystem::environment/d2844601-7a1f-4e4e-9b77-e0d4d3682c50",
  cloudId: "10000000-0000-4000-8000-000000000002",
  siteOrigin: "https://company.atlassian.net",
  product: "jira",
  targetId: "10",
  principal: "automation",
  moduleKey: "release-event",
  apiBaseUrl:
    "https://api.atlassian.com/ex/jira/10000000-0000-4000-8000-000000000002",
};
const {
  appId,
  installationId,
  environmentId,
  cloudId,
  siteOrigin,
  product,
  targetId,
} = identity;
const binding = {
  appId,
  installationId,
  environmentId,
  cloudId,
  siteOrigin,
  product,
  targetId,
};
const version = {
  id: "45",
  projectId: 10,
  name: "v1",
  released: true,
  archived: false,
};
const observed = "2026-10-16T00:00:00.000Z";
function fixture() {
  type Row = {
    id: string;
    entityType: string;
    entityId: string;
    organizationId: string;
    projectId: string;
    actorId: string;
    metadata: Record<string, unknown>;
  };
  const grants: Row[] = [
      {
        id: "approval",
        entityType: "ForgeQualitySharing",
        entityId: "key",
        organizationId: "org",
        projectId: "project",
        actorId: "approver",
        metadata: {
          connectionId: "10000000-0000-4000-8000-000000000003",
          version: 1,
          state: "APPROVED",
          binding,
          snapshotIds: [],
          releaseLinks: [
            { jiraVersionId: "45", releaseId: "release", runIds: ["run"] },
          ],
          closureSnapshotIds: [],
        },
      },
    ],
    captures: Row[] = [];
  const tx = {
    $queryRaw: vi.fn(async () => []),
    organization: { findUnique: vi.fn(async () => ({ suspendedAt: null })) },
    project: { findUnique: vi.fn(async () => ({ organizationId: "org" })) },
    auditLog: {
      findMany: vi.fn(async () => grants),
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) =>
          captures.find((c) => c.id === where.id) ?? null,
      ),
      findFirst: vi.fn(
        async ({ where }: { where: { id: string } }) =>
          captures.find((c) => c.id === where.id) ?? null,
      ),
      create: vi.fn(async ({ data }: { data: Row }) => {
        captures.push(data);
        return data;
      }),
    },
    release: {
      findFirst: vi.fn(async () => ({
        id: "release",
        name: "Release one",
        testPlans: [{ id: "plan" }],
        riskFlags: [{ severity: "HIGH" }],
      })),
    },
    testCase: {
      findMany: vi.fn(async () => [
        {
          id: "case",
          displayId: "APP-1",
          title: "Check payment",
          priority: "HIGH",
          reviewStatus: "APPROVED",
          background: "PRIVATE_CASE_DEFINITION",
          sharedStepGroup: {
            projectId: "project",
            steps: ["PRIVATE_SHARED_STEPS"],
          },
        },
      ]),
    },
    testRun: {
      findMany: vi.fn(async () => [
        {
          id: "run",
          status: "FAILED",
          ciProvider: "manual",
          startedAt: new Date(observed),
          finishedAt: new Date(observed),
          commitSha: "abc123",
          branch: "main",
          manualTestCaseIds: ["case"],
          executionContext: { private: "PRIVATE_RUN_CONTEXT" },
        },
      ]),
    },
    testResult: {
      findMany: vi.fn(async () => [
        { id: "result", testCaseId: "case", testRunId: "run", status: "FAIL" },
      ]),
    },
  };
  return {
    tx: tx as unknown as Prisma.TransactionClient,
    spies: tx,
    grants,
    captures,
  };
}
describe("immutable Jira Released capture", () => {
  it("retains private definitions once and never rewrites metrics on retry, later edits, or release reopening", async () => {
    const f = fixture();
    expect(
      await captureJiraRelease(f.tx, "key", identity, version, observed),
    ).toEqual({ captured: true });
    const original = JSON.stringify(f.captures);
    expect(f.captures[0]?.actorId).toBe("approver");
    expect(f.captures[0]?.metadata).toMatchObject({
      automation: "JIRA_VERSION_RELEASED",
      approvalId: "approval",
      observedAt: observed,
      summary: { mode: "FROZEN", counts: { fail: 1, pass: 0 } },
    });
    expect(original).toContain("PRIVATE_CASE_DEFINITION");
    expect(original).toContain("PRIVATE_RUN_CONTEXT");
    expect(original).toContain("PRIVATE_SHARED_STEPS");
    f.spies.testResult.findMany.mockResolvedValue([
      { id: "result", testCaseId: "case", testRunId: "run", status: "PASS" },
    ]);
    await captureJiraRelease(
      f.tx,
      "key",
      identity,
      version,
      "2026-10-17T00:00:00.000Z",
    );
    expect(JSON.stringify(f.captures)).toBe(original);
    expect(f.spies.auditLog.create).toHaveBeenCalledTimes(1);
    const frozen = await readJiraReleaseQuality(f.tx, "key", identity, version);
    expect(frozen.counts.fail).toBe(1);
    expect(JSON.stringify(frozen)).not.toMatch(
      /PRIVATE_CASE|PRIVATE_RUN|PRIVATE_SHARED/,
    );
    await expect(
      captureJiraRelease(
        f.tx,
        "key",
        identity,
        { ...version, released: false },
        observed,
      ),
    ).rejects.toThrow();
    const current = await readJiraReleaseQuality(f.tx, "key", identity, {
      ...version,
      released: false,
    });
    expect(current.mode).toBe("LIVE");
    expect(current.counts.pass).toBe(1);
    expect(JSON.stringify(f.captures)).toBe(original);
  });
  it("does not fabricate a historical backfill, omit missing validation runs, or inherit Jira approval for Confluence", async () => {
    const f = fixture();
    expect(
      (await readJiraReleaseQuality(f.tx, "key", identity, version)).mode,
    ).toBe("RELEASED_CAPTURE_UNAVAILABLE");
    f.spies.testRun.findMany.mockResolvedValue([]);
    await expect(
      captureJiraRelease(f.tx, "key", identity, version, observed),
    ).rejects.toThrow(/complete release/);
    expect(f.spies.auditLog.create).not.toHaveBeenCalled();
    await expect(
      readSharedClosure(
        f.tx,
        "key",
        { ...identity, product: "confluence", targetId: "20" },
        "a".repeat(64),
      ),
    ).rejects.toThrow();
    const revoked = fixture();
    revoked.grants[0]!.metadata.state = "REVOKED";
    await expect(
      captureJiraRelease(revoked.tx, "key", identity, version, observed),
    ).rejects.toThrow();
    expect(revoked.spies.release.findFirst).not.toHaveBeenCalled();
  });
});
