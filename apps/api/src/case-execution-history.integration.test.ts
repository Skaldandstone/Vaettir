import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, Prisma, type TestResultStatus } from "@vaettir/db";
import { appRouter } from "./router.js";
import { hardDeleteOrganization } from "./services/orgHardDelete.js";

const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
const isolated =
  url &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  /test/i.test(url.pathname) &&
  !url.searchParams.has("host");

describe.skipIf(!isolated)("case-centric execution history", () => {
  const key = `execution-history-${randomUUID()}`;
  let owner: ReturnType<typeof appRouter.createCaller>;
  let viewer: typeof owner;
  let outsider: typeof owner;
  let organizationId: string,
    otherOrgId: string,
    actorId: string,
    projectId: string,
    otherProjectId: string;
  beforeAll(async () => {
    const tier = await prisma.planTier.findUniqueOrThrow({
      where: { key: "free" },
    });
    const org = await prisma.organization.create({
      data: { name: key, slug: key, planTierId: tier.id },
    });
    const other = await prisma.organization.create({
      data: { name: `${key}-other`, slug: `${key}-other`, planTierId: tier.id },
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
          name: `Synthetic ${suffix}`,
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
        name: "Execution history",
        caseKey: "history",
      })
    ).id;
    otherProjectId = (
      await outsider.project.create({
        organizationId: otherOrgId,
        name: "Other history",
        caseKey: "outside",
      })
    ).id;
  });
  afterAll(async () => {
    // Only these uniquely owned synthetic organizations, on a verified loopback test DB.
    for (const id of [organizationId, otherOrgId].filter(Boolean)) {
      const org = await prisma.organization.findUnique({ where: { id } });
      if (!org || !org.slug.startsWith(key))
        throw Error("Fixture ownership mismatch");
      await hardDeleteOrganization(
        prisma,
        id,
        actorId,
        "Owned execution-history fixture teardown",
      );
    }
  });
  async function newCase(steps = 0) {
    return owner.testCases.create({
      projectId,
      title: "Original synthetic procedure",
      testType: "FUNCTIONAL",
      given: ["Signed in"],
      when: ["Open report"],
      then: ["Report appears"],
      steps: Array.from({ length: steps }, (_, i) => ({
        action: `Action ${i}`,
        expectedResult: `Expected ${i}`,
      })),
    });
  }
  async function ciRun(
    caseId: string,
    statuses: TestResultStatus[] = ["PASS"],
    at = new Date(),
    scopedProject = projectId,
  ) {
    return prisma.testRun.create({
      data: {
        projectId: scopedProject,
        ciProvider: "synthetic-junit",
        commitSha: "reported-source-commit",
        branch: "synthetic",
        startedAt: at,
        status: "FAILED",
        results: {
          create: statuses.map((status) => ({ testCaseId: caseId, status })),
        },
      },
    });
  }
  const query = (id: string, limit = 10, before?: { runId: string }) =>
    viewer.caseExecutionHistory.list({
      projectId,
      testCaseId: id,
      limit,
      before,
    });

  it("pages 45 equal-timestamp executions without repeats or unrelated cases", async () => {
    const c = await newCase(),
      other = await newCase();
    const at = new Date("2026-01-02T03:04:05Z");
    const runs = await Promise.all(
      Array.from({ length: 45 }, () => ciRun(c.id, ["PASS"], at)),
    );
    await ciRun(other.id, ["FAIL"], at);
    const first = await query(c.id, 15),
      second = await query(c.id, 15, first.nextCursor!),
      third = await query(c.id, 15, second.nextCursor!);
    const ids = [...first.items, ...second.items, ...third.items].map(
      (r) => r.runId,
    );
    expect(ids).toEqual(
      runs
        .map((r) => r.id)
        .sort()
        .reverse(),
    );
    expect(new Set(ids).size).toBe(45);
    expect(third.nextCursor).toBeNull();
    expect(first.testCase.displayId).toMatch(/^history-\d+$/);
  });
  it("keeps case verdict separate from overall run and groups mixed parameter results, including flaky", async () => {
    const c = await newCase();
    const pass = await ciRun(c.id),
      mixed = await ciRun(c.id, [
        "PASS",
        "PASS",
        "FAIL",
        "SKIP",
        "FLAKY",
        "BLOCKED",
      ]);
    const failResult = await prisma.testResult.findFirstOrThrow({
      where: { testRunId: mixed.id, status: "FAIL" },
    });
    await prisma.testResultArtifact.create({
      data: {
        testResultId: failResult.id,
        type: "SCREENSHOT",
        storageUrl: "https://example.invalid/synthetic-private-artifact",
      },
    });
    const page = await query(c.id);
    const good = page.items.find((r) => r.runId === pass.id)!;
    expect(good).toMatchObject({
      outcome: "PASS",
      runStatus: "FAILED",
      starter: null,
      platform: null,
      build: null,
    });
    const bad = page.items.find((r) => r.runId === mixed.id)!;
    expect(bad).toMatchObject({
      outcome: "MIXED",
      outcomeMode: "MULTIPLE_REPORTED_RESULTS",
      artifactCount: 1,
    });
    expect(JSON.stringify(bad)).not.toContain("synthetic-private-artifact");
    expect(bad.outcomeCounts).toEqual(
      expect.arrayContaining([
        { status: "PASS", count: 2 },
        { status: "FLAKY", count: 1 },
      ]),
    );
    const flaky = await ciRun(c.id, ["FLAKY"]);
    expect(
      (await query(c.id)).items.find((r) => r.runId === flaky.id)?.outcome,
    ).toBe("FLAKY");
  });
  it("keeps planned and partially observed manual cases uncompleted", async () => {
    const c = await newCase(2);
    const run = await owner.manualExecution.start({
      projectId,
      testCaseIds: [c.id],
      executionContext: { platform: "PC", build: "synthetic-build" },
    });
    let item = (await query(c.id)).items[0]!;
    expect(item).toMatchObject({
      planned: true,
      outcome: "NOT_RECORDED",
      outcomeMode: "PLANNED_ONLY",
      reportedCommit: null,
      platform: "PC",
      build: "synthetic-build",
      definition: { stepCount: 2 },
    });
    await owner.manualExecution.recordStepResult({
      testRunId: run.testRunId,
      testCaseId: c.id,
      stepIndex: 0,
      status: "PASS",
      expectedRevisionId: null,
      idempotencyKey: randomUUID(),
      evidenceAttachmentIds: [],
    });
    item = (await query(c.id)).items[0]!;
    expect(item).toMatchObject({
      outcome: "NOT_RECORDED",
      outcomeMode: "PARTIAL_STEPS",
      steps: { recordedCount: 1, correctionCount: 0 },
    });
  });
  it("keeps corrections in one execution and retains frozen identity/title through edits and archiving", async () => {
    const c = await newCase(1);
    const { testRunId } = await owner.manualExecution.start({
      projectId,
      testCaseIds: [c.id],
    });
    const input = {
      testRunId,
      testCaseId: c.id,
      stepIndex: 0,
      expectedRevisionId: null,
      idempotencyKey: randomUUID(),
      evidenceAttachmentIds: [],
    };
    const first = await owner.manualExecution.recordStepResult({
      ...input,
      status: "FAIL",
    });
    const second = await owner.manualExecution.recordStepResult({
      ...input,
      expectedRevisionId: first.revisionId,
      idempotencyKey: randomUUID(),
      status: "PASS",
      correctionReason: "Synthetic mistyped verdict",
    });
    await owner.manualExecution.recordStepResult({
      ...input,
      expectedRevisionId: second.revisionId,
      idempotencyKey: randomUUID(),
      status: "PASS",
      correctionReason: "Synthetic note correction",
      note: "Corrected note",
    });
    await prisma.user.update({
      where: { id: actorId },
      data: { name: "Renamed current profile" },
    });
    await prisma.testCase.update({
      where: { id: c.id },
      data: {
        title: "Later edited title",
        suitePath: "Moved suite",
        archived: true,
      },
    });
    await prisma.testCaseStep.updateMany({
      where: { testCaseId: c.id },
      data: { action: "Later edited action" },
    });
    const page = await query(c.id);
    expect(page.items).toHaveLength(1);
    expect(page.testCase).toMatchObject({
      archived: true,
      title: "Later edited title",
    });
    expect(page.items[0]).toMatchObject({
      outcome: "PASS",
      outcomeMode: "STEP_RESULTS",
      runStatus: "RUNNING",
      definition: {
        source: "FROZEN_MANUAL_SUMMARY",
        originalCaseId: c.id,
        titleAtRun: "Original synthetic procedure",
        stepCount: 1,
      },
      steps: {
        correctionCount: 2,
        recordedCount: 1,
        lastObservation: { recordedActorName: "Synthetic owner" },
      },
      starter: { label: "Renamed current profile", source: "CURRENT_PROFILE" },
    });
    await prisma.testCase.update({
      where: { id: c.id },
      data: { archived: false },
    });
    await owner.manualExecution.start({
      projectId,
      testCaseIds: [c.id],
      idempotencyKey: randomUUID(),
    });
    expect((await query(c.id)).items).toHaveLength(2); // A new execution, not an inferred verified retest.
  });
  it("labels GWT-only snapshots accurately and explains mutable whole-case history limits", async () => {
    const c = await newCase();
    const { testRunId } = await owner.manualExecution.start({
      projectId,
      testCaseIds: [c.id],
    });
    await owner.manualExecution.recordResult({
      testRunId,
      testCaseId: c.id,
      status: "FAIL",
      note: "First note",
    });
    await owner.manualExecution.recordResult({
      testRunId,
      testCaseId: c.id,
      status: "PASS",
      note: "Changed note",
    });
    const item = (await query(c.id)).items[0]!;
    expect(item).toMatchObject({
      outcome: "PASS",
      outcomeMode: "CASE_RESULT",
      definition: { stepCount: 0 },
      steps: { recordedCount: 0, correctionCount: 0, lastObservation: null },
    });
    expect(item.limitations.join(" ")).toContain(
      "earlier changes, observer and observation time were not recorded",
    );
  });
  it("does not substitute current case content for legacy or unsupported snapshots", async () => {
    const c = await newCase();
    const legacy = await ciRun(c.id);
    expect((await query(c.id)).items[0]).toMatchObject({
      runId: legacy.id,
      definition: { source: "NOT_RECORDED", titleAtRun: null, stepCount: null },
    });
    for (const context of [
      null,
      "scalar",
      [],
      { version: 2 },
      { version: 1, caseDefinitions: "not an array" },
      { version: 1, caseDefinitions: ["invalid"] },
    ]) {
      const run = await prisma.testRun.create({
        data: {
          projectId,
          ciProvider: "manual",
          commitSha: "manual",
          branch: "manual",
          startedAt: new Date(),
          status: "RUNNING",
          manualTestCaseIds: [c.id],
          executionContext: context === null ? Prisma.JsonNull : context,
        },
      });
      const item = (await query(c.id)).items.find((r) => r.runId === run.id)!;
      expect(item.definition.titleAtRun).toBeNull();
      expect(item.outcome).toBe("NOT_RECORDED");
    }
  });
  it("bounds oversized and duplicate snapshot metadata instead of copying payloads", async () => {
    const c = await newCase();
    const { testRunId } = await owner.manualExecution.start({
      projectId,
      testCaseIds: [c.id],
    });
    const original = (
      await prisma.testRun.findUniqueOrThrow({ where: { id: testRunId } })
    ).executionContext as Record<string, Prisma.JsonValue>;
    await prisma.testRun.update({
      where: { id: testRunId },
      data: { executionContext: { ...original, extra: "x".repeat(2097153) } },
    });
    let item = (await query(c.id)).items[0]!;
    expect(item.definition).toMatchObject({
      source: "UNSUPPORTED_METADATA",
      titleAtRun: null,
    });
    expect(JSON.stringify(item).length).toBeLessThan(3000);
    const definitions = original.caseDefinitions as Prisma.JsonArray;
    await prisma.testRun.update({
      where: { id: testRunId },
      data: {
        executionContext: {
          ...original,
          caseDefinitions: [...definitions, ...definitions],
        },
      },
    });
    item = (await query(c.id)).items[0]!;
    expect(item.definition.source).toBe("UNSUPPORTED_METADATA");
  });
  it("rejects foreign project/case cursors and historical foreign run mappings", async () => {
    const c = await newCase(),
      otherCase = await newCase();
    const unrelated = await ciRun(otherCase.id),
      foreign = await ciRun(c.id, ["FAIL"], new Date(), otherProjectId);
    await expect(
      query(c.id, 10, { runId: unrelated.id }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(query(c.id, 10, { runId: foreign.id })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect((await query(c.id)).items).toEqual([]);
    await expect(
      outsider.caseExecutionHistory.list({ projectId, testCaseId: c.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      viewer.caseExecutionHistory.list({
        projectId: otherProjectId,
        testCaseId: c.id,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(query("nonexistent-case")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const sibling = await owner.project.create({
      organizationId,
      name: "Sibling",
      caseKey: "sibling",
    });
    await expect(
      viewer.caseExecutionHistory.list({
        projectId: sibling.id,
        testCaseId: c.id,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("rechecks current memberships and suspension rather than accepting stale owner context", async () => {
    const c = await newCase();
    await ciRun(c.id);
    await prisma.membership.delete({
      where: { organizationId_userId: { organizationId, userId: actorId } },
    });
    try {
      await expect(
        owner.caseExecutionHistory.list({ projectId, testCaseId: c.id }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    } finally {
      await prisma.membership.create({
        data: { organizationId, userId: actorId, role: "OWNER" },
      });
    }
    await prisma.organization.update({
      where: { id: organizationId },
      data: { suspendedAt: new Date() },
    });
    try {
      await expect(query(c.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    } finally {
      await prisma.organization.update({
        where: { id: organizationId },
        data: { suspendedAt: null },
      });
    }
  });
  it("rejects fractional/excessive pages and deleted cursors without claiming empty history", async () => {
    const c = await newCase(),
      run = await ciRun(c.id);
    await expect(query(c.id, 1.5)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(query(c.id, 26)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await prisma.testResult.deleteMany({ where: { testRunId: run.id } });
    await prisma.testRun.delete({ where: { id: run.id } });
    await expect(query(c.id, 10, { runId: run.id })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });
  it("rejects the former organization's request after project reparenting", async () => {
    const c = await newCase();
    await ciRun(c.id);
    await prisma.project.update({
      where: { id: projectId },
      data: { organizationId: otherOrgId },
    });
    try {
      await expect(query(c.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    } finally {
      await prisma.project.update({
        where: { id: projectId },
        data: { organizationId },
      });
    }
  });
});
