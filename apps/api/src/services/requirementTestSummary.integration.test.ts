// Real-DB proof that the ticket-panel summary aggregates correctly across
// Requirement -> AcceptanceCriterion -> TestPlan -> TestCase -> TestResult,
// plus the project's open risk flags - the exact chain a Jira/Linear
// unfurl preview (or the in-app panel) needs to be genuinely informative,
// not just a bare link.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@vaettir/db";
import { computeRequirementTestSummary } from "./requirementTestSummary.js";

const RUN = `req-summary-${randomUUID()}`;
let orgId: string;
let projectId: string;
let releaseId: string;
let requirementId: string;
let passingCaseId: string;
let failingCaseId: string;
let neverRunCaseId: string;

beforeAll(async () => {
  const tier = await prisma.planTier.findFirstOrThrow();
  const org = await prisma.organization.create({ data: { name: `Req summary test ${RUN}`, slug: RUN, planTierId: tier.id } });
  orgId = org.id;
  const project = await prisma.project.create({ data: { organizationId: orgId, name: "Summary project", slug: "summary-project" } });
  projectId = project.id;
  const release = await prisma.release.create({ data: { projectId, name: "v1.0", status: "SHIPPED" } });
  releaseId = release.id;
  const planType = await prisma.testPlanType.findFirstOrThrow();
  const plan = await prisma.testPlan.create({ data: { projectId, testPlanTypeId: planType.id, releaseId, name: "plan" } });

  const requirement = await prisma.requirement.create({ data: { projectId, title: "Checkout must handle empty carts" } });
  requirementId = requirement.id;
  await prisma.acceptanceCriterion.createMany({
    data: [
      { testPlanId: plan.id, requirementId, description: "a", status: "MET" },
      { testPlanId: plan.id, requirementId, description: "b", status: "PENDING" },
    ],
  });

  const [passingCase, failingCase, neverRunCase] = await Promise.all([
    prisma.testCase.create({
      data: { projectId, testPlanId: plan.id, title: "Passing case", testType: "FUNCTIONAL", given: [], when: [], then: [] },
    }),
    prisma.testCase.create({
      data: { projectId, testPlanId: plan.id, title: "Failing case", testType: "FUNCTIONAL", given: [], when: [], then: [] },
    }),
    prisma.testCase.create({
      data: {
        projectId,
        testPlanId: plan.id,
        title: "Never-run case",
        testType: "FUNCTIONAL",
        given: [],
        when: [],
        then: [],
        reviewStatus: "PENDING_REVIEW",
      },
    }),
  ]);
  passingCaseId = passingCase.id;
  failingCaseId = failingCase.id;
  neverRunCaseId = neverRunCase.id;

  const run = await prisma.testRun.create({
    data: { projectId, ciProvider: "manual", commitSha: "abc123", branch: "main", startedAt: new Date() },
  });
  await prisma.testResult.createMany({
    data: [
      { testRunId: run.id, testCaseId: passingCaseId, status: "PASS" },
      { testRunId: run.id, testCaseId: failingCaseId, status: "FAIL" },
    ],
  });

  await prisma.riskFlag.create({ data: { releaseId, severity: "CRITICAL", source: "MANUAL_FLAG", description: "Known payment bug" } });
  await prisma.riskFlag.create({
    data: { releaseId, severity: "LOW", source: "MANUAL_FLAG", description: "Resolved cosmetic issue", resolvedAt: new Date() },
  });
});

afterAll(async () => {
  if (!orgId) return;
  await prisma.testResult.deleteMany({ where: { testCaseId: { in: [passingCaseId, failingCaseId, neverRunCaseId] } } });
  await prisma.testRun.deleteMany({ where: { projectId } });
  await prisma.testCase.deleteMany({ where: { projectId } });
  await prisma.acceptanceCriterion.deleteMany({ where: { requirementId } });
  await prisma.requirement.deleteMany({ where: { projectId } });
  await prisma.riskFlag.deleteMany({ where: { releaseId } });
  await prisma.testPlan.deleteMany({ where: { releaseId } });
  await prisma.release.deleteMany({ where: { id: releaseId } });
  await prisma.project.deleteMany({ where: { organizationId: orgId } });
  await prisma.organization.delete({ where: { id: orgId } });
});

describe("computeRequirementTestSummary (real DB)", () => {
  it("aggregates acceptance criteria, test case pass/fail/never-run, and open risk flags", async () => {
    const summary = await computeRequirementTestSummary(prisma, requirementId);

    expect(summary.requirementTitle).toBe("Checkout must handle empty carts");
    expect(summary.acceptanceCriteria).toEqual({ total: 2, met: 1, pending: 1, notMet: 0, atRisk: 0 });

    expect(summary.testCases.total).toBe(3);
    expect(summary.testCases.passing).toBe(1);
    expect(summary.testCases.failing).toBe(1);
    expect(summary.testCases.neverRun).toBe(1);
    expect(summary.testCases.pendingReview).toBe(1);

    expect(summary.failingTestCases).toHaveLength(1);
    expect(summary.failingTestCases[0]!.id).toBe(failingCaseId);
    expect(summary.failingTestCases[0]!.title).toBe("Failing case");

    // Only the unresolved CRITICAL flag - the resolved LOW one must not appear.
    expect(summary.openRiskFlags).toHaveLength(1);
    expect(summary.openRiskFlags[0]!.severity).toBe("CRITICAL");
    expect(summary.openRiskFlags[0]!.description).toBe("Known payment bug");
  });

  it("returns zeroed counts for a requirement with no acceptance criteria at all", async () => {
    const bare = await prisma.requirement.create({ data: { projectId, title: "No criteria yet" } });
    const summary = await computeRequirementTestSummary(prisma, bare.id);
    expect(summary.acceptanceCriteria).toEqual({ total: 0, met: 0, pending: 0, notMet: 0, atRisk: 0 });
    expect(summary.testCases.total).toBe(0);
    await prisma.requirement.delete({ where: { id: bare.id } });
  });
});
