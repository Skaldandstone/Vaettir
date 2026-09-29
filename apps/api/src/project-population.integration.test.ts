import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@vaettir/db";
import type { PopulationDraft } from "@vaettir/core";
import { appRouter } from "./router.js";

const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
const isolated =
  url &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  /test/i.test(url.pathname) &&
  !url.searchParams.has("host");
describe.skipIf(!isolated)("population draft persistence", () => {
  let owner: ReturnType<typeof appRouter.createCaller>;
  let viewer: typeof owner;
  let readOnly: typeof owner;
  let otherOwner: typeof owner;
  let projectId: string;
  let otherProjectId: string;
  let organizationId: string;
  const document: PopulationDraft = {
    schemaVersion: 1,
    step: "scope",
    sections: ["context", "sources"],
    objective: "Verify playback",
    systemScope: "SOFTWARE",
    providers: ["gitlab", "jira"],
  };
  const key = `population-${randomUUID()}`;

  beforeAll(async () => {
    const tier = await prisma.planTier.findUniqueOrThrow({
      where: { key: "free" },
    });
    const org = await prisma.organization.create({
      data: { name: key, slug: key, planTierId: tier.id },
    });
    const other = await prisma.organization.create({
      data: { name: `${key}-other`, slug: `${key}-other`, planTierId: tier.id },
    });
    organizationId = org.id;
    async function caller(
      suffix: string,
      orgId: string,
      role: "OWNER" | "VIEWER",
      seatType: "FULL" | "READ_ONLY",
    ) {
      const user = await prisma.user.create({
        data: {
          clerkUserId: `${key}-${suffix}`,
          email: `${key}-${suffix}@example.com`,
          memberships: { create: { organizationId: orgId, role, seatType } },
        },
        include: { memberships: true },
      });
      return appRouter.createCaller({ prisma, user });
    }
    owner = await caller("owner", org.id, "OWNER", "FULL");
    viewer = await caller("viewer", org.id, "VIEWER", "FULL");
    readOnly = await caller("read", org.id, "OWNER", "READ_ONLY");
    otherOwner = await caller("other", other.id, "OWNER", "FULL");
    projectId = (
      await owner.project.create({ organizationId: org.id, name: "Population" })
    ).id;
    otherProjectId = (
      await otherOwner.project.create({
        organizationId: other.id,
        name: "Population",
      })
    ).id;
  });

  it("roundtrips a saved draft without modifying approved project context", async () => {
    expect(await owner.projectPopulation.draft({ projectId })).toBeNull();
    const result = await owner.projectPopulation.saveDraft({
      projectId,
      expectedVersion: 0,
      requestId: randomUUID(),
      document,
    });
    expect(result).toEqual({ version: 1, replayed: false });
    expect(
      (await viewer.projectPopulation.draft({ projectId }))?.document,
    ).toEqual(document);
    expect(
      (await owner.project.byId({ id: projectId })).qualityProfile.objective,
    ).toBe("");
  });

  it("serializes simultaneous saves from the same baseline", async () => {
    const results = await Promise.allSettled(
      ["A", "B"].map((objective) =>
        owner.projectPopulation.saveDraft({
          projectId,
          expectedVersion: 1,
          requestId: randomUUID(),
          document: { ...document, objective },
        }),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((r) => r.status === "rejected");
    expect(failed?.status === "rejected" && failed.reason.code).toBe(
      "CONFLICT",
    );
    expect((await owner.projectPopulation.draft({ projectId }))?.version).toBe(
      2,
    );
  });

  it("serializes first-save races without duplicate drafts", async () => {
    const fresh = await owner.project.create({
      organizationId,
      name: "First-save race",
    });
    const results = await Promise.allSettled(
      ["A", "B"].map((objective) =>
        owner.projectPopulation.saveDraft({
          projectId: fresh.id,
          expectedVersion: 0,
          requestId: randomUUID(),
          document: { ...document, objective },
        }),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((r) => r.status === "rejected");
    expect(failed?.status === "rejected" && failed.reason.code).toBe(
      "CONFLICT",
    );
    expect(
      await prisma.projectPopulationDraft.count({
        where: { projectId: fresh.id },
      }),
    ).toBe(1);
  });

  it("requires authentication for reads and writes", async () => {
    const anonymous = appRouter.createCaller({ prisma, user: null });
    await expect(
      anonymous.projectPopulation.draft({ projectId }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      anonymous.projectPopulation.saveDraft({
        projectId,
        expectedVersion: 0,
        requestId: randomUUID(),
        document,
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("replays identical requests once, including after a later save", async () => {
    const request = {
      projectId,
      expectedVersion: 2,
      requestId: randomUUID(),
      document,
    };
    const results = await Promise.all([
      owner.projectPopulation.saveDraft(request),
      owner.projectPopulation.saveDraft(request),
    ]);
    expect(results.map((r) => r.replayed).sort()).toEqual([false, true]);
    const later = { ...document, objective: "Preserve this newer edit" };
    await owner.projectPopulation.saveDraft({
      ...request,
      expectedVersion: 3,
      requestId: randomUUID(),
      document: later,
    });
    expect(await owner.projectPopulation.saveDraft(request)).toEqual({
      version: 3,
      replayed: true,
    });
    const current = await owner.projectPopulation.draft({ projectId });
    expect(current?.version).toBe(4);
    expect(current?.document).toEqual(later);
    await expect(
      owner.projectPopulation.saveDraft({ ...request, document: later }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rejects cross-tenant reads and writes and read-only edits", async () => {
    await expect(
      owner.projectPopulation.draft({ projectId: otherProjectId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      otherOwner.projectPopulation.saveDraft({
        projectId,
        expectedVersion: 4,
        requestId: randomUUID(),
        document,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    for (const actor of [viewer, readOnly]) {
      await expect(
        actor.projectPopulation.saveDraft({
          projectId,
          expectedVersion: 4,
          requestId: randomUUID(),
          document,
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect((await owner.projectPopulation.draft({ projectId }))?.version).toBe(
      4,
    );
  });

  it("rejects unknown credential fields and duplicate selections", async () => {
    await expect(
      owner.projectPopulation.saveDraft({
        projectId,
        expectedVersion: 4,
        requestId: randomUUID(),
        document: { ...document, token: "not-a-real-token" } as PopulationDraft,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      owner.projectPopulation.saveDraft({
        projectId,
        expectedVersion: 4,
        requestId: randomUUID(),
        document: { ...document, sections: ["context", "context"] },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("refuses suspended organization access even for owners", async () => {
    await prisma.organization.update({
      where: { id: organizationId },
      data: { suspendedAt: new Date() },
    });
    try {
      await expect(
        owner.projectPopulation.draft({ projectId }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        owner.projectPopulation.saveDraft({
          projectId,
          expectedVersion: 4,
          requestId: randomUUID(),
          document,
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    } finally {
      await prisma.organization.update({
        where: { id: organizationId },
        data: { suspendedAt: null },
      });
    }
  });
});
