// Fresh owned synthetic DB only; root owns execution and validation evidence.
// Same native User.id, genuinely refreshed ctx B, old UNACCEPTED A review.
// This is not a stale ctx test and never invents Clerk stamps for old receipts.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, type Prisma } from "@vaettir/db";
import { appRouter } from "./router.js";
import { assertOwnedTestDatabase } from "./testOnlyDatabaseSafety.js";
import { hardDeleteOrganization } from "./services/orgHardDelete.js";

describe("ephemeral case intent binds actual current Clerk independently of native actor identity", () => {
  const tag = `case-intent-${randomUUID()}`;
  type Caller = ReturnType<typeof appRouter.createCaller>;
  let organizationId: string;
  let actorA: Prisma.UserGetPayload<{ include: { memberships: true } }>;
  let a: Caller;
  beforeAll(async () => {
    assertOwnedTestDatabase(process.env.DATABASE_URL);
    const tier = await prisma.planTier.findUniqueOrThrow({ where: { key: "free" } });
    organizationId = (await prisma.organization.create({ data: { slug: tag, name: tag, planTierId: tier.id } })).id;
    actorA = await prisma.user.create({ data: {
      email: `${tag}@example.com`, clerkUserId: `${tag}-a`,
      memberships: { create: { organizationId, role: "OWNER", seatType: "FULL" } },
    }, include: { memberships: true } });
    a = appRouter.createCaller({ prisma, user: actorA });
  });
  afterAll(async () => {
    if (!organizationId || !actorA) return;
    const org = await prisma.organization.findUnique({ where: { id: organizationId } });
    if (!org || org.slug !== tag) throw Error("Synthetic case-intent fixture ownership mismatch");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: actorA.id } })).clerkUserId).toBe(actorA.clerkUserId);
    await hardDeleteOrganization(prisma, organizationId, actorA.id, "Owned case-intent binding fixture teardown");
    expect(await prisma.organizationDeletionLog.count({ where: { organizationId, deletedById: actorA.id } })).toBe(1);
    // Retain the dedicated actor and native deletion receipt FK.
  });
  const schema = { version: 1 as const, fields: [
    { key: "context", label: "Context", type: "TEXT" as const, required: true, retired: false, options: [] },
    { key: "flag", label: "Flag", type: "BOOLEAN" as const, required: true, retired: false, options: [] },
    { key: "count", label: "Count", type: "NUMBER" as const, required: true, retired: false, options: [] },
  ] };
  const content = {
    title: "Original | authored title", background: "Literal setup\nsecond line",
    given: ["Given | original"], when: ["When\noriginal"], then: ["Then original"],
    steps: [{ action: "Literal | action", expectedResult: "Expected\nsecond line" }],
    priority: "HIGH" as const, testType: "FUNCTIONAL" as const, tags: ["synthetic"],
  };
  const initialValues = { context: "Initial | literal\ncontext", flag: false, count: 0 };
  const proposedValues = { context: "Explicit | reviewed\ncontext", flag: true, count: 3 };
  async function schemaRequest(caller: Caller, projectId: string, next = schema) {
    const impact = await caller.caseFields.reviewSchema({ projectId, schema: next });
    return { projectId, schema: next, actorId: impact.actorId,
      expectedSchemaHash: impact.expectedSchemaHash, expectedImpactHash: impact.expectedImpactHash,
      reason: "Reviewed synthetic definitions", confirmed: true as const, requestId: randomUUID() };
  }
  async function saveRequest(caller: Caller, projectId: string, caseId: string, values = proposedValues) {
    const state = await caller.caseFields.get({ projectId, caseId });
    return { projectId, caseId, values, expectedSchemaHash: state.expectedSchemaHash, expectedValueHash: state.expectedValueHash,
      reason: "Reviewed synthetic metadata", confirmed: true as const, requestId: randomUUID() };
  }
  async function fixture() {
    const project = await a.project.create({ organizationId, name: `${tag}-${randomUUID()}`, caseKey: `i${randomUUID().replaceAll("-", "").slice(0, 15)}` });
    const acceptedConfigure = await schemaRequest(a, project.id);
    await a.caseFields.configure(acceptedConfigure);
    const fields = await a.caseFields.get({ projectId: project.id });
    const testCase = await a.testCases.create({ projectId: project.id, ...content,
      customFields: initialValues, expectedFieldSchemaHash: fields.expectedSchemaHash });
    const current = await a.testCases.byId({ id: testCase.id });
    const values = await a.caseFields.get({ projectId: project.id, caseId: testCase.id });
    await a.testCases.update({ id: testCase.id, ...content, title: "Later | human title",
      expectedCaseRevision: current.caseRevision, expectedStepRevision: current.stepRevision,
      expectedPriority: current.priority, expectedSuitePath: current.suitePath,
      customFields: initialValues, expectedFieldSchemaHash: values.expectedSchemaHash, expectedCustomFieldRevision: values.expectedValueHash });
    const acceptedSave = await saveRequest(a, project.id, testCase.id, { ...initialValues, context: "Accepted A | second\ncontext" });
    await a.caseFields.save(acceptedSave);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: {
      projectId: project.id, actorId: actorA.id, entityType: "CaseFieldValueWrite", entityId: acceptedSave.requestId,
    } });
    expect(await prisma.testCaseVersion.count({ where: { testCaseId: testCase.id } })).toBe(2);
    return { project, caseId: testCase.id, acceptedConfigure, acceptedSave, audit };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  async function retained(f: Fixture) {
    return { project: await prisma.project.findUniqueOrThrow({ where: { id: f.project.id } }),
      cases: await prisma.testCase.findMany({ where: { projectId: f.project.id }, orderBy: { id: "asc" },
        include: { steps: { orderBy: { order: "asc" } }, versions: { orderBy: { versionNumber: "asc" } } } }),
      audits: await prisma.auditLog.findMany({ where: { projectId: f.project.id }, orderBy: { id: "asc" } }),
      count: await prisma.testCase.count({ where: { projectId: f.project.id } }) };
  }
  async function withFreshB(f: Fixture, work: (b: Caller) => Promise<void>) {
    const clerkB = `${tag}-b-${randomUUID()}`;
    await prisma.user.update({ where: { id: actorA.id }, data: { clerkUserId: clerkB } });
    try {
      const userB = await prisma.user.findUniqueOrThrow({ where: { id: actorA.id }, include: { memberships: true } });
      expect(userB.id).toBe(actorA.id); expect(userB.clerkUserId).toBe(clerkB);
      expect(userB.memberships).toEqual(actorA.memberships);
      const b = appRouter.createCaller({ prisma, user: userB });
      const scope = await b.caseFields.get({ projectId: f.project.id, caseId: f.caseId,
        originalOrganizationId: organizationId, expectedClerkActorId: clerkB });
      expect(scope.readScope).toEqual({ projectId: f.project.id, organizationId, actorId: actorA.id, actorClerkUserId: clerkB });
      expect(scope.canEdit).toBe(true); expect(scope.canConfigure).toBe(true);
      await work(b);
    } finally {
      await prisma.user.update({ where: { id: actorA.id }, data: { clerkUserId: actorA.clerkUserId } });
    }
  }
  async function refuseOld(f: Fixture, action: () => Promise<unknown>, label: string) {
    const before = await retained(f);
    const result = await action().then(() => ({ accepted: true as const }), (error: unknown) => ({ accepted: false as const, error }));
    expect.soft(result.accepted, `${label}: valid B must not adopt unaccepted A review`).toBe(false);
    if (!result.accepted) expect.soft(result.error).toMatchObject({ code: "CONFLICT" });
    expect.soft(await retained(f), `${label}: no allocation/content/procedure/version/audit changes`).toEqual(before);
  }
  async function fieldRestore(caller: Caller, f: Fixture) {
    const input = { projectId: f.project.id, caseId: f.caseId, auditId: f.audit.id, side: "BEFORE" as const };
    const preview = await caller.caseFields.previewRestore(input);
    expect(preview.canRestore).toBe(true);
    return { ...input, actorId: preview.actorId, expectedSchemaHash: preview.expectedSchemaHash,
      expectedValueHash: preview.expectedValueHash, expectedSourceHash: preview.expectedSourceHash,
      reason: "Explicit reviewed metadata restore", confirmed: true as const, requestId: randomUUID() };
  }
  async function versionRestore(caller: Caller, f: Fixture) {
    const input = { projectId: f.project.id, testCaseId: f.caseId, versionNumber: 1 };
    const preview = await caller.caseVersionReview.preview(input);
    expect(preview.canRestore).toBe(true);
    const fields: Array<"title"> = ["title"];
    return { ...input, fields, expectedCaseRevision: preview.expectedCaseRevision,
      expectedVersionRevision: preview.expectedVersionRevision,
      reason: "Explicit reviewed procedure title restore", confirmed: true as const, requestId: randomUUID() };
  }
  it("configure binds new schema/impact intent to actual Clerk and permits B's explicit fresh review", async () => {
    const f = await fixture(), next = { ...schema, fields: schema.fields.map((field) => ({ ...field, label: `${field.label} reviewed` })) };
    const old = await schemaRequest(a, f.project.id, next);
    await withFreshB(f, async (b) => {
      const reviewB = await schemaRequest(b, f.project.id, next);
      expect.soft(reviewB.expectedSchemaHash).not.toBe(old.expectedSchemaHash);
      expect.soft(reviewB.expectedImpactHash).not.toBe(old.expectedImpactHash);
      expect(reviewB.actorId).toBe(old.actorId);
      await refuseOld(f, () => b.caseFields.configure(old), "configure");
      const fresh = await schemaRequest(b, f.project.id, next);
      expect(await b.caseFields.configure(fresh)).toEqual({ requestId: fresh.requestId, replayed: false });
      expect((await b.caseFields.get({ projectId: f.project.id })).schema).toEqual(next);
    });
  });
  it("save binds both field hashes to actual Clerk and permits B's same explicit human values", async () => {
    const f = await fixture(), old = await saveRequest(a, f.project.id, f.caseId);
    await withFreshB(f, async (b) => {
      const reviewB = await saveRequest(b, f.project.id, f.caseId);
      expect.soft(reviewB.expectedSchemaHash).not.toBe(old.expectedSchemaHash);
      expect.soft(reviewB.expectedValueHash).not.toBe(old.expectedValueHash);
      await refuseOld(f, () => b.caseFields.save(old), "save");
      const fresh = await saveRequest(b, f.project.id, f.caseId);
      expect(await b.caseFields.save(fresh)).toEqual({ requestId: fresh.requestId, replayed: false });
      expect((await b.caseFields.get({ projectId: f.project.id, caseId: f.caseId })).values).toEqual(proposedValues);
    });
  });
  it("metadata restore keeps source identity stable but refuses A's unaccepted authoring intent under B", async () => {
    const f = await fixture(), old = await fieldRestore(a, f);
    await withFreshB(f, async (b) => {
      const reviewB = await fieldRestore(b, f);
      expect.soft(reviewB.expectedSchemaHash).not.toBe(old.expectedSchemaHash);
      expect.soft(reviewB.expectedValueHash).not.toBe(old.expectedValueHash);
      expect(reviewB.expectedSourceHash).toBe(old.expectedSourceHash);
      await refuseOld(f, () => b.caseFields.restore(old), "metadata restore");
      const fresh = await fieldRestore(b, f);
      expect(await b.caseFields.restore(fresh)).toEqual({ requestId: fresh.requestId, replayed: false });
      expect((await b.caseFields.get({ projectId: f.project.id, caseId: f.caseId })).values).toEqual(initialValues);
    });
  });
  it("embedded create cannot inherit A's schema intent but accepts B's reviewed required metadata", async () => {
    const f = await fixture(), fieldA = await a.caseFields.get({ projectId: f.project.id });
    const old = { projectId: f.project.id, ...content, title: "Explicit independent new case", customFields: proposedValues, expectedFieldSchemaHash: fieldA.expectedSchemaHash };
    await withFreshB(f, async (b) => {
      const fieldB = await b.caseFields.get({ projectId: f.project.id });
      expect.soft(fieldB.expectedSchemaHash).not.toBe(old.expectedFieldSchemaHash);
      await refuseOld(f, () => b.testCases.create(old), "embedded create");
      const before = await prisma.testCase.count({ where: { projectId: f.project.id } });
      const fresh = await b.caseFields.get({ projectId: f.project.id });
      const created = await b.testCases.create({ ...old, expectedFieldSchemaHash: fresh.expectedSchemaHash });
      expect(created.createdById).toBe(actorA.id); expect(created.customFields).toEqual(proposedValues);
      expect(await prisma.testCase.count({ where: { projectId: f.project.id } })).toBe(before + 1);
    });
  });
  it("embedded update cannot inherit A's schema/value intent while global procedure CAS stays unchanged", async () => {
    const f = await fixture(), current = await a.testCases.byId({ id: f.caseId });
    const fieldA = await a.caseFields.get({ projectId: f.project.id, caseId: f.caseId });
    const old = { id: f.caseId, ...content, title: "Explicit independent next title", customFields: proposedValues,
      expectedFieldSchemaHash: fieldA.expectedSchemaHash, expectedCustomFieldRevision: fieldA.expectedValueHash,
      expectedCaseRevision: current.caseRevision, expectedStepRevision: current.stepRevision,
      expectedPriority: current.priority, expectedSuitePath: current.suitePath };
    await withFreshB(f, async (b) => {
      const fieldB = await b.caseFields.get({ projectId: f.project.id, caseId: f.caseId });
      expect.soft(fieldB.expectedSchemaHash).not.toBe(old.expectedFieldSchemaHash);
      expect.soft(fieldB.expectedValueHash).not.toBe(old.expectedCustomFieldRevision);
      expect((await b.testCases.byId({ id: f.caseId })).caseRevision).toBe(old.expectedCaseRevision);
      await refuseOld(f, () => b.testCases.update(old), "embedded update");
      const now = await b.testCases.byId({ id: f.caseId }), fresh = await b.caseFields.get({ projectId: f.project.id, caseId: f.caseId });
      await b.testCases.update({ ...old, expectedFieldSchemaHash: fresh.expectedSchemaHash, expectedCustomFieldRevision: fresh.expectedValueHash,
        expectedCaseRevision: now.caseRevision, expectedStepRevision: now.stepRevision, expectedPriority: now.priority, expectedSuitePath: now.suitePath });
      expect((await b.testCases.byId({ id: f.caseId })).title).toBe(old.title);
    });
  });
  it("version restore binds its review token to actual Clerk without redefining current case or historical content", async () => {
    const f = await fixture(), old = await versionRestore(a, f);
    await withFreshB(f, async (b) => {
      const reviewB = await versionRestore(b, f);
      expect.soft(reviewB.expectedVersionRevision).not.toBe(old.expectedVersionRevision);
      expect(reviewB.expectedCaseRevision).toBe(old.expectedCaseRevision);
      await refuseOld(f, () => b.caseVersionReview.restore(old), "version restore");
      const fresh = await versionRestore(b, f);
      expect((await b.caseVersionReview.restore(fresh)).replayed).toBe(false);
      expect((await b.testCases.byId({ id: f.caseId })).title).toBe(content.title);
    });
  });
  it("accepted native-actor receipts remain exact compatibility recovery under B and restored A", async () => {
    const f = await fixture(), acceptedFieldRestore = await fieldRestore(a, f);
    await a.caseFields.restore(acceptedFieldRestore);
    const acceptedVersionRestore = await versionRestore(a, f);
    const versionAck = await a.caseVersionReview.restore(acceptedVersionRestore);
    const before = await retained(f);
    const replay = async (caller: Caller) => {
      expect(await caller.caseFields.configure(f.acceptedConfigure)).toEqual({ requestId: f.acceptedConfigure.requestId, replayed: true });
      expect(await caller.caseFields.save(f.acceptedSave)).toEqual({ requestId: f.acceptedSave.requestId, replayed: true });
      expect(await caller.caseFields.restore(acceptedFieldRestore)).toEqual({ requestId: acceptedFieldRestore.requestId, replayed: true });
      expect(await caller.caseVersionReview.restore(acceptedVersionRestore)).toEqual({ ...versionAck, replayed: true });
      expect(await retained(f)).toEqual(before);
    };
    await withFreshB(f, replay);
    await replay(a);
    // No receipt/input hash/version body was rewritten or retrospectively
    // attributed to a Clerk identity absent from its retained native record.
    expect(await retained(f)).toEqual(before);
  });
});
