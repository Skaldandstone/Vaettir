import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@vaettir/db";
import { appRouter } from "./router.js";
import { assertOwnedTestDatabase } from "./testOnlyDatabaseSafety.js";
let admitted = false;
try { assertOwnedTestDatabase(process.env.DATABASE_URL); admitted = true; } catch { /* No native test outside the exact owned disposable route. */ }

describe.skipIf(!admitted)("durable manual case creation on an owned disposable database", () => {
  let owner: ReturnType<typeof appRouter.createCaller>, outsider: typeof owner;
  let projectId: string, organizationId: string, actorId: string, subject: string;
  beforeAll(async () => {
    assertOwnedTestDatabase(process.env.DATABASE_URL);
    const tag = `durable-create-${randomUUID()}`;
    const tier = await prisma.planTier.findUniqueOrThrow({ where: { key: "free" } });
    const org = await prisma.organization.create({ data: { name: tag, slug: tag, planTierId: tier.id } });
    organizationId = org.id; subject = tag;
    const user = await prisma.user.create({ data: { email: `${tag}@example.invalid`, clerkUserId: subject,
      memberships: { create: { organizationId, role: "OWNER", seatType: "FULL" } } }, include: { memberships: true } });
    actorId = user.id;
    const other = await prisma.user.create({ data: { email: `${tag}-outside@example.invalid`, clerkUserId: `${tag}-outside` }, include: { memberships: true } });
    owner = appRouter.createCaller({ prisma, user, authenticatedClerkSubject: subject });
    outsider = appRouter.createCaller({ prisma, user: other, authenticatedClerkSubject: other.clerkUserId });
    projectId = (await prisma.project.create({ data: { organizationId, name: tag, slug: tag, caseKey: "DUR" } })).id;
  });
  async function request() {
    const fields = await owner.caseFields.get({ projectId });
    return { projectId, originalOrganizationId: organizationId, expectedClerkActorId: subject, requestId: randomUUID(),
      title: " Exact saved\nmanual case ", testType: "FUNCTIONAL", priority: "HIGH" as const,
      given: ["", " Exact Given "], when: ["When\nline"], then: ["Then"], tags: [" literal|tag "],
      steps: [{ action: " Tester action ", expectedActionOrData: "GET /synthetic", expectedResult: "", expectedResponse: null, mediaAttachmentIds: [] }],
      customFields: {}, expectedFieldSchemaHash: fields.expectedSchemaHash };
  }
  it("serializes concurrent retries into one case, receipt and initial version", async () => {
    const input = await request();
    const results = await Promise.all([owner.testCases.createDurable(input), owner.testCases.createDurable(input)]);
    expect(results[0]!.id).toBe(results[1]!.id); expect(results.filter(result => result.replayed)).toHaveLength(1);
    expect(await prisma.testCase.count({ where: { projectId } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { projectId, entityType: "TestCaseCreate", entityId: input.requestId } })).toBe(1);
    expect(await prisma.testCaseVersion.count({ where: { testCaseId: results[0]!.id } })).toBe(1);
    const saved = await owner.testCases.byId({ id: results[0]!.id });
    expect(saved).toMatchObject({ title: input.title, given: input.given, when: input.when, then: input.then, tags: input.tags });
    await expect(owner.testCases.createDurable({ ...input, title: "Changed body" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(outsider.testCases.createDurable(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("recovers the original ID without overwriting later manual edits or adding a version", async () => {
    const input = await request(), first = await owner.testCases.createDurable(input);
    const before = await owner.testCases.byId({ id: first.id });
    await owner.testCases.update({ ...input, id: first.id, title: "Later human wording", expectedCaseRevision: before.caseRevision,
      expectedStepRevision: before.stepRevision, expectedPriority: before.priority, expectedSuitePath: before.suitePath });
    const versions = await prisma.testCaseVersion.findMany({ where: { testCaseId: first.id }, orderBy: { versionNumber: "asc" } });
    expect(await owner.testCases.createDurable(input)).toEqual({ ...first, replayed: true });
    expect((await owner.testCases.byId({ id: first.id })).title).toBe("Later human wording");
    expect(await prisma.testCaseVersion.findMany({ where: { testCaseId: first.id }, orderBy: { versionNumber: "asc" } })).toEqual(versions);
  });
  it("requires the original current native Clerk mapping to recover an acknowledged request", async () => {
    const input = await request(), first = await owner.testCases.createDurable(input);
    await prisma.user.update({ where: { id: actorId }, data: { clerkUserId: `${subject}-replacement` } });
    try { await expect(owner.testCases.createDurable(input)).rejects.toMatchObject({ code: "FORBIDDEN" }); }
    finally { await prisma.user.update({ where: { id: actorId }, data: { clerkUserId: subject } }); }
    expect(await owner.testCases.createDurable(input)).toEqual({ ...first, replayed: true });
  });
  it("cannot rebind a receipt to another authorized actor or project", async () => {
    const input = await request(); await owner.testCases.createDurable(input);
    const tag = `durable-other-${randomUUID()}`;
    const user = await prisma.user.create({ data: { email: `${tag}@example.invalid`, clerkUserId: tag,
      memberships: { create: { organizationId, role: "EDITOR", seatType: "FULL" } } }, include: { memberships: true } });
    const other = appRouter.createCaller({ prisma, user, authenticatedClerkSubject: tag });
    await expect(other.testCases.createDurable({ ...input, expectedClerkActorId: tag })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const project = await prisma.project.create({ data: { organizationId, name: tag, slug: tag, caseKey: "OTH" } });
    await expect(owner.testCases.createDurable({ ...input, projectId: project.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await prisma.testCase.count({ where: { projectId: project.id } })).toBe(0);
    const concurrent = await request(), fields = await owner.caseFields.get({ projectId: project.id });
    const outcomes = await Promise.allSettled([
      owner.testCases.createDurable(concurrent),
      owner.testCases.createDurable({ ...concurrent, projectId: project.id, expectedFieldSchemaHash: fields.expectedSchemaHash }),
    ]);
    expect(outcomes.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.find(result => result.status === "rejected")).toMatchObject({ reason: { code: "FORBIDDEN" } });
    expect(await prisma.auditLog.count({ where: { entityType: "TestCaseCreate", entityId: concurrent.requestId } })).toBe(1);
  });
  it("rolls back the entire case and version if durable receipt insertion fails", async () => {
    const input = await request(), name = `durable_fail_${randomUUID().replaceAll("-", "")}`;
    // All identifiers and the trigger predicate are generated here, never user data.
    // This relation-wide DDL is permitted only in the admitted disposable schema.
    const before = await prisma.testCase.count({ where: { projectId } });
    await prisma.$executeRawUnsafe(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic receipt refusal'; END $$`);
    try {
      await prisma.$executeRawUnsafe(`CREATE TRIGGER ${name} BEFORE INSERT ON "AuditLog" FOR EACH ROW WHEN (NEW."entityType" = 'TestCaseCreate' AND NEW."entityId" = '${input.requestId}') EXECUTE FUNCTION ${name}()`);
      try { await expect(owner.testCases.createDurable(input)).rejects.toThrow(); }
      finally { await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${name} ON "AuditLog"`); }
    } finally { await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${name}()`); }
    expect(await prisma.testCase.count({ where: { projectId } })).toBe(before);
    expect(await prisma.auditLog.count({ where: { projectId, entityType: "TestCaseCreate", entityId: input.requestId } })).toBe(0);
    const retry = await owner.testCases.createDurable(input);
    expect(retry.replayed).toBe(false);
    expect(await prisma.testCaseVersion.count({ where: { testCaseId: retry.id } })).toBe(1);
  });
});
