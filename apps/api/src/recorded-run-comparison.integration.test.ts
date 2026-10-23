// Synthetic integration coverage; requires an owned migrated loopback test DB.
import { randomUUID } from "node:crypto";
import { describe, beforeAll, afterAll, it, expect } from "vitest";
import { prisma } from "@vaettir/db";
import { recordedRunComparisonRouter } from "./routers/recordedRunComparison.js";
import { recordedResultStatuses } from "./services/recordedRunComparisonSchema.js";
import {
  withRecordedRunAccess,
  compareRecordedRuns,
} from "./services/recordedRunComparison.js";
import { hardDeleteOrganization } from "./services/orgHardDelete.js";
describe("bounded neutral recorded-run comparison", () => {
  const tag = `run-compare-${randomUUID()}`,
    orgs: string[] = [],
    users: string[] = [];
  type Caller = ReturnType<typeof recordedRunComparisonRouter.createCaller>;
  let owner: Caller, viewer: Caller, outsider: Caller, actorId: string;
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
    if (
      !["localhost", "127.0.0.1"].includes(url.hostname) ||
      !/test/i.test(url.pathname) ||
      url.searchParams.has("host")
    )
      throw Error("Owned disposable loopback DB required");
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
      orgs.push(org.id);
      const user = await prisma.user.create({
        data: {
          email: `${tag}-${index}@example.com`,
          clerkUserId: `${tag}-${index}`,
          memberships: {
            create: { organizationId: org.id, role: "OWNER", seatType: "FULL" },
          },
        },
        include: { memberships: true },
      });
      users.push(user.id);
      if (index === 0) {
        actorId = user.id;
        owner = recordedRunComparisonRouter.createCaller({ prisma, user });
      } else
        outsider = recordedRunComparisonRouter.createCaller({ prisma, user });
    }
    const user = await prisma.user.create({
      data: {
        email: `${tag}-viewer@example.com`,
        clerkUserId: `${tag}-viewer`,
        memberships: {
          create: {
            organizationId: orgs[0]!,
            role: "VIEWER",
            seatType: "READ_ONLY",
          },
        },
      },
      include: { memberships: true },
    });
    users.push(user.id);
    viewer = recordedRunComparisonRouter.createCaller({ prisma, user });
  });
  afterAll(async () => {
    if (!orgs.length) return;
    for (const id of orgs) {
      const org = await prisma.organization.findUniqueOrThrow({
        where: { id },
      });
      if (!org.slug.startsWith(tag)) throw Error("Fixture ownership mismatch");
      const receipt = await hardDeleteOrganization(
        prisma,
        id,
        actorId,
        "Owned recorded comparison fixtures",
      );
      const removed = await prisma.organizationDeletionLog.deleteMany({
        where: {
          id: receipt.deletionLogId,
          organizationId: id,
          organizationSlug: org.slug,
          deletedById: actorId,
        },
      });
      expect(removed.count).toBe(1);
    }
    await prisma.user.deleteMany({ where: { id: { in: users } } });
  });
  async function project(foreign = false) {
    const slug = `p-${randomUUID()}`;
    return prisma.project.create({
      data: {
        organizationId: orgs[foreign ? 1 : 0]!,
        name: slug,
        slug,
        caseKey: `r${randomUUID().replaceAll("-", "").slice(0, 15)}`,
      },
    });
  }
  async function pair() {
    const p = await project();
    const baseline = await prisma.testRun.create({
      data: {
        projectId: p.id,
        ciProvider: "synthetic-ci",
        commitSha: "same commit is not equivalence",
        branch: "same branch",
        startedAt: new Date("2026-10-04T02:00:00Z"),
        finishedAt: new Date("2026-10-04T02:01:00Z"),
        status: "FAILED",
      },
    });
    const candidate = await prisma.testRun.create({
      data: {
        projectId: p.id,
        ciProvider: "synthetic-ci",
        commitSha: baseline.commitSha,
        branch: baseline.branch,
        startedAt: new Date("2026-10-04T03:00:00Z"),
        finishedAt: new Date("2026-10-04T03:01:00Z"),
        status: "PASSED",
      },
    });
    return { p, baseline, candidate };
  }
  const input = (p: { id: string }, a: { id: string }, b: { id: string }) => ({
    projectId: p.id,
    baselineRunId: a.id,
    candidateRunId: b.id,
    requestId: randomUUID(),
  });
  it("preserves all reported statuses original failures and neutral multiple-observation counts", async () => {
    const { p, baseline, candidate } = await pair(),
      c = await prisma.testCase.create({
        data: {
          projectId: p.id,
          title: "Synthetic current case",
          testType: "FUNCTIONAL",
          isFlaky: true,
        },
      });
    for (const status of recordedResultStatuses)
      await prisma.testResult.create({
        data: {
          testRunId: baseline.id,
          testCaseId: c.id,
          status,
          durationMs: 5,
        },
      });
    await prisma.testResult.createMany({
      data: [
        {
          testRunId: candidate.id,
          testCaseId: c.id,
          status: "PASS",
          durationMs: 10,
        },
        {
          testRunId: candidate.id,
          testCaseId: c.id,
          status: "PASS",
          durationMs: 10,
        },
      ],
    });
    const before = await prisma.testResult.findMany({
        where: { testRunId: baseline.id },
        orderBy: { id: "asc" },
      }),
      result = await owner.compare(input(p, baseline, candidate));
    expect(result.items[0]!.baseline.counts).toEqual({
      PASS: 1,
      FAIL: 1,
      SKIP: 1,
      FLAKY: 1,
      BLOCKED: 1,
    });
    expect(result.items[0]!.candidate.counts.PASS).toBe(2);
    expect(result.items[0]!.difference).toBe("COUNTS_CHANGED");
    expect(result.comparableConfiguration).toBe(false);
    expect(result.comparisonScope).toBe("RECORDED_COUNTS_ONLY");
    expect(result.limitations.join(" ")).toContain("Retry/attempt grouping");
    expect(
      await prisma.testResult.findMany({
        where: { testRunId: baseline.id },
        orderBy: { id: "asc" },
      }),
    ).toEqual(before);
    expect(result.items[0]!.displayId).toBe(c.displayId);
  });
  it("keeps missing sides unmatched rows and unavailable foreign links distinct without leaking content", async () => {
    const privateSentinels = {
      note: `Synthetic private note ${randomUUID()}`,
      error: `Synthetic private error ${randomUUID()}`,
      observation: `Synthetic private measurement ${randomUUID()}`,
      externalId: `Synthetic private external identity ${randomUUID()}`,
    };
    const { p, baseline, candidate } = await pair(),
      foreign = await project(true),
      secret = await prisma.testCase.create({
        data: {
          projectId: foreign.id,
          title: "Foreign secret not projected",
          testType: "FUNCTIONAL",
        },
      }),
      a = await prisma.testCase.create({
        data: { projectId: p.id, title: "Baseline only", testType: "FUNCTIONAL" },
      }),
      b = await prisma.testCase.create({
        data: { projectId: p.id, title: "Candidate only", testType: "FUNCTIONAL" },
      });
    await prisma.testResult.createMany({
      data: [
        {
          testRunId: baseline.id,
          testCaseId: a.id,
          status: "FAIL",
          note: privateSentinels.note,
          errorMessage: privateSentinels.error,
          observations: { secret: privateSentinels.observation },
        },
        { testRunId: candidate.id, testCaseId: b.id, status: "SKIP" },
        {
          testRunId: baseline.id,
          status: "BLOCKED",
          externalTestId: privateSentinels.externalId,
        },
        { testRunId: candidate.id, testCaseId: secret.id, status: "FAIL" },
      ],
    });
    const result = await viewer.compare(input(p, baseline, candidate));
    expect(result.items.find((row) => row.caseId === a.id)!.difference).toBe(
      "BASELINE_ONLY",
    );
    expect(result.items.find((row) => row.caseId === b.id)!.difference).toBe(
      "CANDIDATE_ONLY",
    );
    expect(result.baselineSummary.unmatchedResults.BLOCKED).toBe(1);
    expect(result.candidateSummary.unavailableLinks.FAIL).toBe(1);
    expect(result.mappedCaseCount).toBe(2);
    for (const text of [
      secret.id,
      secret.title,
      ...Object.values(privateSentinels),
    ])
      expect(JSON.stringify(result)).not.toContain(text);
    // Match serialized property names, not the honest generic limitations copy.
    expect(JSON.stringify(result)).not.toMatch(
      /"(?:note|notes|errorMessage|observations|externalTestId|externalFilePath|artifacts|source)"\s*:/,
    );
  });
  it("accounts for missing and invalid durations without coercing them to zero", async () => {
    const { p, baseline, candidate } = await pair();
    await prisma.testResult.createMany({
      data: [
        { testRunId: baseline.id, status: "PASS", durationMs: null },
        { testRunId: baseline.id, status: "PASS", durationMs: -1 },
        { testRunId: baseline.id, status: "FAIL", durationMs: 0 },
        { testRunId: baseline.id, status: "SKIP", durationMs: 20 },
      ],
    });
    const result = await owner.compare(input(p, baseline, candidate));
    expect(result.baselineSummary).toMatchObject({
      resultCount: 4,
      timedResults: 2,
      missingDurations: 1,
      invalidDurations: 1,
      minDurationMs: 0,
      maxDurationMs: 20,
      meanDurationMs: 10,
    });
    expect(result.candidateSummary.meanDurationMs).toBeNull();
    expect(result.items).toHaveLength(0);
  });
  it("rejects foreign missing manual identical and non-chronological selected runs", async () => {
    const { p, baseline, candidate } = await pair(),
      foreign = await pair(),
      manual = await prisma.testRun.create({
        data: {
          projectId: p.id,
          ciProvider: "manual",
          commitSha: "manual",
          branch: "manual",
          startedAt: new Date("2026-10-04T04:00:00Z"),
        },
      });
    for (const [a, b, code] of [
      [baseline.id, baseline.id, "BAD_REQUEST"],
      [candidate.id, baseline.id, "BAD_REQUEST"],
      [baseline.id, manual.id, "NOT_FOUND"],
      [baseline.id, foreign.candidate.id, "NOT_FOUND"],
      [baseline.id, "missing", "NOT_FOUND"],
    ] as const)
      await expect(
        owner.compare({
          projectId: p.id,
          baselineRunId: a,
          candidateRunId: b,
          requestId: randomUUID(),
        }),
      ).rejects.toMatchObject({ code });
    await expect(
      outsider.compare(input(p, baseline, candidate)),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await prisma.testRun.update({
      where: { id: candidate.id },
      data: { startedAt: baseline.startedAt },
    });
    await expect(
      owner.compare(input(p, baseline, candidate)),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it("pins all case pages and first-page return to exact actor/org/run population", async () => {
    const { p, baseline, candidate } = await pair();
    for (let index = 0; index < 57; index++) {
      const c = await prisma.testCase.create({
        data: { projectId: p.id, title: `Case ${index}`, testType: "FUNCTIONAL" },
      });
      await prisma.testResult.create({
        data: { testRunId: baseline.id, testCaseId: c.id, status: "FAIL" },
      });
    }
    const first = await owner.compare(input(p, baseline, candidate)),
      second = await owner.compare({
        ...input(p, baseline, candidate),
        cursor: first.nextCursor!,
        expectedPairHash: first.pairHash,
      });
    expect(first.items).toHaveLength(50);
    expect(second.items).toHaveLength(7);
    expect(
      new Set([...first.items, ...second.items].map((row) => row.caseId)).size,
    ).toBe(57);
    await expect(
      viewer.compare({
        ...input(p, baseline, candidate),
        cursor: first.nextCursor!,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      owner.compare({
        ...input(p, baseline, candidate),
        cursor: {
          caseId: "not-in-population",
          expectedPairHash: first.pairHash,
        },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await prisma.testResult.create({
      data: { testRunId: candidate.id, status: "PASS" },
    });
    await expect(
      owner.compare({
        ...input(p, baseline, candidate),
        cursor: first.nextCursor!,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      owner.compare({
        ...input(p, baseline, candidate),
        expectedPairHash: first.pairHash,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("fails explicitly over the population bound instead of returning a passing partial cohort", async () => {
    const { p, baseline, candidate } = await pair();
    await prisma.testResult.createMany({
      data: Array.from({ length: 10001 }, () => ({
        testRunId: baseline.id,
        status: "PASS" as const,
      })),
    });
    await expect(
      owner.compare(input(p, baseline, candidate)),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const removable = await prisma.testResult.findFirstOrThrow({
      where: { testRunId: baseline.id },
      select: { id: true },
    });
    await prisma.testResult.delete({ where: { id: removable.id } });
    const result = await owner.compare(input(p, baseline, candidate));
    expect(result.baselineSummary.resultCount).toBe(10000);
    expect(result.baselineSummary.unmatchedResults.PASS).toBe(10000);
    expect(result.items).toHaveLength(0);
  }, 60000);
  it("pages and bounds run metadata while excluding manual histories", async () => {
    const p = await project(),
      instant = new Date("2026-10-04T04:00:00Z");
    for (let index = 0; index < 24; index++)
      await prisma.testRun.create({
        data: {
          projectId: p.id,
          ciProvider: index === 0 ? "ci".repeat(200) : "synthetic-ci",
          commitSha: "c".repeat(400),
          branch: "b".repeat(400),
          startedAt: instant,
        },
      });
    await prisma.testRun.create({
      data: {
        projectId: p.id,
        ciProvider: "manual",
        commitSha: "manual",
        branch: "manual",
        startedAt: instant,
      },
    });
    const a = await owner.runs({ projectId: p.id, requestId: randomUUID() }),
      b = await owner.runs({
        projectId: p.id,
        requestId: randomUUID(),
        cursor: a.nextCursor!,
      });
    expect(a.items).toHaveLength(20);
    expect(b.items).toHaveLength(4);
    expect(new Set([...a.items, ...b.items].map((run) => run.id)).size).toBe(
      24,
    );
    expect(
      [...a.items, ...b.items].every(
        (run) =>
          run.provider.length <= 80 &&
          run.commit.length <= 160 &&
          run.branch.length <= 160,
      ),
    ).toBe(true);
    await expect(
      outsider.runs({ projectId: p.id, requestId: randomUUID() }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      owner.runs({
        projectId: p.id,
        requestId: randomUUID(),
        cursor: { runId: "missing", startedAt: instant.toISOString() },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it("rechecks revocation suspension and original-org reparenting without trusting caller membership snapshots", async () => {
    const { p, baseline, candidate } = await pair();
    await prisma.membership.delete({
      where: {
        organizationId_userId: { organizationId: orgs[0]!, userId: actorId },
      },
    });
    try {
      await expect(
        owner.compare(input(p, baseline, candidate)),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    } finally {
      await prisma.membership.create({
        data: {
          organizationId: orgs[0]!,
          userId: actorId,
          role: "OWNER",
          seatType: "FULL",
        },
      });
    }
    await prisma.organization.update({
      where: { id: orgs[0]! },
      data: { suspendedAt: new Date() },
    });
    try {
      await expect(
        owner.compare(input(p, baseline, candidate)),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    } finally {
      await prisma.organization.update({
        where: { id: orgs[0]! },
        data: { suspendedAt: null },
      });
    }
    await prisma.membership.create({
      data: {
        organizationId: orgs[1]!,
        userId: actorId,
        role: "OWNER",
        seatType: "FULL",
      },
    });
    await prisma.project.update({
      where: { id: p.id },
      data: { organizationId: orgs[1]! },
    });
    try {
      await expect(
        withRecordedRunAccess(prisma, actorId, p.id, orgs[0]!, (tx) =>
          compareRecordedRuns(
            tx,
            input(p, baseline, candidate),
            actorId,
            orgs[0]!,
          ),
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    } finally {
      await prisma.project.update({
        where: { id: p.id },
        data: { organizationId: orgs[0]! },
      });
      await prisma.membership.delete({
        where: {
          organizationId_userId: { organizationId: orgs[1]!, userId: actorId },
        },
      });
    }
  });
  it("bounds Unicode metadata before output parsing without splitting surrogate pairs", async () => {
    const { p, baseline, candidate } = await pair();
    await prisma.testRun.update({
      where: { id: baseline.id },
      data: {
        ciProvider: "😀".repeat(80),
        commitSha: "😀".repeat(160),
        branch: "😀".repeat(160),
      },
    });
    const c = await prisma.testCase.create({
      data: { projectId: p.id, title: "😀".repeat(1000), testType: "FUNCTIONAL" },
    });
    await prisma.testResult.create({
      data: { testRunId: baseline.id, testCaseId: c.id, status: "FAIL" },
    });
    const result = await owner.compare(input(p, baseline, candidate));
    expect(result.baseline.provider).toBe("😀".repeat(40));
    expect(result.baseline.providerClipped).toBe(true);
    expect(result.baseline.commit).toBe("😀".repeat(80));
    expect(result.baseline.commitClipped).toBe(true);
    expect(result.baseline.branch).toBe("😀".repeat(80));
    expect(result.baseline.branchClipped).toBe(true);
    expect(result.items[0]!.title).toBe("😀".repeat(500));
    expect(result.items[0]!.titleClipped).toBe(true);
  });
  it("discloses in-progress runs and never interprets branch commit or speculative context as equivalence", async () => {
    const { p, baseline, candidate } = await pair();
    await prisma.testRun.update({
      where: { id: candidate.id },
      data: {
        status: "RUNNING",
        finishedAt: null,
        executionContext: {
          automationHealth: {
            version: 1,
            configurationHash: "a".repeat(64),
            testDefinitionHash: "b".repeat(64),
            provider: "synthetic-ci",
          },
        },
      },
    });
    const result = await owner.compare(input(p, baseline, candidate));
    expect(result.candidate.status).toBe("RUNNING");
    expect(result.candidate.finishedAt).toBeNull();
    expect(result.comparableConfiguration).toBe(false);
    expect(result.limitations.join(" ")).toContain(
      "In-progress runs are incomplete",
    );
    expect(JSON.stringify(result)).not.toContain("configurationHash");
  });
});
