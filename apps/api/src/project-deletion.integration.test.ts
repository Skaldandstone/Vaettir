import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { prisma } from "@vaettir/db";
import { appRouter } from "./router.js";
import { assertOwnedTestDatabase } from "./testOnlyDatabaseSafety.js";
import {
  deleteReviewedProject,
  previewProjectDeletion,
} from "./services/projectDeletion.js";

const isolated = (() => {
  try {
    assertOwnedTestDatabase(process.env.DATABASE_URL);
    return true;
  } catch {
    /* dedicated retained local fixture below */
  }
  try {
    const url = new URL(process.env.DATABASE_URL ?? "");
    return (
      url.protocol === "postgresql:" &&
      url.hostname === "127.0.0.1" &&
      url.port === "55439" &&
      /^\/vaettir_project_deletion_test_[0-9]{13}$/.test(url.pathname) &&
      !url.hash &&
      url.search === "?schema=public&connection_limit=5"
    );
  } catch {
    return false;
  }
})();
describe.skipIf(!isolated)(
  "reviewed project deletion on an owned synthetic database",
  () => {
    const tag = "project-delete-" + randomUUID();
    let tierId: string;
    beforeAll(async () => {
      tierId = (
        await prisma.planTier.create({
          data: { key: tag, name: tag, sortOrder: 0, minFullSeats: 0 },
        })
      ).id;
    });
    afterAll(async () => {
      await prisma.$disconnect();
    });
    async function fixture() {
      const unique = randomUUID();
      const org = await prisma.organization.create({
        data: { name: tag, slug: unique, planTierId: tierId },
      });
      const user = await prisma.user.create({
        data: {
          clerkUserId: unique,
          email: unique + "@example.invalid",
          memberships: {
            create: { organizationId: org.id, role: "OWNER", seatType: "FULL" },
          },
        },
        include: { memberships: true },
      });
      const caller = appRouter.createCaller({
        prisma,
        user,
        authenticatedClerkSubject: unique,
      });
      const project = await caller.project.create({
        organizationId: org.id,
        name: "Synthetic deletion " + unique,
      });
      const actor = { id: user.id, clerkSubject: unique };
      return { org, user, project, caller, actor };
    }
    async function request(f: Awaited<ReturnType<typeof fixture>>) {
      const preview = await f.caller.project.deletionPreview({
        id: f.project.id,
      });
      return {
        id: f.project.id,
        organizationId: f.org.id,
        expectedName: preview.name,
        previewFingerprint: preview.fingerprint,
        includeContents: true,
        requestId: randomUUID(),
      };
    }
    async function addImport(projectId: string) {
      return prisma.importJob.create({
        data: {
          projectId,
          source: "CSV",
          fieldMapping: {},
          status: "SUCCEEDED",
        },
      });
    }
    it("removes reviewed ordinary contents atomically, retains audit/key history and replays the exact receipt", async () => {
      const f = await fixture(),
        untouched = await fixture();
      const type = await prisma.testPlanType.create({
        data: {
          key: randomUUID(),
          name: "Synthetic",
          category: "FUNCTIONAL",
          fieldSchema: {},
        },
      });
      const plan = await prisma.testPlan.create({
        data: {
          projectId: f.project.id,
          testPlanTypeId: type.id,
          name: "Synthetic plan",
        },
      });
      const requirement = await prisma.requirement.create({
        data: { projectId: f.project.id, title: "Synthetic requirement" },
      });
      await prisma.acceptanceCriterion.create({
        data: {
          testPlanId: plan.id,
          requirementId: requirement.id,
          description: "Synthetic criterion",
        },
      });
      const testCase = await prisma.testCase.create({
        data: {
          projectId: f.project.id,
          testPlanId: plan.id,
          title: "Synthetic case",
          testType: "FUNCTIONAL",
        },
      });
      await prisma.testCaseDataset.create({
        data: { testCaseId: testCase.id, parameterNames: [], rows: [] },
      });
      await addImport(f.project.id);
      await prisma.testRun.create({
        data: {
          projectId: f.project.id,
          ciProvider: "synthetic",
          commitSha: "synthetic",
          branch: "synthetic",
          startedAt: new Date(),
          status: "PASSED",
        },
      });
      const audit = await prisma.auditLog.create({
        data: {
          organizationId: f.org.id,
          projectId: f.project.id,
          actorId: f.user.id,
          entityType: "Project",
          entityId: f.project.id,
          action: "CREATE",
          summary: "Synthetic history",
        },
      });
      const aliases = await prisma.projectCaseKeyAlias.findMany({
        where: { projectId: f.project.id },
      });
      const foreignBefore = await prisma.project.findUniqueOrThrow({
        where: { id: untouched.project.id },
      });
      const preview = await f.caller.project.deletionPreview({
        id: f.project.id,
      });
      expect(preview).toMatchObject({ blocked: false, hasContents: true });
      expect(preview.rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ key: "testCases", count: 1 }),
          expect.objectContaining({ key: "testRuns", count: 1 }),
          expect.objectContaining({ key: "importJobs", count: 1 }),
        ]),
      );
      const input = await request(f);
      const result = await f.caller.project.deleteReviewed(input);
      expect(result.replayed).toBe(false);
      expect(
        await prisma.project.findUnique({ where: { id: f.project.id } }),
      ).toBeNull();
      expect(
        await prisma.testCase.findUnique({ where: { id: testCase.id } }),
      ).toBeNull();
      expect(
        await prisma.importJob.count({ where: { projectId: f.project.id } }),
      ).toBe(0);
      expect(
        await prisma.testRun.count({ where: { projectId: f.project.id } }),
      ).toBe(0);
      expect(
        await prisma.auditLog.findUnique({ where: { id: audit.id } }),
      ).toEqual({ ...audit, projectId: null });
      expect(
        await prisma.projectCaseKeyAlias.findMany({
          where: { projectId: f.project.id },
        }),
      ).toEqual(aliases);
      expect(
        await prisma.project.findUnique({
          where: { id: untouched.project.id },
        }),
      ).toEqual(foreignBefore);
      await expect(f.caller.project.deleteReviewed(input)).resolves.toEqual({
        ...result,
        replayed: true,
      });
      await expect(
        f.caller.project.deleteReviewed({ ...input, includeContents: false }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });
    it("requires contents opt-in and a fresh matching project review, before any writes", async () => {
      const f = await fixture();
      await addImport(f.project.id);
      const input = await request(f);
      await expect(
        f.caller.project.deleteReviewed({ ...input, includeContents: false }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(
        f.caller.project.deleteReviewed({
          ...input,
          expectedName: "Different name",
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      await addImport(f.project.id);
      await expect(
        f.caller.project.deleteReviewed(input),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(
        await prisma.importJob.count({ where: { projectId: f.project.id } }),
      ).toBe(2);
      expect(
        await prisma.project.findUnique({ where: { id: f.project.id } }),
      ).not.toBeNull();
    });
    it("identifies recorded evidence before confirmation and never erases it", async () => {
      const f = await fixture();
      await addImport(f.project.id);
      const run = await prisma.testRun.create({
        data: {
          projectId: f.project.id,
          ciProvider: "synthetic",
          commitSha: "synthetic",
          branch: "synthetic",
          startedAt: new Date(),
          status: "PASSED",
        },
      });
      const result = await prisma.testResult.create({
        data: {
          testRunId: run.id,
          externalTestId: "Synthetic result",
          status: "PASS",
          durationMs: 1,
        },
      });
      const before = await prisma.testResult.findUnique({
        where: { id: result.id },
      });
      const preview = await f.caller.project.deletionPreview({
        id: f.project.id,
      });
      expect(preview.blocked).toBe(true);
      expect(preview.rows).toContainEqual(
        expect.objectContaining({
          key: "recordedResults",
          count: 1,
          blocksDeletion: true,
        }),
      );
      await expect(
        f.caller.project.deleteReviewed(await request(f)),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(
        await prisma.testResult.findUnique({ where: { id: result.id } }),
      ).toEqual(before);
      expect(
        await prisma.importJob.count({ where: { projectId: f.project.id } }),
      ).toBe(1);
    });
    it("refreshes administrator authority, seat, suspension and independently authenticated actor", async () => {
      const f = await fixture(),
        input = await request(f);
      await prisma.membership.update({
        where: {
          organizationId_userId: {
            organizationId: f.org.id,
            userId: f.user.id,
          },
        },
        data: { role: "VIEWER" },
      });
      await expect(
        f.caller.project.deleteReviewed(input),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await prisma.membership.update({
        where: {
          organizationId_userId: {
            organizationId: f.org.id,
            userId: f.user.id,
          },
        },
        data: { role: "OWNER", seatType: "READ_ONLY" },
      });
      await expect(
        f.caller.project.deleteReviewed(input),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await prisma.membership.update({
        where: {
          organizationId_userId: {
            organizationId: f.org.id,
            userId: f.user.id,
          },
        },
        data: { seatType: "FULL" },
      });
      await prisma.organization.update({
        where: { id: f.org.id },
        data: { suspendedAt: new Date() },
      });
      await expect(
        f.caller.project.deleteReviewed(input),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      const service = appRouter.createCaller({
        prisma,
        user: f.user,
        authenticatedClerkSubject: null,
      });
      await expect(service.project.deleteReviewed(input)).rejects.toMatchObject(
        { code: "FORBIDDEN" },
      );
      await expect(
        deleteReviewedProject(
          prisma,
          { ...f.actor, workspaceOrganizationId: "another-workspace" },
          input,
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
    it("does not clear another project's optional links during deletion", async () => {
      const f = await fixture(),
        foreign = await fixture();
      const type = await prisma.testPlanType.findFirstOrThrow();
      const plan = await prisma.testPlan.create({
        data: {
          projectId: f.project.id,
          name: "Linked synthetic plan",
          testPlanTypeId: type.id,
        },
      });
      const testCase = await prisma.testCase.create({
        data: {
          projectId: foreign.project.id,
          title: "Foreign synthetic case",
          testType: "FUNCTIONAL",
          testPlanId: plan.id,
        },
      });
      const before = await prisma.testCase.findUnique({
        where: { id: testCase.id },
      });
      expect(
        (await previewProjectDeletion(prisma, f.project.id)).rows,
      ).toContainEqual(
        expect.objectContaining({ key: "foreignLinks", blocksDeletion: true }),
      );
      await expect(
        f.caller.project.deleteReviewed(await request(f)),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(
        await prisma.testCase.findUnique({ where: { id: testCase.id } }),
      ).toEqual(before);
    });
    it("rolls every child removal back when the durable receipt fails", async () => {
      const f = await fixture();
      const imported = await addImport(f.project.id);
      const input = await request(f);
      const failing = new Proxy(prisma, {
        get(target, key) {
          if (key === "$transaction")
            return (
              work: Parameters<typeof prisma.$transaction>[0],
              options: object,
            ) =>
              prisma.$transaction(async (tx) => {
                const injected = new Proxy(tx, {
                  get(value, field) {
                    return field === "auditLog"
                      ? {
                          ...value.auditLog,
                          create: async () => {
                            throw Error("Synthetic receipt failure");
                          },
                        }
                      : Reflect.get(value, field);
                  },
                });
                return (
                  work as unknown as (value: typeof tx) => Promise<unknown>
                )(injected);
              }, options);
          return Reflect.get(target, key);
        },
      });
      await expect(
        deleteReviewedProject(failing, f.actor, input),
      ).rejects.toThrow("Synthetic receipt failure");
      expect(
        await prisma.project.findUnique({ where: { id: f.project.id } }),
      ).not.toBeNull();
      expect(
        await prisma.importJob.findUnique({ where: { id: imported.id } }),
      ).toEqual(imported);
      expect(
        await prisma.auditLog.findUnique({
          where: { id: "project-deletion:" + input.requestId },
        }),
      ).toBeNull();
    });
  },
);
