import { TRPCError } from "@trpc/server";
import { Prisma } from "@vaettir/db";
import { qualityProfileHash } from "./qualityExperienceProfile.js";
import {
  prepareFolderDatasets,
  validateDatasetCopyClosure,
  validatedDatasetReplay,
} from "./caseFolderCopyDatasets.js";
import {
  cloneDatasetMappingSchema,
  cloneExpectedScopeSchema,
} from "./caseCloneDatasetSchema.js";
import type { sourceState } from "./caseClone.js";
import type { z } from "zod";

function refuse(message: string): never {
  throw new TRPCError({ code: "BAD_REQUEST", message });
}
export async function independentCloneScope(
  tx: Prisma.TransactionClient,
  userId: string,
  projectId: string,
  expected?: z.infer<typeof cloneExpectedScopeSchema>,
) {
  const project = await tx.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { organizationId: true },
  });
  // The caller has pinned the project and current membership first. Pin the
  // authenticated actor row in that same order; Clerk identity cannot change
  // between this scope comparison and receipt replay or the eventual write.
  const [actor] = await tx.$queryRaw<Array<{ clerkUserId: string }>>`
    SELECT "clerkUserId" FROM "User" WHERE id=${userId} FOR SHARE`;
  if (!actor)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "The authenticated account is no longer available.",
    });
  if (
    expected &&
    (expected.organizationId !== project.organizationId ||
      expected.clerkActorId !== actor.clerkUserId)
  )
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "Return to the original account and workspace before reviewing or retrying this duplicate.",
    });
  return {
    projectId,
    organizationId: project.organizationId,
    clerkActorId: actor.clerkUserId,
  };
}
/** Independent dataset copy refuses every unsupported relation before projecting
 * dataset bodies. Folder copy keeps its separately reviewed remapping contract. */
export async function prepareIndependentCloneDataset(
  tx: Prisma.TransactionClient,
  projectId: string,
  state: Awaited<ReturnType<typeof sourceState>>,
  title?: string,
) {
  const dependent = await tx.testCase.findFirst({
    where: { id: state.source.id, projectId },
    select: {
      sharedStepGroupId: true,
      _count: { select: { attachments: true } },
    },
  });
  if (!dependent)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Case is not available in this project.",
    });
  if (
    dependent.sharedStepGroupId ||
    dependent._count.attachments ||
    state.preview.mediaReferencesExcluded
  )
    refuse(
      "Independent dataset duplication cannot copy shared libraries, attachments or step media. Nothing was omitted; use the original case or review independent authoring without dataset copy.",
    );
  const touching = await tx.testCasePrerequisite.count({
    where: {
      OR: [
        { dependentId: state.source.id },
        { prerequisiteId: state.source.id },
      ],
    },
  });
  if (touching)
    refuse(
      "Independent dataset duplication cannot drop prerequisite relationships or guess row pairing. Use complete reviewed folder copy when supported; no foreign relationship identity is disclosed.",
    );
  const selected = [
    { row: { id: state.source.id, displayId: state.source.displayId }, state },
  ];
  const p = await prepareFolderDatasets(tx, projectId, selected, []);
  if (p.datasets.length !== 1)
    refuse(
      "This case has no saved dataset. Turn off Include parameter dataset to review an ordinary independent duplicate.",
    );
  if (title !== undefined)
    validateDatasetCopyClosure(
      p.datasets,
      [
        {
          ...selected[0]!,
          state: {
            ...state,
            preview: {
              ...state.preview,
              definition: { ...state.preview.definition, title },
            },
          },
        },
      ],
      [],
    );
  return {
    data: p.datasets[0]!.data,
    source: p.sources[0]!,
    reviewHash: p.reviewHash,
  };
}
export async function createIndependentCloneDataset(
  tx: Prisma.TransactionClient,
  scope: { projectId: string; organizationId: string },
  actorId: string,
  requestId: string,
  reason: string,
  plan: Awaited<ReturnType<typeof prepareIndependentCloneDataset>>,
  copy: { caseId: string; displayId: string },
) {
  const created = await tx.testCaseDataset.create({
    data: {
      testCaseId: copy.caseId,
      parameterNames: plan.data.parameterNames,
      rows: plan.data.rows,
    },
    select: { id: true, parameterNames: true, rows: true },
  });
  if (
    created.id === plan.source.sourceDatasetId ||
    qualityProfileHash({
      parameterNames: created.parameterNames,
      rows: created.rows,
    }) !== plan.source.contentHash
  )
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "Fresh duplicate dataset contents could not be verified. Nothing was committed.",
    });
  const mapping = cloneDatasetMappingSchema.parse({
    ...plan.source,
    caseId: copy.caseId,
    displayId: copy.displayId,
    datasetId: created.id,
  });
  validatedDatasetReplay(
    scope.projectId,
    [plan.source],
    [mapping],
    [{ sourceId: plan.source.sourceCaseId, ...copy }],
    plan.reviewHash,
  );
  await tx.auditLog.create({
    data: {
      organizationId: scope.organizationId,
      projectId: scope.projectId,
      actorId,
      entityType: "TestCaseDatasetClone",
      entityId: copy.caseId,
      action: "CREATE",
      summary:
        "Created reviewed independent parameter dataset with a fresh case",
      metadata: {
        requestId,
        reason,
        datasetReviewHash: plan.reviewHash,
        mapping,
        sourceUnchanged: true,
        rowIdentity: "DATASET_ID_AND_ROW_INDEX",
        procedureVersionContainsDataset: false,
      },
    },
  });
  return mapping;
}
