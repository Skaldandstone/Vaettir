import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@vaettir/db";
import { TRPCError } from "@trpc/server";
import { ensureCaseEvidenceNotRetained } from "./caseEvidenceRetention.js";

// This workflow deliberately preserves the existing evidence-retention rules.
// New/unknown project relations appear in the review as blockers; adding a
// relation never silently adds it to the destructive allowlist.
const removable = new Set([
  "testCases",
  "testPlans",
  "requirements",
  "importJobs",
  "reverseEngineerJobs",
  "testRuns",
  "customFrameworkHeuristics",
  "repositories",
  "auditLogs",
  "prScanPolicy",
]);
const labels: Record<string, string> = {
  testCases: "Test cases",
  testPlans: "Test plans",
  requirements: "Requirements",
  testRuns: "Test runs",
  unrealPlaytestJobs: "Unreal playtest history",
  unrealPlaytestCatalogs: "Unreal map and actor catalogs",
  importJobs: "Import history",
  importMappingBatches: "Retained import mappings and source observations",
  reverseEngineerJobs: "Generation jobs",
  customFrameworkHeuristics: "Framework settings",
  repositories: "Repository references",
  auditLogs: "Audit entries (kept in workspace history)",
  sharedStepGroups: "Shared step libraries and revisions",
  exploratorySessions: "Exploratory sessions",
  releases: "Releases",
  coverageReports: "Coverage reports",
  testSelectionRuns: "Test selection history",
  complianceEvidence: "Compliance evidence",
  complianceReviewDrafts: "Retained compliance reviews and apply receipts",
  complianceSignOffs: "Compliance sign-offs",
  complianceSignOffRequests: "Sign-off requests",
  healingSuggestions: "Healing suggestions",
  aiEditFeedback: "AI edit feedback",
  reportDefinitions: "Saved reports",
  reportDefinitionWrites: "Report change history",
  reportSnapshots: "Saved report snapshots",
  folderWrites: "Folder change history",
  folderState: "Folder structure",
  caseTraceability: "Retained coverage references",
  caseAuthoringPresets: "Authoring presets",
  caseAuthoringPresetWrites: "Authoring preset history",
  qualityRiskState: "Quality risk history",
  requirementBaselineState: "Requirement baselines",
  manualCaseResultRevisions: "Whole-case result history",
  manualCaseResultHeads: "Recorded whole-case results",
  aiDisclosurePolicy: "AI disclosure approvals and audit history",
  repositoryConnections: "Connected repositories",
  driveSourceConnections: "Connected document sources",
  ticketSourceConnections: "Connected ticket sources",
  populationDraft: "Project setup draft",
  defectMap: "Defect map",
  populationDraftWrites: "Project setup history",
  populationDocuments: "Source documents",
  populationDocumentRuns: "Document processing history",
  populationRequirements: "Document requirements",
  savedTypedCaseQueries: "Saved case queries",
  savedTypedCaseQueryWrites: "Saved query history",
  caseAnalysisQueues: "Case analysis queues",
  testCaseViews: "Saved case views",
  productionSignalConnections: "Production signal connections",
  productionSignals: "Production signals",
  jiraIssueIdentities: "Imported issue references",
  prScanPolicy: "Repository scan policy",
};

export async function previewProjectDeletion(
  db: Prisma.TransactionClient,
  id: string,
) {
  const project = await db.project.findUnique({
    where: { id },
    select: {
      id: true,
      organizationId: true,
      name: true,
      _count: true,
      aiDisclosurePolicy: { select: { projectId: true } },
      populationDraft: { select: { projectId: true } },
      defectMap: { select: { projectId: true } },
      caseTraceability: { select: { projectId: true } },
      folderState: { select: { projectId: true } },
      qualityRiskState: { select: { projectId: true } },
      requirementBaselineState: { select: { projectId: true } },
      prScanPolicy: { select: { projectId: true } },
    },
  });
  if (!project)
    throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
  const counts: Record<string, number> = { ...project._count };
  counts.complianceReviewDrafts = await db.complianceReviewDraft.count({where:{projectId:id}});
  for (const key of [
    "aiDisclosurePolicy",
    "populationDraft",
    "defectMap",
    "caseTraceability",
    "folderState",
    "qualityRiskState",
    "requirementBaselineState",
  ] as const)
    if (project[key]) counts[key] = 1;
  if (project.prScanPolicy) counts.prScanPolicy = 1;
  if (
    (counts.testCases ?? 0) > 1000 ||
    (counts.testPlans ?? 0) > 10000 ||
    (counts.requirements ?? 0) > 10000 ||
    (counts.testRuns ?? 0) > 10000
  )
    counts.deletionLimit = 1;
  const results = await db.testResult.count({
    where: {
      OR: [{ testRun: { projectId: id } }, { testCase: { projectId: id } }],
    },
  });
  const stepHistory = await db.manualStepResultRevision.count({
    where: { testRun: { projectId: id } },
  });
  const activeJobs =
    (await db.reverseEngineerJob.count({
      where: { projectId: id, status: { in: ["PENDING", "RUNNING"] } },
    })) +
    (await db.importJob.count({
      where: { projectId: id, status: { in: ["PENDING", "RUNNING"] } },
    }));
  if (results) counts.recordedResults = results;
  if (stepHistory) counts.stepHistory = stepHistory;
  if (activeJobs) counts.activeJobs = activeJobs;
  const foreignLinks =
    (await db.testCase.count({
      where: { projectId: { not: id }, testPlan: { projectId: id } },
    })) +
    (await db.testPlan.count({
      where: { projectId: { not: id }, strategy: { projectId: id } },
    })) +
    (await db.acceptanceCriterion.count({
      where: {
        testPlan: { projectId: { not: id } },
        requirement: { projectId: id },
      },
    })) +
    (await db.jiraIssueIdentity.count({
      where: { projectId: { not: id }, requirement: { projectId: id } },
    })) +
    (await db.projectPopulationRequirement.count({
      where: { projectId: { not: id }, requirement: { projectId: id } },
    })) +
    (await db.caseComment.count({
      where: { projectId: id, organizationId: { not: project.organizationId } },
    }));
  if (foreignLinks) counts.foreignLinks = foreignLinks;
  const [attachments] = await db.$queryRaw<Array<{ count: bigint }>>`
    SELECT count(*)::bigint AS count FROM "TestCaseAttachment" a
    JOIN "TestCase" c ON c.id=a."testCaseId" WHERE c."projectId"=${id} AND (
      EXISTS(SELECT 1 FROM "ManualStepResultRevision" r WHERE r."evidenceAttachmentIds" @> ARRAY[a.id]) OR
      EXISTS(SELECT 1 FROM "TestRun" r WHERE r."projectId"=${id} AND r."executionContext" @>
        jsonb_build_object('caseDefinitions',jsonb_build_array(jsonb_build_object('steps',
          jsonb_build_array(jsonb_build_object('mediaAttachmentIds',jsonb_build_array(a.id))))))))`;
  if (
    !attachments ||
    attachments.count < 0n ||
    attachments.count > BigInt(Number.MAX_SAFE_INTEGER)
  )
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Project evidence inventory is unavailable. No deletion can be confirmed.",
    });
  if (attachments.count) counts.retainedAttachments = Number(attachments.count);
  const rows = Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([key, count]) => ({
      key,
      count,
      label:
        labels[key] ??
        {
          recordedResults: "Recorded test results",
          stepHistory: "Recorded step history",
          retainedAttachments:
            "Attachments retained by recorded evidence or a saved run procedure",
          activeJobs: "Jobs still in progress",
          foreignLinks:
            "References or original records belonging to another project or workspace",
          deletionLimit:
            "Project exceeds the guided removal limit (1,000 cases or 10,000 plans, requirements or runs)",
        }[key] ??
        "Additional project records",
      retained: key === "auditLogs",
      blocksDeletion: !removable.has(key),
    }));
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        id,
        organizationId: project.organizationId,
        name: project.name,
        counts,
        scanPolicy: !!project.prScanPolicy,
      }),
    )
    .digest("hex");
  return {
    id,
    organizationId: project.organizationId,
    name: project.name,
    rows,
    fingerprint,
    hasContents: rows.some((row) => !row.retained),
    blocked: rows.some((row) => row.blocksDeletion),
  };
}

export type ProjectDeletionInput = {
  id: string;
  organizationId: string;
  expectedName: string;
  previewFingerprint: string;
  includeContents: boolean;
  requestId: string;
};
export type ProjectDeletionActor = {
  id: string;
  clerkSubject: string;
  workspaceOrganizationId?: string | null;
};

export async function authorizeProjectDeletion(
  db: Prisma.TransactionClient,
  actor: ProjectDeletionActor,
  organizationId: string,
) {
  if (
    actor.workspaceOrganizationId &&
    actor.workspaceOrganizationId !== organizationId
  )
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This address belongs to a different workspace.",
    });
  const user = await db.user.findUnique({
    where: { id: actor.id },
    select: { clerkUserId: true },
  });
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { suspendedAt: true },
  });
  const member = await db.membership.findUnique({
    where: { organizationId_userId: { organizationId, userId: actor.id } },
  });
  if (
    !user ||
    user.clerkUserId !== actor.clerkSubject ||
    !org ||
    org.suspendedAt ||
    !member ||
    !["ADMIN", "OWNER"].includes(member.role) ||
    member.seatType !== "FULL"
  )
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "A current workspace administrator with a full seat must confirm project deletion.",
    });
}

export async function deleteReviewedProject(
  db: PrismaClient,
  actor: ProjectDeletionActor,
  input: ProjectDeletionInput,
) {
  const requestHash = createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex");
  const receiptId = `project-deletion:${input.requestId}`;
  return db
    .$transaction(
      async (tx) => {
        // Same lock as editable case writers. Row locks also exclude new direct
        // project children; restrictive FKs remain enabled throughout the operation.
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${input.id}))::text`;
        await tx.$queryRaw`SELECT id FROM "Organization" WHERE id=${input.organizationId} FOR SHARE`;
        await tx.$queryRaw`SELECT id FROM "User" WHERE id=${actor.id} FOR SHARE`;
        await tx.$queryRaw`SELECT "userId" FROM "Membership" WHERE "organizationId"=${input.organizationId} AND "userId"=${actor.id} FOR SHARE`;
        await authorizeProjectDeletion(tx, actor, input.organizationId);
        const oldReceipt = await tx.auditLog.findUnique({
          where: { id: receiptId },
        });
        if (oldReceipt) {
          if (
            oldReceipt.actorId !== actor.id ||
            oldReceipt.organizationId !== input.organizationId ||
            oldReceipt.entityId !== input.id ||
            (oldReceipt.metadata as { requestHash?: string } | null)
              ?.requestHash !== requestHash
          )
            throw new TRPCError({
              code: "CONFLICT",
              message:
                "This deletion request ID has already been used. Start a new review.",
            });
          return { receiptId, replayed: true };
        }
        await tx.$queryRaw`SELECT id FROM "Project" WHERE id=${input.id} FOR UPDATE`;
    const target = await tx.project.findUnique({
      where: { id: input.id },
      select: { organizationId: true },
    });
    if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
    if (target.organizationId !== input.organizationId)
      throw new TRPCError({ code: "FORBIDDEN" });
        // Pin native parents before checking incoming references. A concurrent FK
        // writer must finish before this review or wait for the entire transaction;
        // SET NULL on optional foreign-project references must never change them.
        const beforeLocks = await previewProjectDeletion(tx, input.id);
        if (beforeLocks.organizationId !== input.organizationId)
          throw new TRPCError({ code: "FORBIDDEN" });
        if (beforeLocks.blocked)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "Some project records require a separate removal review. No records were deleted. Review the highlighted items.",
          });
        await tx.$queryRaw`SELECT id FROM "TestPlan" WHERE "projectId"=${input.id} ORDER BY id FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM "TestCase" WHERE "projectId"=${input.id} ORDER BY id FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM "Requirement" WHERE "projectId"=${input.id} ORDER BY id FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM "TestRun" WHERE "projectId"=${input.id} ORDER BY id FOR UPDATE`;
        const preview = await previewProjectDeletion(tx, input.id);
        if (preview.organizationId !== input.organizationId)
          throw new TRPCError({ code: "FORBIDDEN" });
        if (
          preview.name !== input.expectedName ||
          preview.fingerprint !== input.previewFingerprint
        )
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "The project changed after your review. Review its current contents and confirm again.",
          });
        if (preview.blocked)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "Some project records require a separate removal review. No records were deleted. Review the highlighted items.",
          });
        if (preview.hasContents && !input.includeContents)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Confirm that you also want to delete the listed project contents.",
          });
        const cases = await tx.testCase.findMany({
          where: { projectId: input.id },
          select: { id: true },
          take: 1001,
        });
        if (cases.length > 1000)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "This project exceeds the guided deletion limit of 1,000 cases. No records were deleted. Arrange a separate removal review.",
          });
        for (const testCase of cases)
          await ensureCaseEvidenceNotRetained(tx, input.id, testCase.id);
        // Preserve workspace audit history, including the original project identity.
        await tx.auditLog.updateMany({
          where: { projectId: input.id, organizationId: input.organizationId },
          data: { projectId: null },
        });
        await tx.reverseEngineerJob.deleteMany({
          where: { projectId: input.id },
        });
        await tx.importJob.deleteMany({ where: { projectId: input.id } });
        await tx.testCasePrerequisite.deleteMany({
          where: { projectId: input.id },
        });
        await tx.testCaseComplianceControl.deleteMany({
          where: { testCase: { projectId: input.id } },
        });
        await tx.acceptanceCriterion.deleteMany({
          where: { testPlan: { projectId: input.id } },
        });
        await tx.testPlanVersion.deleteMany({
          where: { testPlan: { projectId: input.id } },
        });
        // Cases own editable steps, attachments, datasets, sources and versions via
        // existing CASCADE constraints. Recorded-result/retention FKs still refuse.
        await tx.testCase.deleteMany({ where: { projectId: input.id } });
        await tx.testPlan.deleteMany({ where: { projectId: input.id } });
        await tx.requirement.deleteMany({ where: { projectId: input.id } });
        await tx.testRun.deleteMany({ where: { projectId: input.id } });
        await tx.customFrameworkHeuristic.deleteMany({
          where: { projectId: input.id },
        });
        await tx.projectRepository.deleteMany({
          where: { projectId: input.id },
        });
        await tx.prScanPolicy.deleteMany({ where: { projectId: input.id } });
        await tx.project.delete({
          where: { id: input.id, organizationId: input.organizationId },
        });
        await tx.auditLog.create({
          data: {
            id: receiptId,
            organizationId: input.organizationId,
            actorId: actor.id,
            entityType: "Project",
            entityId: input.id,
            action: "DELETE",
            summary: `Deleted project ${preview.name} after contents review`,
            metadata: {
              requestHash,
              projectName: preview.name,
              previewFingerprint: preview.fingerprint,
              includeContents: input.includeContents,
              reviewedCounts: Object.fromEntries(
                preview.rows.map((row) => [row.key, row.count]),
              ),
            },
          },
        });
        return { receiptId, replayed: false };
      },
      { timeout: 30000 },
    )
    .catch((error) => {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2003"
      )
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "Linked or retained records changed during deletion. No records were deleted. Review the project again.",
        });
      throw error;
    });
}
