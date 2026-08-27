import type { PrismaClient } from "@vaettir/db";

export interface RetentionDryRunResult {
  retentionYears: number;
  cutoffDate: Date;
  auditLogRowsEligible: number;
  oldestAuditLogDate: Date | null;
  testRunRowsEligible: number;
  testResultArtifactRowsEligible: number;
}

// P12-08 (dry-run half only): reports what WOULD be eligible for deletion
// under the org's configured retention window -- deliberately read-only,
// no delete/purge code path exists anywhere in this file or its caller.
// The ticket itself calls for a dry-run mode and an audit trail before an
// actual purge job is trusted to run automatically; this is that dry-run,
// built alone and on purpose rather than pairing it with real deletion
// logic in the same overnight, unsupervised pass that a genuine data-loss
// capability deserves a human reviewing before it exists at all.
export async function computeRetentionDryRun(prisma: PrismaClient, organizationId: string): Promise<RetentionDryRunResult> {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { dataRetentionYears: true },
  });

  const cutoffDate = new Date();
  cutoffDate.setFullYear(cutoffDate.getFullYear() - org.dataRetentionYears);

  const [auditLogRowsEligible, oldestAuditLog, testRunRowsEligible, testResultArtifactRowsEligible] = await Promise.all([
    prisma.auditLog.count({ where: { organizationId, createdAt: { lt: cutoffDate } } }),
    prisma.auditLog.findFirst({ where: { organizationId }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    prisma.testRun.count({ where: { project: { organizationId }, startedAt: { lt: cutoffDate } } }),
    prisma.testResultArtifact.count({
      where: { testResult: { testRun: { project: { organizationId } } }, capturedAt: { lt: cutoffDate } },
    }),
  ]);

  return {
    retentionYears: org.dataRetentionYears,
    cutoffDate,
    auditLogRowsEligible,
    oldestAuditLogDate: oldestAuditLog?.createdAt ?? null,
    testRunRowsEligible,
    testResultArtifactRowsEligible,
  };
}
