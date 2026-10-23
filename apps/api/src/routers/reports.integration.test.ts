import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@vaettir/db";
import { reportsRouter } from "./reports.js";

const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
const disposable =
  url &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  /test/i.test(url.pathname) &&
  !url.searchParams.has("host");

describe.skipIf(!disposable)(
  "project report isolation and evidence totals",
  () => {
    const key = `report-${Date.now()}`;
    let orgA = "",
      orgB = "",
      projectA = "",
      projectB = "",
      ownerId = "",
      colleagueId = "",
      outsiderId = "",
      caseId = "",
      planId = "",
      planTypeId = "",
      requirementId = "";
    let caller: ReturnType<typeof reportsRouter.createCaller>;
    let outsider: ReturnType<typeof reportsRouter.createCaller>;

    beforeAll(async () => {
      const tier = await prisma.planTier.findUniqueOrThrow({
        where: { key: "free" },
      });
      const [a, b] = await Promise.all(
        ["a", "b"].map((suffix) =>
          prisma.organization.create({
            data: {
              name: `${key}-${suffix}`,
              slug: `${key}-${suffix}`,
              planTierId: tier.id,
            },
          }),
        ),
      );
      orgA = a.id;
      orgB = b.id;
      const [pa, pb] = await Promise.all([
        prisma.project.create({
          data: {
            organizationId: orgA,
            name: "Report project",
            slug: "report",
          },
        }),
        prisma.project.create({
          data: { organizationId: orgB, name: "Other tenant", slug: "other" },
        }),
      ]);
      projectA = pa.id;
      projectB = pb.id;
      const [owner, colleague, other] = await Promise.all([
        prisma.user.create({
          data: {
            clerkUserId: `${key}-owner`,
            email: `${key}-owner@example.com`,
            memberships: { create: { organizationId: orgA, role: "VIEWER" } },
          },
          include: { memberships: true },
        }),
        prisma.user.create({
          data: {
            clerkUserId: `${key}-colleague`,
            email: `${key}-colleague@example.com`,
            memberships: { create: { organizationId: orgA, role: "VIEWER" } },
          },
          include: { memberships: true },
        }),
        prisma.user.create({
          data: {
            clerkUserId: `${key}-other`,
            email: `${key}-other@example.com`,
            memberships: { create: { organizationId: orgB, role: "VIEWER" } },
          },
          include: { memberships: true },
        }),
      ]);
      ownerId = owner.id;
      colleagueId = colleague.id;
      outsiderId = other.id;
      caller = reportsRouter.createCaller({ prisma, user: owner });
      outsider = reportsRouter.createCaller({ prisma, user: other });
      const active = await prisma.testCase.create({
        data: {
          projectId: projectA,
          title: "Login",
          testType: "FUNCTIONAL",
          given: [],
          when: [],
          then: [],
          tags: ["auth smoke"],
          priority: "HIGH",
          riskAssessedAt: new Date(),
          riskScore: 80,
          riskSeverity: "HIGH",
        },
      });
      caseId = active.id;
      await prisma.testCase.create({
        data: {
          projectId: projectA,
          title: "Old",
          testType: "FUNCTIONAL",
          given: [],
          when: [],
          then: [],
          tags: ["legacy"],
          archived: true,
        },
      });
      await prisma.testCaseSource.create({
        data: {
          testCaseId: caseId,
          filePath: "tests/login.spec.ts",
          framework: "playwright",
        },
      });
      // A separate tenant's records must never appear in either totals or run references.
      await prisma.testCase.create({
        data: {
          projectId: projectB,
          title: "Private",
          testType: "FUNCTIONAL",
          given: [],
          when: [],
          then: [],
          tags: [],
        },
      });
      const type = await prisma.testPlanType.create({
        data: {
          key,
          name: "Report test type",
          category: "CUSTOM",
          fieldSchema: {},
        },
      });
      planTypeId = type.id;
      planId = (
        await prisma.testPlan.create({
          data: {
            projectId: projectA,
            testPlanTypeId: planTypeId,
            name: "Acceptance",
          },
        })
      ).id;
      requirementId = (
        await prisma.requirement.create({
          data: { projectId: projectA, title: "Sign in" },
        })
      ).id;
      await prisma.acceptanceCriterion.create({
        data: {
          testPlanId: planId,
          requirementId,
          description: "Login succeeds",
          status: "MET",
        },
      });
      await prisma.acceptanceCriterion.create({
        data: {
          testPlanId: planId,
          description: "General plan gate",
          status: "PENDING",
        },
      });
      await prisma.testRun.create({
        data: {
          projectId: projectA,
          ciProvider: "synthetic",
          commitSha: "abc",
          branch: "main",
          status: "FAILED",
          startedAt: new Date(),
          results: {
            create: [
              { testCaseId: caseId, status: "PASS" },
              { externalTestId: "unknown", status: "FAIL" },
              { externalTestId: "blocked", status: "BLOCKED" },
            ],
          },
        },
      });
      await prisma.testRun.create({
        data: {
          projectId: projectA,
          ciProvider: "synthetic",
          commitSha: "old",
          branch: "main",
          status: "PASSED",
          startedAt: new Date(Date.now() - 60 * 86_400_000),
          results: { create: [{ testCaseId: caseId, status: "PASS" }] },
        },
      });
      await prisma.testRun.create({
        data: {
          projectId: projectB,
          ciProvider: "synthetic",
          commitSha: "private",
          branch: "private",
          status: "FAILED",
          startedAt: new Date(),
          results: { create: [{ status: "FAIL" }] },
        },
      });
    });

    afterAll(async () => {
      if (!orgA || !orgB) return;
      await prisma.testResult.deleteMany({
        where: { testRun: { projectId: { in: [projectA, projectB] } } },
      });
      await prisma.testRun.deleteMany({
        where: { projectId: { in: [projectA, projectB] } },
      });
      await prisma.testCaseSource.deleteMany({ where: { testCaseId: caseId } });
      await prisma.testCaseView.deleteMany({
        where: { projectId: { in: [projectA, projectB] } },
      });
      await prisma.acceptanceCriterion.deleteMany({
        where: { testPlanId: planId },
      });
      await prisma.testPlan.deleteMany({ where: { id: planId } });
      await prisma.testPlanType.deleteMany({ where: { id: planTypeId } });
      await prisma.requirement.deleteMany({ where: { id: requirementId } });
      await prisma.testCase.deleteMany({
        where: { projectId: { in: [projectA, projectB] } },
      });
      await prisma.project.deleteMany({
        where: { id: { in: [projectA, projectB] } },
      });
      await prisma.membership.deleteMany({
        where: { organizationId: { in: [orgA, orgB] } },
      });
      await prisma.user.deleteMany({
        where: { id: { in: [ownerId, colleagueId, outsiderId] } },
      });
      await prisma.organization.deleteMany({
        where: { id: { in: [orgA, orgB] } },
      });
    });

    it("keeps current inventory separate from the execution window and excludes other tenants", async () => {
      const report = await caller.overview({
        projectId: projectA,
        windowDays: 30,
      });
      expect(report).toMatchObject({
        projectId: projectA,
        organizationId: orgA,
        clerkActorId: `${key}-owner`,
      });
      expect(report.inventory).toMatchObject({
        active: 1,
        archived: 1,
        withSource: 1,
        riskAssessed: 1,
      });
      expect(report.inventory.byPriority).toEqual([{ key: "HIGH", count: 1 }]);
      expect(report.requirements).toMatchObject({
        total: 1,
        withCriteria: 1,
        linkedCriteria: 1,
        criteria: [
          { key: "MET", count: 1 },
          { key: "PENDING", count: 1 },
        ],
      });
      expect(report.execution).toMatchObject({
        runs: 1,
        results: 3,
        matchedResults: 1,
      });
      expect(report.execution.byResultStatus).toEqual([
        { key: "BLOCKED", count: 1 },
        { key: "FAIL", count: 1 },
        { key: "PASS", count: 1 },
      ]);
      expect(report.recentRuns).toHaveLength(1);
      expect(report.recentRuns[0]?.commitSha).toBe("abc");
      const all = await caller.overview({
        projectId: projectA,
        windowDays: null,
      });
      expect(all.execution).toMatchObject({
        runs: 2,
        results: 4,
        matchedResults: 2,
      });
    });

    it("rejects another tenant and an unknown project before aggregating", async () => {
      await expect(
        outsider.overview({ projectId: projectA, windowDays: 30 }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        caller.overview({ projectId: projectB, windowDays: 30 }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        caller.overview({ projectId: "missing", windowDays: 30 }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("previews a typed case query with tag substring, source-derived suite and archive policy", async () => {
      const filters = {
        suitePath: "tests",
        search: "moke",
        type: "FUNCTIONAL",
        automation: "",
        priority: "HIGH",
        review: "",
        origin: "",
        sortBy: "title" as const,
        sortDescending: false,
        showArchived: false,
      };
      const report = await caller.overview({
        projectId: projectA,
        windowDays: 30,
        caseFilters: filters,
      });
      expect(report.caseQuery).toMatchObject({
        source: "preview",
        name: null,
        total: 1,
        active: 1,
        archived: 0,
        withSource: 1,
        sample: [{ id: caseId, title: "Login" }],
      });
      expect(report.inventory.active).toBe(1); // project-wide and separate from the scoped case query
      expect(report.execution.results).toBe(3); // execution is never silently narrowed by a case filter
      const unassigned = await caller.overview({
        projectId: projectA,
        windowDays: 30,
        caseFilters: {
          ...filters,
          suitePath: "__unassigned__",
          search: "",
          priority: "",
          showArchived: true,
        },
      });
      expect(unassigned.caseQuery).toMatchObject({
        total: 1,
        archived: 1,
        sample: [{ title: "Old" }],
      });
      await expect(
        caller.overview({
          projectId: projectA,
          windowDays: 30,
          caseFilters: { ...filters, unsafeWhere: projectB },
        }),
      ).rejects.toThrow();
    });

    it("rejects revoked membership and suspended organization despite a retained caller", async () => {
      await prisma.membership.delete({
        where: {
          organizationId_userId: { organizationId: orgA, userId: ownerId },
        },
      });
      try {
        await expect(
          caller.overview({ projectId: projectA }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
      } finally {
        await prisma.membership.create({
          data: { organizationId: orgA, userId: ownerId, role: "VIEWER" },
        });
      }
      await prisma.organization.update({
        where: { id: orgA },
        data: { suspendedAt: new Date() },
      });
      try {
        await expect(
          caller.overview({ projectId: projectA }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
      } finally {
        await prisma.organization.update({
          where: { id: orgA },
          data: { suspendedAt: null },
        });
      }
    });

    it("refuses actual reparenting between initial authorization and report transaction", async () => {
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: ownerId },
        include: { memberships: true },
      });
      let changed = 0;
      const scopedDb = new Proxy(prisma, {
        get(target, property, receiver) {
          const value = Reflect.get(target, property, receiver);
          if (property === "$transaction")
            return async (...args: unknown[]) => {
              changed++;
              await prisma.project.update({
                where: { id: projectA },
                data: { organizationId: orgB },
              });
              return value.apply(target, args);
            };
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      const racing = reportsRouter.createCaller({ prisma: scopedDb, user });
      try {
        await expect(
          racing.overview({ projectId: projectA }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
        expect(changed).toBe(1);
        expect(
          (await prisma.project.findUniqueOrThrow({ where: { id: projectA } }))
            .organizationId,
        ).toBe(orgB);
      } finally {
        await prisma.project.update({
          where: { id: projectA },
          data: { organizationId: orgA },
        });
      }
    });

    it("uses only the current user's saved query in the authorized project", async () => {
      const filters = {
        suitePath: null,
        search: "",
        type: "FUNCTIONAL",
        automation: "",
        priority: "",
        review: "",
        origin: "",
        sortBy: "title",
        sortDescending: false,
        showArchived: true,
      };
      const owned = await prisma.testCaseView.create({
        data: {
          projectId: projectA,
          userId: ownerId,
          name: "All functional",
          filters,
        },
      });
      const colleague = await prisma.testCaseView.create({
        data: {
          projectId: projectA,
          userId: colleagueId,
          name: "Private colleague view",
          filters,
        },
      });
      const report = await caller.overview({
        projectId: projectA,
        windowDays: 30,
        caseViewId: owned.id,
      });
      expect(report.caseQuery).toMatchObject({
        source: "saved",
        name: "All functional",
        total: 2,
        active: 1,
        archived: 1,
      });
      await expect(
        caller.overview({
          projectId: projectA,
          windowDays: 30,
          caseViewId: colleague.id,
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        outsider.overview({
          projectId: projectA,
          windowDays: 30,
          caseViewId: owned.id,
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        caller.overview({
          projectId: projectA,
          windowDays: 30,
          caseViewId: owned.id,
          caseFilters: filters,
        }),
      ).rejects.toThrow();
    });
  },
);
