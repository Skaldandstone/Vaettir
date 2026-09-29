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

  it("creates cited requirements once and preserves human edits and removals on rerun", async () => {
    const projectId = (await owner.project.create({organizationId,name:`Requirements ${randomUUID()}`})).id;
    const doc = {
      projectId,
      requestId: randomUUID(),
      sourceKey: "req-fixture",
      title: "Device spec",
      content: "Voltage shall stay below 5 V.\nPlayback must resume.",
      processingPermission: true as const,
    };
    await owner.populationDocuments.preview(doc);
    await owner.populationDocuments.approve({
      projectId,
      requestId: doc.requestId,
      approve: true,
    });
    const preview = await owner.populationRequirements.preview({
      projectId,
      sourceKey: doc.sourceKey,
    });
    const row = preview.candidates[0]!;
    const approval = {
      projectId,
      sourceKey: doc.sourceKey,
      version: preview.version,
      candidateKey: row.key,
      title: "Voltage shall remain below 5 V at full load.",
      approve: true as const,
    };
    const results = await Promise.all([
      owner.populationRequirements.approve(approval),
      owner.populationRequirements.approve(approval),
    ]);
    expect(results[0]!.requirementId).toBe(results[1]!.requirementId);
    expect(results.filter((result) => result.created)).toHaveLength(1);
    await prisma.requirement.update({
      where: { id: results[0]!.requirementId },
      data: { title: "Human-reviewed voltage limit" },
    });
    expect(
      (
        await owner.populationRequirements.preview({
          projectId,
          sourceKey: doc.sourceKey,
        })
      ).candidates[0]?.status,
    ).toBe("human-edited");
    await owner.populationRequirements.approve(approval);
    expect(
      (
        await prisma.requirement.findUniqueOrThrow({
          where: { id: results[0]!.requirementId },
        })
      ).title,
    ).toBe("Human-reviewed voltage limit");
    await prisma.requirement.delete({
      where: { id: results[0]!.requirementId },
    });
    await expect(
      owner.populationRequirements.approve(approval),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      (
        await owner.populationRequirements.preview({
          projectId,
          sourceKey: doc.sourceKey,
        })
      ).candidates[0]?.status,
    ).toBe("removed");
    await expect(
      viewer.populationRequirements.approve(approval),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      otherOwner.populationRequirements.preview({
        projectId,
        sourceKey: doc.sourceKey,
      }),
    ).rejects.toThrow();
    const changed = {
      ...doc,
      requestId: randomUUID(),
      content: "Playback must resume.\nSystem must log events.",
    };
    await owner.populationDocuments.preview(changed);
    await owner.populationDocuments.approve({
      projectId,
      requestId: changed.requestId,
      approve: true,
    });
    expect((await owner.populationRequirements.preview({projectId,sourceKey:doc.sourceKey})).staleLinks).toHaveLength(1);
    await expect(
      owner.populationRequirements.approve({
        ...approval,
        candidateKey: preview.candidates[1]!.key,
        title: preview.candidates[1]!.title,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("reviews document evidence, deduplicates identical reruns and preserves unrelated records", async () => {
    const input = {
      projectId,
      requestId: randomUUID(),
      sourceKey: "readme",
      title: "System specification",
      content: "Playback must resume after interruption.",
      processingPermission: true as const,
    };
    const preview = await owner.populationDocuments.preview(input);
    expect(preview.status).toBe("new");
    expect(await owner.populationDocuments.list({ projectId })).toEqual([]);
    const approval = {
      projectId,
      requestId: input.requestId,
      approve: true as const,
    };
    expect(await owner.populationDocuments.approve(approval)).toEqual({
      version: 1,
      replayed: false,
    });
    expect(await owner.populationDocuments.approve(approval)).toEqual({
      version: 1,
      replayed: true,
    });
    const rerun = { ...input, requestId: randomUUID() };
    expect((await owner.populationDocuments.preview(rerun)).status).toBe(
      "unchanged",
    );
    expect(
      await owner.populationDocuments.approve({
        ...approval,
        requestId: rerun.requestId,
      }),
    ).toEqual({ version: 1, replayed: false });
    expect(await owner.populationDocuments.list({ projectId })).toHaveLength(1);
    const left = {
      ...input,
      requestId: randomUUID(),
      content: "Playback must resume in 2 seconds.",
    };
    const right = {
      ...input,
      requestId: randomUUID(),
      content: "Playback must resume in 3 seconds.",
    };
    expect((await owner.populationDocuments.preview(left)).status).toBe(
      "changed",
    );
    await owner.populationDocuments.preview(right);
    await owner.populationDocuments.approve({
      ...approval,
      requestId: left.requestId,
    });
    await expect(
      owner.populationDocuments.approve({
        ...approval,
        requestId: right.requestId,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await owner.populationDocuments.approve(approval)).toEqual({
      version: 1,
      replayed: true,
    });
    expect(
      (
        await prisma.projectPopulationDocument.findUniqueOrThrow({
          where: { projectId_sourceKey: { projectId, sourceKey: "readme" } },
        })
      ).content,
    ).toBe(left.content);
    await expect(
      owner.populationDocuments.preview({ ...input, content: "Changed reuse" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("document intake enforces processing permission, scope and full editor seat", async () => {
    const input = {
      projectId,
      requestId: randomUUID(),
      sourceKey: "security-spec",
      title: "Spec",
      content: "Synthetic requirements",
      processingPermission: true as const,
    };
    await expect(
      viewer.populationDocuments.preview(input),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      readOnly.populationDocuments.preview(input),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      otherOwner.populationDocuments.preview(input),
    ).rejects.toThrow();
    await expect(
      otherOwner.populationDocuments.list({ projectId }),
    ).rejects.toThrow();
    await expect(
      owner.populationDocuments.preview({
        ...input,
        processingPermission: false as unknown as true,
      }),
    ).rejects.toThrow();
    await expect(
      owner.populationDocuments.preview({
        ...input,
        content: "x".repeat(50001),
      }),
    ).rejects.toThrow();
    await expect(
      owner.populationDocuments.preview({ ...input, content: "x\0y" }),
    ).rejects.toThrow();
    await owner.populationDocuments.preview(input);
    expect(
      (await owner.populationDocuments.pending({ projectId })).some(
        (run) => run.requestId === input.requestId,
      ),
    ).toBe(true);
    expect(await viewer.populationDocuments.pending({ projectId })).toEqual([]);
    await expect(
      otherOwner.populationDocuments.approve({
        projectId,
        requestId: input.requestId,
        approve: true,
      }),
    ).rejects.toThrow();
    expect(
      await owner.populationDocuments.cancel({
        projectId,
        requestId: input.requestId,
      }),
    ).toEqual({ cancelled: true });
    await expect(
      owner.populationDocuments.approve({
        projectId,
        requestId: input.requestId,
        approve: true,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      (await owner.populationDocuments.pending({ projectId })).some(
        (run) => run.requestId === input.requestId,
      ),
    ).toBe(false);
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
