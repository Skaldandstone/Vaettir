// Native execution evidence is recorded by root on fresh owned disposable DBs.
// Stale independent ctx A versus native Clerk B on the same User, not fresh B
// adopting A's review. Explicit original expectedScope is a refusal control.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, type Prisma } from "@vaettir/db";
import { appRouter } from "./router.js";
import { assertOwnedTestDatabase } from "./testOnlyDatabaseSafety.js";
import { hardDeleteOrganization } from "./services/orgHardDelete.js";

describe("case clone checks independent authenticated Clerk before private preview creation and replay", () => {
  const tag = `clone-clerk-${randomUUID()}`;
  let organizationId: string;
  let userA: Prisma.UserGetPayload<{ include: { memberships: true } }>;
  let callerA: ReturnType<typeof appRouter.createCaller>;

  beforeAll(async () => {
    assertOwnedTestDatabase(process.env.DATABASE_URL);
    const tier = await prisma.planTier.findUniqueOrThrow({ where: { key: "free" } });
    organizationId = (await prisma.organization.create({
      data: { slug: tag, name: tag, planTierId: tier.id },
    })).id;
    const user = await prisma.user.create({ data: {
      email: `${tag}@example.com`, clerkUserId: `${tag}-authenticated-a`,
      memberships: { create: { organizationId, role: "OWNER", seatType: "FULL" } },
    } });
    userA = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, include: { memberships: true } });
    expect(userA.memberships).toEqual(expect.arrayContaining([
      expect.objectContaining({ organizationId, role: "OWNER", seatType: "FULL" }),
    ]));
    callerA = appRouter.createCaller({ prisma, user: userA });
  });

  afterAll(async () => {
    if (!organizationId || !userA) return;
    const organization = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
    if (organization.slug !== tag) throw Error("Owned synthetic clone-Clerk organization required");
    const native = await prisma.user.findUniqueOrThrow({ where: { id: userA.id } });
    if (native.clerkUserId !== userA.clerkUserId)
      throw Error("Original synthetic Clerk mapping must be restored before teardown");
    await hardDeleteOrganization(prisma, organizationId, userA.id, "Owned synthetic clone-Clerk fixture teardown");
    expect(await prisma.organizationDeletionLog.count({ where: { organizationId, deletedById: userA.id } })).toBe(1);
    // Retain native erasure receipt and dedicated synthetic actor FK evidence.
  });

  const content = {
    title: "Synthetic source | title\nsecond line",
    background: "Independent preconditions | exact\nsecond setup line",
    given: ["Given | original", "Given\nsecond line"],
    when: ["When | original"], then: ["Then\noriginal outcome"],
    steps: [{
      action: "Original | action\nsecond line", expectedActionOrData: "Literal | data",
      expectedResult: "Original expected\nresult", expectedResponse: "Literal | response",
    }],
    tags: ["synthetic", "literal|tag"], priority: "HIGH" as const,
    testType: "FUNCTIONAL" as const, suitePath: "Synthetic/source suite",
  };

  async function eligible(scoped: boolean) {
    const project = await callerA.project.create({
      organizationId, name: `${tag}-${randomUUID()}`,
      caseKey: `c${randomUUID().replaceAll("-", "").slice(0, 15)}`,
    });
    const source = await callerA.testCases.create({ projectId: project.id, ...content });
    const previewInput = {
      projectId: project.id, caseId: source.id,
      ...(scoped ? { expectedScope: { organizationId, clerkActorId: userA.clerkUserId } } : {}),
    };
    const preview = await callerA.caseClone.preview(previewInput);
    expect(preview).toMatchObject({
      sourceId: source.id, sourceDisplayId: source.displayId,
      sharedProcedureMaterialized: false, mediaReferencesExcluded: 0,
      definition: {
        title: content.title, background: content.background,
        given: content.given, when: content.when, then: content.then,
        tags: content.tags, priority: content.priority, testType: content.testType,
        customFields: {}, steps: [expect.objectContaining({ ...content.steps[0], order: 0, mediaAttachmentIds: [] })],
      },
    });
    expect(preview.expectedSourceRevision).toMatch(/^[a-f0-9]{64}$/);
    if (scoped) expect(preview).toMatchObject({ projectId: project.id, organizationId, clerkActorId: userA.clerkUserId });
    else {
      // Legacy shape/content identity must not be rewritten to manufacture
      // refusal. No new scope is inferred onto this original input or receipt.
      expect(preview.projectId).toBeUndefined();
      expect(preview.organizationId).toBeUndefined();
      expect(preview.clerkActorId).toBeUndefined();
    }
    const input = {
      ...previewInput, expectedSourceRevision: preview.expectedSourceRevision,
      title: "Explicit independent synthetic | duplicate", suitePath: "Synthetic/copied suite",
      reason: "Reviewed independent reuse of the exact synthetic authored procedure",
      confirmed: true as const, requestId: randomUUID(),
    };
    return { project, source, previewInput, preview, input };
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
          source: true, attachments: { orderBy: { id: "asc" } },
          automationDrafts: { orderBy: { id: "asc" } }, results: { orderBy: { id: "asc" } },
          prerequisites: { orderBy: { prerequisiteId: "asc" } },
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
      // Actual callerA carries its original independent authenticated ctx. No
      // identity/scope rebinding, service mock or fabricated receipt is used.
      const outcome = await operation().then(
        () => ({ accepted: true as const }),
        (error: unknown) => ({ accepted: false as const, error }),
      );
      expect.soft(outcome.accepted, `${label}: stale ctx A must receive no private preview/create/replay body`).toBe(false);
      if (!outcome.accepted) expect.soft(outcome.error).toMatchObject({ code: "FORBIDDEN" });
      expect.soft(await retained(f), `${label}: complete allocations/procedure/history/source evidence/audits must remain exact`).toEqual(before);
    } finally {
      await prisma.user.update({ where: { id: userA.id }, data: { clerkUserId: userA.clerkUserId } });
    }
  }

  async function assertGenuineClone(f: Fixture, caseId: string, displayId: string) {
    const copy = await prisma.testCase.findUniqueOrThrow({
      where: { id: caseId }, include: { steps: { orderBy: { order: "asc" } }, versions: { orderBy: { versionNumber: "asc" } } },
    });
    expect(copy.id).not.toBe(f.source.id);
    expect(copy.displayId).not.toBe(f.source.displayId);
    expect(copy).toMatchObject({
      projectId: f.project.id, displayId, title: f.input.title, suitePath: f.input.suitePath,
      background: content.background, given: content.given, when: content.when, then: content.then,
      tags: content.tags, testType: content.testType, priority: content.priority,
      origin: "AUTHORED", automationStatus: "MANUAL", reviewStatus: "PENDING_REVIEW",
    });
    expect(copy.steps).toHaveLength(1);
    expect(copy.steps[0]).toMatchObject({ ...content.steps[0], order: 0, mediaAttachmentIds: [] });
    expect(copy.versions).toHaveLength(1);
    expect(copy.versions[0]!.versionNumber).toBe(1);
  }

  for (const scoped of [false, true]) {
    const label = scoped ? "explicit original A scope (existing refusal control)" : "legacy omitted expectedScope";
    it(`preview withholds a genuinely eligible source from stale ctx A: ${label}`, async () => {
      const f = await eligible(scoped), before = await retained(f);
      await refuseWhileRemapped(f, () => callerA.caseClone.preview(f.previewInput), `preview ${label}`);
      expect(await callerA.caseClone.preview(f.previewInput)).toEqual(f.preview);
      expect(await retained(f)).toEqual(before);
    });

    it(`unaccepted create refuses stale ctx A without allocation or evidence writes: ${label}`, async () => {
      const f = await eligible(scoped), before = await retained(f);
      expect(await prisma.auditLog.count({ where: {
        projectId: f.project.id, actorId: userA.id, entityType: "TestCaseClone",
        metadata: { path: ["requestId"], equals: f.input.requestId },
      } })).toBe(0);
      await refuseWhileRemapped(f, () => callerA.caseClone.create(f.input), `unaccepted create ${label}`);
      // Original A restores the identical unaccepted review/input/UUID, proving
      // eligibility without changing native-only source or historical hashes.
      const accepted = await callerA.caseClone.create(f.input);
      expect(accepted.replayed).toBe(false);
      await assertGenuineClone(f, accepted.caseId, accepted.displayId);
      const acceptedState = await retained(f);
      expect(acceptedState.count).toBe(before.count + 1);
      expect(acceptedState.cases.find(c => c.id === f.source.id)).toEqual(before.cases.find(c => c.id === f.source.id));
      expect(await callerA.caseClone.create(f.input)).toEqual({ ...accepted, replayed: true });
      expect(await retained(f)).toEqual(acceptedState);
      expect(await prisma.auditLog.count({ where: {
        projectId: f.project.id, actorId: userA.id, entityType: "TestCaseClone",
        metadata: { path: ["requestId"], equals: f.input.requestId },
      } })).toBe(1);
    });

    it(`genuine accepted exact UUID replay refuses stale ctx A and recovers unchanged under restored A: ${label}`, async () => {
      const f = await eligible(scoped), before = await retained(f);
      const accepted = await callerA.caseClone.create(f.input);
      expect(accepted.replayed).toBe(false);
      await assertGenuineClone(f, accepted.caseId, accepted.displayId);
      const receipt = await prisma.auditLog.findFirstOrThrow({ where: {
        projectId: f.project.id, actorId: userA.id, entityType: "TestCaseClone", entityId: accepted.caseId,
        metadata: { path: ["requestId"], equals: f.input.requestId },
      } });
      expect(receipt).toMatchObject({ organizationId, actorId: userA.id, entityId: accepted.caseId });
      expect(receipt.metadata).toMatchObject({
        requestId: f.input.requestId, caseId: accepted.caseId, displayId: accepted.displayId,
        sourceCaseId: f.source.id, sourceDisplayId: f.source.displayId, sourceRevision: f.input.expectedSourceRevision,
      });
      const acceptedState = await retained(f);
      expect(acceptedState.count).toBe(before.count + 1);
      expect(acceptedState.cases.find(c => c.id === f.source.id)).toEqual(before.cases.find(c => c.id === f.source.id));
      expect(await callerA.caseClone.create(f.input)).toEqual({ ...accepted, replayed: true });
      expect(await retained(f)).toEqual(acceptedState);
      await refuseWhileRemapped(f, () => callerA.caseClone.create(f.input), `accepted replay ${label}`);
      expect(await callerA.caseClone.create(f.input)).toEqual({ ...accepted, replayed: true });
      expect(await retained(f)).toEqual(acceptedState);
      expect(await prisma.auditLog.findUniqueOrThrow({ where: { id: receipt.id } })).toEqual(receipt);
      expect(await prisma.auditLog.count({ where: {
        projectId: f.project.id, actorId: userA.id, entityType: "TestCaseClone",
        metadata: { path: ["requestId"], equals: f.input.requestId },
      } })).toBe(1);
    });
  }
});
