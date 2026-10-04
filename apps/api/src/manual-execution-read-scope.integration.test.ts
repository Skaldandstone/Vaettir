// SOURCE ONLY: authored NOT RUN; uniquely owned seeded/migrated loopback DB.
// These exercise the scope helper, NOT getForExecution output acceptance. The
// mounted native parser/output must independently reject unsupported raw shapes.
import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, afterEach, describe, it, expect } from "vitest";
import { prisma, Prisma } from "@vaettir/db";
import { lockManualExecutionReadScope } from "./services/manualExecutionReadScope.js";
import { manualExecutionReadRequestKey } from "./services/manualExecutionReadScopeSchema.js";
import { hardDeleteOrganization } from "./services/orgHardDelete.js";
describe("manual execution read identity and bounds (NOT RUN)", () => {
  const tag = `manual-read-${randomUUID()}`;
  let orgId: string,
    foreignOrgId: string,
    projectId: string,
    foreignProjectId: string,
    actorId: string,
    clerkId: string,
    runId: string,
    caseId: string;
  beforeAll(() => {
    const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
    if (
      !["localhost", "127.0.0.1"].includes(url.hostname) ||
      !/test/i.test(url.pathname) ||
      url.searchParams.has("host")
    )
      throw Error("Owned seeded/migrated loopback test DB required");
  });
  beforeEach(async () => {
    const tier = await prisma.planTier.findUniqueOrThrow({
      where: { key: "free" },
    });
    const org = async () =>
      prisma.organization.create({
        data: {
          name: tag,
          slug: `${tag}-${randomUUID()}`,
          planTierId: tier.id,
        },
      });
    orgId = (await org()).id;
    foreignOrgId = (await org()).id;
    projectId = (
      await prisma.project.create({
        data: { organizationId: orgId, name: tag, slug: randomUUID() },
      })
    ).id;
    foreignProjectId = (
      await prisma.project.create({
        data: { organizationId: foreignOrgId, name: tag, slug: randomUUID() },
      })
    ).id;
    clerkId = `${tag}-${randomUUID()}`;
    actorId = (
      await prisma.user.create({
        data: {
          clerkUserId: clerkId,
          email: `${clerkId}@example.com`,
          memberships: {
            create: [
              { organizationId: orgId, role: "EDITOR", seatType: "FULL" },
              {
                organizationId: foreignOrgId,
                role: "EDITOR",
                seatType: "FULL",
              },
            ],
          },
        },
      })
    ).id;
    caseId = (
      await prisma.testCase.create({
        data: {
          projectId,
          title: "Synthetic retained procedure",
          testType: "FUNCTIONAL",
          given: ["Given"],
          when: ["When"],
          then: ["Then"],
        },
      })
    ).id;
    runId = (
      await prisma.testRun.create({
        data: {
          projectId,
          ciProvider: "manual",
          commitSha: "manual",
          branch: "manual",
          startedAt: new Date(),
          manualTestCaseIds: [caseId],
        },
      })
    ).id;
  });
  afterEach(async () => {
    const p = await prisma.project.findUnique({
      where: { id: projectId },
      select: { organizationId: true },
    });
    if (p && p.organizationId !== orgId)
      await prisma.project.update({
        where: { id: projectId },
        data: { organizationId: orgId },
      });
    for (const organizationId of [orgId, foreignOrgId]) {
      const org = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { slug: true },
      });
      if (!org) continue;
      if (!org.slug.startsWith(tag)) throw Error("Owned fixture mismatch");
      await hardDeleteOrganization(
        prisma,
        organizationId,
        actorId,
        "Owned manual read fixture cleanup",
      );
    }
    await prisma.organizationDeletionLog.deleteMany({
      where: { organizationId: { in: [orgId, foreignOrgId] } },
    });
    await prisma.user.deleteMany({
      where: { id: actorId, clerkUserId: { startsWith: tag } },
    });
  });
  const scoped = () => ({
    testRunId: runId,
    projectId,
    originalOrganizationId: orgId,
    expectedClerkActorId: clerkId,
  });
  const read = (input = scoped(), transport = clerkId) =>
    prisma.$transaction(
      (tx) => lockManualExecutionReadScope(tx, actorId, transport, input),
      { isolationLevel: "RepeatableRead", timeout: 20000 },
    );
  it("supports scoped and legacy manual reads with exact current actor/org/key and separates readable READ_ONLY editor from writes", async () => {
    const input = scoped();
    expect(await read(input)).toEqual({
      testRunId: runId,
      projectId,
      organizationId: orgId,
      originalOrganizationId: orgId,
      actorId,
      clerkActorId: clerkId,
      canWrite: true,
      readRequestKey: manualExecutionReadRequestKey(input),
    });
    const legacy = await prisma.$transaction(
      (tx) =>
        lockManualExecutionReadScope(tx, actorId, clerkId, {
          testRunId: runId,
        }),
      { isolationLevel: "RepeatableRead" },
    );
    expect(legacy.readRequestKey).toBe(JSON.stringify({ testRunId: runId }));
    await prisma.membership.update({
      where: {
        organizationId_userId: { organizationId: orgId, userId: actorId },
      },
      data: { seatType: "READ_ONLY" },
    });
    expect((await read()).canWrite).toBe(false);
  });
  it("refuses missing/wrong-project/nonmanual/old original scope and current unauthenticated actor before bodies", async () => {
    await expect(
      read({ ...scoped(), testRunId: "missing" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      read({ ...scoped(), projectId: foreignProjectId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      read({ ...scoped(), originalOrganizationId: foreignOrgId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(read(scoped(), "wrong-token")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await prisma.testRun.update({
      where: { id: runId },
      data: { ciProvider: "github-actions" },
    });
    await expect(read()).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it("fails revoked/suspended/reparented current access with ownership in both scopes and does not rebound old request", async () => {
    await prisma.organization.update({
      where: { id: orgId },
      data: { suspendedAt: new Date() },
    });
    await expect(read()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await prisma.organization.update({
      where: { id: orgId },
      data: { suspendedAt: null },
    });
    await prisma.project.update({
      where: { id: projectId },
      data: { organizationId: foreignOrgId },
    });
    await expect(read()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await prisma.project.update({
      where: { id: projectId },
      data: { organizationId: orgId },
    });
    await prisma.membership.delete({
      where: {
        organizationId_userId: { organizationId: orgId, userId: actorId },
      },
    });
    await expect(read()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("pins Org/Membership/Project/User/Run rows against concurrent updates without timing sleeps", async () => {
    await prisma.$transaction(
      async (tx) => {
        await lockManualExecutionReadScope(tx, actorId, clerkId, scoped());
        const updates = [
          Prisma.sql`UPDATE "Organization" SET "suspendedAt"=now() WHERE id=${orgId}`,
          Prisma.sql`DELETE FROM "Membership" WHERE "organizationId"=${orgId} AND "userId"=${actorId}`,
          Prisma.sql`UPDATE "Project" SET "organizationId"=${foreignOrgId} WHERE id=${projectId}`,
          Prisma.sql`UPDATE "User" SET "clerkUserId"=${`${tag}-changed`} WHERE id=${actorId}`,
          Prisma.sql`UPDATE "TestRun" SET "ciProvider"='ci' WHERE id=${runId}`,
        ];
        for (const update of updates)
          await expect(
            prisma.$transaction(
              async (rival) => {
                await rival.$executeRaw`SET LOCAL lock_timeout='100ms'`;
                await rival.$executeRaw(update);
              },
              { timeout: 2000 },
            ),
          ).rejects.toMatchObject({ code: "P2010", meta: { code: "55P03" } });
      },
      { isolationLevel: "RepeatableRead", timeout: 20000 },
    );
    expect((await read()).canWrite).toBe(true);
  });
  it("refuses unsupported transaction, duplicate/oversized scope and private case/library pointers without projecting foreign identities", async () => {
    await expect(
      prisma.$transaction(
        (tx) => lockManualExecutionReadScope(tx, actorId, clerkId, scoped()),
        { isolationLevel: "ReadCommitted" },
      ),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await prisma.testRun.update({
      where: { id: runId },
      data: { manualTestCaseIds: [caseId, caseId] },
    });
    await expect(read()).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const foreign = await prisma.testCase.create({
      data: {
        projectId: foreignProjectId,
        title: "Do not disclose",
        testType: "FUNCTIONAL",
        given: [],
        when: [],
        then: [],
      },
    });
    await prisma.testRun.update({
      where: { id: runId },
      data: { manualTestCaseIds: [foreign.id] },
    });
    try {
      await read();
      throw Error("Expected refusal");
    } catch (error) {
      expect(String(error)).toContain("unsupported relationships");
      expect(String(error)).not.toContain(foreign.id);
      expect(String(error)).not.toContain(foreign.title);
    }
    await prisma.testRun.update({
      where: { id: runId },
      data: { manualTestCaseIds: [caseId] },
    });
    const group = await prisma.sharedStepGroup.create({
      data: { projectId: foreignProjectId, name: "Private library", steps: [] },
    });
    await prisma.testCase.update({
      where: { id: caseId },
      data: { sharedStepGroupId: group.id },
    });
    await expect(read()).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
  it("refuses oversized run/current-case/result and matching batch bodies rather than truncating or rewriting", async () => {
    await prisma.testRun.update({
      where: { id: runId },
      data: { executionContext: { padding: "x".repeat(4 * 1024 * 1024) } },
    });
    await expect(read()).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await prisma.testRun.update({
      where: { id: runId },
      data: { executionContext: {} },
    });
    await prisma.testCase.update({
      where: { id: caseId },
      data: { background: "x".repeat(512 * 1024) },
    });
    await expect(read()).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await prisma.testCase.update({
      where: { id: caseId },
      data: { background: null },
    });
    const result = await prisma.testResult.create({
      data: {
        testRunId: runId,
        testCaseId: caseId,
        status: "FAIL",
        note: "x".repeat(256 * 1024),
      },
    });
    await expect(read()).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await prisma.testResult.delete({ where: { id: result.id } });
    const batchId = `dataset_${"a".repeat(64)}`;
    await prisma.testRun.update({
      where: { id: runId },
      data: { executionContext: { datasetExecution: { batchId } } },
    });
    for (let n = 0; n < 3; n++)
      await prisma.testRun.create({
        data: {
          projectId,
          ciProvider: "manual",
          commitSha: "manual",
          branch: "manual",
          startedAt: new Date(),
          executionContext: {
            datasetExecution: { batchId },
            padding: "x".repeat(3 * 1024 * 1024),
          },
        },
      });
    await expect(read()).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(
      (await prisma.testRun.findUniqueOrThrow({ where: { id: runId } }))
        .executionContext,
    ).toEqual({ datasetExecution: { batchId } });
  });
  it("refuses multiple selected-case results without choosing the last Map entry or rewriting the original failure", async () => {
    const failure = await prisma.testResult.create({
      data: {
        testRunId: runId,
        testCaseId: caseId,
        status: "FAIL",
        note: "Retained original failure",
      },
    });
    const passed = await prisma.testResult.create({
      data: {
        testRunId: runId,
        testCaseId: caseId,
        status: "PASS",
        note: "Ambiguous independent stored row",
      },
    });
    await expect(read()).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(
      await prisma.testResult.findMany({
        where: { id: { in: [failure.id, passed.id] } },
        orderBy: { id: "asc" },
        select: { id: true, status: true, note: true },
      }),
    ).toEqual(
      [
        { id: failure.id, status: "FAIL", note: "Retained original failure" },
        {
          id: passed.id,
          status: "PASS",
          note: "Ambiguous independent stored row",
        },
      ].sort((a, b) => a.id.localeCompare(b.id)),
    );
  });
  it("refuses malformed/over500 shared procedure steps; supported stored steps are validated without normalization", async () => {
    const group = await prisma.sharedStepGroup.create({
      data: {
        projectId,
        name: "Owned shared setup",
        steps: [{ action: "Arrange fixture", expectedResult: "Ready" }],
      },
    });
    await prisma.testCase.update({
      where: { id: caseId },
      data: { sharedStepGroupId: group.id },
    });
    expect((await read()).testRunId).toBe(runId);
    for (const steps of [
      { unsupported: "not an array" },
      [{ action: 3 }],
      Array.from({ length: 501 }, () => ({ action: "Retained step" })),
    ]) {
      await prisma.sharedStepGroup.update({
        where: { id: group.id },
        data: { steps },
      });
      await expect(read()).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
      expect(
        (
          await prisma.sharedStepGroup.findUniqueOrThrow({
            where: { id: group.id },
            select: { steps: true },
          })
        ).steps,
      ).toEqual(steps);
    }
  });
  it("refuses foreign/dangling/duplicate/cyclic/overbound prerequisite graph without disclosing foreign IDs or substituting edges", async () => {
    const foreign = await prisma.testCase.create({
      data: {
        projectId: foreignProjectId,
        title: "Private graph endpoint",
        testType: "FUNCTIONAL",
        given: [],
        when: [],
        then: [],
      },
    });
    for (const graph of [
      { [caseId]: [foreign.id] },
      { missing: [] },
      { [caseId]: [caseId] },
      { [caseId]: Array.from({ length: 501 }, () => caseId) },
    ]) {
      await prisma.testRun.update({
        where: { id: runId },
        data: { manualPrerequisites: graph },
      });
      try {
        await read();
        throw Error("Expected refusal");
      } catch (error) {
        expect(String(error)).toContain("unsupported relationships");
        expect(String(error)).not.toContain(foreign.id);
      }
      expect(
        (
          await prisma.testRun.findUniqueOrThrow({
            where: { id: runId },
            select: { manualPrerequisites: true },
          })
        ).manualPrerequisites,
      ).toEqual(graph);
    }
    const other = await prisma.testCase.create({
      data: {
        projectId,
        title: "Owned second endpoint",
        testType: "FUNCTIONAL",
        given: [],
        when: [],
        then: [],
      },
    });
    await prisma.testRun.update({
      where: { id: runId },
      data: {
        manualTestCaseIds: [caseId, other.id],
        manualPrerequisites: { [caseId]: [other.id, other.id] },
      },
    });
    await expect(read()).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await prisma.testRun.update({
      where: { id: runId },
      data: {
        manualPrerequisites: { [caseId]: [other.id], [other.id]: [caseId] },
      },
    });
    await expect(read()).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await prisma.testRun.update({
      where: { id: runId },
      data: { manualPrerequisites: { [caseId]: [other.id], [other.id]: [] } },
    });
    expect((await read()).testRunId).toBe(runId);
    const scope = Array.from(
      { length: 101 },
      (_, n) => `retained-missing-${n}`,
    );
    const graph = Object.fromEntries(
      scope.map((id, n) => [id, scope.slice(n + 1)]),
    );
    // >10k unique acyclic edges, including retained missing frozen identities.
    const largeScope = Array.from(
      { length: 143 },
      (_, n) => `retained-missing-${n}`,
    );
    const largeGraph = Object.fromEntries(
      largeScope.map((id, n) => [id, largeScope.slice(n + 1)]),
    );
    await prisma.testRun.update({
      where: { id: runId },
      data: { manualTestCaseIds: scope, manualPrerequisites: graph },
    });
    expect((await read()).testRunId).toBe(runId);
    await prisma.testRun.update({
      where: { id: runId },
      data: { manualTestCaseIds: largeScope, manualPrerequisites: largeGraph },
    });
    await expect(read()).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});
