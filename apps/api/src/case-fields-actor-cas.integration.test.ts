// Authored source only; NOT RUN. Root owns disposable migration/native execution.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, type Prisma } from "@vaettir/db";
import { appRouter } from "./router.js";
import { assertOwnedTestDatabase } from "./testOnlyDatabaseSafety.js";
import { hardDeleteOrganization } from "./services/orgHardDelete.js";
import { qualityProfileHash } from "./services/qualityExperienceProfile.js";
import { caseFieldAuthoringSchemaHash } from "./services/caseFields.js";

describe("current actor-bound ephemeral case-field authoring CAS", () => {
  const tag = `field-actor-cas-${randomUUID()}`;
  type Caller = ReturnType<typeof appRouter.createCaller>;
  let organizationId: string, actorId: string, editorId: string;
  let owner: Caller, editor: Caller;
  beforeAll(async () => {
    assertOwnedTestDatabase(process.env.DATABASE_URL);
    const tier = await prisma.planTier.findUniqueOrThrow({
      where: { key: "free" },
    });
    const org = await prisma.organization.create({
      data: { slug: tag, name: tag, planTierId: tier.id },
    });
    organizationId = org.id;
    for (const role of ["OWNER", "EDITOR"] as const) {
      const user = await prisma.user.create({
        data: {
          email: `${tag}-${role}@example.com`,
          clerkUserId: `${tag}-${role}`,
          memberships: { create: { organizationId, role, seatType: "FULL" } },
        },
        include: { memberships: true },
      });
      if (role === "OWNER") {
        actorId = user.id;
        owner = appRouter.createCaller({ prisma, user });
      } else {
        editorId = user.id;
        editor = appRouter.createCaller({ prisma, user });
      }
    }
  });
  afterAll(async () => {
    if (!organizationId) return;
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (!org || org.slug !== tag || !actorId)
      throw Error("Synthetic field-actor fixture ownership mismatch");
    await hardDeleteOrganization(
      prisma,
      organizationId,
      actorId,
      "Owned field-actor CAS fixture teardown",
    );
    expect(
      await prisma.organizationDeletionLog.count({
        where: { organizationId, deletedById: actorId },
      }),
    ).toBe(1);
    // Receipt FK actors remain deliberately retained in the disposable DB.
  });
  const content = {
    title: "Original | title",
    background: "Original setup\nsecond",
    given: ["a|b"],
    when: ["action\nsecond"],
    then: ["outcome"],
    testType: "FUNCTIONAL" as const,
    steps: [],
  };
  async function fixture() {
    const p = await owner.project.create({
      organizationId,
      name: `Actor fields ${randomUUID()}`,
      caseKey: `a${randomUUID().replaceAll("-", "").slice(0, 15)}`,
    });
    const schema = {
      version: 1 as const,
      fields: [
        {
          key: "flag",
          label: "Flag",
          type: "BOOLEAN" as const,
          required: true,
          retired: false,
          options: [],
        },
        {
          key: "count",
          label: "Count",
          type: "NUMBER" as const,
          required: true,
          retired: false,
          options: [],
        },
      ],
    };
    const impact = await owner.caseFields.reviewSchema({
      projectId: p.id,
      schema,
    });
    await owner.caseFields.configure({
      projectId: p.id,
      schema,
      actorId: impact.actorId,
      expectedSchemaHash: impact.expectedSchemaHash,
      expectedImpactHash: impact.expectedImpactHash,
      requestId: randomUUID(),
      reason: "Synthetic human definitions",
      confirmed: true,
    });
    const state = await owner.caseFields.get({ projectId: p.id });
    const c = await owner.testCases.create({
      projectId: p.id,
      ...content,
      customFields: { flag: false, count: 0 },
      expectedFieldSchemaHash: state.expectedSchemaHash,
    });
    return { p, c };
  }
  async function request(
    caller: Caller,
    projectId: string,
    caseId: string,
    values = { flag: false, count: 0 },
  ) {
    const state = await caller.caseFields.get({ projectId, caseId });
    return {
      projectId,
      caseId,
      values,
      expectedSchemaHash: state.expectedSchemaHash,
      expectedValueHash: state.expectedValueHash,
      reason: "Reviewed synthetic fields",
      confirmed: true as const,
      requestId: randomUUID(),
    };
  }
  async function fullCase(caseId: string) {
    return prisma.testCase.findUniqueOrThrow({
      where: { id: caseId },
      include: { steps: true, versions: true },
    });
  }
  it("makes hashes actor-specific without changing shared definitions or false/zero", async () => {
    const { p, c } = await fixture();
    const a = await owner.caseFields.get({ projectId: p.id, caseId: c.id });
    const b = await editor.caseFields.get({ projectId: p.id, caseId: c.id });
    expect(b.schema).toEqual(a.schema);
    expect(b.values).toEqual({ flag: false, count: 0 });
    expect(b.expectedSchemaHash).not.toBe(a.expectedSchemaHash);
    expect(b.expectedValueHash).not.toBe(a.expectedValueHash);
    expect(a.expectedSchemaHash).toBe(
      caseFieldAuthoringSchemaHash(
        {
          projectId: p.id,
          organizationId,
          version: a.schemaVersion,
          schema: a.schema,
        },
        actorId,
        `${tag}-OWNER`,
      ),
    );
    expect(b.expectedSchemaHash).toBe(
      caseFieldAuthoringSchemaHash(
        {
          projectId: p.id,
          organizationId,
          version: b.schemaVersion,
          schema: b.schema,
        },
        editorId,
        `${tag}-EDITOR`,
      ),
    );
  });
  it("refuses a same-org editor using the owner's save and permits the editor's fresh review", async () => {
    const { p, c } = await fixture(),
      original = await fullCase(c.id);
    const a = await request(owner, p.id, c.id, { flag: true, count: 7 });
    await expect(editor.caseFields.save(a)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    const b = await request(editor, p.id, c.id, { flag: true, count: 7 });
    await expect(owner.caseFields.save(b)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(
      editor.caseFields.save({ ...b, expectedValueHash: a.expectedValueHash }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await fullCase(c.id)).toEqual(original);
    expect(
      await prisma.auditLog.count({
        where: {
          projectId: p.id,
          entityType: "CaseFieldValueWrite",
          entityId: a.requestId,
        },
      }),
    ).toBe(0);
    await editor.caseFields.save(
      await request(editor, p.id, c.id, { flag: true, count: 7 }),
    );
    expect(
      (await owner.caseFields.get({ projectId: p.id, caseId: c.id })).values,
    ).toEqual({ flag: true, count: 7 });
  });
  it("rejects an inherited owner's embedded create CAS without allocating a case", async () => {
    const { p } = await fixture(),
      a = await owner.caseFields.get({ projectId: p.id });
    const before = await prisma.testCase.count({ where: { projectId: p.id } });
    const input = {
      projectId: p.id,
      ...content,
      customFields: { flag: false, count: 0 },
      expectedFieldSchemaHash: a.expectedSchemaHash,
    };
    await expect(editor.testCases.create(input)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(await prisma.testCase.count({ where: { projectId: p.id } })).toBe(
      before,
    );
    const b = await editor.caseFields.get({ projectId: p.id });
    const created = await editor.testCases.create({
      ...input,
      expectedFieldSchemaHash: b.expectedSchemaHash,
    });
    expect(created.customFields).toEqual({ flag: false, count: 0 });
    expect(created.createdById).toBe(editorId);
  });
  it("rejects inherited embedded edit hashes and preserves procedure versions before a fresh editor edit", async () => {
    const { p, c } = await fixture(),
      original = await fullCase(c.id);
    const current = await editor.testCases.byId({ id: c.id }),
      a = await owner.caseFields.get({ projectId: p.id, caseId: c.id });
    const input = {
      id: c.id,
      ...content,
      title: "Explicit editor wording",
      priority: current.priority,
      customFields: { flag: false, count: 0 },
      expectedFieldSchemaHash: a.expectedSchemaHash,
      expectedCustomFieldRevision: a.expectedValueHash,
      expectedCaseRevision: current.caseRevision,
      expectedStepRevision: current.stepRevision,
      expectedPriority: current.priority,
      expectedSuitePath: current.suitePath,
    };
    await expect(editor.testCases.update(input)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(await fullCase(c.id)).toEqual(original);
    const b = await editor.caseFields.get({ projectId: p.id, caseId: c.id });
    await editor.testCases.update({
      ...input,
      expectedFieldSchemaHash: b.expectedSchemaHash,
      expectedCustomFieldRevision: b.expectedValueHash,
    });
    expect(
      (await owner.caseFields.get({ projectId: p.id, caseId: c.id })).values,
    ).toEqual({ flag: false, count: 0 });
    expect((await fullCase(c.id)).title).toBe(input.title);
  });
  it("recovers original actor's exact response-loss receipt before stale CAS after a later editor save", async () => {
    const { p, c } = await fixture(),
      a = await request(owner, p.id, c.id, { flag: true, count: 1 });
    await owner.caseFields.save(a); // Synthetic accepted response is deliberately not consumed by a client.
    await editor.caseFields.save(
      await request(editor, p.id, c.id, { flag: false, count: 2 }),
    );
    const beforeReplay = await fullCase(c.id);
    await expect(editor.caseFields.save(a)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(await owner.caseFields.save(a)).toEqual({
      requestId: a.requestId,
      replayed: true,
    });
    expect(await fullCase(c.id)).toEqual(beforeReplay);
    expect(
      await prisma.auditLog.count({
        where: {
          projectId: p.id,
          actorId,
          entityType: "CaseFieldValueWrite",
          entityId: a.requestId,
        },
      }),
    ).toBe(1);
  });
  it("replays an explicitly seeded pre-actor-hash receipt without recomputing its exact input hash", async () => {
    const { p, c } = await fixture(),
      state = await owner.caseFields.get({ projectId: p.id, caseId: c.id });
    const native = await prisma.testCase.findUniqueOrThrow({
      where: { id: c.id },
    });
    const legacyInput = {
      projectId: p.id,
      caseId: c.id,
      values: { flag: false, count: 0 },
      expectedSchemaHash: qualityProfileHash({
        projectId: p.id,
        organizationId,
        version: state.schemaVersion,
        schema: state.schema,
      }),
      expectedValueHash: qualityProfileHash({
        caseId: c.id,
        values: state.values,
        updatedAt: native.updatedAt.toISOString(),
      }),
      reason: "Synthetic historical accepted receipt",
      confirmed: true as const,
      requestId: randomUUID(),
    };
    // Native synthetic history fixture, not a claim that any live old request existed.
    const receipt = await prisma.auditLog.create({
      data: {
        projectId: p.id,
        organizationId,
        actorId,
        entityType: "CaseFieldValueWrite",
        entityId: legacyInput.requestId,
        action: "UPDATE",
        summary: "Synthetic pre-actor-hash accepted save",
        metadata: {
          requestHash: qualityProfileHash(legacyInput),
          input: legacyInput,
          evidence: {
            version: 1,
            caseId: c.id,
            beforeValues: state.values,
            afterValues: state.values,
            schema: state.schema,
            schemaVersion: state.schemaVersion,
            recoverySupported: true,
          },
        } as Prisma.InputJsonValue,
      },
    });
    const before = await fullCase(c.id);
    expect(await owner.caseFields.save(legacyInput)).toEqual({
      requestId: legacyInput.requestId,
      replayed: true,
    });
    await expect(editor.caseFields.save(legacyInput)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(await fullCase(c.id)).toEqual(before);
    expect(
      await prisma.auditLog.findUniqueOrThrow({ where: { id: receipt.id } }),
    ).toEqual(receipt);
    expect(
      await prisma.auditLog.count({
        where: {
          projectId: p.id,
          entityType: "CaseFieldValueWrite",
          entityId: legacyInput.requestId,
        },
      }),
    ).toBe(1);
  });
  it("retains actor-independent source review identity while cloning through the current editor's authoring CAS", async () => {
    const { p, c } = await fixture(),
      before = await fullCase(c.id);
    const a = await owner.caseClone.preview({ projectId: p.id, caseId: c.id });
    const b = await editor.caseClone.preview({ projectId: p.id, caseId: c.id });
    expect(b.expectedSourceRevision).toBe(a.expectedSourceRevision);
    const copied = await editor.caseClone.create({
      projectId: p.id,
      caseId: c.id,
      expectedSourceRevision: b.expectedSourceRevision,
      title: "Independent editor copy",
      suitePath: null,
      reason: "Synthetic copy",
      confirmed: true,
      requestId: randomUUID(),
    });
    const created = await prisma.testCase.findUniqueOrThrow({
      where: { id: copied.caseId },
    });
    expect(created.customFields).toEqual({ flag: false, count: 0 });
    expect(created.createdById).toBe(editorId);
    expect(await fullCase(c.id)).toEqual(before);
  });
});
