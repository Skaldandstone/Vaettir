import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, type PrismaClient, type Prisma } from "@vaettir/db";
import { appRouter } from "./router.js";
import { snapshotTestCaseVersion } from "./services/testCaseVersion.js";
import { restoreCaseVersion } from "./services/caseVersionReview.js";
import { hardDeleteOrganization } from "./services/orgHardDelete.js";

const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
const isolated =
  url &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  /test/i.test(url.pathname) &&
  !url.searchParams.has("host");
describe.skipIf(!isolated)(
  "reviewed selective case version restoration",
  () => {
    const key = `version-review-${randomUUID()}`;
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
      });
      const other = await prisma.organization.create({
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
                seatType: role === "VIEWER" ? "READ_ONLY" : "FULL",
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
      outsider = await caller("outside", other.id, "OWNER");
      projectId = (
        await owner.project.create({
          organizationId,
          name: "Version review",
          caseKey: "restore",
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
        if (!org?.slug.startsWith(key))
          throw Error("Fixture ownership mismatch");
        await hardDeleteOrganization(
          prisma,
          id,
          actorId,
          "Owned version-review fixture teardown",
        );
      }
    });
    async function newCase() {
      return owner.testCases.create({
        projectId,
        title: "Original title",
        background: "Original setup",
        given: ["Given original"],
        when: ["When original"],
        then: ["Then original"],
        steps: [
          { action: "Original action", expectedResult: "Original expected" },
        ],
        priority: "HIGH",
        testType: "FUNCTIONAL",
        tags: ["original"],
      });
    }
    async function snapshot(id: string) {
      const current = await prisma.testCase.findUniqueOrThrow({
        where: { id },
        include: { steps: { orderBy: { order: "asc" } } },
      });
      await snapshotTestCaseVersion(prisma, {
        testCaseId: id,
        title: current.title,
        background: current.background,
        given: current.given,
        when: current.when,
        then: current.then,
        steps: current.steps.map((s) => ({
          order: s.order,
          action: s.action,
          expectedActionOrData: s.expectedActionOrData,
          expectedResult: s.expectedResult,
          expectedResponse: s.expectedResponse,
          mediaAttachmentIds: s.mediaAttachmentIds,
        })),
        priority: current.priority,
        testType: current.testType,
        tags: current.tags,
        actorId,
      });
    }
    async function change(id: string) {
      await prisma.testCase.update({
        where: { id },
        data: {
          title: "Later title",
          background: "Later setup",
          given: ["Given later"],
          when: ["When later"],
          then: ["Then later"],
          priority: "LOW",
          testType: "UNIT",
          tags: ["later"],
        },
      });
      await prisma.testCaseStep.updateMany({
        where: { testCaseId: id },
        data: { action: "Later action", expectedResult: "Later expected" },
      });
      await snapshot(id);
    }
    function scope(id: string, versionNumber = 1) {
      return { projectId, testCaseId: id, versionNumber };
    }
    async function attempt(
      id: string,
      fields: Array<
        | "title"
        | "background"
        | "given"
        | "when"
        | "then"
        | "steps"
        | "tags"
        | "priority"
        | "testType"
        | "validationDomain"
        | "verificationProfile"
      > = ["title"],
      versionNumber = 1,
    ) {
      const preview = await owner.caseVersionReview.preview(
        scope(id, versionNumber),
      );
      return {
        ...scope(id, versionNumber),
        fields,
        expectedCaseRevision: preview.expectedCaseRevision,
        expectedVersionRevision: preview.expectedVersionRevision,
        reason: "Explicit current business need and reviewed restore",
        confirmed: true as const,
        requestId: randomUUID(),
      };
    }
    it("compares exact BDD and structured procedure fields, then restores as a new immutable version", async () => {
      const c = await newCase();
      await change(c.id);
      const originals = await prisma.testCaseVersion.findMany({
        where: { testCaseId: c.id },
        orderBy: { versionNumber: "asc" },
      });
      const preview = await viewer.caseVersionReview.preview(scope(c.id));
      expect(preview.canRestore).toBe(false);
      expect(preview.fields.find((f) => f.key === "given")).toMatchObject({
        current: '[\n  "Given later"\n]',
        saved: '[\n  "Given original"\n]',
        changed: true,
        restorable: true,
      });
      const result = await owner.caseVersionReview.restore(
        await attempt(c.id, [
          "title",
          "background",
          "given",
          "when",
          "then",
          "steps",
          "tags",
          "priority",
          "testType",
        ]),
      );
      expect(result).toMatchObject({
        restoredVersionNumber: 1,
        createdVersionNumber: 3,
        replayed: false,
      });
      const current = await owner.testCases.byId({ id: c.id });
      expect(current).toMatchObject({
        displayId: result.displayId,
        title: "Original title",
        background: "Original setup",
        given: ["Given original"],
        when: ["When original"],
        then: ["Then original"],
        priority: "HIGH",
        testType: "FUNCTIONAL",
        tags: ["original"],
        steps: [{ action: "Original action" }],
      });
      expect(
        await prisma.testCaseVersion.findMany({
          where: { testCaseId: c.id, versionNumber: { lte: 2 } },
          orderBy: { versionNumber: "asc" },
        }),
      ).toEqual(originals);
      const audits = await prisma.auditLog.findMany({
        where: { entityId: c.id, entityType: "TestCaseVersionRestore" },
      });
      expect(audits).toHaveLength(1);
      expect(audits[0]?.actorId).toBe(actorId);
      const reloaded = await viewer.caseVersionReview.list({
        projectId,
        testCaseId: c.id,
      });
      expect(reloaded.restorationNotice).toContain("did not recertify");
      expect(reloaded.items[0]).toMatchObject({
        createdBy: { source: "CURRENT_PROFILE" },
        restoration: {
          restoredVersionNumber: 1,
          reason: "Explicit current business need and reviewed restore",
        },
      });
      const priorityAudit = await prisma.auditLog.findFirstOrThrow({
        where: { entityId: c.id, entityType: "TestCasePriority" },
        orderBy: { createdAt: "desc" },
      });
      expect(priorityAudit.metadata).toMatchObject({
        mode: "MANUAL",
        from: "LOW",
        to: "HIGH",
        rationale: "Explicit current business need and reviewed restore",
      });
    });
    it("preserves independent prerequisites, placement, approvals, provenance and paid drafts", async () => {
      const c = await newCase(),
        prerequisite = await newCase();
      await change(c.id);
      const draft = await prisma.automationDraft.create({
        data: {
          testCaseId: c.id,
          framework: "JEST_VITEST",
          status: "READY",
          content: { code: "Synthetic paid draft" },
          createdById: actorId,
        },
      });
      await prisma.testCasePrerequisite.create({
        data: {
          projectId,
          dependentId: c.id,
          prerequisiteId: prerequisite.id,
          createdById: actorId,
        },
      });
      await prisma.testCase.update({
        where: { id: c.id },
        data: {
          suitePath: "Current suite",
          archived: true,
          origin: "IMPORTED",
          reviewStatus: "APPROVED",
          reviewedById: actorId,
          reviewedAt: new Date("2026-01-02T00:00:00Z"),
          reviewNote: "Recorded human decision",
          riskScore: 80,
          riskRationale: "Recorded risk context",
        },
      });
      const before = await prisma.testCase.findUniqueOrThrow({
        where: { id: c.id },
      });
      const source = await prisma.testCaseSource.create({
        data: {
          testCaseId: c.id,
          filePath: "synthetic-import.csv",
          framework: "synthetic-import",
          importSnapshot: { title: "Imported original", sourceRow: 4 },
        },
      });
      await owner.caseVersionReview.restore(await attempt(c.id, ["title"]));
      const after = await prisma.testCase.findUniqueOrThrow({
        where: { id: c.id },
      });
      for (const field of [
        "displayId",
        "caseNumber",
        "suitePath",
        "testPlanId",
        "archived",
        "origin",
        "aiSnapshot",
        "reviewStatus",
        "reviewedById",
        "reviewedAt",
        "reviewNote",
        "riskScore",
        "riskRationale",
      ] as const)
        expect(after[field]).toEqual(before[field]);
      expect(
        await prisma.automationDraft.findUnique({ where: { id: draft.id } }),
      ).toEqual(draft);
      expect(
        await prisma.testCasePrerequisite.count({
          where: { dependentId: c.id },
        }),
      ).toBe(1);
      expect(
        await prisma.testCaseSource.findUnique({ where: { id: source.id } }),
      ).toEqual(source);
      expect(
        (await owner.caseVersionReview.preview(scope(c.id))).warnings.join(" "),
      ).toContain("may refer to other case content");
    });
    it("rejects intervening full-content human edits and changed saved snapshots", async () => {
      const c = await newCase();
      await change(c.id);
      const input = await attempt(c.id);
      await prisma.testCase.update({
        where: { id: c.id },
        data: { when: ["New human action"] },
      });
      await expect(
        owner.caseVersionReview.restore(input),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(
        (await prisma.testCase.findUniqueOrThrow({ where: { id: c.id } })).when,
      ).toEqual(["New human action"]);
      const input2 = await attempt(c.id);
      const version = await prisma.testCaseVersion.findUniqueOrThrow({
        where: {
          testCaseId_versionNumber: { testCaseId: c.id, versionNumber: 1 },
        },
      });
      // Synthetic corruption proves source-snapshot CAS without changing production history.
      await prisma.testCaseVersion.update({
        where: { id: version.id },
        data: { title: "Synthetic altered snapshot" },
      });
      await expect(
        owner.caseVersionReview.restore(input2),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(
        await prisma.testCaseVersion.count({ where: { testCaseId: c.id } }),
      ).toBe(2);
    });
    it("replays exact reviewed retries once and serializes concurrent competing restores", async () => {
      const c = await newCase();
      await change(c.id);
      const input = await attempt(c.id);
      const [a, b] = await Promise.all([
        owner.caseVersionReview.restore(input),
        owner.caseVersionReview.restore(input),
      ]);
      expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
      expect(a.createdVersionNumber).toBe(b.createdVersionNumber);
      expect(
        await prisma.testCaseVersion.count({ where: { testCaseId: c.id } }),
      ).toBe(3);
      await expect(
        owner.caseVersionReview.restore({
          ...input,
          reason: "Changed request",
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      await change(c.id);
      const first = await attempt(c.id),
        second = { ...first, requestId: randomUUID() };
      const outcomes = await Promise.allSettled([
        owner.caseVersionReview.restore(first),
        owner.caseVersionReview.restore(second),
      ]);
      expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
      expect(outcomes.find((o) => o.status === "rejected")).toMatchObject({
        reason: { code: "CONFLICT" },
      });
    });
    it("restores recorded owned step media but refuses unknown or foreign references", async () => {
      const c = await newCase();
      const image = await prisma.testCaseAttachment.create({
        data: {
          testCaseId: c.id,
          fileName: "synthetic.png",
          contentType: "image/png",
          storageUrl: "https://example.invalid/private",
          sizeBytes: 1,
        },
      });
      await prisma.testCaseStep.updateMany({
        where: { testCaseId: c.id },
        data: { mediaAttachmentIds: [image.id] },
      });
      await snapshot(c.id);
      await prisma.testCaseStep.updateMany({
        where: { testCaseId: c.id },
        data: { action: "Later action", mediaAttachmentIds: [] },
      });
      await snapshot(c.id);
      await owner.caseVersionReview.restore(await attempt(c.id, ["steps"], 2));
      expect(
        (await owner.testCases.byId({ id: c.id })).steps[0]?.mediaAttachmentIds,
      ).toEqual([image.id]);
      const original = await prisma.testCaseVersion.findUniqueOrThrow({
        where: {
          testCaseId_versionNumber: { testCaseId: c.id, versionNumber: 1 },
        },
      });
      await prisma.testCaseVersion.create({
        data: {
          testCaseId: c.id,
          versionNumber: 5,
          title: original.title,
          background: original.background,
          given: original.given,
          when: original.when,
          then: original.then,
          tags: original.tags,
          priority: original.priority,
          testType: original.testType,
          steps: [
            { order: 0, action: "Legacy action", expectedResult: "Expected" },
          ],
        },
      });
      const legacy = await owner.caseVersionReview.preview(scope(c.id, 5));
      expect(legacy.fields.find((f) => f.key === "steps")).toMatchObject({
        restorable: false,
      });
      await expect(
        owner.caseVersionReview.restore(await attempt(c.id, ["steps"], 5)),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      const otherCase = await newCase();
      const foreign = await prisma.testCaseAttachment.create({
        data: {
          testCaseId: otherCase.id,
          fileName: "other.png",
          contentType: "image/png",
          storageUrl: "https://example.invalid/other",
          sizeBytes: 1,
        },
      });
      await prisma.testCaseVersion.create({
        data: {
          testCaseId: c.id,
          versionNumber: 6,
          title: original.title,
          given: original.given,
          when: original.when,
          then: original.then,
          tags: original.tags,
          priority: original.priority,
          testType: original.testType,
          steps: [
            {
              order: 0,
              action: "Foreign-media action",
              mediaAttachmentIds: [foreign.id],
            },
          ],
        },
      });
      expect(
        (await owner.caseVersionReview.preview(scope(c.id, 6))).fields.find(
          (f) => f.key === "steps",
        )?.restorable,
      ).toBe(false);
      await expect(
        owner.caseVersionReview.restore(await attempt(c.id, ["steps"], 6)),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(
        await prisma.testCaseAttachment.count({ where: { id: image.id } }),
      ).toBe(1);
    });
    it("preserves shared libraries and unsupported older physical profile fields", async () => {
      const c = await newCase();
      await change(c.id);
      const group = await prisma.sharedStepGroup.create({
        data: {
          projectId,
          name: "Shared library",
          steps: [{ order: 0, action: "Current shared action" }],
        },
      });
      await prisma.testCase.update({
        where: { id: c.id },
        data: {
          sharedStepGroupId: group.id,
          validationDomain: "HIL",
          verificationProfile: {
            setup: "Current rig",
            safety: "Current safety",
            instruments: "Current instruments",
            acceptanceCriteria: "Current bounds",
          },
        },
      });
      const preview = await owner.caseVersionReview.preview(scope(c.id));
      for (const field of ["steps", "validationDomain", "verificationProfile"])
        expect(preview.fields.find((f) => f.key === field)?.restorable).toBe(
          false,
        );
      await owner.caseVersionReview.restore(await attempt(c.id));
      const current = await prisma.testCase.findUniqueOrThrow({
        where: { id: c.id },
      });
      expect(current).toMatchObject({
        sharedStepGroupId: group.id,
        validationDomain: "HIL",
        verificationProfile: { setup: "Current rig" },
      });
    });
    it("fails tenant/project/role gates and current-seat revocation during a lock wait", async () => {
      const c = await newCase();
      await change(c.id);
      const input = await attempt(c.id);
      await expect(
        viewer.caseVersionReview.restore(input),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        outsider.caseVersionReview.preview(scope(c.id)),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        owner.caseVersionReview.preview({
          ...scope(c.id),
          projectId: otherProjectId,
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      const sibling = await owner.project.create({
        organizationId,
        name: "Sibling",
        caseKey: "sibling",
      });
      await expect(
        owner.caseVersionReview.preview({
          ...scope(c.id),
          projectId: sibling.id,
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
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
      const blocked = owner.caseVersionReview.restore(input);
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
      expect(
        (await prisma.testCase.findUniqueOrThrow({ where: { id: c.id } }))
          .title,
      ).toBe("Later title");
    });
    it("rolls back case, steps and new version if audit persistence fails", async () => {
      const c = await newCase();
      await change(c.id);
      const input = await attempt(c.id, ["title", "steps"]);
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
                      if (field !== "auditLog")
                        return Reflect.get(inner, field);
                      return new Proxy(inner.auditLog, {
                        get(delegate, operation) {
                          if (operation !== "create")
                            return Reflect.get(delegate, operation);
                          return () => {
                            throw Error("Synthetic audit storage failure");
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
      await expect(restoreCaseVersion(db, actorId, input)).rejects.toThrow(
        "Synthetic audit storage failure",
      );
      const current = await owner.testCases.byId({ id: c.id });
      expect(current.title).toBe("Later title");
      expect(current.steps[0]?.action).toBe("Later action");
      expect(
        await prisma.testCaseVersion.count({ where: { testCaseId: c.id } }),
      ).toBe(2);
    });
    it("restores explicitly recorded physical profile fields and rejects an incomplete resulting procedure", async () => {
      const c = await owner.testCases.create({
        projectId,
        title: "Physical procedure",
        testType: "FUNCTIONAL",
        given: ["Rig prepared"],
        when: ["Measure"],
        then: ["Within limits"],
        validationDomain: "HIL",
        verificationProfile: {
          setup: "Recorded rig",
          safety: "Recorded safety",
          instruments: "Recorded meter",
          acceptanceCriteria: "Recorded bounds",
        },
      });
      await prisma.testCase.update({
        where: { id: c.id },
        data: {
          validationDomain: "SOFTWARE",
          verificationProfile: {
            setup: "Changed",
            safety: "",
            instruments: "",
            acceptanceCriteria: "",
          },
        },
      });
      await snapshot(c.id);
      await owner.caseVersionReview.restore(
        await attempt(c.id, ["validationDomain", "verificationProfile"]),
      );
      expect(
        await prisma.testCase.findUniqueOrThrow({ where: { id: c.id } }),
      ).toMatchObject({
        validationDomain: "HIL",
        verificationProfile: {
          setup: "Recorded rig",
          safety: "Recorded safety",
        },
      });
      const v = await prisma.testCaseVersion.findUniqueOrThrow({
        where: {
          testCaseId_versionNumber: { testCaseId: c.id, versionNumber: 1 },
        },
      });
      await prisma.testCaseVersion.create({
        data: {
          testCaseId: c.id,
          versionNumber: 4,
          title: v.title,
          given: [],
          when: [],
          then: [],
          steps: [],
          tags: [],
          priority: v.priority,
          testType: v.testType,
        },
      });
      const input = await attempt(c.id, ["given", "when", "then"], 4);
      await expect(
        owner.caseVersionReview.restore(input),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(
        (await prisma.testCase.findUniqueOrThrow({ where: { id: c.id } }))
          .given,
      ).toEqual(["Rig prepared"]);
      expect(
        await prisma.testCaseVersion.count({ where: { testCaseId: c.id } }),
      ).toBe(4);
    });
    it("requires live authorization and non-suspended organization even on successful-request replay", async () => {
      const c = await newCase();
      await change(c.id);
      const input = await attempt(c.id);
      await owner.caseVersionReview.restore(input);
      await prisma.organization.update({
        where: { id: organizationId },
        data: { suspendedAt: new Date() },
      });
      try {
        await expect(
          owner.caseVersionReview.restore(input),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
      } finally {
        await prisma.organization.update({
          where: { id: organizationId },
          data: { suspendedAt: null },
        });
      }
      await prisma.membership.delete({
        where: { organizationId_userId: { organizationId, userId: actorId } },
      });
      try {
        await expect(
          owner.caseVersionReview.restore(input),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
      } finally {
        await prisma.membership.create({
          data: {
            organizationId,
            userId: actorId,
            role: "OWNER",
            seatType: "FULL",
          },
        });
      }
      await expect(
        owner.caseVersionReview.restore({
          ...input,
          confirmed: false as never,
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(
        await prisma.testCaseVersion.count({ where: { testCaseId: c.id } }),
      ).toBe(3);
    });
    it("compares arbitrary saved pairs without reading current content or creating writes", async () => {
      const c = await newCase();
      await change(c.id);
      for (let i = 0; i < 23; i++) await snapshot(c.id);
      await prisma.testCase.update({
        where: { id: c.id },
        data: { title: "Unsaved newest title", background: "x".repeat(524289) },
      });
      const original = await prisma.testCase.findUniqueOrThrow({
        where: { id: c.id },
      });
      const versionsBefore = await prisma.testCaseVersion.findMany({
        where: { testCaseId: c.id },
        orderBy: { versionNumber: "asc" },
      });
      const auditBefore = await prisma.auditLog.count({
        where: { projectId, entityId: c.id },
      });
      const comparison = await viewer.caseVersionReview.compareHistorical({
        projectId,
        testCaseId: c.id,
        fromVersionNumber: 1,
        toVersionNumber: 25,
      });
      expect(comparison).toMatchObject({
        caseId: c.id,
        displayId: c.displayId,
        from: { versionNumber: 1 },
        to: { versionNumber: 25 },
      });
      expect(comparison.fields.find((f) => f.key === "title")).toMatchObject({
        changed: true,
        from: '"Original title"',
        to: '"Later title"',
      });
      expect(comparison.fields.find((f) => f.key === "given")).toMatchObject({
        from: '[\n  "Given original"\n]',
        to: '[\n  "Given later"\n]',
      });
      expect(comparison.fields.find((f) => f.key === "steps")!.from).toContain(
        "Original action",
      );
      expect(comparison.fields.find((f) => f.key === "steps")!.to).toContain(
        "Later expected",
      );
      expect(JSON.stringify(comparison)).not.toContain("Unsaved newest title");
      expect(comparison).not.toHaveProperty("expectedCaseRevision");
      expect(comparison).not.toHaveProperty("expectedVersionRevision");
      expect(comparison).not.toHaveProperty("canRestore");
      const reversed = await owner.caseVersionReview.compareHistorical({
        projectId,
        testCaseId: c.id,
        fromVersionNumber: 25,
        toVersionNumber: 1,
      });
      expect(reversed.fields.find((f) => f.key === "title")).toMatchObject({
        from: '"Later title"',
        to: '"Original title"',
      });
      const identical = await viewer.caseVersionReview.compareHistorical({
        projectId,
        testCaseId: c.id,
        fromVersionNumber: 25,
        toVersionNumber: 25,
      });
      expect(identical.fields.every((f) => !f.changed)).toBe(true);
      expect(
        await prisma.testCase.findUniqueOrThrow({ where: { id: c.id } }),
      ).toEqual(original);
      expect(
        await prisma.testCaseVersion.findMany({
          where: { testCaseId: c.id },
          orderBy: { versionNumber: "asc" },
        }),
      ).toEqual(versionsBefore);
      expect(
        await prisma.auditLog.count({ where: { projectId, entityId: c.id } }),
      ).toBe(auditBefore);
    });
    it("scopes both historical selections to the same case and freshly authorized project", async () => {
      const c = await newCase(),
        other = await newCase();
      await change(other.id);
      const pair = {
        projectId,
        testCaseId: c.id,
        fromVersionNumber: 1,
        toVersionNumber: 2,
      };
      await expect(
        owner.caseVersionReview.compareHistorical(pair),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        owner.caseVersionReview.compareHistorical({
          ...pair,
          fromVersionNumber: 2,
          toVersionNumber: 1,
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        outsider.caseVersionReview.compareHistorical({
          ...pair,
          toVersionNumber: 1,
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      const sibling = await owner.project.create({
        organizationId,
        name: "Sibling version project",
        caseKey: `sibling${randomUUID().slice(0, 8)}`,
      });
      await expect(
        owner.caseVersionReview.compareHistorical({
          ...pair,
          projectId: sibling.id,
          toVersionNumber: 1,
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        owner.caseVersionReview.compareHistorical({
          ...pair,
          projectId: otherProjectId,
          toVersionNumber: 1,
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await prisma.organization.update({
        where: { id: organizationId },
        data: { suspendedAt: new Date() },
      });
      try {
        await expect(
          viewer.caseVersionReview.compareHistorical({
            ...pair,
            toVersionNumber: 1,
          }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
      } finally {
        await prisma.organization.update({
          where: { id: organizationId },
          data: { suspendedAt: null },
        });
      }
      await prisma.membership.delete({
        where: { organizationId_userId: { organizationId, userId: actorId } },
      });
      try {
        await expect(
          owner.caseVersionReview.compareHistorical({
            ...pair,
            toVersionNumber: 1,
          }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
      } finally {
        await prisma.membership.create({
          data: {
            organizationId,
            userId: actorId,
            role: "OWNER",
            seatType: "FULL",
          },
        });
      }
    });
    it("bounds historical version inputs and either snapshot before loading procedures", async () => {
      const c = await newCase();
      await change(c.id);
      const pair = {
        projectId,
        testCaseId: c.id,
        fromVersionNumber: 1,
        toVersionNumber: 2,
      };
      for (const bad of [0, -1, 1.5, 2147483648, Number.MAX_SAFE_INTEGER]) {
        await expect(
          viewer.caseVersionReview.compareHistorical({
            ...pair,
            fromVersionNumber: bad,
          }),
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });
        await expect(
          viewer.caseVersionReview.compareHistorical({
            ...pair,
            toVersionNumber: bad,
          }),
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      }
      await expect(
        viewer.caseVersionReview.compareHistorical({
          ...pair,
          toVersionNumber: 2147483647,
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        viewer.caseVersionReview.compareHistorical({
          ...pair,
          expectedCaseRevision: "a".repeat(64),
        } as never),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await prisma.testCaseVersion.update({
        where: {
          testCaseId_versionNumber: { testCaseId: c.id, versionNumber: 1 },
        },
        data: { background: "x".repeat(524289) },
      });
      await expect(
        viewer.caseVersionReview.compareHistorical(pair),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(
        viewer.caseVersionReview.compareHistorical({
          ...pair,
          fromVersionNumber: 2,
          toVersionNumber: 1,
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(
        (
          await viewer.caseVersionReview.compareHistorical({
            ...pair,
            fromVersionNumber: 2,
          })
        ).fields.every((f) => !f.changed),
      ).toBe(true);
    });
    it("historical comparison cannot substitute for a fresh target-to-current restore review", async () => {
      const c = await newCase();
      await change(c.id);
      const historical = await owner.caseVersionReview.compareHistorical({
        projectId,
        testCaseId: c.id,
        fromVersionNumber: 2,
        toVersionNumber: 1,
      });
      await expect(
        owner.caseVersionReview.restore({
          ...historical,
          projectId,
          testCaseId: c.id,
          versionNumber: 1,
          fields: ["title"],
          reason: "Reviewed old wording",
          confirmed: true,
          requestId: randomUUID(),
        } as never),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      const stale = await attempt(c.id);
      await prisma.testCase.update({
        where: { id: c.id },
        data: { title: "Concurrent human title" },
      });
      await expect(
        owner.caseVersionReview.restore(stale),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      await owner.caseVersionReview.restore(await attempt(c.id));
      expect(
        (await prisma.testCase.findUniqueOrThrow({ where: { id: c.id } }))
          .title,
      ).toBe("Original title");
      expect(
        await prisma.testCaseVersion.count({ where: { testCaseId: c.id } }),
      ).toBe(3);
    });
    it("bounds metadata paging and oversized comparisons without inventing history", async () => {
      const c = await newCase();
      for (let i = 0; i < 24; i++) await snapshot(c.id);
      const first = await viewer.caseVersionReview.list({
        projectId,
        testCaseId: c.id,
        take: 10,
      });
      const second = await viewer.caseVersionReview.list({
        projectId,
        testCaseId: c.id,
        take: 10,
        before: first.nextCursor!,
      });
      const third = await viewer.caseVersionReview.list({
        projectId,
        testCaseId: c.id,
        take: 10,
        before: second.nextCursor!,
      });
      expect(
        [...first.items, ...second.items, ...third.items].map(
          (v) => v.versionNumber,
        ),
      ).toEqual(Array.from({ length: 25 }, (_, i) => 25 - i));
      expect(third.nextCursor).toBeNull();
      expect(JSON.stringify(first)).not.toContain("Original action");
      await expect(
        viewer.caseVersionReview.list({
          projectId,
          testCaseId: c.id,
          take: 21,
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(
        viewer.caseVersionReview.list({
          projectId,
          testCaseId: c.id,
          before: 9999,
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await prisma.testCase.update({
        where: { id: c.id },
        data: { background: "x".repeat(524289) },
      });
      await expect(
        viewer.caseVersionReview.preview(scope(c.id)),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  },
);
