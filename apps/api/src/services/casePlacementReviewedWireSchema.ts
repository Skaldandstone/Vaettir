// Browser-pure wire contracts. No native client, service or Node imports.
import { z } from "zod";
const nativeText = (value: string) => {
  if (value.includes("\0")) return false;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
};
const id = z
    .string()
    .min(1)
    .max(200)
    .refine(nativeText, "Unsupported native identity"),
  hash = z.string().regex(/^[a-f0-9]{64}$/);
// Exact native scope scalar shape copied from caseFieldReadScopeSchema. This
// module cannot import that native lock service into a browser import graph.
export const placementReadScopeSchema = z
  .object({
    projectId: z.string().min(1).max(200),
    organizationId: z.string().min(1).max(200),
    actorId: z.string().min(1).max(200),
    actorClerkUserId: z.string().min(1).max(200),
  })
  .strict();
export const placementRawPath = z
  .string()
  .max(240)
  .refine(nativeText, "Unsupported native path")
  .nullable();
export const placementMetadata = z
  .object({
    id,
    displayId: id,
    suitePath: placementRawPath,
    sortPosition: z.number().int().min(-2147483648).max(2147483647),
    createdAtText: z.string().min(1).max(100),
    reviewStatus: z.enum(["APPROVED", "PENDING_REVIEW", "REJECTED"]),
  })
  .strict();
export const placementAccessInput = z
  .object({
    projectId: id,
    caseId: id,
    readRequestId: z.string().uuid(),
    originalOrganizationId: id.optional(),
    expectedClerkActorId: id.optional(),
    expectedNativeActorId: id.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const provided = [
      value.originalOrganizationId,
      value.expectedClerkActorId,
      value.expectedNativeActorId,
    ].filter((pin) => pin !== undefined).length;
    if (provided !== 0 && provided !== 3)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Original organization, Clerk actor and native actor read pins must be supplied together, or all omitted for current access discovery.",
      });
  });
export const placementAccessOutput = z
  .object({
    projectId: id,
    caseId: id,
    readRequestId: z.string().uuid(),
    readScope: placementReadScopeSchema,
    canWrite: z.boolean(),
    canRecover: z.boolean(),
  })
  .strict();
// Property order is part of the v1 canonical parsed request hash; keep exact.
const moveFields = {
  projectId: id,
  caseId: id,
  originalOrganizationId: id,
  expectedClerkActorId: id,
  expectedNativeActorId: id,
  expectedSuitePath: placementRawPath,
  expectedSortPosition: placementMetadata.shape.sortPosition,
  targetSuitePath: placementRawPath,
  beforeCaseId: id.nullable(),
};
export const placementPreviewInput = z
  .object({ ...moveFields, readRequestId: z.string().uuid() })
  .strict();
export const placementPreviewOutput = placementAccessOutput
  .extend({
    intent: z
      .object({
        caseId: id,
        expectedSuitePath: placementRawPath,
        expectedSortPosition: placementMetadata.shape.sortPosition,
        targetSuitePath: placementRawPath,
        beforeCaseId: id.nullable(),
      })
      .strict(),
    moving: placementMetadata,
    rows: z.array(placementMetadata).max(4000),
    sourceCount: z.number().int().min(1).max(2000),
    targetCount: z.number().int().min(0).max(2000),
    expectedCohortHash: hash,
    warnings: z.array(z.string().max(500)).max(8),
  })
  .strict();
export const placementMoveInput = z
  .object({
    ...moveFields,
    requestId: z.string().uuid(),
    expectedCohortHash: hash,
    confirmed: z.literal(true),
  })
  .strict();
export const placementMoveAck = z
  .object({
    kind: z.literal("CasePlacementReviewedMove"),
    version: z.literal(1),
    projectId: id,
    caseId: id,
    readScope: placementReadScopeSchema,
    requestId: z.string().uuid(),
    requestHash: hash,
    receiptId: id,
    suitePath: placementRawPath,
    sortPosition: z.number().int().min(0).max(1999),
    recovered: z.boolean(),
  })
  .strict();
export const placementStoredReceipt = z
  .object({
    kind: z.literal("CasePlacementReviewedMove"),
    version: z.literal(1),
    organizationId: id,
    scope: placementReadScopeSchema,
    caseId: id,
    requestId: z.string().uuid(),
    requestHash: hash,
    before: z.array(placementMetadata).max(4000),
    after: z.array(placementMetadata).max(4000),
    beforeCohortHash: hash,
    suitePath: placementRawPath,
    sortPosition: z.number().int().min(0).max(1999),
  })
  .strict();
