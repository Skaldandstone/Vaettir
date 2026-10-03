import { TRPCError } from "@trpc/server";
import type { Prisma } from "@vaettir/db";
import {
  caseProcedureExportSchema,
  encodeCaseProcedureExport,
  exportedProcedureStepSchema,
  type CaseProcedureExport,
} from "@vaettir/core";

export async function captureCaseProcedureExport(
  db: Prisma.TransactionClient,
  input: {
    projectId: string;
    ids: string[];
    scope: "selected" | "filtered";
    includeArchived: boolean;
  },
): Promise<CaseProcedureExport> {
  const project = await db.project.findUniqueOrThrow({
    where: { id: input.projectId },
    select: { id: true, name: true, caseKey: true },
  });
  const [clock] = await db.$queryRaw<
    Array<{ capturedAt: Date }>
  >`SELECT CURRENT_TIMESTAMP AS "capturedAt"`;
  if (!clock)
    throw new Error("Could not establish procedure export snapshot time");
  const rows = await db.testCase.findMany({
    where: {
      projectId: input.projectId,
      id: { in: input.ids },
      ...(input.includeArchived ? {} : { archived: false }),
    },
    select: {
      id: true,
      displayId: true,
      caseNumber: true,
      title: true,
      background: true,
      given: true,
      when: true,
      then: true,
      sharedStepGroupId: true,
      validationDomain: true,
      verificationProfile: true,
      suitePath: true,
      testType: true,
      automationStatus: true,
      priority: true,
      origin: true,
      reviewStatus: true,
      archived: true,
      tags: true,
      steps: {
        orderBy: { order: "asc" },
        take: 5001,
        select: {
          order: true,
          action: true,
          expectedActionOrData: true,
          expectedResult: true,
          expectedResponse: true,
          mediaAttachmentIds: true,
        },
      },
      prerequisites: {
        take: 2001,
        select: {
          prerequisite: {
            select: {
              id: true,
              displayId: true,
              title: true,
              archived: true,
              projectId: true,
            },
          },
        },
      },
    },
  });
  if (rows.length !== input.ids.length)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Export scope changed or contains unavailable cases. Refresh and review the selection; no partial export was generated.",
    });
  const groupIds = [
    ...new Set(
      rows.flatMap((row) =>
        row.sharedStepGroupId ? [row.sharedStepGroupId] : [],
      ),
    ),
  ];
  // Never fetch a foreign group's contents first and only later filter them.
  const groups = await db.sharedStepGroup.findMany({
    where: { projectId: input.projectId, id: { in: groupIds } },
    select: { id: true, name: true, steps: true },
  });
  if (groups.length !== groupIds.length)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "A shared procedure is unavailable in this project. No export was generated.",
    });
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  const mediaIds = [
    ...new Set(
      rows.flatMap((row) =>
        row.steps.flatMap((step) => step.mediaAttachmentIds),
      ),
    ),
  ];
  const attachments = await db.testCaseAttachment.findMany({
    where: {
      id: { in: mediaIds },
      testCaseId: { in: input.ids },
      testCase: { projectId: input.projectId },
    },
    select: {
      id: true,
      testCaseId: true,
      fileName: true,
      contentType: true,
      sizeBytes: true,
      uploadCompletedAt: true,
    },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  try {
    const bundle = caseProcedureExportSchema.parse({
      format: "vaettir.case-procedure",
      version: 1,
      project,
      capturedAt: clock.capturedAt.toISOString(),
      scope: { kind: input.scope, includeArchived: input.includeArchived },
      importSupported: false,
      excluded: [
        "attachment-bytes",
        "datasets",
        "case-and-run-history",
        "paid-drafts",
        "document-bytes",
      ],
      cases: input.ids.map((id) => {
        const row = byId.get(id)!;
        if (
          row.prerequisites.some(
            (link) => link.prerequisite.projectId !== input.projectId,
          )
        )
          throw new Error("Foreign prerequisite");
        const group = row.sharedStepGroupId
          ? groupsById.get(row.sharedStepGroupId)!
          : null;
        const resolved = group
          ? exportedProcedureStepSchema
              .omit({ mediaAttachmentIds: true })
              .array()
              .max(5000)
              .parse(group.steps)
              .map((step) => ({ ...step, mediaAttachmentIds: [] }))
          : row.steps;
        return {
          id: row.id,
          displayId: row.displayId,
          caseNumber: row.caseNumber,
          title: row.title,
          background: row.background,
          given: row.given,
          when: row.when,
          then: row.then,
          authoredSteps: row.steps,
          resolvedSteps: resolved,
          sharedStepGroup: group ? { id: group.id, name: group.name } : null,
          validationDomain: row.validationDomain,
          verificationProfile: row.verificationProfile,
          suitePath: row.suitePath,
          testType: row.testType,
          automationStatus: row.automationStatus,
          priority: row.priority,
          origin: row.origin,
          reviewStatus: row.reviewStatus,
          archived: row.archived,
          tags: row.tags,
          prerequisites: row.prerequisites.map((link) => ({
            id: link.prerequisite.id,
            displayId: link.prerequisite.displayId,
            title: link.prerequisite.title,
            archived: link.prerequisite.archived,
          })),
          mediaReferences: attachments
            .filter((attachment) => attachment.testCaseId === row.id)
            .map((attachment) => ({
              id: attachment.id,
              fileName: attachment.fileName,
              contentType: attachment.contentType,
              sizeBytes: attachment.sizeBytes,
              uploadMetadataVerified: attachment.uploadCompletedAt !== null,
            })),
        };
      }),
    });
    encodeCaseProcedureExport(bundle); // Same byte bound as the downloadable artifact.
    return bundle;
  } catch {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "A procedure, shared-library definition or media reference cannot be preserved by this export version, or the scope exceeds 8 MiB. Choose a smaller scope or repair the reference. No partial export was generated.",
    });
  }
}
