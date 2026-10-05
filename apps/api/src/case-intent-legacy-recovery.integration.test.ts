// Native execution is recorded by root on a fresh owned migrated database.
// Accepted native-actor receipts are not retrospectively Clerk-stamped. Their
// original organization still binds replay; old unaccepted review tokens do not.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, type Prisma } from "@vaettir/db";
import { appRouter } from "./router.js";
import { assertOwnedTestDatabase } from "./testOnlyDatabaseSafety.js";
import { hardDeleteOrganization } from "./services/orgHardDelete.js";
import { qualityProfileHash } from "./services/qualityExperienceProfile.js";

describe("legacy accepted intent recovery retains native actor and original tenant boundaries", () => {
  const tag = `case-legacy-${randomUUID()}`;
  let orgA: string, orgB: string;
  const organizations: string[] = [];
  let userA: Prisma.UserGetPayload<{ include: { memberships: true } }>;
  let a: ReturnType<typeof appRouter.createCaller>;
  beforeAll(async () => {
    assertOwnedTestDatabase(process.env.DATABASE_URL);
    const tier = await prisma.planTier.findUniqueOrThrow({ where: { key: "free" } });
    for (const suffix of ["a", "b"])
      organizations.push((await prisma.organization.create({ data: {
        name: `${tag}-${suffix}`, slug: `${tag}-${suffix}`, planTierId: tier.id,
      } })).id);
    [orgA, orgB] = [organizations[0]!, organizations[1]!];
    userA = await prisma.user.create({ data: {
      email: `${tag}@example.com`, clerkUserId: `${tag}-original-clerk-a`,
      memberships: { create: organizations.map((organizationId) => ({ organizationId, role: "OWNER" as const, seatType: "FULL" as const })) },
    }, include: { memberships: true } });
    // Independently reread both memberships before constructing the context;
    // an earlier missing-B ctx denial must not mask the receipt tenant guard.
    userA = await prisma.user.findUniqueOrThrow({ where: { id: userA.id }, include: { memberships: true } });
    for (const organizationId of organizations)
      expect(userA.memberships.find((membership) => membership.organizationId === organizationId)).toMatchObject({ role: "OWNER", seatType: "FULL" });
    a = appRouter.createCaller({ prisma, user: userA });
  });
  afterAll(async () => {
    if (!userA) return;
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userA.id } })).clerkUserId).toBe(userA.clerkUserId);
    for (const id of organizations) {
      const org = await prisma.organization.findUnique({ where: { id } });
      if (!org || !org.slug.startsWith(`${tag}-`)) throw Error("Synthetic legacy-recovery fixture ownership mismatch");
      await hardDeleteOrganization(prisma, id, userA.id, "Owned legacy-intent fixture teardown");
      expect(await prisma.organizationDeletionLog.count({ where: { organizationId: id, deletedById: userA.id } })).toBe(1);
    }
    // Do not delete retained native deletion receipts or their dedicated actor.
  });
  const content = { title: "Original | title", background: "Setup\nsecond line",
    given: ["Given | original"], when: ["When\noriginal"], then: ["Then original"],
    steps: [{ action: "Original | action", expectedResult: "Original\nexpected" }],
    testType: "FUNCTIONAL" as const, priority: "HIGH" as const, tags: ["synthetic"] };
  const schema = { version: 1 as const, fields: [
    { key: "flag", label: "Flag", type: "BOOLEAN" as const, required: true, retired: false, options: [] },
    { key: "count", label: "Count", type: "NUMBER" as const, required: true, retired: false, options: [] },
  ] };
  async function fixture(required: boolean) {
    const p = await a.project.create({ organizationId: orgA, name: `${tag}-${randomUUID()}`,
      caseKey: `l${randomUUID().replaceAll("-", "").slice(0, 15)}` });
    if (required) {
      const review = await a.caseFields.reviewSchema({ projectId: p.id, schema });
      await a.caseFields.configure({ projectId: p.id, schema, actorId: review.actorId,
        expectedSchemaHash: review.expectedSchemaHash, expectedImpactHash: review.expectedImpactHash,
        reason: "Reviewed required synthetic legacy metadata", confirmed: true, requestId: randomUUID() });
    }
    const fields = await a.caseFields.get({ projectId: p.id });
    const c = await a.testCases.create({ projectId: p.id, ...content,
      ...(required ? { customFields: { flag: false, count: 0 }, expectedFieldSchemaHash: fields.expectedSchemaHash } : {}) });
    return { p, c };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  async function retained(f: Fixture) {
    return { project: await prisma.project.findUniqueOrThrow({ where: { id: f.p.id } }),
      cases: await prisma.testCase.findMany({ where: { projectId: f.p.id }, orderBy: { id: "asc" },
        include: { steps: { orderBy: { order: "asc" } }, versions: { orderBy: { versionNumber: "asc" } } } }),
      audits: await prisma.auditLog.findMany({ where: { projectId: f.p.id }, orderBy: { id: "asc" } }),
      count: await prisma.testCase.count({ where: { projectId: f.p.id } }) };
  }
  it("accepted original-org version restore refuses reparent replay despite OWNER in both and recovers unchanged after return", async () => {
    const f = await fixture(false), current = await a.testCases.byId({ id: f.c.id });
    await a.testCases.update({ id: f.c.id, ...content, title: "Later | explicit human title",
      expectedCaseRevision: current.caseRevision, expectedStepRevision: current.stepRevision,
      expectedPriority: current.priority, expectedSuitePath: current.suitePath });
    const selected = { projectId: f.p.id, testCaseId: f.c.id, versionNumber: 1 };
    const preview = await a.caseVersionReview.preview(selected);
    expect(preview.canRestore).toBe(true);
    expect(preview.fields.find((field) => field.key === "title")).toMatchObject({ changed: true, restorable: true });
    const fields: Array<"title"> = ["title"];
    const input = { ...selected, fields, expectedCaseRevision: preview.expectedCaseRevision,
      expectedVersionRevision: preview.expectedVersionRevision,
      reason: "Accepted exact original-organization restore", confirmed: true as const, requestId: randomUUID() };
    const accepted = await a.caseVersionReview.restore(input);
    expect(accepted).toMatchObject({ restoredVersionNumber: 1, createdVersionNumber: 3, replayed: false });
    const receipt = await prisma.auditLog.findFirstOrThrow({ where: {
      projectId: f.p.id, actorId: userA.id, entityType: "TestCaseVersionRestore", entityId: f.c.id,
      metadata: { path: ["requestId"], equals: input.requestId },
    } });
    expect(receipt.organizationId).toBe(orgA);
    const before = await retained(f);
    await prisma.project.update({ where: { id: f.p.id }, data: { organizationId: orgB } });
    try {
      expect((await a.caseFields.get({ projectId: f.p.id, caseId: f.c.id })).readScope).toEqual({
        projectId: f.p.id, organizationId: orgB, actorId: userA.id, actorClerkUserId: userA.clerkUserId,
      });
      const currentPreview = await a.caseVersionReview.preview(selected);
      expect(currentPreview.canRestore).toBe(true);
      expect(currentPreview.caseId).toBe(f.c.id);
      const moved = await retained(f);
      await expect(a.caseVersionReview.restore(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(await retained(f)).toEqual(moved);
      expect(await prisma.auditLog.findUniqueOrThrow({ where: { id: receipt.id } })).toEqual(receipt);
    } finally {
      await prisma.project.update({ where: { id: f.p.id }, data: { organizationId: orgA } });
    }
    expect(await retained(f)).toEqual(before);
    expect(await a.caseVersionReview.restore(input)).toEqual({ ...accepted, replayed: true });
    expect(await retained(f)).toEqual(before);
    expect(await prisma.auditLog.count({ where: {
      projectId: f.p.id, actorId: userA.id, entityType: "TestCaseVersionRestore", entityId: f.c.id,
      metadata: { path: ["requestId"], equals: input.requestId },
    } })).toBe(1);
  });
  it("rejects unaccepted native-only pre-Clerk tokens but replays an explicitly seeded exact accepted legacy field receipt", async () => {
    const f = await fixture(true), state = await a.caseFields.get({ projectId: f.p.id, caseId: f.c.id });
    const native = await prisma.testCase.findUniqueOrThrow({ where: { id: f.c.id } });
    // Exact previous native-actor-only formulas, distinct from the existing
    // pre-actor fixture and from new Clerk-bound v2 authoring token formulas.
    const legacySchemaHash = qualityProfileHash({ projectId: f.p.id, organizationId: orgA,
      version: state.schemaVersion, schema: state.schema, actorId: userA.id });
    const legacyValueHash = qualityProfileHash({ actorId: userA.id, caseId: f.c.id,
      values: state.values, updatedAt: native.updatedAt.toISOString() });
    expect(legacySchemaHash).not.toBe(state.expectedSchemaHash);
    expect(legacyValueHash).not.toBe(state.expectedValueHash);
    const unaccepted = { projectId: f.p.id, caseId: f.c.id,
      values: { flag: true, count: 1 }, expectedSchemaHash: legacySchemaHash, expectedValueHash: legacyValueHash,
      reason: "Unaccepted old native-only review", confirmed: true as const, requestId: randomUUID() };
    const beforeRefusal = await retained(f);
    await expect(a.caseFields.save(unaccepted)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await retained(f)).toEqual(beforeRefusal);
    const acceptedLegacy = { ...unaccepted, values: { flag: false, count: 0 },
      reason: "Synthetic retained accepted native-only request", requestId: randomUUID() };
    // Deliberately seeded retained history, not a claim of an actual old
    // provider response or a retrospective attribution to Clerk A or B.
    const receipt = await prisma.auditLog.create({ data: {
      organizationId: orgA, projectId: f.p.id, actorId: userA.id,
      entityType: "CaseFieldValueWrite", entityId: acceptedLegacy.requestId, action: "UPDATE",
      summary: "Synthetic accepted native-only legacy receipt",
      metadata: { requestHash: qualityProfileHash(acceptedLegacy), input: acceptedLegacy,
        evidence: { version: 1, caseId: f.c.id, beforeValues: state.values, afterValues: state.values,
          schema: state.schema, schemaVersion: state.schemaVersion, recoverySupported: true } },
    } });
    const beforeRecovery = await retained(f);
    expect(await a.caseFields.save(acceptedLegacy)).toEqual({ requestId: acceptedLegacy.requestId, replayed: true });
    expect(await retained(f)).toEqual(beforeRecovery);
    const clerkB = `${tag}-fresh-native-b-${randomUUID()}`;
    await prisma.user.update({ where: { id: userA.id }, data: { clerkUserId: clerkB } });
    try {
      const nativeB = await prisma.user.findUniqueOrThrow({ where: { id: userA.id }, include: { memberships: true } });
      expect(nativeB.id).toBe(userA.id); expect(nativeB.clerkUserId).toBe(clerkB);
      const b = appRouter.createCaller({ prisma, user: nativeB });
      expect((await b.caseFields.get({ projectId: f.p.id, caseId: f.c.id })).readScope).toEqual({
        projectId: f.p.id, organizationId: orgA, actorId: userA.id, actorClerkUserId: clerkB,
      });
      await expect(b.caseFields.save(unaccepted)).rejects.toMatchObject({ code: "CONFLICT" });
      expect(await b.caseFields.save(acceptedLegacy)).toEqual({ requestId: acceptedLegacy.requestId, replayed: true });
      expect(await retained(f)).toEqual(beforeRecovery);
    } finally {
      await prisma.user.update({ where: { id: userA.id }, data: { clerkUserId: userA.clerkUserId } });
    }
    expect(await a.caseFields.save(acceptedLegacy)).toEqual({ requestId: acceptedLegacy.requestId, replayed: true });
    expect(await retained(f)).toEqual(beforeRecovery);
    expect(await prisma.auditLog.findUniqueOrThrow({ where: { id: receipt.id } })).toEqual(receipt);
    expect(await prisma.auditLog.count({ where: { projectId: f.p.id, actorId: userA.id,
      entityType: "CaseFieldValueWrite", entityId: acceptedLegacy.requestId } })).toBe(1);
  });
  it("global clone source and procedure identity stay actor-independent while ephemeral field intent changes", async () => {
    const f = await fixture(true), before = await retained(f);
    const cloneA = await a.caseClone.preview({ projectId: f.p.id, caseId: f.c.id });
    const caseA = await a.testCases.byId({ id: f.c.id });
    const fieldA = await a.caseFields.get({ projectId: f.p.id, caseId: f.c.id });
    const clerkB = `${tag}-clone-current-b-${randomUUID()}`;
    await prisma.user.update({ where: { id: userA.id }, data: { clerkUserId: clerkB } });
    try {
      const nativeB = await prisma.user.findUniqueOrThrow({ where: { id: userA.id }, include: { memberships: true } });
      expect(nativeB.id).toBe(userA.id); expect(nativeB.clerkUserId).toBe(clerkB);
      const b = appRouter.createCaller({ prisma, user: nativeB });
      const cloneB = await b.caseClone.preview({ projectId: f.p.id, caseId: f.c.id });
      const caseB = await b.testCases.byId({ id: f.c.id });
      const fieldB = await b.caseFields.get({ projectId: f.p.id, caseId: f.c.id });
      expect(fieldB.readScope).toEqual({ projectId: f.p.id, organizationId: orgA, actorId: userA.id, actorClerkUserId: clerkB });
      expect(cloneB.expectedSourceRevision).toBe(cloneA.expectedSourceRevision);
      expect(caseB.caseRevision).toBe(caseA.caseRevision);
      expect(caseB.stepRevision).toBe(caseA.stepRevision);
      expect(caseB.displayId).toBe(caseA.displayId);
      expect(fieldB.schema).toEqual(fieldA.schema); expect(fieldB.values).toEqual(fieldA.values);
      expect(fieldB.expectedSchemaHash).not.toBe(fieldA.expectedSchemaHash);
      expect(fieldB.expectedValueHash).not.toBe(fieldA.expectedValueHash);
      expect(await retained(f)).toEqual(before);
    } finally {
      await prisma.user.update({ where: { id: userA.id }, data: { clerkUserId: userA.clerkUserId } });
    }
    expect(await retained(f)).toEqual(before);
  });
});
