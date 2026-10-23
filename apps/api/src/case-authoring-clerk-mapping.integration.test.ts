// Run only on a fresh migrated owned disposable database. Root owns validation.
// These test a changed native Clerk mapping vs unchanged
// authenticated ctx, NOT fresh actor B using actor A's review intent/hashes.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, type Prisma } from "@vaettir/db";
import { appRouter } from "./router.js";
import { assertOwnedTestDatabase } from "./testOnlyDatabaseSafety.js";
import { hardDeleteOrganization } from "./services/orgHardDelete.js";

describe("case authoring and reviewed version recovery require current native Clerk mapping", () => {
  const tag = `case-clerk-${randomUUID()}`;
  type Caller = ReturnType<typeof appRouter.createCaller>;
  let organizationId: string;
  let user: Prisma.UserGetPayload<{ include: { memberships: true } }>;
  let owner: Caller;
  beforeAll(async () => {
    assertOwnedTestDatabase(process.env.DATABASE_URL);
    const tier = await prisma.planTier.findUniqueOrThrow({ where: { key: "free" } });
    const org = await prisma.organization.create({
      data: { slug: tag, name: tag, planTierId: tier.id },
    });
    organizationId = org.id;
    user = await prisma.user.create({
      data: {
        email: `${tag}@example.com`, clerkUserId: `${tag}-original-a`,
        memberships: { create: { organizationId, role: "OWNER", seatType: "FULL" } },
      }, include: { memberships: true },
    });
    owner = appRouter.createCaller({ prisma, user });
  });
  afterAll(async () => {
    if (!organizationId || !user) return;
    const org = await prisma.organization.findUnique({ where: { id: organizationId } });
    if (!org || org.slug !== tag) throw Error("Synthetic case-Clerk fixture ownership mismatch");
    const current = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (current.clerkUserId !== user.clerkUserId)
      throw Error("Synthetic case-Clerk mapping was not restored before teardown");
    await hardDeleteOrganization(prisma, organizationId, user.id, "Owned case-Clerk mapping fixture teardown");
    expect(await prisma.organizationDeletionLog.count({ where: { organizationId, deletedById: user.id } })).toBe(1);
    // Retain the synthetic actor and native erasure receipt; their FK is proof,
    // not disposable state that this fixture may delete to simplify cleanup.
  });
  const content = {
    title: "Synthetic original | title", background: "Original setup\nLiteral second line",
    given: ["Given | original"], when: ["When\noriginal"], then: ["Then original"],
    steps: [{ action: "Original | action", expectedResult: "Original\nexpected outcome" }],
    testType: "FUNCTIONAL" as const, priority: "HIGH" as const, tags: ["synthetic", "literal|tag"],
  };
  const metadata = { context: "Original | context\nsecond line", enabled: false, count: 0 };
  const requiredSchema = {
    version: 1 as const,
    fields: [
      { key: "context", label: "Context", type: "TEXT" as const, required: true, retired: false, options: [] },
      { key: "enabled", label: "Enabled", type: "BOOLEAN" as const, required: true, retired: false, options: [] },
      { key: "count", label: "Count", type: "NUMBER" as const, required: true, retired: false, options: [] },
    ],
  };
  async function fixture(required: boolean) {
    const project = await owner.project.create({
      organizationId, name: `${tag}-${randomUUID()}`,
      caseKey: `c${randomUUID().replaceAll("-", "").slice(0, 15)}`,
    });
    if (required) {
      const impact = await owner.caseFields.reviewSchema({ projectId: project.id, schema: requiredSchema });
      await owner.caseFields.configure({
        projectId: project.id, schema: requiredSchema, actorId: impact.actorId,
        expectedSchemaHash: impact.expectedSchemaHash, expectedImpactHash: impact.expectedImpactHash,
        reason: "Reviewed required synthetic metadata", confirmed: true, requestId: randomUUID(),
      });
    }
    const fields = await owner.caseFields.get({ projectId: project.id });
    const created = await owner.testCases.create({
      projectId: project.id, ...content,
      ...(required ? { customFields: metadata, expectedFieldSchemaHash: fields.expectedSchemaHash } : {}),
    });
    const current = await owner.testCases.byId({ id: created.id });
    const currentFields = await owner.caseFields.get({ projectId: project.id, caseId: created.id });
    // A genuine ordinary edit generates the retained second version. Never
    // mutate a saved snapshot or fabricate a version to satisfy this fixture.
    await owner.testCases.update({
      id: created.id, ...content, title: "Synthetic later | human title",
      expectedCaseRevision: current.caseRevision, expectedStepRevision: current.stepRevision,
      expectedPriority: current.priority, expectedSuitePath: current.suitePath,
      ...(required ? {
        customFields: metadata, expectedFieldSchemaHash: currentFields.expectedSchemaHash,
        expectedCustomFieldRevision: currentFields.expectedValueHash,
      } : {}),
    });
    const versions = await prisma.testCaseVersion.findMany({
      where: { testCaseId: created.id }, orderBy: { versionNumber: "asc" },
    });
    expect(versions.map((version) => version.versionNumber)).toEqual([1, 2]);
    return { project, testCaseId: created.id, required };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  async function retained(f: Fixture) {
    return {
      project: await prisma.project.findUniqueOrThrow({ where: { id: f.project.id } }),
      cases: await prisma.testCase.findMany({
        where: { projectId: f.project.id }, orderBy: { id: "asc" },
        include: { steps: { orderBy: { order: "asc" } }, versions: { orderBy: { versionNumber: "asc" } } },
      }),
      audits: await prisma.auditLog.findMany({ where: { projectId: f.project.id }, orderBy: { id: "asc" } }),
      count: await prisma.testCase.count({ where: { projectId: f.project.id } }),
    };
  }
  function selection(f: Fixture) {
    return { projectId: f.project.id, testCaseId: f.testCaseId, versionNumber: 1 };
  }
  async function restoreRequest(f: Fixture) {
    const preview = await owner.caseVersionReview.preview(selection(f));
    expect(preview.canRestore).toBe(true);
    expect(preview.fields.find((field) => field.key === "title")).toMatchObject({ changed: true, restorable: true });
    const fields: Array<"title"> = ["title"];
    return {
      ...selection(f), fields,
      expectedCaseRevision: preview.expectedCaseRevision, expectedVersionRevision: preview.expectedVersionRevision,
      reason: "Reviewed exact synthetic title restore before native remap",
      confirmed: true as const, requestId: randomUUID(),
    };
  }
  async function remappedRefusal(f: Fixture, operation: () => Promise<unknown>, label: string) {
    const before = await retained(f);
    await prisma.user.update({
      where: { id: user.id }, data: { clerkUserId: `${tag}-different-native-b-${randomUUID()}` },
    });
    try {
      // The router still receives the original independent ctx A object. No
      // new caller, mocked identity or A-derived expected hash is rebound to B.
      const outcome = await operation().then(
        () => ({ accepted: true as const }), (error: unknown) => ({ accepted: false as const, error }),
      );
      expect.soft(outcome.accepted, `${label}: stale authenticated ctx A must be refused`).toBe(false);
      if (!outcome.accepted) expect.soft(outcome.error).toMatchObject({ code: "FORBIDDEN" });
      expect.soft(await retained(f), `${label}: whole allocation/procedure/version/audit state must remain exact`).toEqual(before);
    } finally {
      await prisma.user.update({ where: { id: user.id }, data: { clerkUserId: user.clerkUserId } });
    }
  }
  it("quickCreate refuses stale ctx on a genuinely eligible empty-field-schema project", async () => {
    const f = await fixture(false);
    await remappedRefusal(f, () => owner.testCases.quickCreate({
      projectId: f.project.id, title: "Eligible independent synthetic quick draft", suitePath: "Synthetic / drafts",
    }), "quickCreate");
  });
  for (const required of [false, true]) {
    const label = required ? "required-field schema with valid false/zero/text" : "empty-field schema";
    it(`create refuses stale ctx with ${label}`, async () => {
      const f = await fixture(required), fields = await owner.caseFields.get({ projectId: f.project.id });
      const input = {
        projectId: f.project.id, ...content, title: "Eligible independent synthetic new case",
        ...(required ? { customFields: metadata, expectedFieldSchemaHash: fields.expectedSchemaHash } : {}),
      };
      await remappedRefusal(f, () => owner.testCases.create(input), `create ${label}`);
    });
    it(`update refuses stale ctx with ${label} and preserves stable IDs and ordered procedure`, async () => {
      const f = await fixture(required), current = await owner.testCases.byId({ id: f.testCaseId });
      const fields = await owner.caseFields.get({ projectId: f.project.id, caseId: f.testCaseId });
      const input = {
        id: f.testCaseId, ...content, title: "Eligible independently reviewed third title",
        expectedCaseRevision: current.caseRevision, expectedStepRevision: current.stepRevision,
        expectedPriority: current.priority, expectedSuitePath: current.suitePath,
        ...(required ? {
          customFields: metadata, expectedFieldSchemaHash: fields.expectedSchemaHash,
          expectedCustomFieldRevision: fields.expectedValueHash,
        } : {}),
      };
      await remappedRefusal(f, () => owner.testCases.update(input), `update ${label}`);
    });
    it(`preview list and historical comparison withhold version bodies from stale ctx with ${label}`, async () => {
      // Independently eligible scopes keep all three before-fix read failures
      // visible without a successful mutation manufacturing a later refusal.
      for (const path of ["preview", "list", "compareHistorical"] as const) {
        const f = await fixture(required);
        const input = selection(f);
        await owner.caseVersionReview.preview(input);
        await owner.caseVersionReview.list({ projectId: f.project.id, testCaseId: f.testCaseId, take: 10 });
        const comparison = { projectId: f.project.id, testCaseId: f.testCaseId, fromVersionNumber: 1, toVersionNumber: 2 };
        await owner.caseVersionReview.compareHistorical(comparison);
        await remappedRefusal(f, () => {
          if (path === "preview") return owner.caseVersionReview.preview(input);
          if (path === "list") return owner.caseVersionReview.list({ projectId: f.project.id, testCaseId: f.testCaseId, take: 10 });
          return owner.caseVersionReview.compareHistorical(comparison);
        }, `${path} ${label}`);
      }
    });
    it(`restore refuses stale ctx with ${label} despite a genuinely eligible reviewed baseline`, async () => {
      const f = await fixture(required), input = await restoreRequest(f);
      await remappedRefusal(f, () => owner.caseVersionReview.restore(input), `restore ${label}`);
    });
    it(`exact accepted version restore replay requires current native mapping with ${label}`, async () => {
      const f = await fixture(required), input = await restoreRequest(f);
      const accepted = await owner.caseVersionReview.restore(input);
      expect(accepted).toMatchObject({ restoredVersionNumber: 1, createdVersionNumber: 3, replayed: false });
      const receipt = await prisma.auditLog.findFirstOrThrow({ where: {
        projectId: f.project.id, actorId: user.id, entityType: "TestCaseVersionRestore", entityId: f.testCaseId,
        metadata: { path: ["requestId"], equals: input.requestId },
      } });
      const before = await retained(f);
      await remappedRefusal(f, () => owner.caseVersionReview.restore(input), `accepted restore replay ${label}`);
      // Restoration of the actual original mapping recovers the identical
      // accepted request, not a new UUID, version or reinterpreted legacy hash.
      expect(await owner.caseVersionReview.restore(input)).toEqual({ ...accepted, replayed: true });
      expect(await retained(f)).toEqual(before);
      expect(await prisma.auditLog.findUniqueOrThrow({ where: { id: receipt.id } })).toEqual(receipt);
      expect(await prisma.auditLog.count({ where: {
        projectId: f.project.id, actorId: user.id, entityType: "TestCaseVersionRestore", entityId: f.testCaseId,
        metadata: { path: ["requestId"], equals: input.requestId },
      } })).toBe(1);
    });
  }
});
