import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@vaettir/db";
import { assessTestCaseRisk, reviewTestDesign } from "@vaettir/ai-agent";
vi.mock("@vaettir/ai-agent", async (original) => ({
  ...(await original<typeof import("@vaettir/ai-agent")>()),
  assessTestCaseRisk: vi.fn(),
  reviewTestDesign: vi.fn(),
}));
import { appRouter } from "./router.js";
import { assertOwnedTestDatabase } from "./testOnlyDatabaseSafety.js";
import { hardDeleteOrganization } from "./services/orgHardDelete.js";

describe("durable analysis original actor tenant and exact acknowledgements", () => {
  const prefix = `queue-current-scope-${randomUUID()}`,
    reason = "Owned synthetic durable scope cleanup";
  const organizations: Array<{ id: string; slug: string }> = [],
    users: string[] = [];
  let orgId: string,
    otherOrgId: string,
    projectId: string,
    actorId: string,
    clerk: string;
  let a: ReturnType<typeof appRouter.createCaller>,
    b: typeof a,
    staleAUser: Parameters<typeof appRouter.createCaller>[0]["user"];
  beforeAll(async () => {
    assertOwnedTestDatabase(process.env.DATABASE_URL);
    const tier = await prisma.planTier.findUniqueOrThrow({
      where: { key: "free" },
    });
    for (const suffix of ["original", "other"]) {
      const slug = `${prefix}-${suffix}`;
      const org = await prisma.organization.create({
        data: { slug, name: slug, planTierId: tier.id },
      });
      organizations.push({ id: org.id, slug });
    }
    [orgId, otherOrgId] = organizations.map((row) => row.id);
    for (const suffix of ["a", "b"]) {
      const user = await prisma.user.create({
        data: {
          clerkUserId: `${prefix}-${suffix}`,
          email: `${prefix}-${suffix}@example.com`,
          memberships: {
            create: organizations.map((org) => ({
              organizationId: org.id,
              role: "OWNER",
              seatType: "FULL",
            })),
          },
        },
        include: { memberships: true },
      });
      users.push(user.id);
      const caller = appRouter.createCaller({ prisma, user });
      if (suffix === "a") {
        a = caller;
        staleAUser = user;
        actorId = user.id;
        clerk = user.clerkUserId;
      } else b = caller;
    }
    projectId = (
      await a.project.create({
        organizationId: orgId,
        name: `${prefix} project`,
      })
    ).id;
    await prisma.aiCreditTransaction.create({
      data: {
        organizationId: orgId,
        type: "GRANT",
        amount: 100,
        description: "Owned synthetic no-provider fixture",
      },
    });
  });
  afterAll(async () => {
    expect(assessTestCaseRisk).not.toHaveBeenCalled();
    expect(reviewTestDesign).not.toHaveBeenCalled();
    for (const org of organizations) {
      if (!actorId) continue;
      const actual = await prisma.organization.findUnique({
        where: { id: org.id },
        select: { slug: true },
      });
      if (!actual) continue;
      if (actual.slug !== org.slug || !actual.slug.startsWith(prefix))
        throw Error("Refusing non-owned synthetic erasure");
      const deleted = await hardDeleteOrganization(
        prisma,
        org.id,
        actorId,
        reason,
      );
      expect(
        await prisma.organizationDeletionLog.deleteMany({
          where: {
            id: deleted.deletionLogId,
            organizationId: org.id,
            organizationSlug: org.slug,
            deletedById: actorId,
            reason,
          },
        }),
      ).toMatchObject({ count: 1 });
    }
    if (users.length)
      await prisma.user.deleteMany({ where: { id: { in: users } } });
  });
  const scope = () => ({
    originalOrganizationId: orgId,
    expectedClerkActorId: clerk,
  });
  async function fixture(scoped = true) {
    const c = await a.testCases.quickCreate({
      projectId,
      title: `${prefix}-${randomUUID()}`,
    });
    const input = {
      projectId,
      action: "RISK" as const,
      ids: [c.id],
      requestId: randomUUID(),
      ...(scoped ? scope() : {}),
    };
    const saved = await a.caseAnalysisQueue.review(input);
    return { input, saved };
  }
  const approval = (saved: Awaited<ReturnType<typeof fixture>>["saved"]) => ({
    projectId,
    id: saved.id,
    scopeHash: saved.scopeHash,
    maximumCredits: saved.maximumCredits,
    approved: true as const,
    allowCaseProcessing: true as const,
    ...scope(),
  });
  it("preserves omitted legacy selection hash and array response while new native reads echo verified mapping", async () => {
    const legacy = await fixture(false);
    expect(legacy.saved).not.toHaveProperty("scope");
    expect(legacy.saved).not.toHaveProperty("requestId");
    const stored = await prisma.caseAnalysisQueue.findUniqueOrThrow({
      where: { id: legacy.saved.id },
    });
    expect(stored.selectionHash).toBe(
      createHash("sha256")
        .update(JSON.stringify([projectId, "RISK", legacy.input.ids]))
        .digest("hex"),
    );
    expect(Array.isArray(await a.caseAnalysisQueue.mine({ projectId }))).toBe(
      true,
    );
    const native = await fixture();
    expect(native.saved).toMatchObject({
      requestId: native.input.requestId,
      scope: {
        projectId,
        organizationId: orgId,
        actorId,
        actorClerkUserId: clerk,
      },
    });
    expect(
      await a.caseAnalysisQueue.mine({ projectId, ...scope() }),
    ).toHaveProperty("scope.actorClerkUserId", clerk);
  });
  it("concurrent identical scoped review UUID yields one saved job and altered pins cannot reinterpret its legacy hash", async () => {
    const c = await a.testCases.quickCreate({
      projectId,
      title: `${prefix} concurrent`,
    });
    const input = {
      projectId,
      action: "RISK" as const,
      ids: [c.id],
      requestId: randomUUID(),
      ...scope(),
    };
    const [first, second] = await Promise.all([
      a.caseAnalysisQueue.review(input),
      a.caseAnalysisQueue.review(input),
    ]);
    expect(first.id).toBe(second.id);
    expect(
      await prisma.caseAnalysisQueue.count({
        where: {
          projectId,
          requestedById: actorId,
          requestId: input.requestId,
        },
      }),
    ).toBe(1);
    await expect(
      a.caseAnalysisQueue.review({
        projectId,
        action: input.action,
        ids: input.ids,
        requestId: input.requestId,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("a switched current actor cannot rebind retained review UUID or inspect another actor's saved job", async () => {
    const { input, saved } = await fixture();
    const before = await prisma.caseAnalysisQueue.count({
      where: { projectId },
    });
    await expect(b.caseAnalysisQueue.review(input)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      b.caseAnalysisQueue.byId({ projectId, id: saved.id, ...scope() }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await prisma.caseAnalysisQueue.count({ where: { projectId } })).toBe(
      before,
    );
    expect(await a.caseAnalysisQueue.review(input)).toMatchObject({
      id: saved.id,
      requestId: input.requestId,
    });
  });
  it("server transport Clerk and currently locked DB mapping must both match before private catalog or receipt replay", async () => {
    const { input } = await fixture();
    const wrongTransport = appRouter.createCaller({
      prisma,
      user: { ...staleAUser!, clerkUserId: `${prefix}-b` },
    });
    await expect(
      wrongTransport.caseAnalysisQueue.review(input),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await prisma.user.update({
      where: { id: actorId },
      data: { clerkUserId: `${prefix}-temporarily-remapped` },
    });
    try {
      await expect(
        a.caseAnalysisQueue.mine({ projectId, ...scope() }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(a.caseAnalysisQueue.review(input)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    } finally {
      await prisma.user.update({
        where: { id: actorId },
        data: { clerkUserId: clerk },
      });
    }
  });
  it("same actor owning both tenants cannot reparent-read or replay saved review/approval", async () => {
    const { input, saved } = await fixture();
    await prisma.project.update({
      where: { id: projectId },
      data: { organizationId: otherOrgId },
    });
    try {
      for (const attempt of [
        () => a.caseAnalysisQueue.review(input),
        () => a.caseAnalysisQueue.byId({ projectId, id: saved.id, ...scope() }),
        () => a.caseAnalysisQueue.approve(approval(saved)),
      ])
        await expect(attempt()).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        a.caseAnalysisQueue.byId({
          projectId,
          id: saved.id,
          originalOrganizationId: otherOrgId,
          expectedClerkActorId: clerk,
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    } finally {
      await prisma.project.update({
        where: { id: projectId },
        data: { organizationId: orgId },
      });
    }
    expect(await a.caseAnalysisQueue.review(input)).toMatchObject({
      id: saved.id,
      status: "REVIEW",
    });
  });
  it("current full-seat approval is checked before acknowledged replay while Viewer scoped reads stay read-only", async () => {
    const { saved } = await fixture();
    const input = approval(saved);
    const ack = await a.caseAnalysisQueue.approve(input);
    expect(ack.approvedAt).not.toBeNull();
    await prisma.membership.update({
      where: {
        organizationId_userId: { organizationId: orgId, userId: actorId },
      },
      data: { role: "VIEWER", seatType: "READ_ONLY" },
    });
    try {
      await expect(a.caseAnalysisQueue.approve(input)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(
        await a.caseAnalysisQueue.byId({ projectId, id: saved.id, ...scope() }),
      ).toMatchObject({ canSpend: false, scope: { actorClerkUserId: clerk } });
    } finally {
      await prisma.membership.update({
        where: {
          organizationId_userId: { organizationId: orgId, userId: actorId },
        },
        data: { role: "OWNER", seatType: "FULL" },
      });
    }
    expect(await a.caseAnalysisQueue.approve(input)).toMatchObject({
      id: saved.id,
      scopeHash: input.scopeHash,
      maximumCredits: input.maximumCredits,
      approvedAt: ack.approvedAt,
    });
    expect(
      await prisma.aiCreditTransaction.count({
        where: { organizationId: orgId, type: "CONSUMPTION" },
      }),
    ).toBe(0);
  });
  it("scoped admin ACK recovers after later cancellation but never overwrites its original human reason", async () => {
    const { saved } = await fixture();
    const input = {
      projectId,
      id: saved.id,
      reason: "Original human credit request",
      ...scope(),
    };
    const ack = await a.caseAnalysisQueue.requestAdmin(input);
    expect(ack).toMatchObject({
      queueId: saved.id,
      scopeHash: saved.scopeHash,
      scope: { actorClerkUserId: clerk },
    });
    await a.caseAnalysisQueue.cancel({ projectId, id: saved.id, ...scope() });
    expect(await a.caseAnalysisQueue.requestAdmin(input)).toEqual(ack);
    await expect(
      a.caseAnalysisQueue.requestAdmin({
        ...input,
        reason: "Different unreviewed reason",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      await prisma.aiCreditUseRequest.count({ where: { id: ack.id } }),
    ).toBe(1);
  });
});
