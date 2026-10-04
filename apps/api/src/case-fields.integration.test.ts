// Authored tonight; do not run until schema generation/migration on an owned disposable DB.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, type Prisma } from "@vaettir/db";
import { appRouter } from "./router.js";
import { hardDeleteOrganization } from "./services/orgHardDelete.js";
import type {
  caseFieldSchema,
  CaseFieldDefinition,
} from "./services/caseFieldSchema.js";
import type { z } from "zod";

describe("reviewed typed project case fields", () => {
  const key = `case-fields-${randomUUID()}`;
  const orgIds: string[] = [],
    users: string[] = [];
  let actorId: string;
  type Caller = ReturnType<typeof appRouter.createCaller>;
  let owner: Caller, editor: Caller, viewer: Caller, outsider: Caller;
  const text = {
    key: "component",
    label: "Component",
    type: "TEXT" as const,
    required: true,
    retired: false,
    options: [],
  };
  const schema = (
    fields: CaseFieldDefinition[] = [text],
  ): z.infer<typeof caseFieldSchema> => ({ version: 1, fields });
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
    if (
      !["localhost", "127.0.0.1"].includes(url.hostname) ||
      !/test/i.test(url.pathname) ||
      url.searchParams.has("host")
    )
      throw Error("Owned disposable loopback database required");
    const tier = await prisma.planTier.findUniqueOrThrow({
      where: { key: "free" },
    });
    for (let n = 0; n < 2; n++) {
      const org = await prisma.organization.create({
        data: { slug: `${key}-${n}`, name: `${key}-${n}`, planTierId: tier.id },
      });
      orgIds.push(org.id);
      const user = await prisma.user.create({
        data: {
          email: `${key}-${n}@example.com`,
          clerkUserId: `${key}-${n}`,
          memberships: {
            create: { organizationId: org.id, role: "OWNER", seatType: "FULL" },
          },
        },
        include: { memberships: true },
      });
      users.push(user.id);
      if (n === 0) {
        owner = appRouter.createCaller({ prisma, user });
        actorId = user.id;
      } else outsider = appRouter.createCaller({ prisma, user });
    }
    for (const role of ["EDITOR", "VIEWER"] as const) {
      const user = await prisma.user.create({
        data: {
          email: `${key}-${role}@example.com`,
          clerkUserId: `${key}-${role}`,
          memberships: {
            create: {
              organizationId: orgIds[0]!,
              role,
              seatType: role === "VIEWER" ? "READ_ONLY" : "FULL",
            },
          },
        },
        include: { memberships: true },
      });
      users.push(user.id);
      if (role === "EDITOR") editor = appRouter.createCaller({ prisma, user });
      else viewer = appRouter.createCaller({ prisma, user });
    }
  });
  afterAll(async () => {
    for (const id of orgIds) {
      const org = await prisma.organization.findUnique({ where: { id } });
      if (!org?.slug.startsWith(key)) throw Error("Fixture owner mismatch");
      await hardDeleteOrganization(
        prisma,
        id,
        actorId,
        "Owned case-field fixture teardown",
      );
    }
    // Retain dedicated synthetic users: deletion receipts intentionally retain their actor FK.
    for (const organizationId of orgIds)
      expect(await prisma.organizationDeletionLog.count({ where: { organizationId, deletedById: actorId } })).toBe(1);
  });
  async function project() {
    return owner.project.create({
      organizationId: orgIds[0]!,
      name: `Fields ${randomUUID()}`,
      caseKey: `f${randomUUID().replaceAll("-", "").slice(0, 15)}`,
    });
  }
  async function create(
    projectId: string,
    values?: Record<string, string | number | boolean | null>,
  ) {
    const current = await owner.caseFields.get({ projectId });
    return owner.testCases.create({
      projectId,
      title: "Synthetic authored case",
      testType: "FUNCTIONAL",
      given: ["Given"],
      when: ["When"],
      then: ["Then"],
      customFields: values,
      expectedFieldSchemaHash:
        values === undefined ? undefined : current.expectedSchemaHash,
    });
  }
  async function definition(projectId: string, next = schema()) {
    const review = await owner.caseFields.reviewSchema({
      projectId,
      schema: next,
    });
    return {
      ...review,
      schema: next,
      reason: "Synthetic approved definitions",
      confirmed: true as const,
      requestId: randomUUID(),
    };
  }
  async function install(projectId: string, next = schema()) {
    const {
      affectedCases: _count,
      missingRequired: _missing,
      warnings: _warnings,
      ...input
    } = await definition(projectId, next);
    return owner.caseFields.configure(input);
  }
  async function write(
    projectId: string,
    caseId: string,
    values: Record<string, string | number | boolean | null>,
  ) {
    const state = await owner.caseFields.get({ projectId, caseId });
    return {
      projectId,
      caseId,
      values,
      expectedSchemaHash: state.expectedSchemaHash,
      expectedValueHash: state.expectedValueHash,
      reason: "Reviewed synthetic metadata",
      confirmed: true as const,
      requestId: randomUUID(),
    };
  }
  it("previews required activation without deleting or backfilling existing cases", async () => {
    const p = await project(),
      a = await create(p.id),
      b = await create(p.id);
    const before = await prisma.testCase.findMany({
      where: { projectId: p.id },
      orderBy: { id: "asc" },
    });
    const review = await definition(p.id);
    expect(review.affectedCases).toBe(2);
    expect(review.missingRequired).toEqual([
      { key: "component", label: "Component", count: 2 },
    ]);
    await install(p.id);
    expect(
      await prisma.testCase.findMany({
        where: { projectId: p.id },
        orderBy: { id: "asc" },
      }),
    ).toEqual(before);
    expect(
      (await owner.caseFields.get({ projectId: p.id, caseId: a.id })).problems,
    ).toEqual(["Component is required."]);
    expect(
      (await owner.caseFields.get({ projectId: p.id, caseId: b.id })).values,
    ).toEqual({});
  });
  it("enforces required typed authored creation including raw/quick paths", async () => {
    const p = await project();
    await install(p.id);
    await expect(create(p.id)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      owner.testCases.quickCreate({
        projectId: p.id,
        title: "Must not bypass",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      prisma.testCase.create({
        data: {
          projectId: p.id,
          title: "Raw bypass",
          testType: "FUNCTIONAL",
          createdById: actorId,
          updatedById: actorId,
        },
      }),
    ).rejects.toThrow();
    const c = await create(p.id, { component: "API" });
    expect(c.customFields).toEqual({ component: "API" });
    expect(await prisma.testCase.count({ where: { projectId: p.id } })).toBe(1);
  });
  it("enforces current role, full seat and same-project case access", async () => {
    const p = await project(),
      other = await project(),
      c = await create(p.id);
    await install(p.id);
    const currentFields = await viewer.caseFields.get({ projectId: p.id });
    expect(currentFields.projectId).toBe(p.id);
    expect(currentFields.organizationId).toBe(orgIds[0]);
    expect(
      (await viewer.caseFields.get({ projectId: p.id, caseId: c.id })).canEdit,
    ).toBe(false);
    await expect(
      editor.caseFields.reviewSchema({ projectId: p.id, schema: schema() }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      viewer.caseFields.save(await write(p.id, c.id, { component: "API" })),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      outsider.caseFields.get({ projectId: p.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      owner.caseFields.get({ projectId: other.id, caseId: c.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await editor.caseFields.save(await write(p.id, c.id, { component: "API" }));
    expect(
      (await owner.caseFields.get({ projectId: p.id, caseId: c.id })).problems,
    ).toEqual([]);
  });
  it("does not block folder movement or risk bookkeeping on retained incomplete records", async () => {
    const p = await project(),
      c = await create(p.id);
    await install(p.id);
    await prisma.testCase.update({
      where: { id: c.id },
      data: {
        suitePath: "Moved/folder",
        updatedById: actorId,
        riskScore: 27,
        riskSeverity: "LOW",
      },
    });
    expect(
      (await prisma.testCase.findUniqueOrThrow({ where: { id: c.id } }))
        .suitePath,
    ).toBe("Moved/folder");
    await expect(
      prisma.testCase.update({
        where: { id: c.id },
        data: { title: "Cannot author incomplete content" },
      }),
    ).rejects.toThrow();
  });
  it("pins schema and value CAS and exact actor-bound retry without duplicate audit", async () => {
    const p = await project(),
      c = await create(p.id);
    await install(p.id);
    const original = await write(p.id, c.id, { component: "API" });
    await owner.caseFields.save(original);
    expect(await owner.caseFields.save(original)).toMatchObject({
      replayed: true,
    });
    await expect(
      owner.caseFields.save({
        ...original,
        values: { component: "Changed retry" },
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const stale = await write(p.id, c.id, { component: "Old draft" });
    await owner.caseFields.save(
      await write(p.id, c.id, { component: "New human edit" }),
    );
    await expect(owner.caseFields.save(stale)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    const logs = await prisma.auditLog.findMany({
      where: {
        projectId: p.id,
        entityType: "CaseFieldValueWrite",
        entityId: original.requestId,
      },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]!.metadata).toMatchObject({
      evidence: {
        beforeValues: {},
        afterValues: { component: "API" },
        schema: schema(),
        schemaVersion: 1,
        recoverySupported: true,
      },
    });
  });
  it("pins reviewed impact population and disallows changed/unknown schema revisions", async () => {
    const p = await project();
    const {
      affectedCases: _count,
      missingRequired: _missing,
      warnings: _warnings,
      ...request
    } = await definition(p.id);
    await create(p.id);
    await expect(owner.caseFields.configure(request)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(
      prisma.project.update({
        where: { id: p.id },
        data: { caseFieldSchema: { version: "1", fields: [] } },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.project.update({
        where: { id: p.id },
        data: {
          caseFieldSchema: {
            version: 1,
            fields: [{ ...text, type: null }],
          } as Prisma.InputJsonValue,
        },
      }),
    ).rejects.toThrow();
  });
  it("keeps used type/options immutable and retired values preserved read-only", async () => {
    const p = await project();
    await install(p.id);
    const c = await create(p.id, { component: "Original retained" });
    await expect(
      owner.caseFields.reviewSchema({
        projectId: p.id,
        schema: schema([{ ...text, type: "NUMBER" }]),
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await install(p.id, schema([{ ...text, required: false, retired: true }]));
    expect(
      (await owner.caseFields.get({ projectId: p.id, caseId: c.id })).values,
    ).toEqual({ component: "Original retained" });
    await expect(
      owner.caseFields.save(await write(p.id, c.id, {})),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      owner.caseFields.save(
        await write(p.id, c.id, { component: "Replacement" }),
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      prisma.testCase.update({
        where: { id: c.id },
        data: { customFields: {} },
      }),
    ).rejects.toThrow();
    await expect(
      owner.caseFields.reviewSchema({
        projectId: p.id,
        schema: { version: 1, fields: [] },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it("normal old-client content edit preserves current retired metadata and before/after audit", async () => {
    const p = await project();
    await install(p.id);
    const c = await create(p.id, { component: "Stable metadata" });
    await install(p.id, schema([{ ...text, required: false, retired: true }]));
    const current = await owner.testCases.byId({ id: c.id });
    await owner.testCases.update({
      id: c.id,
      title: "Changed procedure title",
      given: current.given,
      when: current.when,
      then: current.then,
      steps: [],
      priority: current.priority,
      testType: current.testType,
      expectedCaseRevision: current.caseRevision,
      expectedStepRevision: current.stepRevision,
      expectedPriority: current.priority,
      expectedSuitePath: current.suitePath,
    });
    expect(
      (await owner.caseFields.get({ projectId: p.id, caseId: c.id })).values,
    ).toEqual({ component: "Stable metadata" });
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: {
        projectId: p.id,
        entityType: "TestCase",
        entityId: c.id,
        action: "UPDATE",
      },
      orderBy: { createdAt: "desc" },
    });
    expect(audit.metadata).toMatchObject({
      fieldEvidence: {
        beforeValues: { component: "Stable metadata" },
        afterValues: { component: "Stable metadata" },
        schemaVersion: 2,
      },
    });
  });
  it("rechecks revoked/suspended authorization before receipt replay", async () => {
    const p = await project(),
      c = await create(p.id);
    await install(p.id);
    const request = await write(p.id, c.id, { component: "Approved" });
    await owner.caseFields.save(request);
    await prisma.organization.update({
      where: { id: orgIds[0]! },
      data: { suspendedAt: new Date() },
    });
    try {
      await expect(owner.caseFields.save(request)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    } finally {
      await prisma.organization.update({
        where: { id: orgIds[0]! },
        data: { suspendedAt: null },
      });
    }
    await prisma.membership.update({
      where: {
        organizationId_userId: { organizationId: orgIds[0]!, userId: actorId },
      },
      data: { role: "VIEWER", seatType: "READ_ONLY" },
    });
    try {
      await expect(owner.caseFields.save(request)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    } finally {
      await prisma.membership.update({
        where: {
          organizationId_userId: {
            organizationId: orgIds[0]!,
            userId: actorId,
          },
        },
        data: { role: "OWNER", seatType: "FULL" },
      });
    }
  });
  it("rejects reparented projects for old actors without changing preserved metadata", async () => {
    const p = await project(),
      c = await create(p.id);
    await install(p.id);
    const request = await write(p.id, c.id, { component: "Old organization" });
    await prisma.project.update({
      where: { id: p.id },
      data: { organizationId: orgIds[1]! },
    });
    try {
      await expect(owner.caseFields.save(request)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(
        (await prisma.testCase.findUniqueOrThrow({ where: { id: c.id } }))
          .customFields,
      ).toEqual({});
    } finally {
      await prisma.project.update({
        where: { id: p.id },
        data: { organizationId: orgIds[0]! },
      });
    }
  });
  it("blocks procedure restore clearly when newly required metadata is incomplete", async () => {
    const p = await project(),
      c = await create(p.id);
    const bundle = await owner.testCases.exportProcedure({
      projectId: p.id,
      ids: [c.id],
      scope: "selected",
    });
    bundle.cases[0]!.title = "Reviewed historic procedure";
    await install(p.id);
    const review = await owner.caseProcedureReimport.preview({
      projectId: p.id,
      serialized: JSON.stringify(bundle),
    });
    expect(review.entries[0]!.status).toBe("UNAVAILABLE");
    expect(review.entries[0]!.missingRelationships.join(" ")).toContain(
      "required case metadata",
    );
    await expect(
      owner.caseProcedureReimport.approve({
        projectId: p.id,
        serialized: JSON.stringify(bundle),
        actorId: review.actorId,
        expectedReviewHash: review.expectedReviewHash,
        selections: [
          {
            caseId: c.id,
            reason: "Restore reviewed snapshot",
            overwriteConfirmed: true,
          },
        ],
        confirmed: true,
        requestId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(
      (await prisma.testCase.findUniqueOrThrow({ where: { id: c.id } })).title,
    ).toBe("Synthetic authored case");
    expect(
      await prisma.auditLog.count({
        where: { projectId: p.id, entityType: "TestCaseProcedureRestore" },
      }),
    ).toBe(0);
  });
  it("rejects schema/value edits from another actor and enforces database option immutability", async () => {
    const p = await project(),
      initial = schema([{ ...text, type: "CHOICE", options: ["API", "Web"] }]);
    await install(p.id, initial);
    const c = await create(p.id, { component: "API" });
    await expect(
      prisma.project.update({
        where: { id: p.id },
        data: {
          caseFieldSchema: schema([
            { ...text, type: "CHOICE", options: ["API", "Web", "Other"] },
          ]) as Prisma.InputJsonValue,
        },
      }),
    ).rejects.toThrow();
    await expect(
      owner.caseFields.save(await write(p.id, c.id, { component: "Other" })),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const {
      affectedCases: _count,
      missingRequired: _missing,
      warnings: _warnings,
      ...request
    } = await definition(p.id, initial);
    await expect(
      owner.caseFields.configure({ ...request, actorId: users[1]! }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      outsider.caseFields.save(await write(p.id, c.id, { component: "Web" })),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(
      (await owner.caseFields.get({ projectId: p.id, caseId: c.id })).values,
    ).toEqual({ component: "API" });
  });
  it("procedure version restore refuses incomplete required metadata and preserves current values after completion", async () => {
    const p = await project(),
      c = await create(p.id);
    await prisma.testCase.update({
      where: { id: c.id },
      data: { title: "Newer human wording" },
    });
    await install(p.id);
    const attempt = async () => {
      const preview = await owner.caseVersionReview.preview({
        projectId: p.id,
        testCaseId: c.id,
        versionNumber: 1,
      });
      return {
        projectId: p.id,
        testCaseId: c.id,
        versionNumber: 1,
        fields: ["title" as const],
        expectedCaseRevision: preview.expectedCaseRevision,
        expectedVersionRevision: preview.expectedVersionRevision,
        reason: "Reviewed procedure wording",
        confirmed: true as const,
        requestId: randomUUID(),
      };
    };
    await expect(
      owner.caseVersionReview.restore(await attempt()),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("Complete project case fields"),
    });
    expect(
      (await prisma.testCase.findUniqueOrThrow({ where: { id: c.id } })).title,
    ).toBe("Newer human wording");
    await owner.caseFields.save(
      await write(p.id, c.id, { component: "Current metadata" }),
    );
    await owner.caseVersionReview.restore(await attempt());
    expect(
      (await owner.caseFields.get({ projectId: p.id, caseId: c.id })).values,
    ).toEqual({ component: "Current metadata" });
    expect(
      (await prisma.testCase.findUniqueOrThrow({ where: { id: c.id } })).title,
    ).toBe("Synthetic authored case");
  });
  it("rejects a metadata draft pinned to replaced field definitions", async () => {
    const p = await project();
    await install(p.id);
    const c = await create(p.id, { component: "Original" }),
      request = await write(p.id, c.id, { component: "Old schema draft" });
    await install(p.id, schema([{ ...text, label: "Product component" }]));
    await expect(owner.caseFields.save(request)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(
      (await owner.caseFields.get({ projectId: p.id, caseId: c.id })).values,
    ).toEqual({ component: "Original" });
  });
  it("stores false and zero as values while rejecting invalid date/choice on API and database writes", async () => {
    const p = await project();
    const fields: CaseFieldDefinition[] = [
      text,
      { ...text, key: "count", label: "Count", type: "NUMBER" },
      { ...text, key: "flag", label: "Flag", type: "BOOLEAN" },
      { ...text, key: "date", label: "Date", type: "DATE" },
      {
        ...text,
        key: "choice",
        label: "Choice",
        type: "CHOICE",
        options: ["Listed"],
      },
    ];
    await install(p.id, schema(fields));
    const values = {
      component: "API",
      count: 0,
      flag: false,
      date: "2024-02-29",
      choice: "Listed",
    };
    const c = await create(p.id, values);
    await expect(
      owner.caseFields.save(
        await write(p.id, c.id, { ...values, date: "2026-02-30" }),
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      owner.caseFields.save(
        await write(p.id, c.id, { ...values, choice: "Unlisted" }),
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      prisma.testCase.update({
        where: { id: c.id },
        data: { customFields: { ...values, date: "2026-02-30" } },
      }),
    ).rejects.toThrow();
    expect(
      (await owner.caseFields.get({ projectId: p.id, caseId: c.id })).values,
    ).toEqual(values);
  });
});
