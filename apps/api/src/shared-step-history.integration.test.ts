import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@vaettir/db";
import { appRouter } from "./router.js";
import { queryCasePage } from "./services/caseQuery.js";
import { defaultCaseQuery } from "./services/caseQuerySchema.js";
import {
  hardDeleteOrganization,
  previewOrgHardDelete,
} from "./services/orgHardDelete.js";

describe("retained reviewed shared-step history", () => {
  let owner: ReturnType<typeof appRouter.createCaller>,
    viewer: typeof owner,
    readOnly: typeof owner,
    outsider: typeof owner;
  let projectId: string,
    otherProject: string,
    orgId: string,
    actorId: string,
    readOnlyId: string;
  const stamp = `shared-library-${Date.now()}-${randomUUID()}`;
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
    if (
      !["127.0.0.1", "localhost"].includes(url.hostname) ||
      !url.pathname.includes("test") ||
      url.searchParams.has("host")
    )
      throw Error("Synthetic disposable loopback test DB required");
    const tier = await prisma.planTier.findUniqueOrThrow({
      where: { key: "free" },
    });
    const org = await prisma.organization.create({
      data: { name: stamp, slug: stamp, planTierId: tier.id },
    });
    orgId = org.id;
    const other = await prisma.organization.create({
      data: {
        name: `${stamp}-other`,
        slug: `${stamp}-other`,
        planTierId: tier.id,
      },
    });
    async function caller(
      suffix: string,
      organizationId: string,
      role: "OWNER" | "VIEWER" | "EDITOR",
      seatType: "FULL" | "READ_ONLY" = "FULL",
    ) {
      const user = await prisma.user.create({
        data: {
          email: `${stamp}-${suffix}@example.com`,
          clerkUserId: `${stamp}-${suffix}`,
          memberships: { create: { organizationId, role, seatType } },
        },
        include: { memberships: true },
      });
      return { caller: appRouter.createCaller({ prisma, user }), id: user.id };
    }
    ({ caller: owner, id: actorId } = await caller("owner", org.id, "OWNER"));
    viewer = (await caller("viewer", org.id, "VIEWER")).caller;
    ({ caller: readOnly, id: readOnlyId } = await caller(
      "readonly",
      org.id,
      "EDITOR",
      "READ_ONLY",
    ));
    outsider = (await caller("outsider", other.id, "OWNER")).caller;
    projectId = (
      await owner.project.create({
        organizationId: org.id,
        name: "Synthetic library project",
      })
    ).id;
    otherProject = (
      await outsider.project.create({
        organizationId: other.id,
        name: "Foreign sentinel",
      })
    ).id;
  });
  async function create() {
    return owner.sharedStepGroups.create({
      projectId,
      name: "Original library",
      description: "  exact\n背景 ",
      steps: [
        { action: "Original action", expectedResult: "Exact original result" },
      ],
      requestId: randomUUID(),
    });
  }
  async function update(
    id: string,
    action: "UPDATE" | "RESTORE" | "ARCHIVE" | "RECOVER" = "UPDATE",
    extra: Record<string, unknown> = {},
  ) {
    const review = await owner.sharedStepGroups.review({ projectId, id });
    return {
      projectId,
      id,
      action,
      expectedRevisionHash: review.revisionHash,
      requestId: randomUUID(),
      confirmed: true as const,
      reason: "Synthetic reviewed change",
      ...(action === "UPDATE"
        ? {
            content: {
              name: review.snapshot.name,
              description: review.snapshot.description,
              steps: [{ order: 0, action: "Changed action" }],
            },
          }
        : {}),
      ...extra,
    };
  }
  it("captures attributed creation, exact content, durable creation retry and unknown raw creation", async () => {
    const request = {
      projectId,
      name: "Original library",
      steps: [{ action: "Original action" }],
      requestId: randomUUID(),
    };
    const first = await owner.sharedStepGroups.create(request);
    expect(await owner.sharedStepGroups.create(request)).toEqual({
      ...first,
      recovered: true,
    });
    const review = await viewer.sharedStepGroups.review({
      projectId,
      id: first.id,
    });
    expect(review.revisions[0]).toMatchObject({ kind: "CREATE", revision: 1 });
    expect(review.revisions[0]!.actorName).not.toBeNull();
    expect(review.canEdit).toBe(false);
    await expect(
      owner.sharedStepGroups.create({ ...request, name: "Changed retry" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const raw = await prisma.sharedStepGroup.create({
      data: {
        projectId,
        name: "Legacy writer create",
        steps: [{ order: 0, action: "Original raw action" }],
      },
    });
    expect(
      (await owner.sharedStepGroups.review({ projectId, id: raw.id }))
        .revisions[0],
    ).toMatchObject({ kind: "BASELINE_CAPTURE", actorName: null });
  });
  it("keeps library bounds and content in the same authorized snapshot during project reparenting", async () => {
    const isolated = await owner.project.create({
      organizationId: orgId,
      name: `Synthetic library read snapshot ${randomUUID()}`,
    });
    const original = await owner.sharedStepGroups.create({
      projectId: isolated.id,
      name: "Authorized original procedure",
      steps: [{ action: "Original authorized action" }],
    });
    const foreign = await prisma.project.findUniqueOrThrow({
      where: { id: otherProject },
      select: { organizationId: true },
    });
    let reparented = false;
    let introducedId = "";
    const intercepted = prisma.$extends({
      query: {
        membership: {
          async findUnique({ args, query }) {
            const authorized = await query(args);
            if (
              !reparented &&
              args.where.organizationId_userId?.organizationId === orgId &&
              args.where.organizationId_userId.userId === actorId
            ) {
              reparented = true;
              await prisma.$transaction(async (other) => {
                await other.project.update({
                  where: { id: isolated.id },
                  data: { organizationId: foreign.organizationId },
                });
                introducedId = (
                  await other.sharedStepGroup.create({
                    data: {
                      projectId: isolated.id,
                      name: "New foreign-tenant procedure after authorization",
                      steps: [
                        { order: 0, action: "Foreign procedure must not leak" },
                      ],
                    },
                  })
                ).id;
              });
            }
            return authorized;
          },
        },
      },
    });
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: actorId },
      include: { memberships: true },
    });
    const concurrent = appRouter.createCaller({
      prisma: intercepted as unknown as typeof prisma,
      user,
    });
    const result = await concurrent.sharedStepGroups.list({
      projectId: isolated.id,
    });
    expect(reparented).toBe(true);
    expect(introducedId).not.toBe("");
    expect(result.map((g) => g.id)).toEqual([original.id]);
    expect(JSON.stringify(result)).not.toContain(
      "Foreign procedure must not leak",
    );
    await expect(
      owner.sharedStepGroups.list({ projectId: isolated.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(
      (await outsider.sharedStepGroups.list({ projectId: isolated.id })).some(
        (g) => g.id === introducedId,
      ),
    ).toBe(true);
  });
  it("rejects stale/foreign/read-only/currently revoked writes and legacy unreviewed mutation", async () => {
    const group = await create(),
      request = await update(group.id);
    for (const caller of [viewer, readOnly, outsider])
      await expect(
        caller.sharedStepGroups.update(request as never),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      outsider.sharedStepGroups.review({ projectId, id: group.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      prisma.sharedStepGroup.update({
        where: { id: group.id },
        data: { name: "Unreviewed overwrite" },
      }),
    ).rejects.toThrow("compatible reviewed writer");
    const changed = await owner.sharedStepGroups.update(request as never);
    expect(changed.revision).toBe(2);
    await expect(
      owner.sharedStepGroups.update({
        ...request,
        requestId: randomUUID(),
      } as never),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await prisma.membership.update({
      where: {
        organizationId_userId: { organizationId: orgId, userId: readOnlyId },
      },
      data: { role: "OWNER", seatType: "FULL" },
    });
    const current = await update(group.id, "RESTORE", { sourceRevision: 1 });
    await prisma.membership.delete({
      where: {
        organizationId_userId: { organizationId: orgId, userId: readOnlyId },
      },
    });
    await expect(
      readOnly.sharedStepGroups.update(current as never),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("appends restoration, preserves frozen runs and recovers same actor request without duplicate revision", async () => {
    const group = await create();
    const tc = await owner.testCases.create({
      projectId,
      title: "Library run",
      testType: "FUNCTIONAL",
      sharedStepGroupId: group.id,
    });
    const run = await owner.manualExecution.start({
      projectId,
      testCaseIds: [tc.id],
    });
    const frozen = (await owner.manualExecution.getForExecution(run))
      .executionContext;
    const request = await update(group.id);
    await owner.sharedStepGroups.update(request as never);
    expect(await owner.sharedStepGroups.update(request as never)).toMatchObject(
      { revision: 2, recovered: true },
    );
    await expect(
      owner.sharedStepGroups.update({
        ...request,
        reason: "Different request",
      } as never),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const restore = await update(group.id, "RESTORE", { sourceRevision: 1 });
    expect(await owner.sharedStepGroups.update(restore as never)).toMatchObject(
      { revision: 3 },
    );
    const restored = await owner.sharedStepGroups.review({
      projectId,
      id: group.id,
    });
    expect(restored.snapshot.steps[0]!.action).toBe("Original action");
    expect(restored.revisions.map((r) => r.revision)).toEqual([3, 2, 1]);
    expect(restored.revisions[0]).toMatchObject({
      kind: "RESTORE",
      sourceRevision: 1,
    });
    expect(restored.usageCount).toBe(1);
    expect(
      (await owner.manualExecution.getForExecution(run)).executionContext,
    ).toEqual(frozen);
  });
  it("retains immutable receipts and refuses incomplete reviewed SQL writes", async () => {
    const group = await create();
    const revision = await prisma.sharedStepGroupRevision.findFirstOrThrow({
      where: { groupId: group.id },
    });
    await expect(
      prisma.sharedStepGroupRevision.update({
        where: { id: revision.id },
        data: { reason: "Erased original reason" },
      }),
    ).rejects.toThrow("append-only");
    await expect(
      prisma.sharedStepGroupRevision.delete({ where: { id: revision.id } }),
    ).rejects.toThrow("append-only");
    await expect(
      prisma.sharedStepGroup.delete({ where: { id: group.id } }),
    ).rejects.toThrow("retain history");
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('vaettir.shared_step_write',${JSON.stringify({ id: group.id })},true)`;
        await tx.sharedStepGroup.update({
          where: { id: group.id },
          data: { name: "Missing retained receipt", revision: 2 },
        });
      }),
    ).rejects.toThrow("compatible reviewed writer");
    expect(
      (
        await prisma.sharedStepGroup.findUniqueOrThrow({
          where: { id: group.id },
        })
      ).revision,
    ).toBe(1);
  });
  it("archives only unused libraries, hides them from pickers and explicitly recovers", async () => {
    const group = await create();
    const tc = await owner.testCases.create({
      projectId,
      title: "Current link",
      testType: "FUNCTIONAL",
      sharedStepGroupId: group.id,
    });
    await expect(
      owner.sharedStepGroups.update(
        (await update(group.id, "ARCHIVE")) as never,
      ),
    ).rejects.toThrow("Unlink");
    await prisma.testCase.update({
      where: { id: tc.id },
      data: { sharedStepGroupId: null },
    });
    await owner.sharedStepGroups.update(
      (await update(group.id, "ARCHIVE")) as never,
    );
    expect(
      (await owner.sharedStepGroups.list({ projectId })).some(
        (g) => g.id === group.id,
      ),
    ).toBe(false);
    expect(
      (
        await owner.sharedStepGroups.list({ projectId, includeArchived: true })
      ).find((g) => g.id === group.id)?.archivedAt,
    ).not.toBeNull();
    await expect(
      owner.testCases.create({
        projectId,
        title: "New bad link",
        testType: "FUNCTIONAL",
        sharedStepGroupId: group.id,
      }),
    ).rejects.toThrow();
    await expect(
      prisma.testCase.update({
        where: { id: tc.id },
        data: { sharedStepGroupId: group.id },
      }),
    ).rejects.toThrow("Archived libraries");
    await owner.sharedStepGroups.update(
      (await update(group.id, "RECOVER")) as never,
    );
    expect(
      (await owner.sharedStepGroups.review({ projectId, id: group.id }))
        .snapshot.archived,
    ).toBe(false);
  });
  it("serializes concurrent stale edits and durable identical retries", async () => {
    const group = await create(),
      request = await update(group.id);
    const same = await Promise.all([
      owner.sharedStepGroups.update(request as never),
      owner.sharedStepGroups.update(request as never),
    ]);
    expect(same.every((r) => r.revision === 2)).toBe(true);
    expect(
      await prisma.sharedStepGroupRevision.count({
        where: { groupId: group.id },
      }),
    ).toBe(2);
    const a = await update(group.id, "RESTORE", { sourceRevision: 1 });
    const results = await Promise.allSettled([
      owner.sharedStepGroups.update(a as never),
      owner.sharedStepGroups.update({ ...a, requestId: randomUUID() } as never),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
  it("refuses missing saved/media evidence and bounded retained histories", async () => {
    const group = await create();
    await expect(
      owner.sharedStepGroups.update(
        (await update(group.id, "RESTORE", { sourceRevision: 99 })) as never,
      ),
    ).rejects.toThrow("Saved revision not found");
    const request = await update(group.id);
    request.content!.steps[0] = {
      order: 0,
      action: "Changed action",
      mediaAttachmentIds: ["missing-media"],
    } as never;
    await expect(
      owner.sharedStepGroups.update(request as never),
    ).rejects.toThrow("missing, unverified or outside");
    expect(
      await prisma.sharedStepGroupRevision.count({
        where: { groupId: group.id },
      }),
    ).toBe(1);
  });
  it("rejects oversized authored updates before head or history changes", async () => {
    const group = await create(),
      request = await update(group.id);
    request.content!.steps = Array.from({ length: 30 }, (_, order) => ({
      order,
      action: "x".repeat(9000),
    }));
    await expect(
      owner.sharedStepGroups.update(request as never),
    ).rejects.toThrow("256 KiB");
    expect(
      await prisma.sharedStepGroupRevision.count({
        where: { groupId: group.id },
      }),
    ).toBe(1);
  });
  it("shares organization-first query lock ordering without a read/write deadlock", async () => {
    const group = await create(),
      request = await update(group.id);
    const tc = await owner.testCases.create({
      projectId,
      title: "Concurrent library query",
      testType: "FUNCTIONAL",
      sharedStepGroupId: group.id,
    });
    // The new case changes the reviewed impact, so explicitly refresh the CAS.
    request.expectedRevisionHash = (
      await owner.sharedStepGroups.review({ projectId, id: group.id })
    ).revisionHash;
    let write: ReturnType<typeof owner.sharedStepGroups.update> | undefined;
    const page = await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Organization" WHERE id=${orgId} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM "Membership" WHERE "organizationId"=${orgId} AND "userId"=${actorId} FOR UPDATE`;
        write = owner.sharedStepGroups.update(request as never);
        // Force the write to reach its contested organization lock before the
        // query takes Project. Old Project->Organization writers form a cycle.
        let contested = false;
        for (let i = 0; i < 100 && !contested; i++) {
          // PostgreSQL retains activity snapshots for this transaction. Refresh
          // each observation so an earlier poll cannot hide a real lock wait.
          await tx.$queryRaw`SELECT pg_stat_clear_snapshot()::text`;
          const rows = await tx.$queryRaw<
            Array<{ waiting: boolean }>
          >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND "wait_event_type"='Lock' AND query LIKE '%Organization%FOR SHARE%') AS waiting`;
          contested = rows[0]?.waiting === true;
          if (!contested)
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(contested).toBe(true);
        await tx.$queryRaw`SELECT "organizationId" FROM "Project" WHERE id=${projectId} FOR UPDATE`;
        return queryCasePage(
          tx,
          { projectId, query: defaultCaseQuery(), requestId: randomUUID() },
          actorId,
          orgId,
          {
            PRODUCTION_SIGNAL_ENCRYPTION_KEY: Buffer.alloc(32, 11).toString(
              "base64",
            ),
          },
        );
      },
      { isolationLevel: "RepeatableRead", timeout: 15000 },
    );
    expect(page.items.some((c) => c.id === tc.id)).toBe(true);
    expect(await write).toMatchObject({ revision: 2, recovered: false });
  });
  it("binds approvals to current project ownership even when the actor owns both tenants", async () => {
    const group = await create(),
      request = await update(group.id);
    const other = await prisma.project.findUniqueOrThrow({
      where: { id: otherProject },
      select: { organizationId: true },
    });
    await prisma.membership.create({
      data: {
        organizationId: other.organizationId,
        userId: actorId,
        role: "OWNER",
        seatType: "FULL",
      },
    });
    await prisma.project.update({
      where: { id: projectId },
      data: { organizationId: other.organizationId },
    });
    try {
      await expect(
        owner.sharedStepGroups.update(request as never),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(
        (await owner.sharedStepGroups.review({ projectId, id: group.id }))
          .revisionHash,
      ).not.toBe(request.expectedRevisionHash);
      expect(
        await prisma.sharedStepGroupRevision.count({
          where: { groupId: group.id },
        }),
      ).toBe(1);
    } finally {
      await prisma.project.update({
        where: { id: projectId },
        data: { organizationId: orgId },
      });
    }
  });
  it("erases only explicitly scoped synthetic library revisions and reports their impact", async () => {
    const other = await outsider.sharedStepGroups.create({
      projectId: otherProject,
      name: "Retained other tenant",
      steps: [{ action: "Other tenant procedure" }],
    });
    const sentinel = await prisma.sharedStepGroupRevision.findMany({
      where: { groupId: other.id },
    });
    const preview = await previewOrgHardDelete(prisma, orgId);
    expect(preview.rowCounts.SharedStepGroupRevision).toBeGreaterThan(0);
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('vaettir.shared_library_erasure',${orgId},true)`;
        await tx.sharedStepGroupRevision.deleteMany({
          where: { groupId: other.id },
        });
      }),
    ).rejects.toThrow("append-only");
    const erased = await hardDeleteOrganization(
      prisma,
      orgId,
      actorId,
      "Synthetic isolated library teardown",
    );
    expect(erased.rowCounts.SharedStepGroupRevision).toBe(
      preview.rowCounts.SharedStepGroupRevision,
    );
    expect(
      await prisma.sharedStepGroupRevision.findMany({
        where: { groupId: other.id },
      }),
    ).toEqual(sentinel);
  });
});
