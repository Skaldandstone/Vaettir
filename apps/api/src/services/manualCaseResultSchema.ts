import { z } from "zod";
import { observationsSchema } from "./physicalValidation.js";
import { manualRetestExpectedScopeSchema, manualRetestObservedScopeSchema } from "./manualRetestScopeSchema.js";
const identity = z.string().min(1).max(200), hash = z.string().regex(/^[a-f0-9]{64}$/);
// Refuse unknown legacy reading fields instead of silently dropping evidence
// while applying a human correction. These are recorded user limits, not standards.
const reading = z.object({ name: z.string().trim().min(1).max(200), unit: z.string().trim().min(1).max(40), value: z.number().finite(),
  lowerLimit: z.number().finite().optional(), upperLimit: z.number().finite().optional(), instrument: z.string().trim().max(200).default("") }).strict()
  .refine(m => m.lowerLimit === undefined || m.upperLimit === undefined || m.lowerLimit <= m.upperLimit, { message: "Lower limit must not exceed upper limit" });
const caseObservations = observationsSchema.extend({ measurements: z.array(reading).max(100).default([]) }).strict();
export const manualCaseOutcomeSchema = z.enum(["PASS", "FAIL", "BLOCKED", "SKIP"]);
export const manualCaseResultReadSchema = z.object({ projectId: identity, testRunId: identity, testCaseId: identity, expectedScope: manualRetestExpectedScopeSchema }).strict();
export const manualCaseResultHistorySchema = manualCaseResultReadSchema.extend({ before: identity.optional(), limit: z.number().int().min(1).max(20).default(20) });
export const manualCaseResultWriteSchema = manualCaseResultReadSchema.extend({
  expectedRevisionId: identity.nullable(), expectedCurrentFingerprint: hash,
  status: manualCaseOutcomeSchema, note: z.string().max(10000).nullable(),
  observations: caseObservations, correctionReason: z.string().trim().min(1).max(2000).nullable(), idempotencyKey: z.string().uuid(),
}).strict();
export const manualCaseObservationSchema = z.object({ resultId: identity, status: manualCaseOutcomeSchema, note: z.string().max(10000).nullable(), observations: caseObservations }).strict();
export const manualCaseResultRevisionOutputSchema = z.object({ id: identity, revisionNumber: z.number().int().min(1).max(100),
  result: manualCaseObservationSchema, actorLabel: z.string().min(1).max(200), recordedAt: z.date(), correctionReason: z.string().max(2000).nullable(), previousRevisionId: identity.nullable(),
  legacyPrior: z.object({ basis: z.literal("UNVERSIONED_OBSERVATION_CAPTURED_NOW"), originalRecorder: z.null(), originalRecordedAt: z.null(), captured: manualCaseObservationSchema }).strict().nullable(),
}).strict();
export const manualCaseResultPreviewOutputSchema = z.object({ scope: manualRetestObservedScopeSchema, requested: z.string().max(2000), displayId: identity,
  current: manualCaseObservationSchema.nullable(), currentRevisionId: identity.nullable(), revisionNumber: z.number().int().min(0).max(100), currentFingerprint: hash,
  canWrite: z.boolean(), tracked: z.boolean(), runStatus: identity, limitations: z.array(z.string().max(500)).max(10) }).strict();
export const manualCaseResultHistoryOutputSchema = z.object({ scope: manualRetestObservedScopeSchema, requested: z.string().max(2000),
  canWrite: z.boolean(), runStatus: identity, revisions: z.array(manualCaseResultRevisionOutputSchema).max(20), nextCursor: identity.nullable(), limitations: z.array(z.string().max(500)).max(10) }).strict();
export const manualCaseResultAckSchema = z.object({ scope: manualRetestObservedScopeSchema, testRunId: identity, testCaseId: identity,
  resultId: identity, revisionId: identity, revisionNumber: z.number().int().min(1).max(100), idempotencyKey: z.string().uuid(), requestHash: hash, recovered: z.boolean() }).strict();
export type ManualCaseResultRead = z.infer<typeof manualCaseResultReadSchema>;
export type ManualCaseResultWrite = z.infer<typeof manualCaseResultWriteSchema>;
export type ManualCaseResultPreview = z.infer<typeof manualCaseResultPreviewOutputSchema>;
export type ManualCaseResultAck = z.infer<typeof manualCaseResultAckSchema>;
export function manualCaseResultReadKey(input: ManualCaseResultRead & { before?: string; limit?: number }) {
  return JSON.stringify({ projectId: input.projectId, testRunId: input.testRunId, testCaseId: input.testCaseId,
    expectedScope: { projectId: input.expectedScope.projectId, organizationId: input.expectedScope.organizationId, clerkActorId: input.expectedScope.clerkActorId },
    ...(input.before === undefined ? {} : { before: input.before }), ...(input.limit === undefined ? {} : { limit: input.limit }) });
}
/** Canonical explicit request serialization shared by server digest and browser ACK check. */
export function manualCaseResultWriteKey(input: ManualCaseResultWrite) {
  return JSON.stringify({ projectId: input.projectId, testRunId: input.testRunId, testCaseId: input.testCaseId,
    expectedScope: { projectId: input.expectedScope.projectId, organizationId: input.expectedScope.organizationId, clerkActorId: input.expectedScope.clerkActorId },
    expectedRevisionId: input.expectedRevisionId, expectedCurrentFingerprint: input.expectedCurrentFingerprint, status: input.status, note: input.note,
    observations: input.observations, correctionReason: input.correctionReason, idempotencyKey: input.idempotencyKey });
}
