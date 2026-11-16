import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@vaettir/db";
import type { ForgeIdentity } from "./forgeInvocation.js";
import { readSharedQuality } from "./atlassianQualitySharing.js";
import { readForgeLiveQuality } from "./forgeLiveQuality.js";

const orgId = "authorized-org";
const projectId = "project/with ?#%";
const runId = "run/with ?#%";
const snapshotId = "a".repeat(64);
const identity: ForgeIdentity = {
  appId: "ari:cloud:ecosystem::app/743bf96f-0f9f-4fed-981a-ea3fc318d15d",
  installationId:
    "ari:cloud:ecosystem::installation/10000000-0000-4000-8000-000000000001",
  environmentId:
    "ari:cloud:ecosystem::environment/d2844601-7a1f-4e4e-9b77-e0d4d3682c50",
  cloudId: "10000000-0000-4000-8000-000000000002",
  siteOrigin: "https://synthetic.atlassian.net",
  product: "confluence",
  targetId: "10",
  principal: "synthetic-viewer",
  moduleKey: "vaettir-release-quality",
  apiBaseUrl:
    "https://api.atlassian.com/ex/confluence/10000000-0000-4000-8000-000000000002",
};
const binding = Object.fromEntries(
  [
    "appId",
    "installationId",
    "environmentId",
    "cloudId",
    "siteOrigin",
    "product",
    "targetId",
  ].map((key) => [key, identity[key as keyof ForgeIdentity]]),
);
function fixture(
  claim: { name: string; organizationId: string | null } | null,
) {
  const metadata = {
    connectionId: "10000000-0000-4000-8000-000000000003",
    version: 1,
    state: "APPROVED",
    binding,
    snapshotIds: [snapshotId],
    shareApprovedProjectQuality: true,
    shareLiveProjectQuality: true,
  };
  const execution = {
    runs: 2,
    results: 2,
    distinctCases: 2,
    outcomes: [{ key: "PASS", count: 2 }],
  };
  const payload = {
    state: "approved",
    title: "Synthetic report",
    projectName: "Display name is not a domain",
    asOf: "2026-10-28T00:00:00.000Z",
    windowStart: "2026-10-01T00:00:00.000Z",
    inventory: { active: 2 },
    execution,
    limitations: [],
    evidence: {
      runs: ["manual", "automation"].map((provider) => ({
        id: runId,
        provider,
        startedAt: "2026-10-28T00:00:00.000Z",
        outcomes: [],
        plannedCases: 0,
        notRecordedCases: 0,
      })),
    },
  };
  const tx = {
    auditLog: {
      findMany: vi.fn(async () => [
        { organizationId: orgId, projectId, metadata },
      ]),
    },
    organization: { findUnique: vi.fn(async () => ({ suspendedAt: null })) },
    project: { findUnique: vi.fn(async () => ({ organizationId: orgId })) },
    workspaceDomain: { findUnique: vi.fn(async () => claim) },
    projectReportSnapshot: {
      findMany: vi.fn(async () => [{ id: snapshotId, payload }]),
    },
    $executeRaw: vi.fn(async () => 0),
    $queryRaw: vi.fn(async () => [
      {
        payload: {
          projectName: payload.projectName,
          asOf: payload.asOf,
          active: 2,
          ...execution,
          priority: [],
          automation: [],
        },
      },
    ]),
  };
  return { tx: tx as unknown as Prisma.TransactionClient, spies: tx, metadata };
}
beforeEach(() => {
  vi.stubEnv("VAETTIR_WORKSPACE_DOMAINS_ENABLED", "1");
  vi.stubEnv("VAETTIR_ACTIVE_WORKSPACE_NAMES", "skaldandstone-sandbox,atwist");
});
afterEach(() => vi.unstubAllEnvs());

async function expectLinks(f: ReturnType<typeof fixture>, origin: string) {
  const reports = `${origin}/projects/${encodeURIComponent(projectId)}/reports`;
  for (const selected of [undefined, snapshotId]) {
    const result = await readSharedQuality(
      f.tx,
      "connection",
      identity,
      selected,
    );
    expect(result.reportUrl).toBe(reports);
    if (result.protocol !== "vaettir-quality/v1")
      throw Error("Expected approved report");
    expect(result.runLinks.map((run) => run.href)).toEqual([
      `${origin}/projects/${encodeURIComponent(projectId)}/test-runs/manual/${encodeURIComponent(runId)}`,
      `${origin}/projects/${encodeURIComponent(projectId)}/test-runs#run-${encodeURIComponent(runId)}`,
    ]);
  }
  expect(
    (await readForgeLiveQuality(f.tx, "connection", identity)).reportUrl,
  ).toBe(reports);
  f.spies.projectReportSnapshot.findMany.mockResolvedValue([]);
  const empty = await readSharedQuality(f.tx, "connection", identity);
  expect(empty.protocol).toBe("vaettir-quality-empty/v1");
  expect(empty.reportUrl).toBe(reports);
}

describe("Forge links use only the authorized workspace's active validated claim", () => {
  it.each(["skaldandstone-sandbox", "atwist"])(
    "uses %s for live, frozen, latest, empty and encoded run links",
    async (name) => {
      const f = fixture({ name, organizationId: orgId });
      await expectLinks(f, `https://${name}.vaettir.app`);
      expect(f.spies.workspaceDomain.findUnique).toHaveBeenCalledWith({
        where: { organizationId: orgId },
        select: { name: true, organizationId: true },
      });
    },
  );
  it.each([
    ["missing", null],
    ["retained unbound", { name: "atwist", organizationId: null }],
    ["foreign", { name: "atwist", organizationId: "other-org" }],
    ["inactive", { name: "unactivated", organizationId: orgId }],
    ["invalid", { name: "atwist.evil.invalid", organizationId: orgId }],
    ["noncanonical", { name: "Atwist", organizationId: orgId }],
    ["reserved", { name: "app", organizationId: orgId }],
  ] as const)(
    "falls back to the entry host for a %s claim",
    async (_reason, claim) => {
      await expectLinks(fixture(claim), "https://app.vaettir.app");
    },
  );
  it("honors disabled rollout and wildcard activation without accepting an invalid claim", async () => {
    vi.stubEnv("VAETTIR_WORKSPACE_DOMAINS_ENABLED", "0");
    const disabled = fixture({ name: "atwist", organizationId: orgId });
    await expectLinks(disabled, "https://app.vaettir.app");
    expect(disabled.spies.workspaceDomain.findUnique).not.toHaveBeenCalled();
    vi.stubEnv("VAETTIR_WORKSPACE_DOMAINS_ENABLED", "1");
    vi.stubEnv("VAETTIR_ACTIVE_WORKSPACE_NAMES", "*");
    await expectLinks(
      fixture({ name: "skaldandstone-sandbox", organizationId: orgId }),
      "https://skaldandstone-sandbox.vaettir.app",
    );
    await expectLinks(
      fixture({ name: "//evil.invalid", organizationId: orgId }),
      "https://app.vaettir.app",
    );
  });
  it("does not resolve or emit tenant links when sharing authorization fails", async () => {
    const f = fixture({ name: "atwist", organizationId: orgId });
    f.metadata.state = "REVOKED";
    await expect(
      readSharedQuality(f.tx, "connection", identity),
    ).rejects.toThrow();
    await expect(
      readForgeLiveQuality(f.tx, "connection", identity),
    ).rejects.toThrow();
    expect(f.spies.workspaceDomain.findUnique).not.toHaveBeenCalled();
    expect(f.spies.projectReportSnapshot.findMany).not.toHaveBeenCalled();
  });
});
