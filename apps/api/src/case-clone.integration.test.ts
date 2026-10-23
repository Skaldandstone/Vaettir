import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { prisma, type PrismaClient, type Prisma } from "@vaettir/db";
import { appRouter } from "./router.js";
import { cloneCase } from "./services/caseClone.js";
import { hardDeleteOrganization } from "./services/orgHardDelete.js";
const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
const isolated =
  url &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  /test/i.test(url.pathname) &&
  !url.searchParams.has("host");
describe.skipIf(!isolated)("reviewed non-destructive case duplication", () => {
  const key = `clone-review-${randomUUID()}`;
  let owner: ReturnType<typeof appRouter.createCaller>,
    viewer: typeof owner,
    outsider: typeof owner;
  let organizationId: string,
    otherOrgId: string,
    projectId: string,
    otherProjectId: string,
    actorId: string;
  beforeAll(async () => {
    const tier = await prisma.planTier.findUniqueOrThrow({
      where: { key: "free" },
    });
    const org = await prisma.organization.create({
        data: { name: key, slug: key, planTierId: tier.id },
      }),
      other = await prisma.organization.create({
        data: {
          name: `${key}-other`,
          slug: `${key}-other`,
          planTierId: tier.id,
        },
      });
    organizationId = org.id;
    otherOrgId = other.id;
    async function caller(
      suffix: string,
      orgId: string,
      role: "OWNER" | "VIEWER",
    ) {
      const user = await prisma.user.create({
        data: {
          email: `${key}-${suffix}@example.com`,
          clerkUserId: `${key}-${suffix}`,
          memberships: {
            create: {
              organizationId: orgId,
              role,
              seatType: role === "OWNER" ? "FULL" : "READ_ONLY",
            },
          },
        },
        include: { memberships: true },
      });
      if (suffix === "owner") actorId = user.id;
      return appRouter.createCaller({ prisma, user });
    }
    owner = await caller("owner", org.id, "OWNER");
    viewer = await caller("viewer", org.id, "VIEWER");
    outsider = await caller("outsider", other.id, "OWNER");
    projectId = (
      await owner.project.create({
        organizationId,
        name: "Clone source",
        caseKey: "clone",
      })
    ).id;
    otherProjectId = (
      await outsider.project.create({
        organizationId: otherOrgId,
        name: "Outside",
        caseKey: "outside",
      })
    ).id;
  });
  afterAll(async () => {
    for (const id of [organizationId, otherOrgId].filter(Boolean)) {
      const org = await prisma.organization.findUnique({ where: { id } });
      if (!org?.slug.startsWith(key)) throw Error("Fixture ownership mismatch");
      await hardDeleteOrganization(
        prisma,
        id,
        actorId,
        "Owned clone fixture teardown",
      );
    }
  });
  async function newCase() {
    return owner.testCases.create({
      projectId,
      title: "Original λ case",
      background: "Setup\nsecond line",
      given: ["Given a|b"],
      when: ["When action\nsecond line"],
      then: ["Then expected"],
      steps: [
        {
          action: "Action\nnext",
          expectedActionOrData: "Input",
          expectedResult: "Result",
          expectedResponse: "Response",
        },
      ],
      testType: "FUNCTIONAL",
      priority: "HIGH",
      suitePath: "Source suite",
      tags: ["original"],
      validationDomain: "HIL",
      verificationProfile: {
        setup: "Rig",
        safety: "Isolation",
        instruments: "Meter",
        acceptanceCriteria: "Recorded bound",
      },
    });
  }
  async function attempt(caseId: string) {
    const preview = await owner.caseClone.preview({ projectId, caseId });
    return {
      projectId,
      caseId,
      expectedSourceRevision: preview.expectedSourceRevision,
      title: "Explicit copy",
      suitePath: "New suite",
      reason: "Reuse authored scenario in an independent case",
      confirmed: true as const,
      requestId: randomUUID(),
    };
  }
  it("copies supported authored content with a fresh stable ID and new version while leaving source intact", async () => {
    const source = await newCase(),
      before = await prisma.testCase.findUniqueOrThrow({
        where: { id: source.id },
      });
    const preview = await owner.caseClone.preview({
      projectId,
      caseId: source.id,
    });
    expect(preview.definition.given).toEqual(["Given a|b"]);
    const result = await owner.caseClone.create(await attempt(source.id));
    const copied = await prisma.testCase.findUniqueOrThrow({
      where: { id: result.caseId },
      include: { steps: true, versions: true },
    });
    expect(copied.id).not.toBe(source.id);
    expect(copied.displayId).not.toBe(source.displayId);
    expect(copied.displayId).toMatch(/^clone-\d+$/);
    expect(copied).toMatchObject({
      title: "Explicit copy",
      suitePath: "New suite",
      background: before.background,
      given: before.given,
      when: before.when,
      then: before.then,
      tags: before.tags,
      validationDomain: before.validationDomain,
      verificationProfile: before.verificationProfile,
      testType: before.testType,
      priority: before.priority,
      origin: "AUTHORED",
      automationStatus: "MANUAL",
      reviewStatus: "PENDING_REVIEW",
      riskScore: null,
      reviewedAt: null,
      testPlanId: null,
      sharedStepGroupId: null,
    });
    expect(copied.steps[0]).toMatchObject({
      action: "Action\nnext",
      expectedActionOrData: "Input",
      expectedResult: "Result",
      expectedResponse: "Response",
      mediaAttachmentIds: [],
    });
    expect(copied.versions).toHaveLength(1);
    expect(copied.versions[0].versionNumber).toBe(1);
    const another = await owner.caseClone.create(await attempt(source.id));
    expect(
      (
        await prisma.testCase.findUniqueOrThrow({
          where: { id: another.caseId },
        })
      ).sortPosition,
    ).toBeGreaterThan(copied.sortPosition);
    expect(
      await prisma.testCase.findUniqueOrThrow({ where: { id: source.id } }),
    ).toEqual(before);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: "TestCaseClone", entityId: copied.id },
    });
    expect(audit.metadata).toMatchObject({
      sourceCaseId: source.id,
      sourceDisplayId: source.displayId,
      reason: "Reuse authored scenario in an independent case",
    });
  });
  it("does not copy approvals, risk, paid drafts, import reconciliation, dependencies or media", async () => {
    const source = await newCase(),
      pre = await newCase();
    await prisma.testCase.update({
      where: { id: source.id },
      data: {
        origin: "IMPORTED",
        automationStatus: "AUTOMATED",
        reviewStatus: "APPROVED",
        reviewedById: actorId,
        reviewedAt: new Date(),
        reviewNote: "Original approval",
        riskScore: 90,
        riskSeverity: "CRITICAL",
        riskRationale: "Original risk",
        isFlaky: true,
        aiSnapshot: { title: "Original AI evidence" },
      },
    });
    const draft = await prisma.automationDraft.create({
      data: {
        testCaseId: source.id,
        framework: "JEST_VITEST",
        status: "READY",
        content: { code: "Synthetic paid draft" },
        createdById: actorId,
      },
    });
    const imported = await prisma.testCaseSource.create({
      data: {
        testCaseId: source.id,
        filePath: "synthetic.csv",
        framework: "synthetic",
        importSnapshot: { title: "Original import" },
      },
    });
    await prisma.testCasePrerequisite.create({
      data: {
        projectId,
        dependentId: source.id,
        prerequisiteId: pre.id,
        createdById: actorId,
      },
    });
    const media = await prisma.testCaseAttachment.create({
      data: {
        testCaseId: source.id,
        fileName: "synthetic.png",
        contentType: "image/png",
        sizeBytes: 4,
        storageUrl: "synthetic://local-not-fetched",
      },
    });
    await prisma.testCaseStep.updateMany({
      where: { testCaseId: source.id },
      data: { mediaAttachmentIds: [media.id] },
    });
    const before = await prisma.testCase.findUniqueOrThrow({
      where: { id: source.id },
    });
    const preview = await owner.caseClone.preview({
      projectId,
      caseId: source.id,
    });
    expect(preview.mediaReferencesExcluded).toBe(1);
    expect(preview.warnings.join(" ")).toContain("will be omitted");
    const result = await owner.caseClone.create(await attempt(source.id));
    const copied = await prisma.testCase.findUniqueOrThrow({
      where: { id: result.caseId },
      include: {
        source: true,
        attachments: true,
        prerequisites: true,
        automationDrafts: true,
        results: true,
        riskReviews: true,
        designReviews: true,
        traceabilityLinks: true,
        steps: true,
      },
    });
    expect(copied).toMatchObject({
      origin: "AUTHORED",
      automationStatus: "MANUAL",
      reviewStatus: "PENDING_REVIEW",
      reviewedById: null,
      reviewedAt: null,
      reviewNote: null,
      riskScore: null,
      riskSeverity: null,
      riskRationale: null,
      isFlaky: false,
      aiSnapshot: null,
      source: null,
      attachments: [],
      prerequisites: [],
      automationDrafts: [],
      results: [],
      riskReviews: [],
      designReviews: [],
      traceabilityLinks: [],
    });
    expect(copied.steps[0].mediaAttachmentIds).toEqual([]);
    expect(
      await prisma.testCase.findUniqueOrThrow({ where: { id: source.id } }),
    ).toEqual(before);
    expect(
      await prisma.automationDraft.findUnique({ where: { id: draft.id } }),
    ).toEqual(draft);
    expect(
      await prisma.testCaseSource.findUnique({ where: { id: imported.id } }),
    ).toEqual(imported);
    expect(
      await prisma.testCaseAttachment.findUnique({ where: { id: media.id } }),
    ).toEqual(media);
  });
  it("materializes only a same-project shared procedure and rejects changed library content", async () => {
    const source = await newCase(),
      group = await prisma.sharedStepGroup.create({
        data: {
          projectId,
          name: "Original library",
          steps: [
            {
              order: 0,
              action: "Shared action",
              expectedResult: "Shared result",
            },
          ],
        },
      });
    await prisma.testCase.update({
      where: { id: source.id },
      data: { sharedStepGroupId: group.id },
    });
    const input = await attempt(source.id),
      preview = await owner.caseClone.preview({ projectId, caseId: source.id });
    expect(preview.sharedProcedureMaterialized).toBe(true);
    const libraryReview = await owner.sharedStepGroups.review({ projectId, id: group.id });
    await owner.sharedStepGroups.update({ projectId, id: group.id, action: "UPDATE", expectedRevisionHash: libraryReview.revisionHash, requestId: randomUUID(), confirmed: true, reason: "Synthetic concurrent library edit", content: { name: libraryReview.snapshot.name, description: libraryReview.snapshot.description, steps: [{ order: 0, action: "Human-edited shared action" }] } });
    await expect(owner.caseClone.create(input)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    const result = await owner.caseClone.create(await attempt(source.id));
    const copied = await prisma.testCase.findUniqueOrThrow({
      where: { id: result.caseId },
      include: { steps: true },
    });
    expect(copied.sharedStepGroupId).toBeNull();
    expect(copied.steps[0].action).toBe("Human-edited shared action");
    expect(
      (await prisma.testCase.findUniqueOrThrow({ where: { id: source.id } }))
        .sharedStepGroupId,
    ).toBe(group.id);
    const foreign = await prisma.sharedStepGroup.create({
      data: {
        projectId: otherProjectId,
        name: "Outside",
        steps: [{ order: 0, action: "Private foreign content" }],
      },
    });
    await prisma.testCase.update({
      where: { id: source.id },
      data: { sharedStepGroupId: foreign.id },
    });
    await expect(
      owner.caseClone.preview({ projectId, caseId: source.id }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it("replays parallel identical requests once, conflicts altered identity, and allocates distinct IDs for explicit independent clones", async () => {
    const source = await newCase(),
      input = await attempt(source.id);
    const [first, retry] = await Promise.all([
      owner.caseClone.create(input),
      owner.caseClone.create(input),
    ]);
    expect(first.caseId).toBe(retry.caseId);
    expect([first.replayed, retry.replayed].sort()).toEqual([false, true]);
    await expect(
      owner.caseClone.create({ ...input, title: "Different title" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await prisma.testCase.update({
      where: { id: source.id },
      data: { given: ["Human changed after successful duplicate"] },
    });
    expect((await owner.caseClone.create(input)).caseId).toBe(first.caseId);
    const fresh = await attempt(source.id);
    const copies = await Promise.all([
      owner.caseClone.create(fresh),
      owner.caseClone.create({ ...fresh, requestId: randomUUID() }),
    ]);
    expect(new Set(copies.map((c) => c.displayId)).size).toBe(2);
    expect(new Set(copies.map((c) => c.caseId)).size).toBe(2);
    expect(
      await prisma.auditLog.count({
        where: {
          entityType: "TestCaseClone",
          projectId,
          metadata: { path: ["requestId"], equals: input.requestId },
        },
      }),
    ).toBe(1);
  });
  it("protects full-content CAS, missing/cross-project sources, viewer roles and current authorization on retries", async () => {
    const source = await newCase(),
      input = await attempt(source.id);
    const identicalDefinition = await newCase();
    await expect(
      owner.caseClone.create({ ...input, caseId: identicalDefinition.id }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await prisma.testCase.update({
      where: { id: source.id },
      data: { then: ["New human outcome"] },
    });
    await expect(owner.caseClone.create(input)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(
      viewer.caseClone.preview({ projectId, caseId: source.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      outsider.caseClone.preview({ projectId, caseId: source.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const sibling = await owner.project.create({
      organizationId,
      name: "Sibling",
      caseKey: "clonesibling",
    });
    await expect(
      owner.caseClone.preview({ projectId: sibling.id, caseId: source.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      owner.caseClone.preview({ projectId, caseId: "missing-synthetic" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const success = await attempt(source.id);
    await owner.caseClone.create(success);
    await prisma.membership.update({
      where: { organizationId_userId: { organizationId, userId: actorId } },
      data: { seatType: "READ_ONLY" },
    });
    try {
      await expect(owner.caseClone.create(success)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    } finally {
      await prisma.membership.update({
        where: { organizationId_userId: { organizationId, userId: actorId } },
        data: { seatType: "FULL" },
      });
    }
    await prisma.organization.update({
      where: { id: organizationId },
      data: { suspendedAt: new Date() },
    });
    try {
      await expect(owner.caseClone.create(success)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    } finally {
      await prisma.organization.update({
        where: { id: organizationId },
        data: { suspendedAt: null },
      });
    }
  });
  it("rechecks seat revocation after waiting for the project write lock", async () => {
    const source = await newCase(),
      input = await attempt(source.id);
    let release!: () => void, acquired!: () => void;
    const gate = new Promise<void>((r) => {
        release = r;
      }),
      held = new Promise<void>((r) => {
        acquired = r;
      });
    const lock = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${projectId}))::text`;
      acquired();
      await gate;
    });
    await held;
    const blocked = owner.caseClone.create(input);
    await prisma.membership.update({
      where: { organizationId_userId: { organizationId, userId: actorId } },
      data: { seatType: "READ_ONLY" },
    });
    release();
    await lock;
    try {
      await expect(blocked).rejects.toMatchObject({ code: "FORBIDDEN" });
    } finally {
      await prisma.membership.update({
        where: { organizationId_userId: { organizationId, userId: actorId } },
        data: { seatType: "FULL" },
      });
    }
  });
  it("rolls back new case, steps and version if durable audit persistence fails", async () => {
    const source = await newCase(),
      input = await attempt(source.id),
      count = await prisma.testCase.count({ where: { projectId } }),
      versions = await prisma.testCaseVersion.count({
        where: { testCase: { projectId } },
      });
    const db = new Proxy(prisma, {
      get(target, property) {
        if (property !== "$transaction") return Reflect.get(target, property);
        return (
          callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
          options: unknown,
        ) =>
          target.$transaction(
            (tx) =>
              callback(
                new Proxy(tx, {
                  get(inner, field) {
                    if (field !== "auditLog") return Reflect.get(inner, field);
                    return new Proxy(inner.auditLog, {
                      get(delegate, operation) {
                        if (operation !== "create")
                          return Reflect.get(delegate, operation);
                        return () => {
                          throw Error("Synthetic clone audit failure");
                        };
                      },
                    });
                  },
                }),
              ),
            options as never,
          );
      },
    }) as PrismaClient;
    await expect(cloneCase(db, actorId, input)).rejects.toThrow(
      "Synthetic clone audit failure",
    );
    expect(await prisma.testCase.count({ where: { projectId } })).toBe(count);
    expect(
      await prisma.testCaseVersion.count({
        where: { testCase: { projectId } },
      }),
    ).toBe(versions);
    expect(
      await prisma.auditLog.count({
        where: {
          entityType: "TestCaseClone",
          projectId,
          metadata: { path: ["requestId"], equals: input.requestId },
        },
      }),
    ).toBe(0);
  });
  it("requires reviewed approval and rejects archived, oversized or unsupported source definitions", async () => {
    const source = await newCase(),
      input = await attempt(source.id);
    await expect(
      owner.caseClone.create({ ...input, confirmed: false as never }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      owner.caseClone.create({ ...input, reason: " " }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await prisma.testCase.update({
      where: { id: source.id },
      data: { archived: true },
    });
    await expect(
      owner.caseClone.preview({ projectId, caseId: source.id }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await prisma.testCase.update({
      where: { id: source.id },
      data: { archived: false, background: "x".repeat(524289) },
    });
    await expect(
      owner.caseClone.preview({ projectId, caseId: source.id }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await prisma.testCase.update({
      where: { id: source.id },
      data: {
        background: null,
        verificationProfile: { unsupported: "Cannot reinterpret" },
      },
    });
    await expect(
      owner.caseClone.preview({ projectId, caseId: source.id }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
