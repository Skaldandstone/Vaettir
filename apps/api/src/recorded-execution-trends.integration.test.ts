// Synthetic integration coverage; requires an owned migrated loopback test DB.
import { randomUUID } from "node:crypto";
import { describe, beforeAll, afterAll, it, expect } from "vitest";
import { Prisma, prisma } from "@vaettir/db";
import { recordedExecutionTrendsRouter } from "./routers/recordedExecutionTrends.js";
import { recordedExecutionTrendKey } from "./services/recordedExecutionTrendSchema.js";
import {
  withRecordedExecutionTrendAccess,
  readRecordedExecutionTrend,
} from "./services/recordedExecutionTrend.js";
import { hardDeleteOrganization } from "./services/orgHardDelete.js";

describe("bounded daily recorded execution observation explorer", () => {
  const tag = `execution-trend-${randomUUID()}`,
    orgIds: string[] = [],
    userIds: string[] = [];
  let projectId: string,
    foreignProject: string,
    actorId: string,
    clerkActorId: string,
    caseId: string,
    foreignCase: string;
  let owner: ReturnType<typeof recordedExecutionTrendsRouter.createCaller>,
    outsider: typeof owner;
  const dates = { start: "2020-01-01", end: "2020-01-03" };
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
    for (let index = 0; index < 2; index++) {
      const org = await prisma.organization.create({
        data: {
          name: `${tag}-${index}`,
          slug: `${tag}-${index}`,
          planTierId: tier.id,
        },
      });
      orgIds.push(org.id);
      const user = await prisma.user.create({
        data: {
          clerkUserId: `${tag}-${index}`,
          email: `${tag}-${index}@example.com`,
          memberships: {
            create: { organizationId: org.id, role: "OWNER", seatType: "FULL" },
          },
        },
        include: { memberships: true },
      });
      userIds.push(user.id);
      // Retain the erasure actor even if a later setup assertion fails.
      if (index === 0) actorId = user.id;
      const project = await prisma.project.create({
        data: {
          organizationId: org.id,
          name: tag,
          slug: `${tag}-project-${index}`,
          // Keep reparent authorization probes independent of the org key unique constraint.
          caseKey: `t${index}${randomUUID().replaceAll("-", "").slice(0, 12)}`,
        },
      });
      const tc = await prisma.testCase.create({
        data: {
          projectId: project.id,
          title: index ? "FOREIGN CASE BODY" : "Native mapped case",
          testType: "FUNCTIONAL",
        },
      });
      if (!index) {
        projectId = project.id;
        actorId = user.id;
        clerkActorId = user.clerkUserId;
        caseId = tc.id;
        owner = recordedExecutionTrendsRouter.createCaller({ prisma, user });
      } else {
        foreignProject = project.id;
        foreignCase = tc.id;
        outsider = recordedExecutionTrendsRouter.createCaller({ prisma, user });
      }
    }
    const first = await prisma.testRun.create({
      data: {
        projectId,
        ciProvider: "synthetic-ci",
        commitSha: "build-one",
        branch: "PC-but-not-proof",
        startedAt: new Date("2020-01-01T23:59:59.999Z"),
        finishedAt: new Date("2020-01-02T00:00:01Z"),
        status: "PASSED",
        executionContext: {
          version: 1,
          configuration: {
            platform: "PC",
            environment: "lab",
            build: "not-ci-build",
          },
        },
      },
    });
    await prisma.testResult.createMany({
      data: [
        {
          testRunId: first.id,
          testCaseId: caseId,
          status: "PASS",
          durationMs: 10,
        },
        {
          testRunId: first.id,
          testCaseId: caseId,
          status: "PASS",
          durationMs: 20,
        },
        {
          testRunId: first.id,
          testCaseId: null,
          status: "FAIL",
          durationMs: null,
          errorMessage: "DO NOT READ RAW ERROR",
        },
        {
          testRunId: first.id,
          testCaseId: foreignCase,
          status: "BLOCKED",
          durationMs: -1,
          note: "DO NOT READ RAW NOTE",
        },
        {
          testRunId: first.id,
          testCaseId: caseId,
          status: "FLAKY",
          durationMs: 0,
        },
        {
          testRunId: first.id,
          testCaseId: null,
          status: "SKIP",
          durationMs: 5,
        },
      ],
    });
    const running = await prisma.testRun.create({
      data: {
        projectId,
        ciProvider: "manual",
        branch: "manual",
        commitSha: "manual",
        status: "RUNNING",
        startedAt: new Date("2020-01-02T00:00:00Z"),
        executionContext: {
          version: 1,
          configuration: {
            platform: "PC",
            environment: "lab",
            build: "build-two",
          },
        },
      },
    });
    await prisma.testResult.create({
      data: {
        testRunId: running.id,
        testCaseId: caseId,
        status: "FAIL",
        durationMs: 3,
      },
    });
    await prisma.testRun.create({
      data: {
        projectId,
        ciProvider: "legacy-ci",
        branch: "PC",
        commitSha: "build-one",
        status: "PARTIAL",
        startedAt: new Date("2020-01-02T12:00:00Z"),
      },
    });
    const foreign = await prisma.testRun.create({
      data: {
        projectId: foreignProject,
        ciProvider: "synthetic-ci",
        branch: "main",
        commitSha: "build-one",
        status: "PASSED",
        startedAt: new Date("2020-01-01T00:00:00Z"),
      },
    });
    await prisma.testResult.create({
      data: { testRunId: foreign.id, testCaseId: foreignCase, status: "PASS" },
    });
  });
  afterAll(async () => {
    for (const orgId of orgIds) {
      const org = await prisma.organization.findUniqueOrThrow({
        where: { id: orgId },
      });
      if (!org.slug.startsWith(tag))
        throw Error("Synthetic fixture ownership mismatch");
      const receipt = await hardDeleteOrganization(
        prisma,
        orgId,
        actorId,
        "Owned daily execution trend fixture erasure",
      );
      const removed = await prisma.organizationDeletionLog.deleteMany({
        where: {
          id: receipt.deletionLogId,
          organizationId: orgId,
          organizationSlug: org.slug,
          deletedById: actorId,
        },
      });
      expect(removed.count).toBe(1);
    }
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });
  const scope = () => ({
    projectId,
    originalOrganizationId: orgIds[0]!,
    ...dates,
  });
  it("counts actual repeated outcome observations and explicit complete in-progress and missing completion evidence", async () => {
    const result = await owner.summary(scope());
    expect(result.totals).toMatchObject({
      runs: 3,
      results: 7,
      mapped: 4,
      unmatched: 2,
      unavailableMapping: 1,
      inProgressRuns: 1,
      finishedRecordedRuns: 1,
      completionUnavailableRuns: 1,
      inProgressResults: 1,
      timedResults: 5,
      missingDurations: 1,
      invalidDurations: 1,
      sumDurationMs: 38,
      outcomes: { PASS: 2, FAIL: 2, FLAKY: 1, SKIP: 1, BLOCKED: 1 },
    });
    expect(result.days).toHaveLength(3);
    expect(result.days[2]).toMatchObject({
      day: "2020-01-03",
      runs: 0,
      results: 0,
    });
    expect(result.organizationId).toBe(orgIds[0]);
    expect(result.clerkActorId).toBe(clerkActorId);
    expect(result.requestKey).toBe(recordedExecutionTrendKey(scope()));
    expect(JSON.stringify(result)).not.toContain("DO NOT READ");
    expect(JSON.stringify(result)).not.toContain("FOREIGN CASE BODY");
  });
  it("uses stored UTC run-start days even with a non-UTC database session, not finish or observation time", async () => {
    const result = await withRecordedExecutionTrendAccess(
      prisma,
      actorId,
      clerkActorId,
      scope(),
      async (tx) => {
        await tx.$executeRaw(
          Prisma.sql`SET LOCAL TIME ZONE 'America/Los_Angeles'`,
        );
        return readRecordedExecutionTrend(tx, scope(), clerkActorId);
      },
    );
    expect(result.days[0]).toMatchObject({
      day: "2020-01-01",
      runs: 1,
      results: 6,
    });
    expect(result.days[1]).toMatchObject({
      day: "2020-01-02",
      runs: 2,
      results: 1,
    });
  });
  it("matches exact maintained recorded filters without provider/branch or unsupported-context inference", async () => {
    expect(
      (await owner.summary({ ...scope(), platform: "PC", environment: "lab" }))
        .totals.runs,
    ).toBe(2);
    expect(
      (await owner.summary({ ...scope(), build: "build-one" })).totals.runs,
    ).toBe(2);
    expect(
      (await owner.summary({ ...scope(), build: "build-two" })).totals.runs,
    ).toBe(1);
    expect(
      (await owner.summary({ ...scope(), platform: "PC " })).totals.runs,
    ).toBe(0);
    await prisma.testRun.create({
      data: {
        projectId,
        ciProvider: "PC",
        branch: "PC",
        commitSha: "v2",
        startedAt: new Date("2020-01-01T00:00:00Z"),
        executionContext: {
          version: 2,
          configuration: { platform: "PC", environment: "lab" },
        },
      },
    });
    expect(
      (await owner.summary({ ...scope(), platform: "PC", environment: "lab" }))
        .totals.runs,
    ).toBe(2);
  });
  it("returns stable day metadata pages with same base scope key, bounded excerpts and unavailable legacy values", async () => {
    await prisma.testRun.createMany({
      data: Array.from({ length: 25 }, (_, index) => ({
        projectId,
        ciProvider: "😀".repeat(90),
        branch: "DO NOT PROJECT BRANCH",
        commitSha: "b".repeat(180),
        status: "PASSED" as const,
        startedAt: new Date(Date.parse("2020-01-01T12:00:00Z") + index),
        executionContext: {
          version: 1,
          configuration: {
            platform: "Drill-only",
            environment: "😀".repeat(170),
          },
        },
      })),
    });
    const applied = { ...scope(), platform: "Drill-only" },
      first = await owner.runs({ ...applied, day: "2020-01-01", page: 0 }),
      second = await owner.runs({ ...applied, day: "2020-01-01", page: 1 });
    expect(first.total).toBe(25);
    expect(first.runs).toHaveLength(20);
    expect(first.hasMore).toBe(true);
    expect(second.runs).toHaveLength(5);
    expect(second.hasMore).toBe(false);
    expect(first.requestKey).toBe(recordedExecutionTrendKey(applied));
    expect(second.requestKey).toBe(first.requestKey);
    expect(
      new Set([...first.runs, ...second.runs].map((run) => run.id)).size,
    ).toBe(25);
    for (const run of first.runs) {
      expect(run.provider).toHaveLength(80);
      expect(run.providerExcerpt).toBe(true);
      expect(run.build).toHaveLength(160);
      expect(run.buildExcerpt).toBe(true);
      expect(run.environment).toHaveLength(160);
      expect(run.environmentExcerpt).toBe(true);
    }
    expect(JSON.stringify(first)).not.toContain("DO NOT PROJECT BRANCH");
    await expect(
      owner.runs({ ...applied, day: "2020-01-01", page: 2 }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("requires current original-org access and current verified clerk actor, never foreign results after reparent", async () => {
    await expect(outsider.summary(scope())).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      withRecordedExecutionTrendAccess(
        prisma,
        actorId,
        "wrong-clerk-actor",
        scope(),
        (tx) => readRecordedExecutionTrend(tx, scope(), "wrong-clerk-actor"),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await prisma.project.update({
      where: { id: projectId },
      data: { organizationId: orgIds[1]! },
    });
    try {
      await expect(owner.summary(scope())).rejects.toMatchObject({ code: "FORBIDDEN" });
    } finally {
      await prisma.project.update({ where: { id: projectId }, data: { organizationId: orgIds[0]! } });
    }
    await prisma.organization.update({
      where: { id: orgIds[0]! },
      data: { suspendedAt: new Date() },
    });
    try {
      await expect(owner.summary(scope())).rejects.toMatchObject({ code: "FORBIDDEN" });
    } finally {
      await prisma.organization.update({ where: { id: orgIds[0]! }, data: { suspendedAt: null } });
    }
    await prisma.membership.delete({
      where: {
        organizationId_userId: { organizationId: orgIds[0]!, userId: actorId },
      },
    });
    try {
      await expect(owner.summary(scope())).rejects.toMatchObject({ code: "FORBIDDEN" });
    } finally {
      await prisma.membership.create({ data: { organizationId: orgIds[0]!, userId: actorId, role: "OWNER", seatType: "FULL" } });
    }
  });
  it("refuses run and result population caps before aggregate or zero-substitution success", async () => {
    const oversized = await prisma.project.create({
      data: {
        organizationId: orgIds[0]!,
        name: `${tag}-run-limit`,
        slug: `${tag}-run-limit`,
      },
    });
    // Real complete populations, not injected counts. Await bounded <=1000-row
    // statements sequentially so setup cannot spill into teardown after a5s
    // default test timeout. Only this synthetic setup scenario gets180s below;
    // production aggregate/query limits and timeouts remain unchanged.
    for (let inserted = 0; inserted < 20001; inserted += 1000) await prisma.testRun.createMany({
      data: Array.from({ length: Math.min(1000, 20001 - inserted) }, () => ({
        projectId: oversized.id,
        ciProvider: "synthetic",
        branch: "main",
        commitSha: "cap",
        startedAt: new Date("2020-01-01T00:00:00Z"),
      })),
    });
    expect(await prisma.testRun.count({ where: { projectId: oversized.id } })).toBe(20001);
    await expect(
      owner.summary({ ...scope(), projectId: oversized.id }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const overResults = await prisma.project.create({
      data: {
        organizationId: orgIds[0]!,
        name: `${tag}-result-limit`,
        slug: `${tag}-result-limit`,
      },
    });
    const run = await prisma.testRun.create({
      data: {
        projectId: overResults.id,
        ciProvider: "synthetic",
        branch: "main",
        commitSha: "cap",
        startedAt: new Date("2020-01-01T00:00:00Z"),
      },
    });
    for (let inserted = 0; inserted < 100001; inserted += 1000)
      await prisma.testResult.createMany({
        data: Array.from({ length: Math.min(1000, 100001 - inserted) }, () => ({
          testRunId: run.id,
          status: "PASS" as const,
        })),
      });
    expect(await prisma.testResult.count({ where: { testRunId: run.id } })).toBe(100001);
    await expect(
      owner.summary({ ...scope(), projectId: overResults.id }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(
      owner.runs({
        ...scope(),
        projectId: overResults.id,
        day: "2020-01-01",
        page: 0,
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  }, 180000);
  it("fails visible for out-of-filter unsupported ID metadata rather than claiming empty selected evidence", async () => {
    const bounded = await prisma.project.create({
      data: {
        organizationId: orgIds[0]!,
        name: `${tag}-id-bound`,
        slug: `${tag}-id-bound`,
      },
    });
    await prisma.testRun.create({
      data: {
        id: tag.padEnd(201, "x"),
        projectId: bounded.id,
        ciProvider: "synthetic",
        branch: "main",
        commitSha: "unselected",
        startedAt: new Date("2020-01-01T00:00:00Z"),
      },
    });
    await expect(
      owner.summary({
        ...scope(),
        projectId: bounded.id,
        build: "missing-build",
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
  it("returns explicit complete zero days only for a successful empty bounded scope", async () => {
    const result = await owner.summary({
      ...scope(),
      start: "2019-01-01",
      end: "2019-01-03",
    });
    expect(result.days).toHaveLength(3);
    expect(result.totals.runs).toBe(0);
    expect(result.totals.results).toBe(0);
    expect(
      result.days.every((day) => day.results === 0 && day.runs === 0),
    ).toBe(true);
    expect(result.limitations.join(" ")).toContain(
      "not a new regression classifier",
    );
  });
});
