// Execute only after migration on a uniquely owned disposable database.
// Native statements, independent connections and real row locks; no mocked read
// results, disabled triggers or changed product transaction deadlines.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, Prisma } from "@vaettir/db";
import { appRouter } from "./router.js";
import { assertOwnedTestDatabase } from "./testOnlyDatabaseSafety.js";
import { hardDeleteOrganization } from "./services/orgHardDelete.js";
import { lockCaseFieldReadScope } from "./services/caseFieldReadScope.js";

describe("case-field current native actor and original-organization read scope", () => {
  const tag = `field-read-${randomUUID()}`;
  type Caller = ReturnType<typeof appRouter.createCaller>;
  type User = Awaited<ReturnType<typeof prisma.user.findUniqueOrThrow>> & {
    memberships: Awaited<ReturnType<typeof prisma.membership.findMany>>;
  };
  type Pins = { originalOrganizationId?: string; expectedClerkActorId?: string };
  let organizationId: string, otherOrganizationId: string;
  let ownerUser: User, viewerUser: User;
  let owner: Caller, viewer: Caller;
  const orgIds: string[] = [];
  beforeAll(async () => {
    assertOwnedTestDatabase(process.env.DATABASE_URL);
    const tier = await prisma.planTier.findUniqueOrThrow({ where: { key: "free" } });
    for (let n = 0; n < 2; n++) {
      const org = await prisma.organization.create({
        data: { slug: `${tag}-${n}`, name: `${tag}-${n}`, planTierId: tier.id },
      });
      orgIds.push(org.id);
    }
    [organizationId, otherOrganizationId] = [orgIds[0]!, orgIds[1]!];
    ownerUser = await prisma.user.create({
      data: {
        clerkUserId: `${tag}-owner`, email: `${tag}-owner@example.com`,
        memberships: { create: orgIds.map((id) => ({ organizationId: id, role: "OWNER" as const, seatType: "FULL" as const })) },
      }, include: { memberships: true },
    });
    viewerUser = await prisma.user.create({
      data: {
        clerkUserId: `${tag}-viewer`, email: `${tag}-viewer@example.com`,
        memberships: { create: { organizationId, role: "VIEWER", seatType: "READ_ONLY" } },
      }, include: { memberships: true },
    });
    owner = appRouter.createCaller({ prisma, user: ownerUser });
    viewer = appRouter.createCaller({ prisma, user: viewerUser });
  });
  afterAll(async () => {
    // Native deletion receipts deliberately retain their dedicated actor FK.
    // Do not delete those receipts or synthetic actor profiles during teardown.
    if (!ownerUser) return;
    for (const id of orgIds) {
      const org = await prisma.organization.findUnique({ where: { id } });
      if (!org) continue;
      if (!org.slug.startsWith(`${tag}-`)) throw Error("Synthetic field-read ownership mismatch");
      await hardDeleteOrganization(prisma, id, ownerUser.id, "Owned field-read scope fixture teardown");
      expect(await prisma.organizationDeletionLog.count({ where: { organizationId: id, deletedById: ownerUser.id } })).toBe(1);
    }
  });
  const schema = {
    version: 1 as const,
    fields: [{ key: "context", label: "Synthetic context", type: "TEXT" as const, required: false, retired: false, options: [] }],
  };
  async function fixture(orgId = organizationId) {
    const project = await owner.project.create({
      organizationId: orgId, name: `${tag}-${randomUUID()}`,
      caseKey: `r${randomUUID().replaceAll("-", "").slice(0, 15)}`,
    });
    const impact = await owner.caseFields.reviewSchema({ projectId: project.id, schema });
    await owner.caseFields.configure({
      projectId: project.id, schema, actorId: impact.actorId,
      expectedSchemaHash: impact.expectedSchemaHash, expectedImpactHash: impact.expectedImpactHash,
      reason: "Reviewed synthetic definitions", confirmed: true, requestId: randomUUID(),
    });
    const state = await owner.caseFields.get({ projectId: project.id });
    const testCase = await owner.testCases.create({
      projectId: project.id, title: "Synthetic procedure | retained",
      testType: "FUNCTIONAL", background: "Literal setup\nsecond line",
      given: ["original | given"], when: ["original\nwhen"], then: ["original then"],
      customFields: { context: "First | literal\ncontext" }, expectedFieldSchemaHash: state.expectedSchemaHash,
    });
    const current = await owner.caseFields.get({ projectId: project.id, caseId: testCase.id });
    const request = {
      projectId: project.id, caseId: testCase.id,
      expectedSchemaHash: current.expectedSchemaHash, expectedValueHash: current.expectedValueHash,
      values: { context: "Second | literal\ncontext" }, reason: "Reviewed synthetic metadata only",
      confirmed: true as const, requestId: randomUUID(),
    };
    await owner.caseFields.save(request);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { projectId: project.id, actorId: ownerUser.id, entityType: "CaseFieldValueWrite", entityId: request.requestId },
    });
    // project.create deliberately returns a public summary, not the private
    // organization field. Retain the independently chosen creation input.
    return { organizationId: orgId, project, testCase, request, audit };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  function pins(orgId = organizationId, user = ownerUser) {
    return { originalOrganizationId: orgId, expectedClerkActorId: user.clerkUserId };
  }
  function expectedScope(f: Fixture, user = ownerUser) {
    return { projectId: f.project.id, organizationId: f.organizationId, actorId: user.id, actorClerkUserId: user.clerkUserId };
  }
  function reads(f: Fixture, caller = owner, scope: Pins = {}) {
    return [
      () => caller.caseFields.get({ projectId: f.project.id, caseId: f.testCase.id, ...scope }),
      () => caller.caseFields.history({ projectId: f.project.id, caseId: f.testCase.id, take: 10, ...scope }),
      () => caller.caseFields.previewRestore({ projectId: f.project.id, caseId: f.testCase.id, auditId: f.audit.id, side: "BEFORE", ...scope }),
    ];
  }
  async function retained(f: Fixture) {
    return {
      procedure: await prisma.testCase.findUniqueOrThrow({ where: { id: f.testCase.id }, include: { steps: true, versions: true } }),
      audits: await prisma.auditLog.findMany({ where: { projectId: f.project.id }, orderBy: { id: "asc" } }),
    };
  }
  it("legacy unpinned router reads always echo the independently verified native scope", async () => {
    const f = await fixture(), before = await retained(f);
    for (const read of reads(f)) expect((await read()).readScope).toEqual(expectedScope(f));
    const project = await owner.caseFields.get({ projectId: f.project.id });
    expect(project.readScope).toEqual(expectedScope(f));
    expect(project.caseId).toBeNull();
    expect(await retained(f)).toEqual(before);
  });
  it("accepts paired original-org/Clerk pins but rejects either partial pair before private output", async () => {
    const f = await fixture(), before = await retained(f);
    for (const read of reads(f, owner, pins())) expect((await read()).readScope).toEqual(expectedScope(f));
    for (const partial of [{ originalOrganizationId: organizationId }, { expectedClerkActorId: ownerUser.clerkUserId }])
      for (const read of reads(f, owner, partial)) await expect(read()).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await retained(f)).toEqual(before);
  });
  it("Viewer/READ_ONLY keeps read access and accurate provenance without write/restore capability", async () => {
    const f = await fixture(), before = await retained(f);
    const [state, history, preview] = await Promise.all([
      viewer.caseFields.get({ projectId: f.project.id, caseId: f.testCase.id, ...pins(organizationId, viewerUser) }),
      viewer.caseFields.history({ projectId: f.project.id, caseId: f.testCase.id, take: 10, ...pins(organizationId, viewerUser) }),
      viewer.caseFields.previewRestore({ projectId: f.project.id, caseId: f.testCase.id, auditId: f.audit.id, side: "BEFORE", ...pins(organizationId, viewerUser) }),
    ]);
    for (const result of [state, history, preview]) expect(result.readScope).toEqual(expectedScope(f, viewerUser));
    expect(state.values).toEqual({ context: "Second | literal\ncontext" });
    expect(state.canEdit).toBe(false); expect(state.canConfigure).toBe(false); expect(preview.canRestore).toBe(false);
    expect(history.entries.some((entry) => entry.auditId === f.audit.id)).toBe(true);
    expect(await retained(f)).toEqual(before);
  });
  it("refuses wrong expected Clerk or original organization even when the actor owns both tenants", async () => {
    const f = await fixture(), before = await retained(f);
    for (const wrong of [{ ...pins(), expectedClerkActorId: viewerUser.clerkUserId }, { ...pins(), originalOrganizationId: otherOrganizationId }])
      for (const read of reads(f, owner, wrong)) await expect(read()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await retained(f)).toEqual(before);
  });
  it("checks native User Clerk mapping against ctx independently for scoped AND legacy reads", async () => {
    const f = await fixture(), before = await retained(f);
    const remapped = `${tag}-native-remapped-${randomUUID()}`;
    await prisma.user.update({ where: { id: ownerUser.id }, data: { clerkUserId: remapped } });
    try {
      // The caller retains the original authenticated ctx snapshot. No mock
      // changes its token to match a newly reassigned native User row.
      for (const scope of [{}, pins()])
        for (const read of reads(f, owner, scope)) await expect(read()).rejects.toMatchObject({ code: "FORBIDDEN" });
    } finally {
      await prisma.user.update({ where: { id: ownerUser.id }, data: { clerkUserId: ownerUser.clerkUserId } });
    }
    expect(await retained(f)).toEqual(before);
  });
  it("refuses metadata review configure save and restore after independent native Clerk remap", async () => {
    // Each operation gets its own freshly eligible baseline. A missing guard
    // that changes definitions/values cannot manufacture a later CAS refusal
    // and accidentally make the other operation appear protected.
    for (const operation of ["reviewSchema", "configure", "save", "restore"] as const) {
      const f = await fixture();
      const nextSchema = { ...schema, fields: schema.fields.map((field) => ({ ...field, label: "Reviewed next synthetic context" })) };
      const impact = await owner.caseFields.reviewSchema({ projectId: f.project.id, schema: nextSchema });
      const configure = {
        projectId: f.project.id, schema: nextSchema, actorId: impact.actorId,
        expectedSchemaHash: impact.expectedSchemaHash, expectedImpactHash: impact.expectedImpactHash,
        reason: "Eligible synthetic definitions reviewed before remap", confirmed: true as const, requestId: randomUUID(),
      };
      const current = await owner.caseFields.get({ projectId: f.project.id, caseId: f.testCase.id });
      const save = {
        projectId: f.project.id, caseId: f.testCase.id,
        expectedSchemaHash: current.expectedSchemaHash, expectedValueHash: current.expectedValueHash,
        values: { context: "New independent | reviewed\nvalue" }, reason: "Eligible synthetic metadata reviewed before remap",
        confirmed: true as const, requestId: randomUUID(),
      };
      const preview = await owner.caseFields.previewRestore({
        projectId: f.project.id, caseId: f.testCase.id, auditId: f.audit.id, side: "BEFORE", ...pins(),
      });
      expect(preview.canRestore).toBe(true);
      const restore = {
        projectId: f.project.id, caseId: f.testCase.id, auditId: f.audit.id, side: "BEFORE" as const,
        actorId: preview.actorId, expectedSchemaHash: preview.expectedSchemaHash,
        expectedValueHash: preview.expectedValueHash, expectedSourceHash: preview.expectedSourceHash,
        reason: "Eligible synthetic restore reviewed before remap", confirmed: true as const, requestId: randomUUID(),
      };
      const before = await retained(f);
      const projectBefore = await prisma.project.findUniqueOrThrow({ where: { id: f.project.id } });
      const remapped = `${tag}-writer-${operation}-${randomUUID()}`;
      await prisma.user.update({ where: { id: ownerUser.id }, data: { clerkUserId: remapped } });
      try {
        const invoke = () => {
          if (operation === "reviewSchema") return owner.caseFields.reviewSchema({ projectId: f.project.id, schema: nextSchema });
          if (operation === "configure") return owner.caseFields.configure(configure);
          if (operation === "save") return owner.caseFields.save(save);
          return owner.caseFields.restore(restore);
        };
        // Soft assertions preserve real before-fix evidence for all four
        // independent operations instead of stopping after the first gap.
        const outcome = await invoke().then(
          () => ({ accepted: true as const }),
          (error: unknown) => ({ accepted: false as const, error }),
        );
        expect.soft(outcome.accepted, `${operation} must refuse retained ctx A after native mapping B`).toBe(false);
        if (!outcome.accepted) expect.soft(outcome.error).toMatchObject({ code: "FORBIDDEN" });
        expect.soft(await retained(f), `${operation} must preserve full procedure versions and audits`).toEqual(before);
        expect.soft(await prisma.project.findUniqueOrThrow({ where: { id: f.project.id } }), `${operation} must preserve exact definitions/version`).toEqual(projectBefore);
      } finally {
        await prisma.user.update({ where: { id: ownerUser.id }, data: { clerkUserId: ownerUser.clerkUserId } });
      }
    }
  });
  it("refuses exact accepted metadata receipt replay after native Clerk remap without consuming or changing history", async () => {
    const f = await fixture(), before = await retained(f);
    const projectBefore = await prisma.project.findUniqueOrThrow({ where: { id: f.project.id } });
    // The reviewed fixture saved this exact UUID/body once. Current A access
    // must recover it unchanged, before the native mapping becomes B.
    expect(await owner.caseFields.save(f.request)).toEqual({ requestId: f.request.requestId, replayed: true });
    expect(await retained(f)).toEqual(before);
    await prisma.user.update({ where: { id: ownerUser.id }, data: { clerkUserId: `${tag}-accepted-replay-${randomUUID()}` } });
    try {
      const outcome = await owner.caseFields.save(f.request).then(
        () => ({ accepted: true as const }),
        (error: unknown) => ({ accepted: false as const, error }),
      );
      expect.soft(outcome.accepted, "Native remapping must forbid replay before receipt success").toBe(false);
      if (!outcome.accepted) expect.soft(outcome.error).toMatchObject({ code: "FORBIDDEN" });
      expect.soft(await retained(f)).toEqual(before);
      expect.soft(await prisma.project.findUniqueOrThrow({ where: { id: f.project.id } })).toEqual(projectBefore);
      expect.soft(await prisma.auditLog.findUniqueOrThrow({ where: { id: f.audit.id } })).toEqual(f.audit);
      expect.soft(await prisma.auditLog.count({ where: {
        projectId: f.project.id, actorId: ownerUser.id, entityType: "CaseFieldValueWrite", entityId: f.request.requestId,
      } })).toBe(1);
    } finally {
      await prisma.user.update({ where: { id: ownerUser.id }, data: { clerkUserId: ownerUser.clerkUserId } });
    }
    expect(await owner.caseFields.save(f.request)).toEqual({ requestId: f.request.requestId, replayed: true });
    expect(await retained(f)).toEqual(before);
  });
  it("never returns another project's case or audit and never repins an original-org request after reparenting", async () => {
    const f = await fixture(), other = await fixture(), foreign = await fixture(otherOrganizationId);
    const before = await retained(f), foreignBefore = await retained(foreign);
    for (const read of reads(foreign, viewer, pins(otherOrganizationId, viewerUser)))
      await expect(read()).rejects.toMatchObject({ code: "FORBIDDEN" });
    for (const caseId of [other.testCase.id, foreign.testCase.id]) {
      await expect(owner.caseFields.get({ projectId: f.project.id, caseId, ...pins() })).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(owner.caseFields.history({ projectId: f.project.id, caseId, take: 10, ...pins() })).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(owner.caseFields.previewRestore({ projectId: f.project.id, caseId, auditId: f.audit.id, side: "BEFORE", ...pins() })).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    await expect(owner.caseFields.previewRestore({ projectId: f.project.id, caseId: f.testCase.id, auditId: foreign.audit.id, side: "AFTER", ...pins() })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await prisma.project.update({ where: { id: f.project.id }, data: { organizationId: otherOrganizationId } });
    try {
      for (const read of reads(f, owner, pins())) await expect(read()).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect((await owner.caseFields.get({ projectId: f.project.id, caseId: f.testCase.id })).readScope?.organizationId).toBe(otherOrganizationId);
    } finally {
      await prisma.project.update({ where: { id: f.project.id }, data: { organizationId } });
    }
    expect(await retained(f)).toEqual(before); expect(await retained(foreign)).toEqual(foreignBefore);
  });
  it("rechecks suspension and revoked membership despite a formerly valid ctx membership snapshot", async () => {
    const f = await fixture(), before = await retained(f);
    await prisma.organization.update({ where: { id: organizationId }, data: { suspendedAt: new Date("2026-01-01T00:00:00Z") } });
    try { for (const read of reads(f, owner, pins())) await expect(read()).rejects.toMatchObject({ code: "FORBIDDEN" }); }
    finally { await prisma.organization.update({ where: { id: organizationId }, data: { suspendedAt: null } }); }
    const membership = await prisma.membership.findUniqueOrThrow({ where: { organizationId_userId: { organizationId, userId: viewerUser.id } } });
    await prisma.membership.delete({ where: { organizationId_userId: { organizationId, userId: viewerUser.id } } });
    try { for (const read of reads(f, viewer, pins(organizationId, viewerUser))) await expect(read()).rejects.toMatchObject({ code: "FORBIDDEN" }); }
    finally { await prisma.membership.create({ data: membership }); }
    expect(await retained(f)).toEqual(before);
  });
  it("retains actual Org/Membership/Project/User/Case locks until the protected read completes", async () => {
    const f = await fixture(), before = await retained(f);
    await prisma.$transaction(async (tx) => {
      await lockCaseFieldReadScope(tx, ownerUser.id, { projectId: f.project.id, caseId: f.testCase.id, ...pins() }, { clerkActorId: ownerUser.clerkUserId });
      const rivals = [
        Prisma.sql`UPDATE "Organization" SET "suspendedAt"=now() WHERE id=${organizationId}`,
        Prisma.sql`DELETE FROM "Membership" WHERE "organizationId"=${organizationId} AND "userId"=${ownerUser.id}`,
        Prisma.sql`UPDATE "Project" SET "organizationId"=${otherOrganizationId} WHERE id=${f.project.id}`,
        Prisma.sql`UPDATE "User" SET "clerkUserId"=${`${tag}-rival-clerk`} WHERE id=${ownerUser.id}`,
        Prisma.sql`UPDATE "TestCase" SET "title"="title" WHERE id=${f.testCase.id}`,
      ];
      for (const statement of rivals)
        await expect(prisma.$transaction(async (rival) => {
          await rival.$executeRaw`SET LOCAL lock_timeout='100ms'`;
          await rival.$executeRaw(statement);
        }, { timeout: 2000 })).rejects.toMatchObject({ code: "P2010", meta: { code: "55P03" } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 10000 });
    expect(await retained(f)).toEqual(before);
    expect((await owner.caseFields.get({ projectId: f.project.id, caseId: f.testCase.id, ...pins() })).readScope).toEqual(expectedScope(f));
  });
  it("a router read blocked behind a native Clerk remap refuses instead of returning the older actor's body", async () => {
    const f = await fixture(), before = await retained(f);
    type Outcome = { ok: true; value: Awaited<ReturnType<typeof owner.caseFields.get>> } | { ok: false; error: unknown };
    let pending: Promise<Outcome> | undefined;
    const nextClerk = `${tag}-concurrent-remap-${randomUUID()}`;
    try {
      await prisma.$transaction(async (writer) => {
        const [backend] = await writer.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
        if (!backend) throw Error("Synthetic native writer backend unavailable");
        await writer.user.update({ where: { id: ownerUser.id }, data: { clerkUserId: nextClerk } });
        pending = owner.caseFields.get({ projectId: f.project.id, caseId: f.testCase.id, ...pins() }).then(
          (value): Outcome => ({ ok: true, value }), (error: unknown): Outcome => ({ ok: false, error }),
        );
        let blocked = false;
        for (let n = 0; n < 100 && !blocked; n++) {
          await writer.$queryRaw`SELECT pg_stat_clear_snapshot()::text`;
          const [activity] = await writer.$queryRaw<Array<{ blocked: boolean }>>`SELECT EXISTS(
            SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()
              AND wait_event_type='Lock' AND ${backend.pid}=ANY(pg_blocking_pids(pid))
              AND query LIKE '%"User"%' AND query LIKE '%FOR SHARE%'
          ) AS blocked`;
          blocked = activity?.blocked === true;
          if (!blocked) await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(blocked).toBe(true); // A real reader/independent-writer barrier, not a scheduling assumption.
      }, { timeout: 10000 });
      if (!pending) throw Error("Synthetic read was not started");
      const outcome = await pending;
      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw Error("Native read returned a private body after conflicting Clerk remap");
      const codes: string[] = [];
      let cause: unknown = outcome.error;
      for (let n = 0; n < 8 && cause && typeof cause === "object"; n++) {
        if ("code" in cause) codes.push(String(cause.code));
        if ("meta" in cause && cause.meta && typeof cause.meta === "object" && "code" in cause.meta) codes.push(String(cause.meta.code));
        cause = "cause" in cause ? cause.cause : null;
      }
      // The RR row lock may report its genuine serialization conflict before
      // the later explicit mapping refusal. Neither can acknowledge a body.
      expect(codes.some((code) => ["FORBIDDEN", "P2034", "40001"].includes(code))).toBe(true);
    } finally {
      if (pending) await pending;
      await prisma.user.update({ where: { id: ownerUser.id }, data: { clerkUserId: ownerUser.clerkUserId } });
    }
    expect(await retained(f)).toEqual(before);
  });
});
