import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@vaettir/db";
import { appRouter } from "../router.js";
import { createContext } from "../trpc.js";
import { hardDeleteOrganization } from "./orgHardDelete.js";

const runId = `compound-${randomUUID()}`;
const orgIds: string[] = [], users: string[] = [];
let controlId: string;
type Fixture = { orgId: string; projectId: string; userId: string; caseId: string; secondCaseId: string; planId: string; groupId: string; requirementId: string; runId: string; resultId: string; secondResultId: string };
let ours: Fixture, theirs: Fixture;
async function fixture(label: string): Promise<Fixture> {
  const user = await prisma.user.create({ data: { clerkUserId: `${runId}-${label}`, email: `${runId}-${label}@example.com` } }); users.push(user.id);
  const tier = await prisma.planTier.findUniqueOrThrow({ where: { key: "private-beta" } });
  const org = await prisma.organization.create({ data: { name: `${runId}-${label}`, slug: `${runId}-${label}`, planTierId: tier.id } }); orgIds.push(org.id);
  await prisma.membership.create({ data: { organizationId: org.id, userId: user.id, role: "OWNER" } });
  const project = await prisma.project.create({ data: { organizationId: org.id, name: label, slug: label } });
  const type = await prisma.testPlanType.findFirstOrThrow({ where: { isBuiltIn: true } });
  const plan = await prisma.testPlan.create({ data: { projectId: project.id, testPlanTypeId: type.id, name: `${label} private plan` } });
  const group = await prisma.sharedStepGroup.create({ data: { projectId: project.id, name: `${label} private steps`, steps: [{ order: 0, action: "Private action", expectedResult: "Done" }] } });
  const requirement = await prisma.requirement.create({ data: { projectId: project.id, title: `${label} private requirement` } });
  const tc = await prisma.testCase.create({ data: { projectId: project.id, title: `${label} private case`, testType: "FUNCTIONAL" } });
  const secondCase = await prisma.testCase.create({ data: { projectId: project.id, title: `${label} other case`, testType: "FUNCTIONAL" } });
  const testRun = await prisma.testRun.create({ data: { projectId: project.id, ciProvider: "fixture", commitSha: "fixture", branch: "fixture", startedAt: new Date() } });
  const result = await prisma.testResult.create({ data: { testRunId: testRun.id, testCaseId: tc.id, status: "PASS" } });
  const secondResult = await prisma.testResult.create({ data: { testRunId: testRun.id, testCaseId: secondCase.id, status: "PASS" } });
  return { orgId: org.id, projectId: project.id, userId: user.id, caseId: tc.id, secondCaseId: secondCase.id, planId: plan.id, groupId: group.id, requirementId: requirement.id, runId: testRun.id, resultId: result.id, secondResultId: secondResult.id };
}
async function caller() { return appRouter.createCaller({ prisma, user: await prisma.user.findUniqueOrThrow({ where: { id: ours.userId }, include: { memberships: true } }), staff: null }); }
beforeAll(async () => {
  ours = await fixture("ours"); theirs = await fixture("theirs");
  const framework = await prisma.complianceFramework.findFirstOrThrow({ where: { isBuiltIn: true } });
  controlId = (await prisma.complianceControl.create({ data: { frameworkId: framework.id, code: runId, title: "Isolated test control" } })).id;
});
afterAll(async () => {
  for (const orgId of orgIds) {
    await hardDeleteOrganization(prisma, orgId, ours.userId, "Compound tenant fixture cleanup");
    await prisma.organizationDeletionLog.deleteMany({ where: { organizationId: orgId } });
  }
  if (controlId) await prisma.complianceControl.delete({ where: { id: controlId } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
});

describe.sequential("Compound tenant references", () => {
  it("rejects foreign evidence cases, foreign results and mismatched same-project case/result pairs", async () => {
    const api = await caller();
    const pairs = [
      { testCaseId: theirs.caseId },
      { testCaseId: theirs.caseId, testResultId: theirs.resultId },
      { testCaseId: ours.caseId, testResultId: theirs.resultId },
      { testCaseId: ours.caseId, testResultId: ours.secondResultId },
      { testCaseId: "missing-case", testResultId: "missing-result" },
    ];
    for (const pair of pairs) {
      await expect(api.compliance.recordEvidence({ projectId: ours.projectId, controlId, ...pair })).rejects.toMatchObject({ code: "BAD_REQUEST", message: "A referenced record does not belong to this project" });
    }
    expect(await prisma.complianceEvidence.count({ where: { projectId: ours.projectId } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { organizationId: ours.orgId, entityType: "ComplianceEvidence" } })).toBe(0);
  });

  it("records valid same-project evidence with and without a matching result", async () => {
    const api = await caller();
    await expect(api.compliance.recordEvidence({ projectId: ours.projectId, controlId, testCaseId: ours.caseId })).resolves.toMatchObject({ testCaseId: ours.caseId, testResultId: null });
    await expect(api.compliance.recordEvidence({ projectId: ours.projectId, controlId, testCaseId: ours.caseId, testResultId: ours.resultId })).resolves.toMatchObject({ testCaseId: ours.caseId, testResultId: ours.resultId });
    const rows = await api.compliance.listEvidence({ projectId: ours.projectId, controlId });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.testCaseId === ours.caseId)).toBe(true);
  });

  it("rejects foreign plan and shared-step references on case create/update", async () => {
    const api = await caller();
    const content = { title: "Valid content", given: ["a"], when: ["b"], then: ["c"], testType: "FUNCTIONAL" };
    for (const refs of [{ testPlanId: theirs.planId }, { sharedStepGroupId: theirs.groupId }]) {
      await expect(api.testCases.create({ projectId: ours.projectId, ...content, ...refs })).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(api.testCases.update({ id: ours.caseId, ...content, ...refs })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    await expect(api.testCases.update({ id: ours.caseId, ...content, testPlanId: ours.planId, sharedStepGroupId: ours.groupId })).resolves.toMatchObject({ id: ours.caseId });
  });

  it("rejects foreign requirements on acceptance-criterion create/update", async () => {
    const api = await caller();
    await expect(api.testPlans.addAcceptanceCriterion({ testPlanId: ours.planId, description: "criterion", requirementId: theirs.requirementId })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const criterion = await api.testPlans.addAcceptanceCriterion({ testPlanId: ours.planId, description: "criterion", requirementId: ours.requirementId });
    await expect(api.testPlans.updateAcceptanceCriterion({ id: criterion.id, description: "criterion", status: "PENDING", requirementId: theirs.requirementId })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await prisma.acceptanceCriterion.findUniqueOrThrow({ where: { id: criterion.id } })).requirementId).toBe(ours.requirementId);
  });

  it("matches CI external IDs only within the authorized project", async () => {
    const api = await caller();
    await prisma.testCaseSource.create({ data: { testCaseId: theirs.caseId, externalTestId: "Suite::same name", filePath: "fixture", framework: "junit" } });
    const input = { projectId: ours.projectId, ciProvider: "fixture", commitSha: "fixture", branch: "fixture", junitXml: '<testsuite><testcase classname="Suite" name="same name" /></testsuite>' };
    const foreignOnly = await api.testRuns.ingestJUnit(input);
    expect(foreignOnly.matchedCount).toBe(0);
    expect((await prisma.testResult.findFirstOrThrow({ where: { testRunId: foreignOnly.testRunId } })).testCaseId).toBeNull();
    await prisma.testCaseSource.create({ data: { testCaseId: ours.caseId, externalTestId: "Suite::same name", filePath: "fixture", framework: "junit" } });
    const matching = await api.testRuns.ingestJUnit(input);
    expect(matching.matchedCount).toBe(1);
    expect((await prisma.testResult.findFirstOrThrow({ where: { testRunId: matching.testRunId } })).testCaseId).toBe(ours.caseId);
  });

  it("keeps service-token scope inside its issuing organization even with a foreign membership", async () => {
    const api = await caller();
    const key = await api.apiKeys.create({ organizationId: ours.orgId, name: "scoped fixture", role: "EDITOR" });
    const service = await prisma.apiKey.findUniqueOrThrow({ where: { id: key.id } });
    users.push(service.serviceUserId);
    await prisma.membership.create({ data: { organizationId: theirs.orgId, userId: service.serviceUserId, role: "ADMIN" } });
    const context = await createContext({ req: { headers: { authorization: `Bearer ${key.key}` } } } as never);
    const token = appRouter.createCaller(context);
    expect((await token.organization.mine()).map((org) => org.id)).toEqual([ours.orgId]);
    await expect(token.testCases.byId({ id: theirs.caseId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(token.staff.listOrgs()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(token.admin.listOrganizations({})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("does not expose titles or steps through historical invalid cross-project links", async () => {
    const api = await caller();
    const legacy = await prisma.complianceEvidence.create({ data: { projectId: ours.projectId, controlId, testCaseId: theirs.caseId, recordedById: ours.userId } });
    const legacyResult = await prisma.testResult.create({ data: { testRunId: ours.runId, testCaseId: theirs.caseId, status: "PASS" } });
    await prisma.testCase.update({ where: { id: ours.caseId }, data: { sharedStepGroupId: theirs.groupId } });
    await prisma.testRun.update({ where: { id: ours.runId }, data: { manualTestCaseIds: [ours.caseId, theirs.caseId] } });
    try {
      expect((await api.compliance.listEvidence({ projectId: ours.projectId, controlId })).some((r) => r.id === legacy.id)).toBe(false);
      expect((await api.testRuns.byId({ id: ours.runId })).results.find((r) => r.id === legacyResult.id)).toMatchObject({ testCaseId: null, testCaseTitle: null });
      await expect(api.testCases.byId({ id: ours.caseId })).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(api.manualExecution.getForExecution({ testRunId: ours.runId })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    } finally {
      await prisma.testCase.update({ where: { id: ours.caseId }, data: { sharedStepGroupId: null } });
      await prisma.testResult.delete({ where: { id: legacyResult.id } });
      await prisma.complianceEvidence.delete({ where: { id: legacy.id } });
    }
  });
});
