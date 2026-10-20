import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  AiDisclosureDenied,
  readAiProjectSummary,
  type AiReadGrant,
  type AiReadStore,
} from "./aiDisclosureGateway.js";

const token = "vai_" + "a".repeat(64);
const now = new Date("2026-10-16T20:00:00Z");
function fixture(patch: Partial<AiReadGrant> = {}) {
  const grant: AiReadGrant = {
    id: "grant1",
    organizationId: "org1",
    projectId: "project1",
    principalId: "principal1",
    recipient: "codex",
    scope: "aggregate_counts",
    policyVersion: 1,
    classificationVersion: 1,
    expiresAt: new Date("2026-10-17T20:00:00Z"),
    revoked: false,
    enabled: true,
    organizationActive: true,
    principalActive: true,
    currentRole: "VIEWER",
    projectOrganizationId: "org1",
    projectClassification: "SYNTHETIC",
    projectClassificationVersion: 1,
    approvingAdminActive: true,
    ...patch,
  };
  const tx = {
    resolveGrant: vi.fn(async () => grant as AiReadGrant | null),
    countProject: vi.fn(async () => ({
      testCases: 100,
      testPlans: 20,
      testRuns: 50,
    })),
    audit: vi.fn(async () => {}),
  };
  const store: AiReadStore = {
    deploymentAllows: () => true,
    transaction: async (work) => work(tx),
  };
  return { tx, store };
}

describe("external AI disclosure boundary", () => {
  it("audits a known grant outside the deployment pilot and never counts", async () => {
    const { tx, store } = fixture();
    store.deploymentAllows = () => false;
    await expect(
      readAiProjectSummary(store, token, "project1", now),
    ).rejects.toBeInstanceOf(AiDisclosureDenied);
    expect(tx.countProject).not.toHaveBeenCalled();
    expect(tx.audit).toHaveBeenCalledWith(
      expect.objectContaining({ decision: "DENY", reason: "POLICY_DENIED" }),
    );
  });
  it("rechecks deployment scope after counting before releasing any values", async () => {
    const { tx, store } = fixture();
    store.deploymentAllows = vi
      .fn()
      .mockReturnValueOnce(true)
      .mockReturnValue(false);
    await expect(
      readAiProjectSummary(store, token, "project1", now),
    ).rejects.toBeInstanceOf(AiDisclosureDenied);
    expect(tx.audit).toHaveBeenCalledWith(
      expect.objectContaining({ decision: "DENY", reason: "POLICY_DENIED" }),
    );
  });
  it("releases only a positive aggregate projection after its audit succeeds", async () => {
    const { tx, store } = fixture();
    tx.countProject.mockResolvedValue({
      testCases: 100,
      testPlans: 20,
      testRuns: 50,
      title: "CUSTOMER_SECRET",
      patient: "PATIENT_CANARY",
    } as never);
    const summary = await readAiProjectSummary(store, token, "project1", now);
    expect(summary).toEqual({
      policyVersion: 1,
      disclosure: "aggregate_counts",
      classification: "SYNTHETIC",
      suppressed: false,
      counts: { testCases: 100, testPlans: 20, testRuns: 50 },
    });
    expect(tx.resolveGrant).toHaveBeenCalledWith(
      createHash("sha256").update(token).digest("hex"),
    );
    expect(tx.countProject).toHaveBeenCalledWith("org1", "project1");
    expect(tx.audit).toHaveBeenCalledWith(
      expect.objectContaining({ decision: "ALLOW", recipient: "codex" }),
    );
    expect(JSON.stringify(tx.audit.mock.calls)).not.toMatch(
      /CUSTOMER_SECRET|PATIENT_CANARY|vai_|testCases/,
    );
  });

  it.each([
    { enabled: false },
    { revoked: true },
    { organizationActive: false },
    { principalActive: false },
    { approvingAdminActive: false },
    { currentRole: "EDITOR" },
    { currentRole: "ADMIN" },
    { recipient: "other-provider" },
    { scope: "test_content" },
    { policyVersion: 2 },
    { projectOrganizationId: "foreign-org" },
    { projectClassification: "CUSTOMER_PROPRIETARY" },
    { projectClassification: "REGULATED" },
    { projectClassification: "UNCLASSIFIED" },
    { classificationVersion: 0 },
    { projectClassificationVersion: 2 },
    { expiresAt: new Date("invalid") },
    { expiresAt: now },
    { expiresAt: new Date("2026-10-15") },
  ])("denies before counting for policy state %j", async (patch) => {
    const { tx, store } = fixture(patch as Partial<AiReadGrant>);
    await expect(
      readAiProjectSummary(store, token, "project1", now),
    ).rejects.toBeInstanceOf(AiDisclosureDenied);
    expect(tx.countProject).not.toHaveBeenCalled();
    expect(tx.audit).toHaveBeenCalledWith(
      expect.objectContaining({ decision: "DENY" }),
    );
  });

  it("does not let project identity change an approved scope", async () => {
    const { tx, store } = fixture();
    await expect(
      readAiProjectSummary(store, token, "foreign-project", now),
    ).rejects.toBeInstanceOf(AiDisclosureDenied);
    expect(tx.countProject).not.toHaveBeenCalled();
    expect(tx.audit).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "project1" }),
    );
  });

  it.each(["vt_" + "a".repeat(48), "human-session-token", "vai_short", ""])(
    "rejects other credential classes (%s)",
    async (credential) => {
      const { tx, store } = fixture();
      await expect(
        readAiProjectSummary(store, credential, "project1", now),
      ).rejects.toBeInstanceOf(AiDisclosureDenied);
      expect(tx.resolveGrant).not.toHaveBeenCalled();
    },
  );

  it("denies unknown credentials and exposes no grant identity", async () => {
    const { tx, store } = fixture();
    tx.resolveGrant.mockResolvedValue(null);
    await expect(
      readAiProjectSummary(store, token, "project1", now),
    ).rejects.toThrow("AI disclosure is not permitted.");
    expect(tx.countProject).not.toHaveBeenCalled();
  });

  it("withholds all counts for a small cohort", async () => {
    const { tx, store } = fixture();
    tx.countProject.mockResolvedValue({
      testCases: 100,
      testPlans: 1,
      testRuns: 50,
    });
    expect(await readAiProjectSummary(store, token, "project1", now)).toEqual({
      policyVersion: 1,
      disclosure: "aggregate_counts",
      classification: "SYNTHETIC",
      suppressed: true,
      counts: null,
    });
    expect(tx.audit).toHaveBeenCalledWith(
      expect.objectContaining({ decision: "SUPPRESS" }),
    );
  });

  it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "fails closed on invalid counts %s",
    async (value) => {
      const { tx, store } = fixture();
      tx.countProject.mockResolvedValue({
        testCases: value,
        testPlans: 20,
        testRuns: 50,
      });
      await expect(
        readAiProjectSummary(store, token, "project1", now),
      ).rejects.toBeInstanceOf(AiDisclosureDenied);
    },
  );

  it("does not release data when the audit fails", async () => {
    const { tx, store } = fixture();
    tx.audit.mockRejectedValue(new Error("audit unavailable"));
    await expect(
      readAiProjectSummary(store, token, "project1", now),
    ).rejects.toThrow("audit unavailable");
  });

  it("rereads grants so revocation takes effect on the next call", async () => {
    const { tx, store } = fixture();
    await readAiProjectSummary(store, token, "project1", now);
    const grant = await tx.resolveGrant();
    grant!.revoked = true;
    tx.countProject.mockClear();
    await expect(
      readAiProjectSummary(store, token, "project1", now),
    ).rejects.toBeInstanceOf(AiDisclosureDenied);
    expect(tx.countProject).not.toHaveBeenCalled();
  });
});
