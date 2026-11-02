import { describe, expect, it, vi } from "vitest";
import { projectAiCases, aiCaseDigest, aiCaseSnapshot, aiCaseSelection } from "./aiCaseDisclosure.js";
import { readAiApprovedCases } from "./aiCaseDisclosureGateway.js";
import { type AiReadGrant, type AiReadStore, AiDisclosureDenied, readAiProjectSummary } from "./aiDisclosureGateway.js";

const selection = { organizationId: "org", projectId: "project", caseIds: ["c1"], fields: ["title" as const] };
const row = { id: "c1", projectId: "project", title: "Synthetic navigation", given: ["PRIVATE_PRECONDITION"], when: ["PRIVATE_ACTION"], then: ["PRIVATE_RESULT"], customFields: { secret: "CUSTOMER_SECRET" } };
const snapshot = projectAiCases(selection, [row], 1);
const now = new Date("2026-11-02T20:00:00Z"), token = "vai_" + "a".repeat(64);
function fixture(patch: Partial<AiReadGrant> = {}) {
  const grant: AiReadGrant = { id: "grant", organizationId: "org", projectId: "project", principalId: "grant", recipient: "codex", scope: "approved_case_snapshot", policyVersion: 1, classificationVersion: 1, expiresAt: new Date(now.getTime() + 60_000), revoked: false, enabled: true, organizationActive: true, principalActive: true, currentRole: "VIEWER", projectOrganizationId: "org", projectClassification: "CUSTOMER_PROPRIETARY", projectClassificationVersion: 1, approvingAdminActive: true, ...patch };
  const tx = { resolveGrant: vi.fn(async () => grant), readApprovedCases: vi.fn(async (): Promise<unknown> => snapshot), audit: vi.fn(async () => {}), countProject: vi.fn(async () => ({ testCases: 20, testPlans: 20, testRuns: 20 })) };
  const store: AiReadStore = { deploymentAllows: () => true, transaction: async work => work(tx) };
  return { tx, store };
}
describe("reviewed case disclosure", () => {
  it("projects only selected fields and binds content, tenant, version and exact cases", () => {
    expect(snapshot.cases).toEqual([{ id: "c1", title: row.title }]);
    expect(JSON.stringify(snapshot)).not.toMatch(/PRIVATE_|CUSTOMER_SECRET|customFields/);
    const original = aiCaseDigest(snapshot);
    for (const changed of [{ ...snapshot, organizationId: "other" }, { ...snapshot, classificationVersion: 2 }, { ...snapshot, cases: [{ id: "c1", title: "Changed" }] }]) expect(aiCaseDigest(changed)).not.toBe(original);
    expect(() => projectAiCases(selection, [], 1)).toThrow();
    expect(() => projectAiCases(selection, [{ ...row, projectId: "foreign" }], 1)).toThrow();
  });
  it("refuses extra/missing fields, duplicates, oversize content and query-based broadening", () => {
    expect(aiCaseSnapshot.safeParse({ ...snapshot, cases: [{ ...snapshot.cases[0], given: ["NOT_APPROVED"] }] }).success).toBe(false);
    expect(aiCaseSnapshot.safeParse({ ...snapshot, cases: [{ id: "c1" }] }).success).toBe(false);
    expect(aiCaseSnapshot.safeParse({ ...snapshot, cases: [{ id: "c1", title: "x".repeat(8001) }] }).success).toBe(false);
    expect(aiCaseSelection.safeParse({ ...selection, caseIds: ["c1", "c1"] }).success).toBe(false);
    expect(aiCaseSelection.safeParse({ ...selection, fields: ["title", "title"] }).success).toBe(false);
    expect(aiCaseSelection.safeParse({ ...selection, includeAll: true }).success).toBe(false);
  });
  it("commits the content-free durable audit before releasing approved proprietary content", async () => {
    const { tx, store } = fixture();
    const result = await readAiApprovedCases(store, token, "project", now);
    expect(result.snapshot).toEqual(snapshot);
    expect(tx.audit).toHaveBeenCalledWith(expect.objectContaining({ decision: "ALLOW", reason: "APPROVED" }));
    expect(JSON.stringify(tx.audit.mock.calls)).not.toMatch(/Synthetic navigation|PRIVATE_|vai_/);
  });
  it.each<Partial<AiReadGrant>>([
    { projectClassification: "REGULATED" }, { projectClassification: "UNCLASSIFIED" }, { scope: "aggregate_counts" },
    { approvingAdminActive: false }, { revoked: true }, { enabled: false }, { organizationActive: false },
    { principalActive: false }, { currentRole: "ADMIN" }, { projectClassificationVersion: 2 },
    { projectOrganizationId: "other" }, { expiresAt: now },
  ])("denies before loading content for %j", async patch => {
    const { tx, store } = fixture(patch);
    await expect(readAiApprovedCases(store, token, "project", now)).rejects.toBeInstanceOf(AiDisclosureDenied);
    expect(tx.readApprovedCases).not.toHaveBeenCalled();
    expect(tx.audit).toHaveBeenCalledWith(expect.objectContaining({ decision: "DENY" }));
  });
  it("cannot use a case grant for counts or another project's content", async () => {
    const { tx, store } = fixture();
    await expect(readAiProjectSummary(store, token, "project", now)).rejects.toBeInstanceOf(AiDisclosureDenied);
    await expect(readAiApprovedCases(store, token, "foreign", now)).rejects.toBeInstanceOf(AiDisclosureDenied);
    expect(tx.countProject).not.toHaveBeenCalled(); expect(tx.readApprovedCases).not.toHaveBeenCalled();
  });
  it("fails closed after a source change, deployment withdrawal or failed audit", async () => {
    const { tx, store } = fixture();
    tx.readApprovedCases.mockResolvedValueOnce(null);
    await expect(readAiApprovedCases(store, token, "project", now)).rejects.toBeInstanceOf(AiDisclosureDenied);
    store.deploymentAllows = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
    await expect(readAiApprovedCases(store, token, "project", now)).rejects.toBeInstanceOf(AiDisclosureDenied);
    store.deploymentAllows = () => true; tx.audit.mockRejectedValueOnce(new Error("AUDIT_UNAVAILABLE"));
    await expect(readAiApprovedCases(store, token, "project", now)).rejects.toThrow("AUDIT_UNAVAILABLE");
  });
});
