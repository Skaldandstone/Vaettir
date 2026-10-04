import { randomUUID, createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@vaettir/db";
import { qualityRiskWriteInput } from "./qualityRiskSchema.js";
import { writeQualityRisk } from "./qualityRisks.js";
// SOURCE ONLY. These regressions are authored, not executed.
const definition = { title: "Synthetic failure", component: "Synthetic component", failureMode: "Synthetic failure mode", cause: "Synthetic cause", effect: "Synthetic effect",
  likelihood: "UNKNOWN" as const, consequence: "UNKNOWN" as const, rationale: "Synthetic rationale", mitigation: "", requirementIds: [], caseIds: [] };
const decision = { likelihood: "UNKNOWN" as const, consequence: "UNKNOWN" as const, rationale: "Synthetic residual rationale", evidenceNotes: "",
  disposition: "FURTHER_ACTION" as const, resultIds: [], acknowledgeNotQualifiedApproval: true as const };
const writes = () => [
  { operation: "CREATE" as const, projectId: "synthetic", requestId: randomUUID(), definition },
  { operation: "UPDATE" as const, projectId: "synthetic", requestId: randomUUID(), id: "risk", expectedVersion: 1, dropUnavailableLinks: false, definition },
  { operation: "REVIEW" as const, projectId: "synthetic", requestId: randomUUID(), id: "risk", expectedVersion: 1, decision },
];
describe("optional risk reviewed scope contract", () => {
  it("preserves absent legacy payload JSON and hashes for every risk operation", () => {
    const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
    for (const old of writes()) {
      const parsed = qualityRiskWriteInput.parse(old); expect(Object.hasOwn(parsed, "expectedScope")).toBe(false);
      expect(parsed).toEqual(old); expect(JSON.stringify(parsed)).toBe(JSON.stringify(old)); expect(hash(parsed)).toBe(hash(old));
    }
  });
  it("binds exactly supported original actor and organization fields on all operations", () => {
    const expectedScope = { organizationId: "org-synthetic", clerkActorId: "user_synthetic" };
    for (const old of writes()) {
      expect(qualityRiskWriteInput.parse({ ...old, expectedScope })).toMatchObject({ expectedScope });
      for (const invalid of [{ ...expectedScope, token: "forged" }, { ...expectedScope, clerkActorId: "" },
        { ...expectedScope, organizationId: "x".repeat(121) }, { ...expectedScope, clerkActorId: "x".repeat(201) }])
        expect(qualityRiskWriteInput.safeParse({ ...old, expectedScope: invalid }).success).toBe(false);
    }
  });
  it("rejects server actor or tenant mismatch before looking up any prior receipt", async () => {
    for (const expectedScope of [{ organizationId: "org-synthetic", clerkActorId: "user_other" },
      { organizationId: "org-other", clerkActorId: "user_current" }]) {
      const prior = vi.fn(), create = vi.fn();
      const tx = { user: { findUnique: vi.fn().mockResolvedValue({ clerkUserId: "user_current" }) },
        qualityRiskWrite: { findUnique: prior, create }, qualityRiskEntry: { create } } as unknown as Prisma.TransactionClient;
      await expect(writeQualityRisk(tx, { actorId: "synthetic-server-actor", organizationId: "org-synthetic", canWrite: true, caseKey: "SYN" },
        { ...writes()[0], expectedScope })).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(prior).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
    }
  });
});
