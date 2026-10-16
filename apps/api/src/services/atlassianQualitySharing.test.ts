import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@vaettir/db";
import type { ForgeIdentity } from "./forgeInvocation.js";
import {
  authorizeForgeSharing,
  latestForgeSharing,
  readSharedQuality,
} from "./atlassianQualitySharing.js";
import { ticketObservation } from "./jiraTicketVerification.js";

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
  principal: "viewer",
  moduleKey: "vaettir-project-quality",
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
const share = (version: number, state = "APPROVED") => ({
  organizationId: "org",
  projectId: "project",
  metadata: {
    connectionId: "10000000-0000-4000-8000-000000000003",
    version,
    state,
    binding,
    snapshotIds: ["a".repeat(64)],
    shareTicketTests: true,
  },
});
function db() {
  const rows = [share(1)],
    payload = {
      state: "approved",
      title: "Release quality",
      projectName: "Test project",
      asOf: "2026-10-16T00:00:00.000Z",
      windowStart: "2026-10-15T00:00:00.000Z",
      execution: {
        runs: 1,
        results: 3,
        outcomes: [
          { key: "PASS", count: 2 },
          { key: "FAIL", count: 1 },
        ],
        distinctCases: 3,
      },
      inventory: { active: 5 },
      limitations: ["Captured observations"],
      secret: "must not cross",
      cohort: [{ id: "private-case" }],
      architectureMappings: [{ id: "private-map" }],
    };
  const tx = {
    auditLog: { findMany: vi.fn(async () => rows) },
    $queryRaw: vi.fn(async () => []),
    organization: { findUnique: vi.fn(async () => ({ suspendedAt: null })) },
    project: { findUnique: vi.fn(async () => ({ organizationId: "org" })) },
    projectReportSnapshot: {
      findMany: vi.fn(async () => [{ id: "a".repeat(64), payload }]),
    },
  };
  return {
    rows,
    payload,
    tx: tx as unknown as Prisma.TransactionClient,
    spies: tx,
  };
}
describe("opt-in Atlassian quality sharing", () => {
  it("requires the exact installation, environment, cloud, product and target", async () => {
    for (const change of [
      { installationId: "other" },
      { environmentId: "other" },
      { cloudId: "other" },
      { product: "confluence" as const },
      { targetId: "20" },
      { siteOrigin: "https://other.atlassian.net" },
    ]) {
      const f = db();
      await expect(
        authorizeForgeSharing(f.tx, "key", { ...identity, ...change }),
      ).rejects.toThrow();
      expect(f.spies.projectReportSnapshot.findMany).not.toHaveBeenCalled();
    }
  });
  it("refreshes revocation after acquiring the parent lock and refuses a moved project", async () => {
    const f = db();
    f.spies.auditLog.findMany
      .mockResolvedValueOnce([share(1)])
      .mockResolvedValueOnce([share(1), share(2, "REVOKED")]);
    await expect(readSharedQuality(f.tx, "key", identity)).rejects.toThrow();
    expect(f.spies.projectReportSnapshot.findMany).not.toHaveBeenCalled();
    const moved = db();
    moved.spies.project.findUnique.mockResolvedValue({
      organizationId: "other",
    });
    await expect(
      readSharedQuality(moved.tx, "key", identity),
    ).rejects.toThrow();
    expect(() => latestForgeSharing([share(1), share(1)])).toThrow(/conflict/);
  });
  it("exports only approved aggregate fields, never architecture mappings or case content", async () => {
    const f = db(),
      result = await readSharedQuality(f.tx, "key", identity);
    expect(result.mode).toBe("LATEST_APPROVED");
    expect(result.snapshot.execution.results).toBe(3);
    expect(JSON.stringify(result)).not.toMatch(
      /must not cross|private-case|private-map|architectureMappings/,
    );
    expect(Object.keys(f.spies).sort()).toEqual([
      "$queryRaw",
      "auditLog",
      "organization",
      "project",
      "projectReportSnapshot",
    ]);
    expect(
      (await readSharedQuality(f.tx, "key", identity, "a".repeat(64))).mode,
    ).toBe("FROZEN");
    await expect(
      readSharedQuality(f.tx, "key", identity, "b".repeat(64)),
    ).rejects.toThrow();
    f.payload.state = "preview";
    await expect(readSharedQuality(f.tx, "key", identity)).rejects.toThrow();
  });
  it("does not turn a mixed run or tied runs into a passing verification result", () => {
    const run = {
      runId: "r",
      startedAt: "2026-10-16T00:00:00.000Z",
      finishedAt: null,
      runStatus: "RUNNING",
      statuses: ["PASS"],
      href: "https://vaettir.skaldandstone.com/",
    };
    expect(ticketObservation([]).outcome).toBe("NOT_RUN");
    expect(ticketObservation([{ ...run, statuses: [] }]).outcome).toBe(
      "NOT_RECORDED",
    );
    expect(
      ticketObservation([{ ...run, statuses: ["PASS", "FAIL"] }]).outcome,
    ).toBe("MIXED");
    expect(ticketObservation([run, { ...run, runId: "r2" }]).outcome).toBe(
      "AMBIGUOUS",
    );
    expect(
      ticketObservation([
        run,
        {
          ...run,
          runId: "new",
          startedAt: "2026-10-17T00:00:00.000Z",
          statuses: [],
        },
      ]).outcome,
    ).toBe("NOT_RECORDED");
  });
});
