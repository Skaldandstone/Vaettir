import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "../trpc.js";
const mocks = vi.hoisted(() => ({ commit: vi.fn(), preview: vi.fn() }));
vi.mock("../services/historicalResultsImport.js", async original => ({ ...await original<typeof import("../services/historicalResultsImport.js")>(), commitHistoricalResults: mocks.commit, previewHistoricalResults: mocks.preview }));
import { testRunsRouter } from "./testRuns.js";
function caller(role = "EDITOR", organizationId = "org", workspaceOrganizationId?: string) {
  return testRunsRouter.createCaller({ user: { id: "actor", memberships: [{ organizationId, role }] }, workspaceOrganizationId,
    prisma: { project: { findUnique: vi.fn(async () => ({ id: "project", organizationId: "org" })) }, organization: { findUnique: vi.fn(async () => ({ suspendedAt: null })) } },
  } as unknown as Context);
}
const input = { projectId: "project", sourceRef: "file:synthetic.csv", runLabel: "March", csvText: "ID,Result\ncase,pass", mapping: { caseId: "ID", result: "Result" }, runDate: "2026-01-01" };
const commit = { ...input, expectedDigest: "a".repeat(64), acknowledgeHistoricalObservation: true as const };
beforeEach(() => { mocks.commit.mockReset().mockResolvedValue({ runs: [], importedCount: 0 }); mocks.preview.mockReset().mockResolvedValue({ rows: [] }); });
describe("historical run router authority", () => {
  it("derives tenant and actor from native project access", async () => {
    await caller().commitHistorical(commit);
    expect(mocks.commit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining(input), { actorId: "actor", organizationId: "org" });
  });
  it("denies viewers, foreign tenants and wrong host before reading/mutating", async () => {
    for (const c of [caller("VIEWER"), caller("EDITOR", "foreign"), caller("EDITOR", "org", "foreign")]) {
      await expect(c.previewHistorical(input)).rejects.toThrow(); await expect(c.commitHistorical(commit)).rejects.toThrow();
    }
    expect(mocks.preview).not.toHaveBeenCalled(); expect(mocks.commit).not.toHaveBeenCalled();
  });
  it("requires literal acknowledgement and a source-bound digest, refusing authority/token overrides", async () => {
    for (const patch of [{ acknowledgeHistoricalObservation: false }, { expectedDigest: "" }, { organizationId: "foreign" }, { actorId: "owner" }, { token: "no" }]) await expect(caller().commitHistorical({ ...commit, ...patch } as typeof commit)).rejects.toThrow();
    expect(mocks.commit).not.toHaveBeenCalled();
  });
});
