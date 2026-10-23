import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma, prisma } from "@vaettir/db";
import { readReportPlanCaseScope } from "./services/reportPlanCaseScope.js";
// SOURCE ONLY: synthetic disposable DB, no auth/provider/customer use or execution.
describe("same-project current plan report cohort", () => {
  let orgId: string,
    projectId: string,
    foreignProjectId: string,
    typeId: string,
    planA: string,
    planB: string,
    foreignPlan: string,
    linkedId: string,
    savedId: string,
    archivedId: string;
  const template = (testCaseIds: string[]) => ({
    version: 1,
    testCaseIds,
    configurations: [],
  });
  const read = (planIds: string[], project = projectId) =>
    prisma.$transaction(
      async (tx) => {
        // The real resolver owns fresh tenant/role authorization; these fixtures
        // exercise only its locked repeatable-read helper contract.
        await tx.$queryRaw`SELECT id FROM "Project" WHERE id=${project} FOR SHARE`;
        if (planIds.length)
          await tx.$queryRaw(
            Prisma.sql`SELECT id FROM "TestPlan" WHERE id IN (${Prisma.join(planIds)}) ORDER BY id FOR SHARE`,
          );
        return readReportPlanCaseScope(tx, project, planIds);
      },
      { isolationLevel: "RepeatableRead", timeout: 20000 },
    );
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
    if (
      !["localhost", "127.0.0.1"].includes(url.hostname) ||
      !/test/i.test(url.pathname) ||
      url.searchParams.has("host")
    )
      throw Error("Unique disposable loopback test database required");
    const tier = await prisma.planTier.findUniqueOrThrow({
      where: { key: "free" },
    });
    orgId = (
      await prisma.organization.create({
        data: {
          name: "Synthetic report cohort",
          slug: randomUUID(),
          planTierId: tier.id,
        },
      })
    ).id;
    projectId = (
      await prisma.project.create({
        data: {
          organizationId: orgId,
          name: "Synthetic scoped cohort",
          slug: randomUUID(),
        },
      })
    ).id;
    foreignProjectId = (
      await prisma.project.create({
        data: {
          organizationId: orgId,
          name: "Synthetic other project",
          slug: randomUUID(),
        },
      })
    ).id;
    typeId = (
      await prisma.testPlanType.create({
        data: {
          key: `synthetic-cohort-${randomUUID()}`,
          name: "Synthetic cohort type",
          category: "FUNCTIONAL",
          fieldSchema: {},
        },
      })
    ).id;
    planA = (
      await prisma.testPlan.create({
        data: { projectId, testPlanTypeId: typeId, name: "Synthetic plan A" },
      })
    ).id;
    planB = (
      await prisma.testPlan.create({
        data: { projectId, testPlanTypeId: typeId, name: "Synthetic plan B" },
      })
    ).id;
    foreignPlan = (
      await prisma.testPlan.create({
        data: {
          projectId: foreignProjectId,
          testPlanTypeId: typeId,
          name: "Synthetic foreign plan",
        },
      })
    ).id;
    linkedId = (
      await prisma.testCase.create({
        data: {
          projectId,
          testPlanId: planA,
          title: "Synthetic linked case",
          testType: "FUNCTIONAL",
          given: ["Private setup not projected"],
          when: [],
          then: [],
          tags: [],
        },
      })
    ).id;
    savedId = (
      await prisma.testCase.create({
        data: {
          projectId,
          title: "Synthetic saved-only case",
          testType: "FUNCTIONAL",
          given: [],
          when: [],
          then: [],
          tags: [],
        },
      })
    ).id;
    archivedId = (
      await prisma.testCase.create({
        data: {
          projectId,
          testPlanId: planB,
          title: "Synthetic retained archived case",
          archived: true,
          testType: "FUNCTIONAL",
          given: [],
          when: [],
          then: [],
          tags: [],
        },
      })
    ).id;
  });
  afterAll(async () => {
    const ownedProjects = [projectId, foreignProjectId].filter(
      (id): id is string => typeof id === "string",
    );
    if (ownedProjects.length) {
      await prisma.testCase.deleteMany({
        where: { projectId: { in: ownedProjects } },
      });
      await prisma.testPlan.deleteMany({
        where: { projectId: { in: ownedProjects } },
      });
      await prisma.project.deleteMany({
        where: { id: { in: ownedProjects }, organizationId: orgId },
      });
    }
    if (orgId) await prisma.organization.deleteMany({ where: { id: orgId } });
    if (typeId) await prisma.testPlanType.deleteMany({ where: { id: typeId } });
  });
  it("retains legacy directly linked scopes and returns only identities plus explicit limitations", async () => {
    expect(await read([])).toMatchObject({ caseIds: [] });
    const result = await read([planA]);
    expect(result.caseIds).toEqual([linkedId]);
    expect(Object.keys(result).sort()).toEqual(["caseIds", "limitations"]);
    expect(JSON.stringify(result)).not.toContain("Private setup not projected");
  });
  it("unions saved and linked cases across selected plans without silently dropping archived cases", async () => {
    await prisma.testPlan.update({
      where: { id: planA },
      data: { executionTemplate: template([linkedId, savedId]) },
    });
    await prisma.testPlan.update({
      where: { id: planB },
      data: { executionTemplate: template([savedId, archivedId]) },
    });
    const result = await read([planB, planA]);
    expect(new Set(result.caseIds)).toEqual(
      new Set([linkedId, savedId, archivedId]),
    );
    expect(result.caseIds).toHaveLength(3);
    expect(
      result.limitations.some((value) =>
        value.includes("not historical reconstruction"),
      ),
    ).toBe(true);
  });
  it("refuses missing and foreign saved references instead of converting them to partial cohort", async () => {
    const foreign = await prisma.testCase.create({
      data: {
        projectId: foreignProjectId,
        title: "Synthetic foreign saved case",
        testType: "FUNCTIONAL",
        given: [],
        when: [],
        then: [],
        tags: [],
      },
    });
    for (const invalid of [foreign.id, "synthetic-missing-native-case"]) {
      await prisma.testPlan.update({
        where: { id: planA },
        data: { executionTemplate: template([linkedId, invalid]) },
      });
      await expect(read([planA])).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
    }
    await prisma.testPlan.update({
      where: { id: planA },
      data: { executionTemplate: {} },
    });
  });
  it("refuses foreign direct linked relationships and native plan parents", async () => {
    const foreign = await prisma.testCase.create({
      data: {
        projectId: foreignProjectId,
        testPlanId: planA,
        title: "Synthetic foreign direct case",
        testType: "FUNCTIONAL",
        given: [],
        when: [],
        then: [],
        tags: [],
      },
    });
    try {
      await expect(read([planA])).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
    } finally {
      await prisma.testCase.update({
        where: { id: foreign.id },
        data: { testPlanId: null },
      });
    }
    await expect(read([foreignPlan])).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    await expect(read(["synthetic-missing-native-plan"])).rejects.toMatchObject(
      { code: "PRECONDITION_FAILED" },
    );
  });
  it("refuses unknown saved-template formats and oversize persisted JSON before cohort projection", async () => {
    for (const body of [
      { version: 2, testCaseIds: [], configurations: [] },
      { privateProcedure: "x".repeat(4194305) },
    ]) {
      await prisma.testPlan.update({
        where: { id: planA },
        data: { executionTemplate: body },
      });
      await expect(read([planA])).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
    }
    await prisma.testPlan.update({
      where: { id: planA },
      data: { executionTemplate: {} },
    });
  });
});
