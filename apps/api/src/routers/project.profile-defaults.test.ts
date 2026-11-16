import { describe, expect, it, vi } from "vitest";
import { projectRouter } from "./project.js";
import type { Context } from "../trpc.js";

const saved = {
  objective: "Original", systemScope: "HARDWARE",
  softwareTypes: ["Synthetic software"], hardwareTypes: ["Synthetic rig"],
  testEnvironments: ["Lab"], qualityObjectives: ["Reliability"],
  complianceNeeds: ["Synthetic framework"], regulatoryNeeds: ["Synthetic rule"],
  executionSources: ["Manual"], experience: { retained: "exact synthetic metadata" },
  futureField: { value: ["keep", false] },
};
function fixture(role = "EDITOR", count = 1) {
  const result = { id: "project-a", name: "Synthetic project", slug: "synthetic-project" };
  const db = { project: {
    findUnique: vi.fn(async (args: { where: { id?: string }; select?: unknown }) => args.where.id ? { ...result, organizationId: "org-a", qualityProfile: saved } : null),
    create: vi.fn(async () => result),
    updateMany: vi.fn(async () => ({ count })),
  } };
  const ctx = { prisma: db, user: { id: "user-a", memberships: [{ organizationId: "org-a", role, seatType: "FULL" }] } } as unknown as Context;
  return { db, caller: projectRouter.createCaller(ctx) };
}
const update = { id: "project-a", name: "Synthetic project", defaultBranch: "main" };

describe("project profile omission contracts through the actual router; mocked DB only", () => {
  it("creation with no profile still materializes the existing nested defaults", async () => {
    const { caller, db } = fixture();
    await caller.create({ organizationId: "org-a", name: "Synthetic project" });
    expect(db.project.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      defaultBranch: "main",
      qualityProfile: { objective: "", systemScope: "SOFTWARE", softwareTypes: [], hardwareTypes: [], testEnvironments: [], qualityObjectives: [], complianceNeeds: [], regulatoryNeeds: [], executionSources: [] },
    }) }));
  });
  it.each([{ objective: "Changed" }, {}])("PATCH %j preserves all omitted saved context and the CAS", async qualityProfile => {
    const before = JSON.stringify(saved), { caller, db } = fixture();
    await caller.update({ ...update, qualityProfile });
    expect(db.project.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "project-a", organizationId: "org-a", qualityProfile: { equals: saved } },
      data: expect.objectContaining({ qualityProfile: { ...saved, ...qualityProfile } }),
    }));
    expect(JSON.stringify(saved)).toBe(before);
  });
  it("an explicitly empty list clears only that reviewed field", async () => {
    const { caller, db } = fixture();
    await caller.update({ ...update, qualityProfile: { hardwareTypes: [] } });
    expect(db.project.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ qualityProfile: { ...saved, hardwareTypes: [] } }) }));
  });
  it("does not weaken authorization, protected fields, or concurrent-edit refusal", async () => {
    const denied = fixture("VIEWER");
    await expect(denied.caller.update({ ...update, qualityProfile: { objective: "Changed" } })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(denied.db.project.updateMany).not.toHaveBeenCalled();
    const invalid = fixture();
    await expect(invalid.caller.update({ ...update, qualityProfile: { experience: {} } } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(invalid.db.project.updateMany).not.toHaveBeenCalled();
    const raced = fixture("EDITOR", 0);
    await expect(raced.caller.update({ ...update, qualityProfile: { objective: "Changed" } })).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
