import { randomUUID } from "node:crypto";
import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { assessTestCaseRisk, reviewTestDesign } from "@vaettir/ai-agent";
vi.mock("@vaettir/ai-agent", async (original) => ({
  ...(await original<typeof import("@vaettir/ai-agent")>()),
  assessTestCaseRisk: vi.fn(),
  reviewTestDesign: vi.fn(),
}));
import { prisma } from "@vaettir/db";
import { appRouter } from "./router.js";
import { runCaseAnalysisQueueOnce } from "./jobs/caseAnalysisQueueWorker.js";
import {
  hardDeleteOrganization,
  previewOrgHardDelete,
} from "./services/orgHardDelete.js";
const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
const isolated =
  url &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  /test/i.test(url.pathname) &&
  !url.searchParams.has("host");
describe.skipIf(!isolated)("durable reviewed case analysis queue", () => {
  let owner: ReturnType<typeof appRouter.createCaller>,
    viewer: ReturnType<typeof appRouter.createCaller>,
    outsider: ReturnType<typeof appRouter.createCaller>;
  let organizationId: string, projectId: string, ownerId: string;
  const actorIds: string[] = [];
  beforeAll(async () => {
    const key = `analysis-queue-${Date.now()}`;
    const tier = await prisma.planTier.findUniqueOrThrow({
      where: { key: "free" },
    });
    organizationId = (
      await prisma.organization.create({
        data: { name: key, slug: key, planTierId: tier.id },
      })
    ).id;
    const user = await prisma.user.create({
      data: {
        email: `${key}@example.com`,
        clerkUserId: key,
        memberships: { create: { organizationId, role: "OWNER" } },
      },
      include: { memberships: true },
    });
    const read = await prisma.user.create({
      data: {
        email: `${key}-read@example.com`,
        clerkUserId: `${key}-read`,
        memberships: { create: { organizationId, role: "VIEWER" } },
      },
      include: { memberships: true },
    });
    const other = await prisma.user.create({
      data: { email: `${key}-other@example.com`, clerkUserId: `${key}-other` },
      include: { memberships: true },
    });
    actorIds.push(user.id, read.id, other.id);
    ownerId = user.id;
    owner = appRouter.createCaller({ prisma, user });
    viewer = appRouter.createCaller({ prisma, user: read });
    outsider = appRouter.createCaller({ prisma, user: other });
    projectId = (
      await owner.project.create({
        organizationId,
        name: "Synthetic durable scope",
      })
    ).id;
    await prisma.aiCreditTransaction.create({
      data: {
        organizationId,
        type: "GRANT",
        amount: 10000,
        description: "Synthetic queue fixture",
      },
    });
  });
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assessTestCaseRisk).mockResolvedValue({
      severity: "HIGH",
      riskScore: 77,
      rationale: "Synthetic checkout failure",
    });
    vi.mocked(reviewTestDesign).mockResolvedValue({
      summary: "Synthetic design review",
      recommendedLevel: "UNIT",
      framework: "JEST_VITEST",
      rationale: "A pure calculation",
      improvements: [],
      proposedSteps: [],
      retainCoverage: [],
      missingEvidence: [],
      evidenceRefs: ["test-case"],
    });
  });
  afterAll(async () => {
    const preview = await previewOrgHardDelete(prisma, organizationId);
    expect(preview.rowCounts.CaseAnalysisQueue).toBeGreaterThan(0);
    expect(preview.rowCounts.CaseAnalysisQueueItem).toBeGreaterThan(0);
    const result = await hardDeleteOrganization(
      prisma,
      organizationId,
      ownerId,
      "Synthetic queue test cleanup",
    );
    expect(result.rowCounts.CaseAnalysisQueue).toBe(
      preview.rowCounts.CaseAnalysisQueue,
    );
    expect(result.rowCounts.CaseAnalysisQueueItem).toBe(
      preview.rowCounts.CaseAnalysisQueueItem,
    );
    await prisma.organizationDeletionLog.delete({
      where: { id: result.deletionLogId },
    });
    await prisma.user.deleteMany({ where: { id: { in: actorIds } } });
  });
  async function cases(count = 1) {
    return Promise.all(
      Array.from({ length: count }, (_, i) =>
        owner.testCases.quickCreate({
          projectId,
          title: `Synthetic total ${randomUUID()}-${i}`,
        }),
      ),
    );
  }
  async function prepare(
    ids: string[],
    action: "RISK" | "TYPE_DESIGN" = "RISK",
  ) {
    return owner.caseAnalysisQueue.review({
      projectId,
      ids,
      action,
      requestId: randomUUID(),
    });
  }
  async function approve(scope: Awaited<ReturnType<typeof prepare>>) {
    return owner.caseAnalysisQueue.approve({
      projectId,
      id: scope.id,
      scopeHash: scope.scopeHash,
      maximumCredits: scope.maximumCredits,
      approved: true,
      allowCaseProcessing: true,
    });
  }
  it("persists all selected cases with immutable cost and response-loss recovery", async () => {
    const rows = await cases(27),
      ids = rows.map((r) => r.id),
      requestId = randomUUID();
    const input = { projectId, ids, action: "RISK" as const, requestId };
    const scope = await owner.caseAnalysisQueue.review(input);
    expect(scope).toMatchObject({
      caseCount: 27,
      maximumCredits: 54,
      status: "REVIEW",
      counts: { QUEUED: 27 },
    });
    expect((await owner.caseAnalysisQueue.review(input)).id).toBe(scope.id);
    await expect(
      owner.caseAnalysisQueue.review({ ...input, ids: ids.slice(0, 26) }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(assessTestCaseRisk).not.toHaveBeenCalled();
    await owner.caseAnalysisQueue.cancel({ projectId, id: scope.id });
  });
  it("enforces current tenant/actor/full-seat approval and admin requests without granting spending", async () => {
    const ids = (await cases()).map((r) => r.id);
    await expect(
      outsider.caseAnalysisQueue.review({
        projectId,
        ids,
        action: "RISK",
        requestId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const scope = await viewer.caseAnalysisQueue.review({
      projectId,
      ids,
      action: "RISK",
      requestId: randomUUID(),
    });
    expect(scope.canSpend).toBe(false);
    const input = {
      projectId,
      id: scope.id,
      scopeHash: scope.scopeHash,
      maximumCredits: scope.maximumCredits,
      approved: true as const,
      allowCaseProcessing: true as const,
    };
    await expect(viewer.caseAnalysisQueue.approve(input)).rejects.toMatchObject(
      { code: "FORBIDDEN" },
    );
    await expect(
      owner.caseAnalysisQueue.byId({ projectId, id: scope.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const request = await viewer.caseAnalysisQueue.requestAdmin({
      projectId,
      id: scope.id,
      reason: "Synthetic review request",
    });
    expect(
      (
        await viewer.caseAnalysisQueue.requestAdmin({
          projectId,
          id: scope.id,
          reason: "Same scope",
        })
      ).id,
    ).toBe(request.id);
    expect(
      (await viewer.caseAnalysisQueue.byId({ projectId, id: scope.id })).status,
    ).toBe("REVIEW");
    expect(assessTestCaseRisk).not.toHaveBeenCalled();
    await viewer.caseAnalysisQueue.cancel({ projectId, id: scope.id });
  });
  it("requires explicit consent and exact cap, refuses edited scope before spending", async () => {
    const [tc] = await cases();
    const scope = await prepare([tc!.id]);
    const input = {
      projectId,
      id: scope.id,
      scopeHash: scope.scopeHash,
      maximumCredits: scope.maximumCredits,
      approved: true as const,
      allowCaseProcessing: true as const,
    };
    await expect(
      owner.caseAnalysisQueue.approve({
        ...input,
        allowCaseProcessing: false as true,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      owner.caseAnalysisQueue.approve({ ...input, maximumCredits: 1 }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await prisma.testCase.update({
      where: { id: tc!.id },
      data: { given: ["Human-added condition"] },
    });
    await expect(approve(scope)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(assessTestCaseRisk).not.toHaveBeenCalled();
    await owner.caseAnalysisQueue.cancel({ projectId, id: scope.id });
  });
  it("queues approval once, claims once across concurrent workers and preserves identical reruns", async () => {
    const [tc] = await cases();
    const scope = await prepare([tc!.id]);
    await Promise.all([approve(scope), approve(scope)]);
    await Promise.all(
      Array.from({ length: 6 }, () => runCaseAnalysisQueueOnce(prisma)),
    );
    const state = await owner.caseAnalysisQueue.byId({
      projectId,
      id: scope.id,
    });
    expect(state).toMatchObject({ status: "COMPLETE", counts: { READY: 1 } });
    expect(assessTestCaseRisk).toHaveBeenCalledTimes(1);
    expect(
      await prisma.aiCreditTransaction.count({
        where: {
          organizationId,
          type: "CONSUMPTION",
          description: {
            contains: (
              await prisma.testCaseRiskReview.findFirstOrThrow({
                where: { testCaseId: tc!.id },
              })
            ).id,
          },
        },
      }),
    ).toBe(1);
    const identical = await prepare([tc!.id]);
    expect(identical.maximumCredits).toBe(0);
    expect(identical.counts.SAVED).toBe(1);
    await approve(identical);
    await runCaseAnalysisQueueOnce(prisma);
    expect(assessTestCaseRisk).toHaveBeenCalledTimes(1);
  });
  it("cancels after claim but before charge without leaving a paid or generating reservation", async () => {
    const [tc] = await cases();
    const scope = await prepare([tc!.id]);
    await approve(scope);
    const faultDb = prisma.$extends({
      query: {
        testCaseRiskReview: {
          async create({ args, query }) {
            const row = await query(args);
            await owner.caseAnalysisQueue.cancel({ projectId, id: scope.id });
            return row;
          },
        },
      },
    });
    await runCaseAnalysisQueueOnce(faultDb as unknown as typeof prisma);
    const state = await owner.caseAnalysisQueue.byId({
      projectId,
      id: scope.id,
    });
    expect(state).toMatchObject({ status: "CANCELLED", counts: { FAILED: 1 } });
    expect(state.items[0]?.charged).toBe(false);
    expect(
      await prisma.testCaseRiskReview.count({ where: { testCaseId: tc!.id } }),
    ).toBe(0);
    expect(assessTestCaseRisk).not.toHaveBeenCalled();
  });
  it("retains already charged output during cancellation and never spends for subsequent cases", async () => {
    const rows = await cases(2);
    const scope = await prepare(rows.map((r) => r.id));
    await approve(scope);
    vi.mocked(assessTestCaseRisk).mockImplementationOnce(async () => {
      await owner.caseAnalysisQueue.cancel({ projectId, id: scope.id });
      return {
        severity: "LOW",
        riskScore: 10,
        rationale: "Synthetic retained result",
      };
    });
    await runCaseAnalysisQueueOnce(prisma);
    await runCaseAnalysisQueueOnce(prisma);
    const state = await owner.caseAnalysisQueue.byId({
      projectId,
      id: scope.id,
    });
    expect(state.counts).toEqual({ READY: 1, SKIPPED: 1 });
    expect(state.status).toBe("CANCELLED");
    expect(state.items.filter((i) => i.charged)).toHaveLength(1);
    expect(assessTestCaseRisk).toHaveBeenCalledTimes(1);
  });
  it("stops unknown paid failures and expired leases without an automatic second provider attempt", async () => {
    const [tc] = await cases();
    const scope = await prepare([tc!.id]);
    await approve(scope);
    vi.mocked(assessTestCaseRisk).mockRejectedValueOnce(
      new Error("Synthetic ambiguous provider failure"),
    );
    await runCaseAnalysisQueueOnce(prisma);
    await runCaseAnalysisQueueOnce(prisma);
    expect(
      (await owner.caseAnalysisQueue.byId({ projectId, id: scope.id })).status,
    ).toBe("STOPPED");
    expect(assessTestCaseRisk).toHaveBeenCalledTimes(1);
    const rerun = await prepare([tc!.id]);
    expect(rerun.maximumCredits).toBe(0);
    expect(rerun.counts.UNKNOWN).toBe(1);
    await owner.caseAnalysisQueue.cancel({ projectId, id: scope.id });
    await owner.caseAnalysisQueue.cancel({ projectId, id: rerun.id });
    const [next] = await cases();
    const expired = await prepare([next!.id]);
    await approve(expired);
    const item = await prisma.caseAnalysisQueueItem.findFirstOrThrow({
      where: { queueId: expired.id },
    });
    await prisma.caseAnalysisQueueItem.update({
      where: { id: item.id },
      data: { status: "RUNNING" },
    });
    await prisma.caseAnalysisQueue.update({
      where: { id: expired.id },
      data: {
        status: "RUNNING",
        activeItemId: item.id,
        leaseOwner: "lost-process",
        leaseExpiresAt: new Date(0),
      },
    });
    await runCaseAnalysisQueueOnce(prisma);
    expect(
      (await owner.caseAnalysisQueue.byId({ projectId, id: expired.id })).counts
        .UNKNOWN,
    ).toBe(1);
    expect(assessTestCaseRisk).toHaveBeenCalledTimes(1);
    await owner.caseAnalysisQueue.cancel({ projectId, id: expired.id });
  });
  it("refuses current membership loss and case changes after approval without spend", async () => {
    const [tc] = await cases();
    const scope = await prepare([tc!.id]);
    await approve(scope);
    await prisma.membership.update({
      where: { organizationId_userId: { organizationId, userId: ownerId } },
      data: { role: "VIEWER" },
    });
    await runCaseAnalysisQueueOnce(prisma);
    expect(
      (await owner.caseAnalysisQueue.byId({ projectId, id: scope.id })).status,
    ).toBe("STOPPED");
    expect(assessTestCaseRisk).not.toHaveBeenCalled();
    await prisma.membership.update({
      where: { organizationId_userId: { organizationId, userId: ownerId } },
      data: { role: "OWNER" },
    });
    await owner.caseAnalysisQueue.cancel({ projectId, id: scope.id });
    const changed = await prepare([tc!.id]);
    await approve(changed);
    await prisma.testCase.update({
      where: { id: tc!.id },
      data: { then: ["Edited after approval"] },
    });
    await runCaseAnalysisQueueOnce(prisma);
    expect(
      (await owner.caseAnalysisQueue.byId({ projectId, id: changed.id }))
        .items[0]?.charged,
    ).toBe(false);
    expect(assessTestCaseRisk).not.toHaveBeenCalled();
  });
  it("saves type/design recommendations without modifying the human case", async () => {
    const [tc] = await cases();
    const original = await prisma.testCase.findUniqueOrThrow({
      where: { id: tc!.id },
    });
    const scope = await prepare([tc!.id], "TYPE_DESIGN");
    expect(scope.maximumCredits).toBe(12);
    await approve(scope);
    await runCaseAnalysisQueueOnce(prisma);
    expect(
      (await owner.caseAnalysisQueue.byId({ projectId, id: scope.id })).counts
        .READY,
    ).toBe(1);
    expect(
      await prisma.testCase.findUniqueOrThrow({ where: { id: tc!.id } }),
    ).toEqual(original);
    expect(reviewTestDesign).toHaveBeenCalledTimes(1);
  });

  it("reports a definite unpaid failure separately and continues only the other approved case", async () => {
    const rows = await cases(2);
    const scope = await prepare(rows.map((r) => r.id));
    await approve(scope);
    const first = await prisma.caseAnalysisQueueItem.findFirstOrThrow({
      where: { queueId: scope.id },
      orderBy: { position: "asc" },
    });
    await prisma.testCase.update({
      where: { id: first.caseId },
      data: { given: ["Changed approved condition"] },
    });
    await runCaseAnalysisQueueOnce(prisma);
    expect(
      (await owner.caseAnalysisQueue.byId({ projectId, id: scope.id })).counts,
    ).toEqual({ FAILED: 1, QUEUED: 1 });
    expect(assessTestCaseRisk).not.toHaveBeenCalled();
    await runCaseAnalysisQueueOnce(prisma);
    const state = await owner.caseAnalysisQueue.byId({
      projectId,
      id: scope.id,
    });
    expect(state).toMatchObject({
      status: "COMPLETE",
      counts: { FAILED: 1, READY: 1 },
    });
    expect(state.items.filter((i) => i.charged)).toHaveLength(1);
    expect(assessTestCaseRisk).toHaveBeenCalledTimes(1);
    expect(vi.mocked(assessTestCaseRisk).mock.calls[0]?.[1]).toEqual({
      timeout: 90000,
      maxRetries: 0,
    });
  });
  it("bounds intake and procedure bytes and does not leak a disappeared case native link", async () => {
    const [tc] = await cases();
    const scope = await prepare([tc!.id]);
    await expect(
      owner.caseAnalysisQueue.review({
        projectId,
        ids: Array.from({ length: 1001 }, (_, i) => `missing-${i}`),
        action: "RISK",
        requestId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await prisma.testCase.update({
      where: { id: tc!.id },
      data: { background: "x".repeat(65000) },
    });
    await expect(prepare([tc!.id])).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await prisma.testCase.delete({ where: { id: tc!.id } });
    expect(
      (await owner.caseAnalysisQueue.byId({ projectId, id: scope.id })).items[0]
        ?.caseId,
    ).toBeNull();
    await owner.caseAnalysisQueue.cancel({ projectId, id: scope.id });
  });
});
