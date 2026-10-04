// Authored only. Morning execution requires a migrated owned loopback test DB.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, type Prisma } from "@vaettir/db";
import { appRouter } from "./router.js";
import { hardDeleteOrganization } from "./services/orgHardDelete.js";
import type { CaseFieldDefinition } from "./services/caseFieldSchema.js";
describe("captured typed metadata history and restore-as-new", () => {
  const key = `field-history-${randomUUID()}`,
    orgIds: string[] = [],
    users: string[] = [];
  type Caller = ReturnType<typeof appRouter.createCaller>;
  let owner: Caller, viewer: Caller, outsider: Caller, actorId: string;
  const field: CaseFieldDefinition = {
    key: "component",
    label: "Component",
    type: "TEXT",
    required: false,
    retired: false,
    options: [],
  };
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
    if (
      !["localhost", "127.0.0.1"].includes(url.hostname) ||
      !/test/i.test(url.pathname) ||
      url.searchParams.has("host")
    )
      throw Error("Owned disposable loopback test database required");
    const tier = await prisma.planTier.findUniqueOrThrow({
      where: { key: "free" },
    });
    for (let n = 0; n < 2; n++) {
      const org = await prisma.organization.create({
        data: { name: `${key}-${n}`, slug: `${key}-${n}`, planTierId: tier.id },
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
    const user = await prisma.user.create({
      data: {
        email: `${key}-viewer@example.com`,
        clerkUserId: `${key}-viewer`,
        memberships: {
          create: {
            organizationId: orgIds[0]!,
            role: "VIEWER",
            seatType: "READ_ONLY",
          },
        },
      },
      include: { memberships: true },
    });
    users.push(user.id);
    viewer = appRouter.createCaller({ prisma, user });
  });
  afterAll(async () => {
    for (const id of orgIds) {
      const org = await prisma.organization.findUnique({ where: { id } });
      if (!org?.slug.startsWith(key)) throw Error("Fixture ownership mismatch");
      await hardDeleteOrganization(
        prisma,
        id,
        actorId,
        "Owned metadata-history fixture teardown",
      );
    }
    // Retain dedicated synthetic users: deletion receipts intentionally retain their actor FK.
    for (const organizationId of orgIds)
      expect(await prisma.organizationDeletionLog.count({ where: { organizationId, deletedById: actorId } })).toBe(1);
  });
  async function define(
    projectId: string,
    fields: CaseFieldDefinition[] = [field],
  ) {
    const schema = { version: 1 as const, fields },
      review = await owner.caseFields.reviewSchema({ projectId, schema });
    return owner.caseFields.configure({
      projectId,
      schema,
      actorId: review.actorId,
      expectedSchemaHash: review.expectedSchemaHash,
      expectedImpactHash: review.expectedImpactHash,
      reason: "Reviewed synthetic field definitions",
      confirmed: true,
      requestId: randomUUID(),
    });
  }
  async function fixture(fields: CaseFieldDefinition[] = [field]) {
    const p = await owner.project.create({
      organizationId: orgIds[0]!,
      name: `History ${randomUUID()}`,
      caseKey: `h${randomUUID().replaceAll("-", "").slice(0, 15)}`,
    });
    await define(p.id, fields);
    const state = await owner.caseFields.get({ projectId: p.id });
    const c = await owner.testCases.create({
      projectId: p.id,
      title: "Synthetic procedure",
      given: ["original given"],
      when: ["original action"],
      then: ["original result"],
      testType: "FUNCTIONAL",
      customFields: { component: "First" },
      expectedFieldSchemaHash: state.expectedSchemaHash,
    });
    return { p, c };
  }
  async function save(
    projectId: string,
    caseId: string,
    values: Record<string, string | number | boolean | null>,
  ) {
    const state = await owner.caseFields.get({ projectId, caseId }),
      input = {
        projectId,
        caseId,
        values,
        expectedSchemaHash: state.expectedSchemaHash,
        expectedValueHash: state.expectedValueHash,
        reason: "Synthetic metadata decision",
        confirmed: true as const,
        requestId: randomUUID(),
      };
    await owner.caseFields.save(input);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: {
        projectId,
        entityType: "CaseFieldValueWrite",
        entityId: input.requestId,
      },
    });
    return { input, audit };
  }
  async function attempt(
    projectId: string,
    caseId: string,
    auditId: string,
    side: "BEFORE" | "AFTER" = "AFTER",
  ) {
    const preview = await owner.caseFields.previewRestore({
      projectId,
      caseId,
      auditId,
      side,
    });
    return {
      projectId,
      caseId,
      auditId,
      side,
      actorId: preview.actorId,
      expectedSchemaHash: preview.expectedSchemaHash,
      expectedValueHash: preview.expectedValueHash,
      expectedSourceHash: preview.expectedSourceHash,
      reason: "Reviewed historic active metadata",
      confirmed: true as const,
      requestId: randomUUID(),
    };
  }
  it("restores a selected exact before/after capture as a new audit while procedures/paid work remain untouched", async () => {
    const { p, c } = await fixture(),
      captured = await save(p.id, c.id, { component: "Second" });
    await save(p.id, c.id, { component: "Third" });
    const draft = await prisma.automationDraft.create({
      data: {
        testCaseId: c.id,
        framework: "JEST_VITEST",
        status: "READY",
        createdById: actorId,
        content: { code: "Synthetic retained paid draft" },
      },
    });
    const versions = await prisma.testCaseVersion.findMany({
        where: { testCaseId: c.id },
        orderBy: { versionNumber: "asc" },
      }),
      old = await prisma.auditLog.findUniqueOrThrow({
        where: { id: captured.audit.id },
      });
    const preview = await owner.caseFields.previewRestore({
      projectId: p.id,
      caseId: c.id,
      auditId: captured.audit.id,
      side: "BEFORE",
    });
    expect(preview.canRestore).toBe(true);
    expect(preview.rows[0]).toMatchObject({
      current: "Third",
      saved: "First",
      proposed: "First",
      treatment: "Eligible active field",
      changed: true,
    });
    const input = await attempt(p.id, c.id, captured.audit.id, "BEFORE");
    await owner.caseFields.restore(input);
    expect(await owner.caseFields.restore(input)).toMatchObject({
      replayed: true,
    });
    const current = await prisma.testCase.findUniqueOrThrow({
      where: { id: c.id },
    });
    expect(current.customFields).toEqual({ component: "First" });
    expect(current.given).toEqual(c.given);
    expect(current.when).toEqual(c.when);
    expect(current.then).toEqual(c.then);
    expect(current.displayId).toBe(c.displayId);
    expect(
      await prisma.testCaseVersion.findMany({
        where: { testCaseId: c.id },
        orderBy: { versionNumber: "asc" },
      }),
    ).toEqual(versions);
    expect(
      await prisma.automationDraft.findUniqueOrThrow({
        where: { id: draft.id },
      }),
    ).toEqual(draft);
    expect(
      await prisma.auditLog.findUniqueOrThrow({ where: { id: old.id } }),
    ).toEqual(old);
    const receipts = await prisma.auditLog.findMany({
      where: {
        projectId: p.id,
        entityType: "CaseFieldValueWrite",
        entityId: input.requestId,
      },
    });
    expect(receipts).toHaveLength(1);
    expect(receipts[0]!.metadata).toMatchObject({
      evidence: {
        beforeValues: { component: "Third" },
        afterValues: { component: "First" },
        restoredFrom: { auditId: captured.audit.id, side: "BEFORE" },
      },
    });
  });
  it("does not manufacture a restore for unchanged or legacy missing evidence", async () => {
    const { p, c } = await fixture(),
      captured = await save(p.id, c.id, { component: "Second" });
    const preview = await owner.caseFields.previewRestore({
      projectId: p.id,
      caseId: c.id,
      auditId: captured.audit.id,
      side: "AFTER",
    });
    expect(preview.canRestore).toBe(false);
    expect(preview.rows.every((row) => !row.changed)).toBe(true);
    await expect(
      owner.caseFields.restore(await attempt(p.id, c.id, captured.audit.id)),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const legacy = await prisma.auditLog.create({
      data: {
        projectId: p.id,
        organizationId: orgIds[0]!,
        actorId,
        entityType: "TestCase",
        entityId: c.id,
        action: "UPDATE",
        summary: "Synthetic legacy procedure-only event",
      },
    });
    const absent = await owner.caseFields.previewRestore({
      projectId: p.id,
      caseId: c.id,
      auditId: legacy.id,
      side: "AFTER",
    });
    expect(absent.historicalValues).toBeNull();
    expect(absent.canRestore).toBe(false);
    expect(absent.problems.join(" ")).toContain("no supported exact metadata");
  });
  it("preserves a later required field while restoring eligible captured fields", async () => {
    const { p, c } = await fixture(),
      captured = await save(p.id, c.id, { component: "Second" });
    await define(p.id, [
      field,
      { ...field, key: "later", label: "Later field", required: true },
    ]);
    await save(p.id, c.id, {
      component: "Third",
      later: "Current required value",
    });
    const preview = await owner.caseFields.previewRestore({
      projectId: p.id,
      caseId: c.id,
      auditId: captured.audit.id,
      side: "AFTER",
    });
    expect(preview.canRestore).toBe(true);
    expect(preview.rows.find((row) => row.key === "later")).toMatchObject({
      current: "Current required value",
      proposed: "Current required value",
      treatment: "Keep later field",
      changed: false,
    });
    await owner.caseFields.restore(
      await attempt(p.id, c.id, captured.audit.id),
    );
    expect(
      (await owner.caseFields.get({ projectId: p.id, caseId: c.id })).values,
    ).toEqual({ component: "Second", later: "Current required value" });
  });
  it("refuses missing required historical values instead of backfilling", async () => {
    const { p, c } = await fixture(),
      captured = await save(p.id, c.id, { component: "Second" });
    await save(p.id, c.id, {});
    const empty = await save(p.id, c.id, { component: "Current" });
    await define(p.id, [{ ...field, required: true }]);
    const preview = await owner.caseFields.previewRestore({
      projectId: p.id,
      caseId: c.id,
      auditId: empty.audit.id,
      side: "BEFORE",
    });
    expect(preview.canRestore).toBe(false);
    expect(preview.problems).toContain("Component is required.");
    await expect(
      owner.caseFields.restore(
        await attempt(p.id, c.id, empty.audit.id, "BEFORE"),
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(
      (await owner.caseFields.get({ projectId: p.id, caseId: c.id })).values,
    ).toEqual({ component: "Current" });
    expect(captured.audit.id).not.toBe(empty.audit.id);
  });
  it("preserves retired values and refuses a historic replacement of them", async () => {
    const legacy = { ...field, key: "legacy", label: "Retained field" };
    const { p, c } = await fixture([field, legacy]);
    const source = await save(p.id, c.id, {
      component: "Second",
      legacy: "Retained",
    });
    await save(p.id, c.id, { component: "Third", legacy: "Retained" });
    await define(p.id, [field, { ...legacy, retired: true }]);
    const preview = await owner.caseFields.previewRestore({
      projectId: p.id,
      caseId: c.id,
      auditId: source.audit.id,
      side: "AFTER",
    });
    expect(preview.canRestore).toBe(true);
    expect(preview.rows.find((row) => row.key === "legacy")).toMatchObject({
      treatment: "Keep retired value",
      changed: false,
    });
    await owner.caseFields.restore(await attempt(p.id, c.id, source.audit.id));
    expect(
      (await owner.caseFields.get({ projectId: p.id, caseId: c.id })).values
        .legacy,
    ).toBe("Retained");
    const before = await owner.caseFields.previewRestore({
      projectId: p.id,
      caseId: c.id,
      auditId: source.audit.id,
      side: "BEFORE",
    });
    expect(before.canRestore).toBe(false);
    expect(before.problems.join(" ")).toContain("now retired");
  });
  it("pins human edits, definition changes and exact source evidence; stale drafts never overwrite", async () => {
    const { p, c } = await fixture(),
      source = await save(p.id, c.id, { component: "Second" });
    await save(p.id, c.id, { component: "Third" });
    const stale = await attempt(p.id, c.id, source.audit.id);
    await save(p.id, c.id, { component: "New human edit" });
    await expect(owner.caseFields.restore(stale)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    const staleSchema = await attempt(p.id, c.id, source.audit.id);
    await define(p.id, [{ ...field, label: "Current label" }]);
    await expect(owner.caseFields.restore(staleSchema)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    const changedSource = await attempt(p.id, c.id, source.audit.id);
    // Synthetic corruption probe only; the product restore never edits old audits.
    await prisma.auditLog.update({
      where: { id: source.audit.id },
      data: {
        metadata: {
          ...(source.audit.metadata as Prisma.JsonObject),
          syntheticTamperingProbe: true,
        },
      },
    });
    await expect(owner.caseFields.restore(changedSource)).rejects.toMatchObject(
      { code: "CONFLICT" },
    );
    expect(
      (await owner.caseFields.get({ projectId: p.id, caseId: c.id })).values,
    ).toEqual({ component: "New human edit" });
  });
  it("rejects saved type/choice changes even after optional values were cleared", async () => {
    const { p, c } = await fixture();
    await save(p.id, c.id, {});
    await expect(
      owner.caseFields.reviewSchema({
        projectId: p.id,
        schema: { version: 1, fields: [{ ...field, type: "NUMBER" }] },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      prisma.project.update({
        where: { id: p.id },
        data: {
          caseFieldSchema: {
            version: 1,
            fields: [{ ...field, type: "NUMBER" }],
          },
        },
      }),
    ).rejects.toThrow();
    const choices = { ...field, type: "CHOICE" as const, options: ["A", "B"] };
    const other = await owner.project.create({
      organizationId: orgIds[0]!,
      name: `Choices ${randomUUID()}`,
      caseKey: `o${randomUUID().replaceAll("-", "").slice(0, 15)}`,
    });
    await define(other.id, [choices]);
    await expect(
      owner.caseFields.reviewSchema({
        projectId: other.id,
        schema: {
          version: 1,
          fields: [{ ...choices, options: ["A", "B", "C"] }],
        },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it("is tenant/case/actor pinned and readonly members may compare but never restore", async () => {
    const { p, c } = await fixture(),
      foreign = await fixture(),
      source = await save(p.id, c.id, { component: "Second" });
    await save(p.id, c.id, { component: "Third" });
    expect(
      (
        await viewer.caseFields.previewRestore({
          projectId: p.id,
          caseId: c.id,
          auditId: source.audit.id,
          side: "AFTER",
        })
      ).canRestore,
    ).toBe(false);
    await expect(
      viewer.caseFields.restore(await attempt(p.id, c.id, source.audit.id)),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      outsider.caseFields.history({ projectId: p.id, caseId: c.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      owner.caseFields.previewRestore({
        projectId: foreign.p.id,
        caseId: foreign.c.id,
        auditId: source.audit.id,
        side: "AFTER",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const input = await attempt(p.id, c.id, source.audit.id);
    await expect(
      owner.caseFields.restore({ ...input, actorId: users[1]! }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("bounds history pagination and validates case-pinned equal-time cursors", async () => {
    const { p, c } = await fixture();
    for (let n = 0; n < 12; n++)
      await save(p.id, c.id, { component: `Value ${n}` });
    const sameTime = new Date("2026-10-04T00:00:00.000Z");
    await prisma.auditLog.updateMany({
      where: { projectId: p.id },
      data: { createdAt: sameTime },
    });
    const ids: string[] = [];
    let cursor: { auditId: string; createdAt: string } | undefined;
    for (let n = 0; n < 6; n++) {
      const page = await owner.caseFields.history({
        projectId: p.id,
        caseId: c.id,
        take: 3,
        cursor,
      });
      expect(page.entries.length).toBeLessThanOrEqual(3);
      ids.push(...page.entries.map((row) => row.auditId));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    expect(ids).toHaveLength(13);
    expect(new Set(ids).size).toBe(13);
    const foreign = await fixture(),
      otherHistory = await owner.caseFields.history({
        projectId: foreign.p.id,
        caseId: foreign.c.id,
      });
    await expect(
      owner.caseFields.history({
        projectId: p.id,
        caseId: c.id,
        cursor: {
          auditId: otherHistory.entries[0]!.auditId,
          createdAt: otherHistory.entries[0]!.createdAt,
        },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      owner.caseFields.history({ projectId: p.id, caseId: c.id, take: 11 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it("retains uncertainty identity after subsequent writes and refuses changed UUID reuse", async () => {
    const { p, c } = await fixture(),
      source = await save(p.id, c.id, { component: "Second" });
    await save(p.id, c.id, { component: "Third" });
    const input = await attempt(p.id, c.id, source.audit.id);
    await owner.caseFields.restore(input);
    await save(p.id, c.id, { component: "Later independent save" });
    expect(await owner.caseFields.restore(input)).toMatchObject({
      replayed: true,
    });
    await expect(
      owner.caseFields.restore({ ...input, reason: "Different request" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      (await owner.caseFields.get({ projectId: p.id, caseId: c.id })).values,
    ).toEqual({ component: "Later independent save" });
  });
  it("hides former-org evidence and rejects old replay after reparent even for a dual-org actor", async () => {
    const { p, c } = await fixture(),
      source = await save(p.id, c.id, { component: "Second" });
    await save(p.id, c.id, { component: "Third" });
    const restore = await attempt(p.id, c.id, source.audit.id);
    await owner.caseFields.restore(restore);
    const schemaReview = await owner.caseFields.reviewSchema({
      projectId: p.id,
      schema: { version: 1, fields: [field] },
    });
    const schemaRequest = {
      projectId: p.id,
      schema: { version: 1 as const, fields: [field] },
      actorId,
      expectedSchemaHash: schemaReview.expectedSchemaHash,
      expectedImpactHash: schemaReview.expectedImpactHash,
      reason: "Synthetic schema receipt",
      confirmed: true as const,
      requestId: randomUUID(),
    };
    await owner.caseFields.configure(schemaRequest);
    await prisma.membership.create({
      data: {
        organizationId: orgIds[1]!,
        userId: actorId,
        role: "OWNER",
        seatType: "FULL",
      },
    });
    const user = await prisma.user.findUniqueOrThrow({
        where: { id: actorId },
        include: { memberships: true },
      }),
      both = appRouter.createCaller({ prisma, user });
    await prisma.project.update({
      where: { id: p.id },
      data: { organizationId: orgIds[1]! },
    });
    try {
      await expect(
        both.caseFields.configure(schemaRequest),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(both.caseFields.save(source.input)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(both.caseFields.restore(restore)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(
        (await both.caseFields.history({ projectId: p.id, caseId: c.id }))
          .entries,
      ).toHaveLength(0);
      await expect(
        both.caseFields.previewRestore({
          projectId: p.id,
          caseId: c.id,
          auditId: source.audit.id,
          side: "AFTER",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    } finally {
      await prisma.project.update({
        where: { id: p.id },
        data: { organizationId: orgIds[0]! },
      });
      await prisma.membership.delete({
        where: {
          organizationId_userId: {
            organizationId: orgIds[1]!,
            userId: actorId,
          },
        },
      });
    }
  });
  it("bounds malformed/oversized captures without substituting current values", async () => {
    const { p, c } = await fixture();
    for (const metadata of [
      { fieldEvidence: { version: 99 } },
      { oversized: "x".repeat(300000) },
    ]) {
      const record = await prisma.auditLog.create({
        data: {
          organizationId: orgIds[0]!,
          projectId: p.id,
          actorId,
          entityType: "TestCase",
          entityId: c.id,
          action: "UPDATE",
          summary: "Synthetic unavailable capture",
          metadata,
        },
      });
      const preview = await owner.caseFields.previewRestore({
        projectId: p.id,
        caseId: c.id,
        auditId: record.id,
        side: "AFTER",
      });
      expect(preview.historicalValues).toBeNull();
      expect(preview.canRestore).toBe(false);
      expect(preview.rows.every((row) => row.saved === "Unavailable")).toBe(
        true,
      );
    }
  });
  it("bounds summary and current-profile labels before loading history output", async () => {
    const { p, c } = await fixture();
    const original = await prisma.user.findUniqueOrThrow({
      where: { id: actorId },
      select: { name: true },
    });
    await prisma.user.update({
      where: { id: actorId },
      data: { name: "n".repeat(4000) },
    });
    try {
      const audit = await prisma.auditLog.create({
        data: {
          organizationId: orgIds[0]!,
          projectId: p.id,
          actorId,
          entityType: "TestCase",
          entityId: c.id,
          action: "UPDATE",
          summary: "s".repeat(100000),
        },
      });
      const history = await owner.caseFields.history({
        projectId: p.id,
        caseId: c.id,
      });
      const entry = history.entries.find((row) => row.auditId === audit.id)!;
      expect(entry.summary).toBe("s".repeat(1000));
      expect(entry.actor).toEqual({
        id: actorId,
        label: "n".repeat(500),
        source: "CURRENT_PROFILE",
      });
      expect(
        (await prisma.auditLog.findUniqueOrThrow({ where: { id: audit.id } }))
          .summary,
      ).toHaveLength(100000);
    } finally {
      await prisma.user.update({
        where: { id: actorId },
        data: { name: original.name },
      });
    }
  });
  it("rechecks live seat and suspension before an already committed restore replay", async () => {
    const { p, c } = await fixture(),
      source = await save(p.id, c.id, { component: "Second" });
    const request = await attempt(p.id, c.id, source.audit.id, "BEFORE");
    await owner.caseFields.restore(request);
    const where = {
      organizationId_userId: { organizationId: orgIds[0]!, userId: actorId },
    };
    await prisma.membership.update({ where, data: { seatType: "READ_ONLY" } });
    try {
      await expect(owner.caseFields.restore(request)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    } finally {
      await prisma.membership.update({ where, data: { seatType: "FULL" } });
    }
    await prisma.organization.update({
      where: { id: orgIds[0]! },
      data: { suspendedAt: new Date() },
    });
    try {
      await expect(owner.caseFields.restore(request)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    } finally {
      await prisma.organization.update({
        where: { id: orgIds[0]! },
        data: { suspendedAt: null },
      });
    }
    await expect(owner.caseFields.restore(request)).resolves.toEqual({
      requestId: request.requestId,
      replayed: true,
    });
  });
});
