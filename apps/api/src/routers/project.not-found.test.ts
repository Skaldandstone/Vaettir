import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@vaettir/db";
import { projectRouter } from "./project.js";
import type { Context } from "../trpc.js";

const project = {
  id: "project-a", organizationId: "org-a", name: "Synthetic project", slug: "synthetic",
  repoUrl: null, defaultBranch: "main", pagerdutyServiceId: null, datadogProjectTag: null,
  qualityProfile: {},
};

function fixture({ found = true, role = "OWNER", member = true } = {}) {
  const missing = new Prisma.PrismaClientKnownRequestError("No Project found", {
    code: "P2025", clientVersion: "test",
  });
  const db = {
    project: {
      findUnique: vi.fn().mockResolvedValue(found ? project : null),
      findUniqueOrThrow: found ? vi.fn().mockResolvedValue(project) : vi.fn().mockRejectedValue(missing),
      update: vi.fn().mockResolvedValue({ id: project.id, name: project.name, slug: project.slug }),
      delete: vi.fn().mockResolvedValue(project),
    },
  };
  const ctx = {
    prisma: db,
    user: { id: "user-a", memberships: member ? [{ organizationId: "org-a", role, seatType: "FULL" }] : [] },
  } as unknown as Context;
  return { db, caller: projectRouter.createCaller(ctx) };
}

const updateInput = { id: "missing-project", name: "Updated", defaultBranch: "main" };

describe("project lookup error contract", () => {
  for (const operation of ["byId", "update", "delete"] as const) {
    it(`${operation} returns NOT_FOUND for a missing project without writes`, async () => {
      const { caller, db } = fixture({ found: false });
      const request = operation === "update" ? caller.update(updateInput) : caller[operation]({ id: "missing-project" });
      await expect(request).rejects.toMatchObject({ code: "NOT_FOUND", message: "Project not found" });
      expect(db.project.update).not.toHaveBeenCalled();
      expect(db.project.delete).not.toHaveBeenCalled();
    });

    it(`${operation} preserves tenant authorization`, async () => {
      const { caller, db } = fixture({ member: false });
      const request = operation === "update" ? caller.update(updateInput) : caller[operation]({ id: project.id });
      await expect(request).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(db.project.update).not.toHaveBeenCalled();
      expect(db.project.delete).not.toHaveBeenCalled();
    });

    it(`${operation} does not disguise a database outage as a missing project`, async () => {
      const { caller, db } = fixture();
      const outage = new Error("synthetic database outage");
      db.project.findUnique.mockRejectedValue(outage);
      db.project.findUniqueOrThrow.mockRejectedValue(outage);
      const request = operation === "update" ? caller.update(updateInput) : caller[operation]({ id: project.id });
      await expect(request).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR", cause: outage });
      expect(db.project.update).not.toHaveBeenCalled();
      expect(db.project.delete).not.toHaveBeenCalled();
    });
  }

  it("returns an existing permitted project and normalizes its saved profile", async () => {
    const { caller } = fixture({ role: "VIEWER" });
    await expect(caller.byId({ id: project.id })).resolves.toMatchObject({
      id: project.id, organizationId: project.organizationId,
      qualityProfile: { objective: "", regulatoryNeeds: [] },
    });
  });

  it("preserves editor and administrator write requirements", async () => {
    const { caller, db } = fixture({ role: "VIEWER" });
    await expect(caller.update(updateInput)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.delete({ id: project.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.project.update).not.toHaveBeenCalled();
    expect(db.project.delete).not.toHaveBeenCalled();
  });

  for (const operation of ["update", "delete"] as const) {
    it(`${operation} handles deletion between authorization and write without a 500`, async () => {
      const { caller, db } = fixture();
      db.project[operation].mockRejectedValue(new Prisma.PrismaClientKnownRequestError("Record no longer exists", {
        code: "P2025", clientVersion: "test",
      }));
      const request = operation === "update" ? caller.update(updateInput) : caller.delete({ id: project.id });
      await expect(request).rejects.toMatchObject({ code: "NOT_FOUND", message: "Project not found" });
    });
  }
});
