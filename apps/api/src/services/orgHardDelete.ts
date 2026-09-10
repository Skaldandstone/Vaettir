import type { PrismaClient } from "@vaettir/db";

// P13-05: the genuinely destructive half of "ownership actions" -
// deliberately built separately from suspend/reactivate/transfer (all
// reversible), and only after a real, careful pass mapping every foreign
// key in the schema (queried directly from Postgres's own
// information_schema, not hand-traced from schema.prisma - too easy to
// miss one). Two real correctness findings from that pass, both handled
// below:
//
// 1. ComplianceFramework/ComplianceControl have NO organizationId/
//    projectId anywhere in the schema - they're shared, platform-wide
//    reference data (even a "custom" framework is visible to every org).
//    Deleting them because this org happened to reference them would
//    silently corrupt every OTHER org using the same framework. Never
//    touched here - only the per-project/per-case rows that reference
//    them (evidence, sign-offs, the test-case mapping) are deleted.
// 2. The permanent "this org was hard-deleted" record can't be a normal
//    AuditLog row (organizationId there is a real, non-cascading FK -
//    the very act of deleting the org would either be blocked by that
//    row's existence, or cascade-delete the row proving the deletion
//    happened). See OrganizationDeletionLog in schema.prisma: a plain
//    snapshot, not a live FK, so it survives the org it describes.
//
// Deletion order is real child-before-parent FK order (several of these
// already cascade at the schema level - kept explicit here anyway for
// accurate per-model row counts and so correctness never depends on
// remembering which ones do).

export interface OrgDeletionPreview {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  projectCount: number;
  rowCounts: Record<string, number>;
}

async function scopeIds(prisma: PrismaClient, organizationId: string) {
  const projects = await prisma.project.findMany({ where: { organizationId }, select: { id: true } });
  const projectIds = projects.map((p) => p.id);

  const [testCases, testPlans, testRuns, releases, testSelectionRuns, coverageReports, exploratorySessions, webhookEndpoints] =
    await Promise.all([
      prisma.testCase.findMany({ where: { projectId: { in: projectIds } }, select: { id: true } }),
      prisma.testPlan.findMany({ where: { projectId: { in: projectIds } }, select: { id: true } }),
      prisma.testRun.findMany({ where: { projectId: { in: projectIds } }, select: { id: true } }),
      prisma.release.findMany({ where: { projectId: { in: projectIds } }, select: { id: true } }),
      prisma.testSelectionRun.findMany({ where: { projectId: { in: projectIds } }, select: { id: true } }),
      prisma.coverageReport.findMany({ where: { projectId: { in: projectIds } }, select: { id: true } }),
      prisma.exploratorySession.findMany({ where: { projectId: { in: projectIds } }, select: { id: true } }),
      prisma.webhookEndpoint.findMany({ where: { organizationId }, select: { id: true } }),
    ]);
  const testRunIds = testRuns.map((r) => r.id);
  const testResults = await prisma.testResult.findMany({ where: { testRunId: { in: testRunIds } }, select: { id: true } });

  return {
    projectIds,
    testCaseIds: testCases.map((c) => c.id),
    testPlanIds: testPlans.map((p) => p.id),
    testRunIds,
    testResultIds: testResults.map((r) => r.id),
    releaseIds: releases.map((r) => r.id),
    testSelectionRunIds: testSelectionRuns.map((r) => r.id),
    coverageReportIds: coverageReports.map((r) => r.id),
    exploratorySessionIds: exploratorySessions.map((s) => s.id),
    webhookEndpointIds: webhookEndpoints.map((w) => w.id),
  };
}

export async function previewOrgHardDelete(prisma: PrismaClient, organizationId: string): Promise<OrgDeletionPreview> {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
  const scope = await scopeIds(prisma, organizationId);

  const [
    coverageFileEntry,
    coverageReport,
    exploratorySessionNote,
    exploratorySession,
    aiCreditTransaction,
    apiKey,
    auditLog,
    invitation,
    membership,
    aiEditFeedback,
    complianceEvidence,
    complianceSignOff,
    customFrameworkHeuristic,
    healingSuggestion,
    importJob,
    prScanPolicy,
    releaseReadinessSnapshot,
    riskFlag,
    acceptanceCriterion,
    testCaseAttachment,
    testCaseComplianceControl,
    testCaseDataset,
    testCaseSource,
    testCaseStep,
    testCaseVersion,
    reverseEngineerJob,
    testResultArtifact,
    testResult,
    testSelectionRecommendation,
    testCase,
    testPlanVersion,
    testPlan,
    release,
    requirement,
    sharedStepGroup,
    testRun,
    testSelectionRun,
    webhookDelivery,
    webhookEndpoint,
  ] = await Promise.all([
    prisma.coverageFileEntry.count({ where: { reportId: { in: scope.coverageReportIds } } }),
    prisma.coverageReport.count({ where: { projectId: { in: scope.projectIds } } }),
    prisma.exploratorySessionNote.count({ where: { sessionId: { in: scope.exploratorySessionIds } } }),
    prisma.exploratorySession.count({ where: { projectId: { in: scope.projectIds } } }),
    prisma.aiCreditTransaction.count({ where: { organizationId } }),
    prisma.apiKey.count({ where: { organizationId } }),
    prisma.auditLog.count({ where: { organizationId } }),
    prisma.invitation.count({ where: { organizationId } }),
    prisma.membership.count({ where: { organizationId } }),
    prisma.aiEditFeedback.count({ where: { projectId: { in: scope.projectIds } } }),
    prisma.complianceEvidence.count({ where: { projectId: { in: scope.projectIds } } }),
    prisma.complianceSignOff.count({ where: { projectId: { in: scope.projectIds } } }),
    prisma.customFrameworkHeuristic.count({ where: { projectId: { in: scope.projectIds } } }),
    prisma.healingSuggestion.count({ where: { projectId: { in: scope.projectIds } } }),
    prisma.importJob.count({ where: { projectId: { in: scope.projectIds } } }),
    prisma.prScanPolicy.count({ where: { projectId: { in: scope.projectIds } } }),
    prisma.releaseReadinessSnapshot.count({ where: { releaseId: { in: scope.releaseIds } } }),
    prisma.riskFlag.count({ where: { releaseId: { in: scope.releaseIds } } }),
    prisma.acceptanceCriterion.count({ where: { testPlanId: { in: scope.testPlanIds } } }),
    prisma.testCaseAttachment.count({ where: { testCaseId: { in: scope.testCaseIds } } }),
    prisma.testCaseComplianceControl.count({ where: { testCaseId: { in: scope.testCaseIds } } }),
    prisma.testCaseDataset.count({ where: { testCaseId: { in: scope.testCaseIds } } }),
    prisma.testCaseSource.count({ where: { testCaseId: { in: scope.testCaseIds } } }),
    prisma.testCaseStep.count({ where: { testCaseId: { in: scope.testCaseIds } } }),
    prisma.testCaseVersion.count({ where: { testCaseId: { in: scope.testCaseIds } } }),
    prisma.reverseEngineerJob.count({ where: { projectId: { in: scope.projectIds } } }),
    prisma.testResultArtifact.count({ where: { testResultId: { in: scope.testResultIds } } }),
    prisma.testResult.count({ where: { testRunId: { in: scope.testRunIds } } }),
    prisma.testSelectionRecommendation.count({ where: { testSelectionRunId: { in: scope.testSelectionRunIds } } }),
    prisma.testCase.count({ where: { projectId: { in: scope.projectIds } } }),
    prisma.testPlanVersion.count({ where: { testPlanId: { in: scope.testPlanIds } } }),
    prisma.testPlan.count({ where: { projectId: { in: scope.projectIds } } }),
    prisma.release.count({ where: { projectId: { in: scope.projectIds } } }),
    prisma.requirement.count({ where: { projectId: { in: scope.projectIds } } }),
    prisma.sharedStepGroup.count({ where: { projectId: { in: scope.projectIds } } }),
    prisma.testRun.count({ where: { projectId: { in: scope.projectIds } } }),
    prisma.testSelectionRun.count({ where: { projectId: { in: scope.projectIds } } }),
    prisma.webhookDelivery.count({ where: { webhookEndpointId: { in: scope.webhookEndpointIds } } }),
    prisma.webhookEndpoint.count({ where: { organizationId } }),
  ]);

  return {
    organizationId,
    organizationName: org.name,
    organizationSlug: org.slug,
    projectCount: scope.projectIds.length,
    rowCounts: {
      CoverageFileEntry: coverageFileEntry,
      CoverageReport: coverageReport,
      ExploratorySessionNote: exploratorySessionNote,
      ExploratorySession: exploratorySession,
      AiCreditTransaction: aiCreditTransaction,
      ApiKey: apiKey,
      AuditLog: auditLog,
      Invitation: invitation,
      Membership: membership,
      AiEditFeedback: aiEditFeedback,
      ComplianceEvidence: complianceEvidence,
      ComplianceSignOff: complianceSignOff,
      CustomFrameworkHeuristic: customFrameworkHeuristic,
      HealingSuggestion: healingSuggestion,
      ImportJob: importJob,
      PrScanPolicy: prScanPolicy,
      ReleaseReadinessSnapshot: releaseReadinessSnapshot,
      RiskFlag: riskFlag,
      AcceptanceCriterion: acceptanceCriterion,
      TestCaseAttachment: testCaseAttachment,
      TestCaseComplianceControl: testCaseComplianceControl,
      TestCaseDataset: testCaseDataset,
      TestCaseSource: testCaseSource,
      TestCaseStep: testCaseStep,
      TestCaseVersion: testCaseVersion,
      ReverseEngineerJob: reverseEngineerJob,
      TestResultArtifact: testResultArtifact,
      TestResult: testResult,
      TestSelectionRecommendation: testSelectionRecommendation,
      TestCase: testCase,
      TestPlanVersion: testPlanVersion,
      TestPlan: testPlan,
      Release: release,
      Requirement: requirement,
      SharedStepGroup: sharedStepGroup,
      TestRun: testRun,
      TestSelectionRun: testSelectionRun,
      WebhookDelivery: webhookDelivery,
      WebhookEndpoint: webhookEndpoint,
      Project: scope.projectIds.length,
    },
  };
}

export interface OrgHardDeleteResult {
  deletionLogId: string;
  rowCounts: Record<string, number>;
}

export async function hardDeleteOrganization(
  prisma: PrismaClient,
  organizationId: string,
  actorId: string,
  reason: string,
): Promise<OrgHardDeleteResult> {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
  const scope = await scopeIds(prisma, organizationId);

  const rowCounts = await prisma.$transaction(async (tx) => {
    const counts: Record<string, number> = {};
    const del = async (name: string, fn: () => Promise<{ count: number }>) => {
      counts[name] = (await fn()).count;
    };

    await del("CoverageFileEntry", () => tx.coverageFileEntry.deleteMany({ where: { reportId: { in: scope.coverageReportIds } } }));
    await del("CoverageReport", () => tx.coverageReport.deleteMany({ where: { projectId: { in: scope.projectIds } } }));
    await del("ExploratorySessionNote", () =>
      tx.exploratorySessionNote.deleteMany({ where: { sessionId: { in: scope.exploratorySessionIds } } }),
    );
    await del("ExploratorySession", () => tx.exploratorySession.deleteMany({ where: { projectId: { in: scope.projectIds } } }));
    await del("AiCreditTransaction", () => tx.aiCreditTransaction.deleteMany({ where: { organizationId } }));
    await del("ApiKey", () => tx.apiKey.deleteMany({ where: { organizationId } }));
    await del("AuditLog", () => tx.auditLog.deleteMany({ where: { organizationId } }));
    await del("Invitation", () => tx.invitation.deleteMany({ where: { organizationId } }));
    await del("Membership", () => tx.membership.deleteMany({ where: { organizationId } }));
    await del("AiEditFeedback", () => tx.aiEditFeedback.deleteMany({ where: { projectId: { in: scope.projectIds } } }));
    await del("ComplianceEvidence", () => tx.complianceEvidence.deleteMany({ where: { projectId: { in: scope.projectIds } } }));
    await del("ComplianceSignOff", () => tx.complianceSignOff.deleteMany({ where: { projectId: { in: scope.projectIds } } }));
    await del("CustomFrameworkHeuristic", () =>
      tx.customFrameworkHeuristic.deleteMany({ where: { projectId: { in: scope.projectIds } } }),
    );
    await del("HealingSuggestion", () => tx.healingSuggestion.deleteMany({ where: { projectId: { in: scope.projectIds } } }));
    await del("ImportJob", () => tx.importJob.deleteMany({ where: { projectId: { in: scope.projectIds } } }));
    await del("PrScanPolicy", () => tx.prScanPolicy.deleteMany({ where: { projectId: { in: scope.projectIds } } }));
    await del("ReleaseReadinessSnapshot", () =>
      tx.releaseReadinessSnapshot.deleteMany({ where: { releaseId: { in: scope.releaseIds } } }),
    );
    await del("RiskFlag", () => tx.riskFlag.deleteMany({ where: { releaseId: { in: scope.releaseIds } } }));
    await del("AcceptanceCriterion", () => tx.acceptanceCriterion.deleteMany({ where: { testPlanId: { in: scope.testPlanIds } } }));
    await del("TestCaseAttachment", () => tx.testCaseAttachment.deleteMany({ where: { testCaseId: { in: scope.testCaseIds } } }));
    await del("TestCaseComplianceControl", () =>
      tx.testCaseComplianceControl.deleteMany({ where: { testCaseId: { in: scope.testCaseIds } } }),
    );
    await del("TestCaseDataset", () => tx.testCaseDataset.deleteMany({ where: { testCaseId: { in: scope.testCaseIds } } }));
    await del("TestCaseSource", () => tx.testCaseSource.deleteMany({ where: { testCaseId: { in: scope.testCaseIds } } }));
    await del("TestCaseStep", () => tx.testCaseStep.deleteMany({ where: { testCaseId: { in: scope.testCaseIds } } }));
    await del("TestCaseVersion", () => tx.testCaseVersion.deleteMany({ where: { testCaseId: { in: scope.testCaseIds } } }));
    await del("ReverseEngineerJob", () => tx.reverseEngineerJob.deleteMany({ where: { projectId: { in: scope.projectIds } } }));
    await del("TestResultArtifact", () => tx.testResultArtifact.deleteMany({ where: { testResultId: { in: scope.testResultIds } } }));
    await del("TestResult", () => tx.testResult.deleteMany({ where: { testRunId: { in: scope.testRunIds } } }));
    await del("TestSelectionRecommendation", () =>
      tx.testSelectionRecommendation.deleteMany({ where: { testSelectionRunId: { in: scope.testSelectionRunIds } } }),
    );
    await del("TestCase", () => tx.testCase.deleteMany({ where: { projectId: { in: scope.projectIds } } }));
    await del("TestPlanVersion", () => tx.testPlanVersion.deleteMany({ where: { testPlanId: { in: scope.testPlanIds } } }));
    await del("TestPlan", () => tx.testPlan.deleteMany({ where: { projectId: { in: scope.projectIds } } }));
    await del("Release", () => tx.release.deleteMany({ where: { projectId: { in: scope.projectIds } } }));
    await del("Requirement", () => tx.requirement.deleteMany({ where: { projectId: { in: scope.projectIds } } }));
    await del("SharedStepGroup", () => tx.sharedStepGroup.deleteMany({ where: { projectId: { in: scope.projectIds } } }));
    await del("TestRun", () => tx.testRun.deleteMany({ where: { projectId: { in: scope.projectIds } } }));
    await del("TestSelectionRun", () => tx.testSelectionRun.deleteMany({ where: { projectId: { in: scope.projectIds } } }));
    await del("WebhookDelivery", () => tx.webhookDelivery.deleteMany({ where: { webhookEndpointId: { in: scope.webhookEndpointIds } } }));
    await del("WebhookEndpoint", () => tx.webhookEndpoint.deleteMany({ where: { organizationId } }));

    counts.Project = (await tx.project.deleteMany({ where: { organizationId } })).count;
    await tx.organization.delete({ where: { id: organizationId } });

    return counts;
  });

  const log = await prisma.organizationDeletionLog.create({
    data: {
      organizationId: org.id,
      organizationName: org.name,
      organizationSlug: org.slug,
      deletedById: actorId,
      reason,
      rowCounts,
    },
  });

  return { deletionLogId: log.id, rowCounts };
}
