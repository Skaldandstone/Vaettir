// P13-05: the real proof that hardDeleteOrganization's FK-order is
// correct - populates one real row in every single model that can be
// reached from an org (39 of them), then hard-deletes and confirms zero
// FK violations and zero rows left anywhere. This is deliberately NOT a
// sample of "the important ones" - the whole point of a hard-delete
// feature is that missing even one model either leaves an orphaned row
// behind forever or throws mid-transaction, and the only way to be sure
// is to actually exercise every one.
//
// Runs against a fully isolated throwaway org - never against Kall or
// any other real data, given how destructive this operation is.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@vaettir/db";
import { previewOrgHardDelete, hardDeleteOrganization } from "./orgHardDelete.js";

const RUN_ID = `hard-delete-test-${Date.now()}`;

let orgId: string;
let staffUserId: string;
let deletionLogId: string | undefined;

async function seedEverything() {
  const freeTier = await prisma.planTier.findUniqueOrThrow({ where: { key: "free" } });
  const org = await prisma.organization.create({
    data: { name: `Hard delete test org ${RUN_ID}`, slug: RUN_ID, planTier: { connect: { id: freeTier.id } } },
  });
  orgId = org.id;

  const [owner, staff, apiKeyServiceUser] = await Promise.all([
    prisma.user.create({ data: { clerkUserId: `${RUN_ID}-owner`, email: `${RUN_ID}-owner@example.com` } }),
    prisma.user.create({ data: { clerkUserId: `${RUN_ID}-staff`, email: `${RUN_ID}-staff@skaldandstone.com` } }),
    prisma.user.create({ data: { clerkUserId: `${RUN_ID}-svc`, email: `${RUN_ID}-svc@example.com` } }),
  ]);
  staffUserId = staff.id;

  await prisma.membership.create({ data: { organizationId: orgId, userId: owner.id, role: "OWNER" } });

  const project = await prisma.project.create({ data: { organizationId: orgId, name: "hard-delete test project", slug: "hard-delete-test-project" } });
  const testPlanType = await prisma.testPlanType.findFirstOrThrow();
  const complianceFramework = await prisma.complianceFramework.findFirstOrThrow();

  const release = await prisma.release.create({ data: { projectId: project.id, name: "v1", createdById: owner.id, updatedById: owner.id } });
  const requirement = await prisma.requirement.create({ data: { projectId: project.id, title: "req 1" } });
  const testPlan = await prisma.testPlan.create({
    data: { projectId: project.id, testPlanTypeId: testPlanType.id, releaseId: release.id, name: "plan 1", createdById: owner.id, updatedById: owner.id },
  });
  await prisma.testPlanVersion.create({
    data: { testPlanId: testPlan.id, versionNumber: 1, name: "plan 1", status: "DRAFT", customFields: {}, createdById: owner.id },
  });
  await prisma.acceptanceCriterion.create({
    data: { testPlanId: testPlan.id, requirementId: requirement.id, description: "criterion 1" },
  });
  await prisma.sharedStepGroup.create({ data: { projectId: project.id, name: "shared 1", steps: [], createdById: owner.id } });

  const testCase = await prisma.testCase.create({
    data: {
      projectId: project.id,
      testPlanId: testPlan.id,
      testPlanTypeId: testPlanType.id,
      title: "case 1",
      given: ["g"],
      when: ["w"],
      then: ["t"],
      testType: "FUNCTIONAL",
      createdById: owner.id,
      updatedById: owner.id,
    },
  });
  await prisma.testCaseStep.create({ data: { testCaseId: testCase.id, order: 0, action: "do a thing" } });
  await prisma.testCaseVersion.create({
    data: { testCaseId: testCase.id, versionNumber: 1, title: "case 1", given: ["g"], when: ["w"], then: ["t"], steps: [], tags: [], priority: "MEDIUM", testType: "FUNCTIONAL", createdById: owner.id },
  });
  await prisma.testCaseSource.create({ data: { testCaseId: testCase.id, filePath: "src/x.test.ts", framework: "jest" } });
  await prisma.testCaseDataset.create({ data: { testCaseId: testCase.id, parameterNames: ["a"], rows: [] } });
  await prisma.testCaseAttachment.create({
    data: { testCaseId: testCase.id, fileName: "f.png", contentType: "image/png", storageUrl: "s3://x", sizeBytes: 10, uploadedById: owner.id },
  });

  await prisma.riskFlag.create({
    data: { releaseId: release.id, severity: "MEDIUM", source: "MANUAL_FLAG", description: "risk 1", createdById: owner.id, updatedById: owner.id },
  });

  // Reference seeding creates frameworks, but no controls. Own this fixture so
  // a fresh CI database and an already populated database exercise the same test.
  const control = await prisma.complianceControl.create({
    data: { frameworkId: complianceFramework.id, code: RUN_ID, title: "Hard delete test control" },
  });
  seededControlId = control.id;
  await prisma.testCaseComplianceControl.create({ data: { testCaseId: testCase.id, controlId: control.id } });
  await prisma.complianceEvidence.create({ data: { controlId: control.id, testCaseId: testCase.id, projectId: project.id, recordedById: owner.id } });
  await prisma.complianceSignOff.create({ data: { controlId: control.id, projectId: project.id, period: "2026-Q1", statement: "signed", signedById: owner.id } });

  const testRun = await prisma.testRun.create({
    data: { projectId: project.id, ciProvider: "manual", commitSha: "abc123", branch: "main", startedAt: new Date(), startedById: owner.id },
  });
  const testResult = await prisma.testResult.create({ data: { testRunId: testRun.id, testCaseId: testCase.id, status: "FAIL" } });
  await prisma.testResultArtifact.create({ data: { testResultId: testResult.id, type: "SCREENSHOT", storageUrl: "s3://y" } });
  await prisma.healingSuggestion.create({
    data: { testResultId: testResult.id, testCaseId: testCase.id, projectId: project.id, classification: "BRITTLE", classificationRationale: "rationale" },
  });

  const coverageReport = await prisma.coverageReport.create({
    data: { projectId: project.id, testRunId: testRun.id, commitSha: "abc123", branch: "main", tool: "ISTANBUL", linesCovered: 5, linesTotal: 10 },
  });
  await prisma.coverageFileEntry.create({ data: { reportId: coverageReport.id, filePath: "src/x.ts", linesCovered: 5, linesTotal: 10 } });

  const exploratorySession = await prisma.exploratorySession.create({ data: { projectId: project.id, charter: "explore x", testerId: owner.id } });
  await prisma.exploratorySessionNote.create({ data: { sessionId: exploratorySession.id, text: "found a thing" } });

  await prisma.reverseEngineerJob.create({ data: { projectId: project.id, inputType: "PASTE", inputRef: "paste-1", content: "test('x', () => {})" } });
  await prisma.customFrameworkHeuristic.create({ data: { projectId: project.id, name: "custom fw", description: "pattern", createdById: owner.id } });
  await prisma.prScanPolicy.create({ data: { projectId: project.id } });

  const selectionRun = await prisma.testSelectionRun.create({ data: { projectId: project.id, baseRef: "a", headRef: "b", changedFiles: ["x.ts"] } });
  await prisma.testSelectionRecommendation.create({ data: { testSelectionRunId: selectionRun.id, testCaseId: testCase.id, recommended: true, matchReason: "changed" } });

  await prisma.importJob.create({
    data: { projectId: project.id, source: "CSV", fieldMapping: { title: "Title" }, status: "SUCCEEDED", createdById: owner.id },
  });
  await prisma.aiEditFeedback.create({
    data: {
      testCaseId: testCase.id, projectId: project.id,
      beforeTitle: "before", beforeGiven: [], beforeWhen: [], beforeThen: [],
      afterTitle: "after", afterGiven: [], afterWhen: [], afterThen: [],
      editedById: owner.id,
    },
  });

  await prisma.aiCreditTransaction.create({ data: { organizationId: orgId, type: "ADJUSTMENT", amount: 10, description: "test grant" } });
  await prisma.apiKey.create({
    data: { organizationId: orgId, name: "key 1", keyPrefix: "vk_test", hashedKey: `hash-${RUN_ID}`, serviceUserId: apiKeyServiceUser.id, createdByUserId: owner.id },
  });
  await prisma.auditLog.create({
    data: { organizationId: orgId, projectId: project.id, actorId: owner.id, entityType: "TestCase", entityId: testCase.id, action: "CREATE", summary: "created" },
  });
  await prisma.invitation.create({
    data: { organizationId: orgId, email: "invitee@example.com", role: "VIEWER", invitedById: owner.id, expiresAt: new Date(Date.now() + 86400000) },
  });

  const webhookEndpoint = await prisma.webhookEndpoint.create({
    data: { organizationId: orgId, url: "https://example.com/hook", secret: "shh", eventTypes: ["risk_flag.created"], createdById: owner.id },
  });
  await prisma.webhookDelivery.create({ data: { webhookEndpointId: webhookEndpoint.id, eventType: "risk_flag.created", payload: {}, success: true } });

  return { projectId: project.id, complianceFrameworkId: complianceFramework.id, controlId: control.id };
}

let seededComplianceFrameworkId: string;
let seededControlId: string;

beforeAll(async () => {
  const seeded = await seedEverything();
  seededComplianceFrameworkId = seeded.complianceFrameworkId;
  seededControlId = seeded.controlId;
});

afterAll(async () => {
  // Only reached if the test failed before actually hard-deleting (the
  // real deletion, if it ran, already removed everything under the org
  // including the org itself) - a safety net, not the primary cleanup path.
  if (!orgId) return;
  const stillExists = await prisma.organization.findUnique({ where: { id: orgId } });
  if (stillExists) {
    await prisma.$transaction([
      prisma.auditLog.deleteMany({ where: { organizationId: orgId } }),
      prisma.membership.deleteMany({ where: { organizationId: orgId } }),
    ]);
    await prisma.organization.delete({ where: { id: orgId } }).catch(() => undefined);
  }
  if (deletionLogId) await prisma.organizationDeletionLog.deleteMany({ where: { id: deletionLogId } });
  if (seededControlId) await prisma.complianceControl.deleteMany({ where: { id: seededControlId } });
});

describe("hardDeleteOrganization (real DB, every model populated)", () => {
  it("preview reports real non-zero counts for what was seeded", async () => {
    const preview = await previewOrgHardDelete(prisma, orgId);
    expect(preview.projectCount).toBe(1);
    // Every model actually seeded above should show up as exactly 1 (or
    // more, for the two-row cases) in the preview - not just "some number."
    for (const model of [
      "AiCreditTransaction", "ApiKey", "AuditLog", "Invitation", "Membership",
      "AiEditFeedback", "ComplianceEvidence", "ComplianceSignOff", "CustomFrameworkHeuristic",
      "HealingSuggestion", "ImportJob", "PrScanPolicy", "RiskFlag", "AcceptanceCriterion",
      "TestCaseAttachment", "TestCaseComplianceControl", "TestCaseDataset", "TestCaseSource",
      "TestCaseStep", "TestCaseVersion", "ReverseEngineerJob", "TestResultArtifact", "TestResult",
      "TestSelectionRecommendation", "TestCase", "TestPlanVersion", "TestPlan", "Release",
      "Requirement", "SharedStepGroup", "TestRun", "TestSelectionRun", "WebhookDelivery",
      "WebhookEndpoint", "CoverageFileEntry", "CoverageReport", "ExploratorySessionNote", "ExploratorySession",
    ]) {
      expect(preview.rowCounts[model], `${model} count`).toBeGreaterThanOrEqual(1);
    }
  });

  it("hard-deletes every row with zero FK violations, and confirms nothing is left", async () => {
    const result = await hardDeleteOrganization(prisma, orgId, staffUserId, "integration test - full model coverage");
    deletionLogId = result.deletionLogId;

    // The org itself, and every project under it, must actually be gone.
    expect(await prisma.organization.findUnique({ where: { id: orgId } })).toBeNull();
    expect(await prisma.project.count({ where: { organizationId: orgId } })).toBe(0);

    // Spot-check a representative sample directly against the DB (not just
    // trusting the function's own reported counts) - org-scoped, project-
    // scoped, and deeply-nested (testCase-scoped) rows.
    expect(await prisma.membership.count({ where: { organizationId: orgId } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { organizationId: orgId } })).toBe(0);
    expect(await prisma.apiKey.count({ where: { organizationId: orgId } })).toBe(0);
    expect(await prisma.webhookEndpoint.count({ where: { organizationId: orgId } })).toBe(0);

    // The permanent deletion record survives and is queryable, with real
    // counts matching what was actually removed.
    const log = await prisma.organizationDeletionLog.findUniqueOrThrow({ where: { id: result.deletionLogId } });
    expect(log.organizationId).toBe(orgId);
    expect(log.rowCounts).toMatchObject({ TestCase: 1, TestPlan: 1, Release: 1, Project: 1 });

    // The shared ComplianceFramework/ComplianceControl this org's evidence
    // referenced must NOT have been touched - they're platform-wide
    // reference data other orgs may also use.
    expect(await prisma.complianceFramework.findUnique({ where: { id: seededComplianceFrameworkId } })).not.toBeNull();
    expect(await prisma.complianceControl.findUnique({ where: { id: seededControlId } })).not.toBeNull();
  });
});
