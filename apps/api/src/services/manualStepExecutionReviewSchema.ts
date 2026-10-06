import { z } from "zod";

const identity = z.string().min(1).max(200).refine(value => !value.includes("\0") && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value));
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const prose = (max: number) => z.string().max(max).refine(value => !value.includes("\0") && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value));
const number = z.number().finite().refine(value => !Number.isInteger(value) || Number.isSafeInteger(value), "Unsupported integer precision.");
export const reviewedStepStatusSchema = z.enum(["PASS", "FAIL", "BLOCKED", "SKIP"]);
export const reviewedStepMeasurementSchema = z.object({ name: prose(200).refine(value => !!value.trim()), unit: prose(40).refine(value => !!value.trim()), value: number, lowerLimit: number.optional(), upperLimit: number.optional(), instrument: prose(200) }).strict().refine(value => value.lowerLimit === undefined || value.upperLimit === undefined || value.lowerLimit <= value.upperLimit, "Lower limit exceeds upper limit.");
export const reviewedStepObservationsSchema = z.object({ specimen: prose(300), hardwareRevision: prose(200), firmwareVersion: prose(200), environment: prose(1000), measurements: z.array(reviewedStepMeasurementSchema).max(100) }).strict();
export const reviewedStepScopeSchema = z.object({ projectId: identity, organizationId: identity, actorId: identity, actorClerkUserId: identity }).strict();
const ref = { projectId: identity, testRunId: identity, testCaseId: identity, stepIndex: z.number().int().min(0).max(499) };
const optionalPins = { originalOrganizationId: identity.optional(), expectedClerkActorId: identity.optional(), expectedNativeActorId: identity.optional() };
export const reviewedStepPreviewInputSchema = z.object({ ...ref, ...optionalPins, readRequestId: z.string().uuid() }).strict().superRefine((value, ctx) => {
  const present = [value.originalOrganizationId, value.expectedClerkActorId, value.expectedNativeActorId].filter(value => value !== undefined).length;
  if (present !== 0 && present !== 3) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Original organization, Clerk and native actor pins must be supplied together." });
});
export const reviewedStepWriteInputSchema = z.object({ ...ref, originalOrganizationId: identity, expectedClerkActorId: identity, expectedNativeActorId: identity,
  expectedProcedureHash: hash, expectedCurrentFingerprint: hash, expectedRevisionId: identity.nullable(), status: reviewedStepStatusSchema,
  note: prose(10000).nullable(), observations: reviewedStepObservationsSchema, evidenceAttachmentIds: z.array(identity).max(20).refine(ids => new Set(ids).size === ids.length),
  correctionReason: prose(2000).nullable(), idempotencyKey: z.string().uuid(), confirmed: z.literal(true),
}).strict();
export const reviewedStepCurrentSchema = z.object({ id: identity, status: reviewedStepStatusSchema, note: prose(10000).nullable(), observations: reviewedStepObservationsSchema,
  evidenceAttachments: z.array(z.object({ id: identity, fileName: prose(255) }).strict()).max(20), actorName: prose(200), recordedAt: z.date(), correctionReason: prose(2000).nullable(), previousRevisionId: identity.nullable(), revisionNumber: z.number().int().min(1).max(100) }).strict();
export const reviewedStepPreviewOutputSchema = z.object({ ...ref, readRequestId: z.string().uuid(), scope: reviewedStepScopeSchema, canRecover: z.boolean(), canRecord: z.boolean(), supported: z.boolean(), blockedReason: prose(1000).nullable(),
  frozenDefinition: z.unknown().nullable(), current: reviewedStepCurrentSchema.nullable(), rawCurrent: z.unknown().nullable(), procedureHash: hash.nullable(), currentFingerprint: hash.nullable(),
  provenance: z.literal("CURRENT_AUTHORITY_LEGACY_ORIGINAL_TENANCY_UNRECORDED"),
}).strict();
export const reviewedStepAckSchema = z.object({ ...ref, scope: reviewedStepScopeSchema, idempotencyKey: z.string().uuid(), requestHash: hash, revisionId: identity, caseStatus: reviewedStepStatusSchema.nullable(), recovered: z.boolean(), provenance: z.literal("REVIEWED_REQUEST_BOUND_AT_WRITE") }).strict();
export type ReviewedStepPreviewInput = z.infer<typeof reviewedStepPreviewInputSchema>;
export type ReviewedStepWriteInput = z.infer<typeof reviewedStepWriteInputSchema>;
export type ReviewedStepPreview = z.infer<typeof reviewedStepPreviewOutputSchema>;
export type ReviewedStepAck = z.infer<typeof reviewedStepAckSchema>;
// Browser wire shape is additive. The server's Date DTO remains unchanged;
// JSON transport has no SuperJSON and must not pretend a received string is Date.
const reviewedStepWireTimestamp = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/).refine(value => { const parsed = new Date(value); return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value; }, "Unsupported timestamp representation.");
export const reviewedStepWirePreviewSchema = reviewedStepPreviewOutputSchema.extend({ current: reviewedStepCurrentSchema.omit({ recordedAt: true }).extend({ recordedAt: reviewedStepWireTimestamp }).nullable() });
export type ReviewedStepWirePreview = z.infer<typeof reviewedStepWirePreviewSchema>;
/** Complete reviewed envelope; old normalized step receipt hash is separate. */
export function reviewedStepWriteKey(value: ReviewedStepWriteInput) { return JSON.stringify({ projectId: value.projectId, testRunId: value.testRunId, testCaseId: value.testCaseId, stepIndex: value.stepIndex,
  originalOrganizationId: value.originalOrganizationId, expectedClerkActorId: value.expectedClerkActorId, expectedNativeActorId: value.expectedNativeActorId,
  expectedProcedureHash: value.expectedProcedureHash, expectedCurrentFingerprint: value.expectedCurrentFingerprint, expectedRevisionId: value.expectedRevisionId,
  status: value.status, note: value.note, observations: value.observations, evidenceAttachmentIds: value.evidenceAttachmentIds, correctionReason: value.correctionReason, idempotencyKey: value.idempotencyKey, confirmed: true }); }
