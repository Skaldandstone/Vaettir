import { z } from "zod";
import { caseFieldReadScopeSchema } from "./caseFieldReadScope.js";
const id = z.string().min(1).max(200),
  hash = z.string().regex(/^[a-f0-9]{64}$/);
export const MAX_GOVERNANCE_CRITERIA = 200;
export const MAX_GOVERNANCE_SNAPSHOT_BYTES = 128 * 1024;
export const MAX_GOVERNANCE_RECEIPT_BYTES = 384 * 1024;
export const MAX_GOVERNANCE_HISTORY_BYTES = 16 * 1024 * 1024;
export const MAX_GOVERNANCE_HISTORY_REVISIONS = 500;
export const planGovernanceScopeInput = z
  .object({
    projectId: id,
    testPlanId: id,
    originalOrganizationId: id,
    expectedClerkActorId: id,
  })
  .strict();
const write = planGovernanceScopeInput.extend({
  requestId: z.string().uuid(),
  expectedPlanRevision: hash,
  reason: z.string().trim().min(1).max(1000),
  confirmed: z.literal(true),
});
export const editCriterionDescriptionInput = write
  .extend({
    criterionId: id,
    expectedCriterionRevision: hash,
    description: z.string().trim().min(1).max(2000),
  })
  .strict();
export const attachUnassignedPlanInput = write
  .extend({ releaseId: id, expectedReleaseId: z.null() })
  .strict();
export const governanceCriterionSnapshot = z
  .object({
    id,
    testPlanId: id,
    requirementId: id.nullable(),
    description: z.string().max(10000),
    status: z.enum(["PENDING", "MET", "NOT_MET", "AT_RISK"]),
    createdAt: z.string().datetime(),
  })
  .strict();
export const planGovernanceSnapshot = z
  .object({
    snapshotVersion: z.literal(1),
    id,
    projectId: id,
    testPlanTypeId: id,
    releaseId: id.nullable(),
    strategyId: id.nullable(),
    name: z.string().max(10000),
    description: z.string().max(40000).nullable(),
    status: z.enum(["DRAFT", "ACTIVE", "IN_REVIEW", "APPROVED", "ARCHIVED"]),
    customFields: z.unknown(),
    executionTemplate: z.unknown(),
    createdById: id.nullable(),
    updatedById: id.nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    latestVersion: z
      .object({ id, versionNumber: z.number().int().positive() })
      .strict()
      .nullable(),
    criteria: z.array(governanceCriterionSnapshot).max(MAX_GOVERNANCE_CRITERIA),
  })
  .strict();
export const planGovernancePreviewOutput = z
  .object({
    scope: caseFieldReadScopeSchema,
    snapshot: planGovernanceSnapshot,
    planRevision: hash,
    criterionRevisions: z.record(hash),
    canEdit: z.boolean(),
    editBlockedReason: z.string().nullable(),
  })
  .strict();
export const planGovernanceAck = z
  .object({
    scope: caseFieldReadScopeSchema,
    requestId: z.string().uuid(),
    requestHash: hash,
    operation: z.enum(["EDIT_CRITERION_DESCRIPTION", "ATTACH_UNASSIGNED_PLAN"]),
    testPlanId: id,
    criterionId: id.nullable(),
    releaseId: id.nullable(),
    versionId: id,
    versionNumber: z.number().int().positive(),
    beforeRevision: hash,
    afterRevision: hash,
    replayed: z.boolean(),
  })
  .strict();
export const planGovernanceHistoryInput = planGovernanceScopeInput
  .extend({
    take: z.number().int().min(1).max(10).default(5),
    before: z
      .object({ createdAt: z.string().datetime(), id })
      .strict()
      .optional(),
  })
  .strict();
export const planGovernanceReceipt = z
  .object({
    format: z.literal("PlanGovernance/v1"),
    ack: planGovernanceAck.omit({ replayed: true }),
    reason: z.string().max(1000),
    before: planGovernanceSnapshot,
    after: planGovernanceSnapshot,
  })
  .strict();
export const planGovernanceHistoryOutput = z
  .object({
    scope: caseFieldReadScopeSchema,
    entries: z
      .array(
        z.object({
          id,
          createdAt: z.string().datetime(),
          receipt: planGovernanceReceipt,
        }),
      )
      .max(10),
    nextCursor: z.object({ id, createdAt: z.string().datetime() }).nullable(),
  })
  .strict();
export type PlanGovernanceSnapshot = z.infer<typeof planGovernanceSnapshot>;
