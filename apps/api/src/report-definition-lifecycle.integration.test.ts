import { createHash, randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { prisma, Prisma } from "@vaettir/db";
import { appRouter } from "./router.js";
// Authored synthetic scenarios only. Never run against customer databases.
const stamp = `report-definition-${Date.now()}-${randomUUID().slice(0, 8)}`;
const definition = {
  audience: "stakeholders" as const,
  windowDays: 30 as const,
  sections: ["inventory" as const],
  summary: "Synthetic private commentary",
  risks: "No runtime claim",
  nextActions: "Review",
};
type Caller = ReturnType<typeof appRouter.createCaller>;
describe("reviewed reusable report-definition lifecycle", () => {
  let projectId: string, orgId: string, otherOrgId: string;
  const users: string[] = [];
  const callers: Record<string, Caller> = {};
  const ids: Record<string, string> = {};
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
    if (
      !["localhost", "127.0.0.1"].includes(url.hostname) ||
      !/test/i.test(url.pathname) ||
      url.searchParams.has("host")
    )
      throw new Error("Disposable synthetic loopback database required");
    const tier = await prisma.planTier.findUniqueOrThrow({
      where: { key: "free" },
    });
    orgId = (
      await prisma.organization.create({
        data: { name: stamp, slug: stamp, planTierId: tier.id },
      })
    ).id;
    otherOrgId = (
      await prisma.organization.create({
        data: {
          name: `${stamp}-other`,
          slug: `${stamp}-other`,
          planTierId: tier.id,
        },
      })
    ).id;
    projectId = (
      await prisma.project.create({
        data: {
          organizationId: orgId,
          name: "Synthetic report lifecycle",
          slug: stamp,
        },
      })
    ).id;
    for (const [name, role, organizationId] of [
      ["owner", "OWNER", orgId],
      ["admin", "ADMIN", orgId],
      ["editor", "EDITOR", orgId],
      ["viewer", "VIEWER", orgId],
      ["other", "OWNER", otherOrgId],
    ] as const) {
      const user = await prisma.user.create({
        data: {
          clerkUserId: `${stamp}-${name}`,
          email: `${stamp}-${name}@example.com`,
          memberships: { create: { organizationId, role, seatType: "FULL" } },
        },
        include: { memberships: true },
      });
      ids[name] = user.id;
      users.push(user.id);
      callers[name] = appRouter.createCaller({ prisma, user });
    }
  });
  afterAll(async () => {
    if (projectId) {
      await prisma.projectReportDefinitionWrite.deleteMany({
        where: { projectId },
      });
      await prisma.projectReportSnapshot.deleteMany({ where: { projectId } });
      await prisma.projectReportDefinition.deleteMany({ where: { projectId } });
      await prisma.project.deleteMany({ where: { id: projectId } });
    }
    await prisma.auditLog.deleteMany({ where: { userId: { in: users } } });
    await prisma.membership.deleteMany({ where: { userId: { in: users } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    if (orgId)
      await prisma.organization.deleteMany({
        where: { id: { in: [orgId, otherOrgId] } },
      });
  });
  const create = (actor = "owner") =>
    callers[actor].reportSnapshots.saveDefinition({
      projectId,
      requestId: randomUUID(),
      name: `Synthetic ${randomUUID()}`,
      definition,
    });
  const change = (
    id: string,
    version: number,
    action: Parameters<
      Caller["reportSnapshots"]["manageDefinition"]
    >[0]["action"],
    extra: Record<string, unknown> = {},
  ) => ({
    projectId,
    id,
    version,
    action,
    requestId: randomUUID(),
    reason: "Synthetic reviewed change",
    approve: true as const,
    approveProjectSharing: false,
    ...extra,
  });
  const key = (actor: string, requestId: string) =>
    createHash("sha256")
      .update(JSON.stringify([projectId, ids[actor], requestId]))
      .digest("hex");

  it("edits reusable settings as new history without changing captures or silently rebasing stale input", async () => {
    const saved = await create();
    const captured = await callers.owner.reportSnapshots.preview({
      projectId,
      requestId: randomUUID(),
      title: "Original capture",
      definition,
      definitionId: saved.id,
    });
    const frozen = (
      await prisma.projectReportSnapshot.findUniqueOrThrow({
        where: { id: captured.id },
      })
    ).payload;
    const edited = {
      ...definition,
      audience: "quality" as const,
      windowDays: 7 as const,
      sections: ["execution" as const],
      summary: "Explicitly edited notes",
    };
    const request = change(saved.id, 1, {
      kind: "settings",
      definition: edited,
    });
    await callers.owner.reportSnapshots.manageDefinition(request);
    expect(
      await callers.owner.reportSnapshots.manageDefinition(request),
    ).toMatchObject({ version: 2, replay: true });
    const history = await callers.owner.reportSnapshots.definitionHistory({
      projectId,
      id: saved.id,
    });
    expect(history.current.definition).toEqual(edited);
    expect(
      history.items.find((row) => row.key === key("owner", request.requestId)),
    ).toMatchObject({ before: { definition }, after: { definition: edited } });
    await expect(
      callers.owner.reportSnapshots.manageDefinition(
        change(saved.id, 1, {
          kind: "settings",
          definition: { ...edited, risks: "Stale edit" },
        }),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      (
        await prisma.projectReportSnapshot.findUniqueOrThrow({
          where: { id: captured.id },
        })
      ).payload,
    ).toEqual(frozen);
    await callers.owner.reportSnapshots.manageDefinition(
      change(saved.id, 2, {
        kind: "restore",
        receiptKey: key("owner", request.requestId),
        side: "before",
      }),
    );
    expect(
      (
        await callers.owner.reportSnapshots.definitionHistory({
          projectId,
          id: saved.id,
        })
      ).current,
    ).toMatchObject({ version: 3, definition });
  });
  it("requires explicit administrator review for edited shared commentary", async () => {
    const saved = await create();
    await callers.owner.reportSnapshots.manageDefinition(
      change(
        saved.id,
        1,
        { kind: "visibility", visibility: "project" },
        { approveProjectSharing: true },
      ),
    );
    const edited = {
      ...definition,
      summary: "Administrator reviewed replacement",
    };
    await expect(
      callers.admin.reportSnapshots.manageDefinition(
        change(saved.id, 2, { kind: "settings", definition: edited }),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await callers.admin.reportSnapshots.manageDefinition(
      change(
        saved.id,
        2,
        { kind: "settings", definition: edited },
        { approveProjectSharing: true },
      ),
    );
    expect(
      (
        await callers.viewer.reportSnapshots.definitionHistory({
          projectId,
          id: saved.id,
        })
      ).current,
    ).toMatchObject({ version: 3, definition: edited, visibility: "project" });
    expect(
      (
        await prisma.projectReportDefinition.findUniqueOrThrow({
          where: { id: saved.id },
        })
      ).userId,
    ).toBe(ids.owner);
  });
  it("refuses foreign/deleted native settings references and unavailable historical scope without dropping it", async () => {
    const saved = await create();
    const foreignProject = await prisma.project.create({
      data: {
        organizationId: otherOrgId,
        name: "Foreign synthetic scope",
        slug: `${stamp}-scope`,
      },
    });
    const foreignPlan = await prisma.testPlan.create({
      data: { projectId: foreignProject.id, name: "Foreign scope sentinel" },
    });
    const localPlan = await prisma.testPlan.create({
      data: { projectId, name: "Retained original scope" },
    });
    try {
      for (const executionScope of [
        { planId: foreignPlan.id },
        { runId: "missing-native-run" },
      ])
        await expect(
          callers.owner.reportSnapshots.manageDefinition(
            change(saved.id, 1, {
              kind: "settings",
              definition: { ...definition, executionScope },
            }),
          ),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
      const scoped = change(saved.id, 1, {
        kind: "settings",
        definition: { ...definition, executionScope: { planId: localPlan.id } },
      });
      await callers.owner.reportSnapshots.manageDefinition(scoped);
      await callers.owner.reportSnapshots.manageDefinition(
        change(saved.id, 2, { kind: "settings", definition }),
      );
      await prisma.testPlan.delete({ where: { id: localPlan.id } });
      await expect(
        callers.owner.reportSnapshots.manageDefinition(
          change(saved.id, 3, {
            kind: "restore",
            receiptKey: key("owner", scoped.requestId),
            side: "after",
          }),
        ),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(
        (
          await callers.owner.reportSnapshots.definitionHistory({
            projectId,
            id: saved.id,
          })
        ).current,
      ).toMatchObject({ version: 3, definition });
      expect(
        (
          await prisma.testPlan.findUniqueOrThrow({
            where: { id: foreignPlan.id },
          })
        ).name,
      ).toBe("Foreign scope sentinel");
    } finally {
      await prisma.testPlan.deleteMany({
        where: { id: { in: [localPlan.id, foreignPlan.id] } },
      });
      await prisma.project.delete({ where: { id: foreignProject.id } });
    }
  });

  it("creates private retained history, exact retries apply once and changed retries conflict", async () => {
    const saved = await create();
    const history = await callers.owner.reportSnapshots.definitionHistory({
      projectId,
      id: saved.id,
    });
    expect(history.current.visibility).toBe("private");
    expect(history.items[0].before).toBeNull();
    expect(history.items[0].after?.definition.summary).toBe(definition.summary);
    const request = change(saved.id, saved.version, {
      kind: "rename",
      name: "Reviewed name",
    });
    expect(
      await callers.owner.reportSnapshots.manageDefinition(request),
    ).toMatchObject({ version: 2, replay: false });
    expect(
      await callers.owner.reportSnapshots.manageDefinition(request),
    ).toMatchObject({ version: 2, replay: true });
    await expect(
      callers.owner.reportSnapshots.manageDefinition({
        ...request,
        reason: "Changed",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      await prisma.projectReportDefinitionWrite.count({
        where: { definitionId: saved.id },
      }),
    ).toBe(2);
  });
  it("withholds personal definitions from same-tenant administrators/viewers and foreign tenants", async () => {
    const saved = await create();
    for (const actor of ["admin", "viewer", "other"]) {
      const list = await callers[actor].reportSnapshots
        .definitionCatalog({ projectId })
        .catch(() => null);
      expect(list?.items.some((row) => row.id === saved.id) ?? false).toBe(
        false,
      );
      await expect(
        callers[actor].reportSnapshots.definitionHistory({
          projectId,
          id: saved.id,
        }),
      ).rejects.toMatchObject({
        code: actor === "other" ? "FORBIDDEN" : "NOT_FOUND",
      });
    }
  });
  it("requires full-seat administrator and explicit sharing consent; private historical bodies stay author-only", async () => {
    const editor = await create("editor");
    await expect(
      callers.editor.reportSnapshots.manageDefinition(
        change(
          editor.id,
          editor.version,
          { kind: "visibility", visibility: "project" },
          { approveProjectSharing: true },
        ),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const saved = await create();
    await expect(
      callers.owner.reportSnapshots.manageDefinition(
        change(saved.id, saved.version, {
          kind: "visibility",
          visibility: "project",
        }),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const share = change(
      saved.id,
      saved.version,
      { kind: "visibility", visibility: "project" },
      { approveProjectSharing: true },
    );
    await callers.owner.reportSnapshots.manageDefinition(share);
    const history = await callers.viewer.reportSnapshots.definitionHistory({
      projectId,
      id: saved.id,
    });
    expect(history.current.definition.summary).toBe(definition.summary);
    expect(history.canManage).toBe(false);
    expect(
      history.items
        .flatMap((row) => [row.before, row.after])
        .filter(Boolean)
        .every((state) => state?.visibility === "project"),
    ).toBe(true);
    await expect(
      callers.admin.reportSnapshots.manageDefinition(
        change(saved.id, 2, {
          kind: "restore",
          receiptKey: key("owner", share.requestId),
          side: "before",
        }),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      callers.viewer.reportSnapshots.manageDefinition(
        change(saved.id, 2, { kind: "rename", name: "No" }),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("archives without deletion, blocks new captures using archived references, and restores as a new version", async () => {
    const saved = await create();
    const preview = await callers.owner.reportSnapshots.preview({
      projectId,
      requestId: randomUUID(),
      title: "Retained preview",
      definition,
      definitionId: saved.id,
    });
    const frozen = await prisma.projectReportSnapshot.findUniqueOrThrow({
      where: { id: preview.id },
    });
    const archive = change(saved.id, 1, { kind: "archive", archived: true });
    await callers.owner.reportSnapshots.manageDefinition(archive);
    expect(
      (await callers.owner.reportSnapshots.definitions({ projectId })).some(
        (row) => row.id === saved.id,
      ),
    ).toBe(false);
    expect(
      (
        await callers.owner.reportSnapshots.definitionCatalog({
          projectId,
          includeArchived: true,
        })
      ).items.some((row) => row.id === saved.id),
    ).toBe(true);
    await expect(
      callers.owner.reportSnapshots.preview({
        projectId,
        requestId: randomUUID(),
        title: "Refused archived capture",
        definition,
        definitionId: saved.id,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await callers.owner.reportSnapshots.manageDefinition(
      change(saved.id, 2, {
        kind: "restore",
        receiptKey: key("owner", archive.requestId),
        side: "before",
      }),
    );
    const current = await callers.owner.reportSnapshots.definitionHistory({
      projectId,
      id: saved.id,
    });
    expect(current.current).toMatchObject({ version: 3, archived: false });
    expect(current.items).toHaveLength(3);
    expect(
      (
        await prisma.projectReportSnapshot.findUniqueOrThrow({
          where: { id: preview.id },
        })
      ).payload,
    ).toEqual(frozen.payload);
  });
  it("rejects stale heads and no-op writes without creating a version", async () => {
    const saved = await create();
    const original = await prisma.projectReportDefinition.findUniqueOrThrow({
      where: { id: saved.id },
    });
    await expect(
      callers.owner.reportSnapshots.manageDefinition(
        change(saved.id, 1, { kind: "rename", name: original.name }),
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await callers.owner.reportSnapshots.manageDefinition(
      change(saved.id, 1, { kind: "rename", name: "Changed" }),
    );
    await expect(
      callers.owner.reportSnapshots.manageDefinition(
        change(saved.id, 1, { kind: "archive", archived: true }),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      (
        await prisma.projectReportDefinition.findUniqueOrThrow({
          where: { id: saved.id },
        })
      ).version,
    ).toBe(2);
  });
  it("refuses unavailable legacy bodies without inferred restoration", async () => {
    const saved = await create();
    const receiptKey = createHash("sha256").update(randomUUID()).digest("hex");
    await prisma.projectReportDefinitionWrite.create({
      data: {
        key: receiptKey,
        projectId,
        organizationId: orgId,
        actorId: ids.owner,
        requestHash: "legacy",
        definitionId: saved.id,
        appliedVersion: 1,
      },
    });
    await expect(
      callers.owner.reportSnapshots.manageDefinition(
        change(saved.id, 1, { kind: "restore", receiptKey, side: "after" }),
      ),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const history = await callers.owner.reportSnapshots.definitionHistory({
      projectId,
      id: saved.id,
    });
    expect(history.items.find((row) => row.key === receiptKey)).toMatchObject({
      before: null,
      after: null,
    });
  });
  it("requires current role on exact shared retries and original organization on every read", async () => {
    const saved = await create();
    const request = change(
      saved.id,
      1,
      { kind: "visibility", visibility: "project" },
      { approveProjectSharing: true },
    );
    await callers.owner.reportSnapshots.manageDefinition(request);
    await prisma.membership.update({
      where: {
        organizationId_userId: { organizationId: orgId, userId: ids.owner },
      },
      data: { role: "EDITOR" },
    });
    try {
      await expect(
        callers.owner.reportSnapshots.manageDefinition(request),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    } finally {
      await prisma.membership.update({
        where: {
          organizationId_userId: { organizationId: orgId, userId: ids.owner },
        },
        data: { role: "OWNER" },
      });
    }
    await prisma.projectReportDefinition.update({
      where: { id: saved.id },
      data: { organizationId: otherOrgId },
    });
    await expect(
      callers.owner.reportSnapshots.definitionHistory({
        projectId,
        id: saved.id,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(
      (await callers.owner.reportSnapshots.definitions({ projectId })).some(
        (row) => row.id === saved.id,
      ),
    ).toBe(false);
  });
  it("refuses unsupported or oversized retained bodies rather than partial restoration", async () => {
    const saved = await create();
    for (const body of [
      {
        name: "Unsupported",
        definition: { arbitrary: true },
        visibility: "private",
        archived: false,
        version: 1,
      },
      {
        name: "Large",
        definition: { ...definition, summary: "x".repeat(20000) },
        visibility: "private",
        archived: false,
        version: 1,
      },
    ]) {
      const receiptKey = createHash("sha256")
        .update(randomUUID())
        .digest("hex");
      await prisma.projectReportDefinitionWrite.create({
        data: {
          key: receiptKey,
          projectId,
          organizationId: orgId,
          actorId: ids.owner,
          requestHash: "fixture",
          definitionId: saved.id,
          appliedVersion: 1,
          afterState: body as Prisma.InputJsonValue,
        },
      });
      await expect(
        callers.owner.reportSnapshots.manageDefinition(
          change(saved.id, 1, { kind: "restore", receiptKey, side: "after" }),
        ),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    }
    expect(
      (
        await prisma.projectReportDefinition.findUniqueOrThrow({
          where: { id: saved.id },
        })
      ).version,
    ).toBe(1);
  });
  it("bounds scope labels on the server without changing selected native identities", async () => {
    const plan = await prisma.testPlan.create({
      data: { projectId, name: "P".repeat(500) },
    });
    const run = await prisma.testRun.create({
      data: {
        projectId,
        ciProvider: "C".repeat(500),
        branch: "fixture",
        commitSha: "fixture",
        startedAt: new Date(),
        status: "PARTIAL",
      },
    });
    try {
      const scope = await callers.owner.reportSnapshots.scopeOptions({
        projectId,
      });
      expect(scope.plans.find((item) => item.id === plan.id)).toMatchObject({
        name: "P".repeat(160),
        nameExcerpt: true,
      });
      expect(scope.runs.find((item) => item.id === run.id)).toMatchObject({
        ciProvider: "C".repeat(100),
        providerExcerpt: true,
      });
    } finally {
      await prisma.testRun.delete({ where: { id: run.id } });
      await prisma.testPlan.delete({ where: { id: plan.id } });
    }
  });
});
