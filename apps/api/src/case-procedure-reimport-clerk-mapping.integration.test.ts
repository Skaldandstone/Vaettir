// Native execution evidence is recorded by root on fresh owned disposable DBs.
// Stale independently authenticated ctx A versus native Clerk B, not a fresh B
// caller using A's old review. Explicit expectedScope tests are controls.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, type Prisma } from "@vaettir/db";
import { appRouter } from "./router.js";
import { assertOwnedTestDatabase } from "./testOnlyDatabaseSafety.js";
import { hardDeleteOrganization } from "./services/orgHardDelete.js";

describe("procedure reimport verifies independent authenticated Clerk before preview approval and replay", () => {
  const tag = `reimport-clerk-${randomUUID()}`;
  let organizationId: string;
  let userA: Prisma.UserGetPayload<{ include: { memberships: true } }>;
  let callerA: ReturnType<typeof appRouter.createCaller>;

  beforeAll(async () => {
    assertOwnedTestDatabase(process.env.DATABASE_URL);
    const tier = await prisma.planTier.findUniqueOrThrow({ where: { key: "free" } });
    const organization = await prisma.organization.create({
      data: { slug: tag, name: tag, planTierId: tier.id },
    });
    organizationId = organization.id;
    const created = await prisma.user.create({
      data: {
        email: `${tag}@example.com`, clerkUserId: `${tag}-authenticated-a`,
        memberships: { create: { organizationId, role: "OWNER", seatType: "FULL" } },
      },
    });
    userA = await prisma.user.findUniqueOrThrow({
      where: { id: created.id }, include: { memberships: true },
    });
    expect(userA.memberships).toEqual(expect.arrayContaining([
      expect.objectContaining({ organizationId, role: "OWNER", seatType: "FULL" }),
    ]));
    callerA = appRouter.createCaller({ prisma, user: userA });
  });

  afterAll(async () => {
    if (!organizationId || !userA) return;
    const organization = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
    if (organization.slug !== tag) throw Error("Owned synthetic reimport-Clerk organization required");
    const native = await prisma.user.findUniqueOrThrow({ where: { id: userA.id } });
    if (native.clerkUserId !== userA.clerkUserId)
      throw Error("Original synthetic Clerk mapping must be restored before teardown");
    await hardDeleteOrganization(prisma, organizationId, userA.id, "Owned synthetic reimport-Clerk fixture teardown");
    expect(await prisma.organizationDeletionLog.count({ where: { organizationId, deletedById: userA.id } })).toBe(1);
    // Native deletion receipts retain their actor FK. Do not erase receipt or user.
  });

  const exportedContent = {
    title: "Synthetic exported | title\nsecond line",
    background: "Independent preconditions | exact\nsecond setup line",
    given: ["Given | original", "Given\nsecond line"],
    when: ["When | original"], then: ["Then\noriginal result"],
    steps: [{
      action: "Original | action\nsecond line", expectedActionOrData: "Literal | data",
      expectedResult: "Original expected\nresult", expectedResponse: "Literal | response",
    }],
    tags: ["synthetic", "literal|tag"], priority: "HIGH" as const,
    testType: "FUNCTIONAL" as const, suitePath: "Synthetic/retained suite",
  };

  async function eligible(scoped: boolean) {
    const project = await callerA.project.create({
      organizationId, name: `${tag}-${randomUUID()}`,
      caseKey: `r${randomUUID().replaceAll("-", "").slice(0, 15)}`,
    });
    const created = await callerA.testCases.create({ projectId: project.id, ...exportedContent });
    const bundle = await callerA.testCases.exportProcedure({
      projectId: project.id, ids: [created.id], scope: "selected", includeArchived: false,
    });
    expect(bundle.cases).toHaveLength(1);
    expect(bundle.cases[0]).toMatchObject({
      id: created.id, displayId: created.displayId,
      title: exportedContent.title, background: exportedContent.background,
      given: exportedContent.given, when: exportedContent.when, then: exportedContent.then,
    });
    // A genuine reviewed human edit, not an invented incoming body or saved
    // receipt. Exported procedure remains exact original evidence to restore.
    const current = await callerA.testCases.byId({ id: created.id });
    await callerA.testCases.update({
      id: created.id, ...exportedContent,
      title: "Synthetic later human | title\nretained until explicit approval",
      expectedCaseRevision: current.caseRevision, expectedStepRevision: current.stepRevision,
      expectedPriority: current.priority, expectedSuitePath: current.suitePath,
    });
    expect((await prisma.testCaseVersion.findMany({
      where: { testCaseId: created.id }, orderBy: { versionNumber: "asc" },
    })).map(version => version.versionNumber)).toEqual([1, 2]);
    const previewInput = {
      projectId: project.id, serialized: JSON.stringify(bundle),
      ...(scoped ? { expectedScope: { organizationId, clerkActorId: userA.clerkUserId } } : {}),
    };
    const preview = await callerA.caseProcedureReimport.preview(previewInput);
    expect(preview).toMatchObject({
      projectId: project.id, organizationId, actorId: userA.id, actorClerkUserId: userA.clerkUserId,
    });
    expect(preview.entries).toHaveLength(1);
    expect(preview.entries[0]).toMatchObject({
      caseId: created.id, displayId: created.displayId, status: "CONFLICT", missingRelationships: [],
    });
    expect(preview.entries[0]!.expectedCaseHash).toMatch(/^[a-f0-9]{64}$/);
    expect(preview.entries[0]!.fields.find(field => field.label === "title")).toMatchObject({
      current: "Synthetic later human | title\nretained until explicit approval", incoming: exportedContent.title,
    });
    const approval = {
      ...previewInput, expectedReviewHash: preview.expectedReviewHash, actorId: userA.id,
      selections: [{ caseId: created.id, reason: "Explicit review of exact synthetic exported original procedure", overwriteConfirmed: true as const }],
      confirmed: true as const, requestId: randomUUID(),
    };
    return { project, caseId: created.id, displayId: created.displayId, previewInput, preview, approval };
  }
  type Fixture = Awaited<ReturnType<typeof eligible>>;

  async function retained(f: Fixture) {
    return {
      project: await prisma.project.findUniqueOrThrow({ where: { id: f.project.id } }),
      cases: await prisma.testCase.findMany({
        where: { projectId: f.project.id }, orderBy: { id: "asc" },
        include: {
          steps: { orderBy: [{ order: "asc" }, { id: "asc" }] },
          versions: { orderBy: [{ versionNumber: "asc" }, { id: "asc" }] },
        },
      }),
      audits: await prisma.auditLog.findMany({ where: { projectId: f.project.id }, orderBy: { id: "asc" } }),
      count: await prisma.testCase.count({ where: { projectId: f.project.id } }),
    };
  }

  async function refuseWhileRemapped(f: Fixture, operation: () => Promise<unknown>, label: string) {
    const before = await retained(f);
    const clerkB = `${tag}-native-b-${randomUUID()}`;
    await prisma.user.update({ where: { id: userA.id }, data: { clerkUserId: clerkB } });
    try {
      const native = await prisma.user.findUniqueOrThrow({ where: { id: userA.id }, include: { memberships: true } });
      expect(native).toMatchObject({ id: userA.id, clerkUserId: clerkB });
      expect(native.memberships).toEqual(userA.memberships);
      expect(userA.clerkUserId).not.toBe(native.clerkUserId);
      // Deliberately retain callerA's independently authenticated original ctx.
      // Do not construct fresh ctxB, rebound scope or intercept native service.
      const outcome = await operation().then(
        () => ({ accepted: true as const }),
        (error: unknown) => ({ accepted: false as const, error }),
      );
      expect.soft(outcome.accepted, `${label}: stale ctx A must receive no preview body or approval/replay acknowledgement`).toBe(false);
      if (!outcome.accepted) expect.soft(outcome.error).toMatchObject({ code: "FORBIDDEN" });
      expect.soft(await retained(f), `${label}: complete project allocation/procedure/ordered history/audits must remain exact`).toEqual(before);
    } finally {
      await prisma.user.update({ where: { id: userA.id }, data: { clerkUserId: userA.clerkUserId } });
    }
  }

  for (const scoped of [false, true]) {
    const label = scoped ? "explicit original A scope (existing refusal control)" : "legacy omitted expectedScope";
    it(`preview withholds an eligible private procedure under stale ctx A: ${label}`, async () => {
      const f = await eligible(scoped), before = await retained(f);
      await refuseWhileRemapped(f, () => callerA.caseProcedureReimport.preview(f.previewInput), `preview ${label}`);
      expect(await callerA.caseProcedureReimport.preview(f.previewInput)).toEqual(f.preview);
      expect(await retained(f)).toEqual(before);
    });

    it(`unaccepted eligible approval refuses stale ctx A without procedure/history writes: ${label}`, async () => {
      const f = await eligible(scoped);
      expect(await prisma.auditLog.count({ where: {
        projectId: f.project.id, actorId: userA.id, entityType: "TestCaseProcedureReimport", entityId: f.approval.requestId,
      } })).toBe(0);
      await refuseWhileRemapped(f, () => callerA.caseProcedureReimport.approve(f.approval), `unaccepted approval ${label}`);
      // Restored original native mapping admits the SAME reviewed eligible
      // request once. No new UUID/review repairs may conceal an invalid fixture.
      const accepted = await callerA.caseProcedureReimport.approve(f.approval);
      expect(accepted).toMatchObject({
        requestId: f.approval.requestId, restored: [{ caseId: f.caseId, displayId: f.displayId }],
        replayed: false, projectId: f.project.id, organizationId, actorClerkUserId: userA.clerkUserId,
      });
      const restored = await prisma.testCase.findUniqueOrThrow({ where: { id: f.caseId } });
      expect(restored).toMatchObject({
        displayId: f.displayId, title: exportedContent.title, background: exportedContent.background,
        given: exportedContent.given, when: exportedContent.when, then: exportedContent.then,
        suitePath: exportedContent.suitePath, priority: exportedContent.priority,
      });
      const afterAcceptance = await retained(f);
      expect(await callerA.caseProcedureReimport.approve(f.approval)).toEqual({ ...accepted, replayed: true });
      expect(await retained(f)).toEqual(afterAcceptance);
      expect(await prisma.auditLog.count({ where: {
        projectId: f.project.id, actorId: userA.id, entityType: "TestCaseProcedureReimport", entityId: f.approval.requestId,
      } })).toBe(1);
    });

    it(`genuinely accepted exact UUID replay refuses stale ctx A and recovers after A restoration: ${label}`, async () => {
      const f = await eligible(scoped);
      const accepted = await callerA.caseProcedureReimport.approve(f.approval);
      expect(accepted).toMatchObject({
        requestId: f.approval.requestId, restored: [{ caseId: f.caseId, displayId: f.displayId }],
        replayed: false, projectId: f.project.id, organizationId, actorClerkUserId: userA.clerkUserId,
      });
      const receipt = await prisma.auditLog.findFirstOrThrow({ where: {
        projectId: f.project.id, actorId: userA.id, entityType: "TestCaseProcedureReimport", entityId: f.approval.requestId,
      } });
      expect(receipt).toMatchObject({ organizationId, actorId: userA.id });
      expect(receipt.metadata).toMatchObject({ requestId: f.approval.requestId, result: { requestId: f.approval.requestId, replayed: false } });
      const acceptedState = await retained(f);
      expect(await callerA.caseProcedureReimport.approve(f.approval)).toEqual({ ...accepted, replayed: true });
      expect(await retained(f)).toEqual(acceptedState);
      await refuseWhileRemapped(f, () => callerA.caseProcedureReimport.approve(f.approval), `accepted replay ${label}`);
      expect(await callerA.caseProcedureReimport.approve(f.approval)).toEqual({ ...accepted, replayed: true });
      expect(await retained(f)).toEqual(acceptedState);
      expect(await prisma.auditLog.findUniqueOrThrow({ where: { id: receipt.id } })).toEqual(receipt);
      expect(await prisma.auditLog.count({ where: {
        projectId: f.project.id, actorId: userA.id, entityType: "TestCaseProcedureReimport", entityId: f.approval.requestId,
      } })).toBe(1);
    });
  }
});
