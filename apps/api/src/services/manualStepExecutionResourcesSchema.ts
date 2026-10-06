import { z } from "zod";
import { supportedManualExecutionIdentity } from "./manualExecutionReadScopeSchema.js";
import { reviewedStepScopeSchema, reviewedStepStatusSchema } from "./manualStepExecutionReviewSchema.js";

const identity = z.string().min(1).max(200).refine(supportedManualExecutionIdentity);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const prose = (max: number) => z.string().max(max).refine(value => !value.includes("\0") && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value));
export const stepResourceTimestamp = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/).refine(value => { const date = new Date(value); return Number.isFinite(date.getTime()) && date.toISOString() === value; });
const original = {
  projectId: identity, testRunId: identity, testCaseId: identity, stepIndex: z.number().int().min(0).max(499),
  originalOrganizationId: identity, expectedClerkActorId: identity, expectedNativeActorId: identity,
  readRequestId: z.string().uuid(), cursor: z.string().min(1).max(2400).nullable(), limit: z.number().int().min(1).max(25),
};
export const stepResourceHistoryInput = z.object(original).strict();
export const stepResourceEvidenceInput = z.object({ ...original, search: prose(200) }).strict();
export const stepResourceCursorSchema = z.object({ version: z.literal(1), kind: z.enum(["HISTORY", "EVIDENCE"]), scopeKey: hash, populationHash: hash, position: identity, revisionNumber: z.number().int().min(1).max(100).nullable() }).strict();
const envelope = {
  projectId: identity, testRunId: identity, testCaseId: identity, stepIndex: z.number().int().min(0).max(499),
  readRequestId: z.string().uuid(), requestKey: hash, scope: reviewedStepScopeSchema,
  procedureHash: hash, populationHash: hash, nextCursor: z.string().min(1).max(2400).nullable(),
  provenance: z.literal("CURRENT_READER_AUTHORITY_HISTORICAL_ORIGINAL_TENANCY_UNRECORDED"),
};
// Raw JSON is deliberate read-only evidence. Unknown observation/verification
// fields are not passed through the authoring parser or defaulted away.
export const stepResourceRevision = z.object({ id: identity, revisionNumber: z.number().int().min(1).max(100), status: reviewedStepStatusSchema,
  note: prose(10000).nullable(), observations: z.unknown(), evidenceAttachmentIds: z.array(identity).max(20), evidenceAttachments: z.unknown(),
  actorId: identity, actorName: prose(200), recordedAt: stepResourceTimestamp, correctionReason: prose(2000).nullable(), previousRevisionId: identity.nullable(),
  versionProvenance: z.literal("STORED_REVISION_METADATA_NOT_FILE_IMMUTABILITY_PROOF"),
}).strict();
export const stepResourceHistoryOutput = z.object({ ...envelope, revisions: z.array(stepResourceRevision).max(25), totalRevisions: z.number().int().min(0).max(100), frozenStep: z.unknown() }).strict();
export const stepResourceFile = z.object({ id: identity, testCaseId: identity, fileName: prose(255), contentType: prose(200), sizeBytes: z.number().int().min(1).max(25 * 1024 * 1024),
  uploadCompletedAt: stepResourceTimestamp, uploadVerification: z.unknown(), versionId: prose(300).nullable().optional(),
  versionProvenance: z.enum(["VERSION_ID_RECORDED_NOT_FETCHED", "UNVERSIONED_NOT_IMMUTABLE", "UNSUPPORTED_VERIFICATION_RETAINED_READ_ONLY"]), selectable: z.boolean(),
}).strict();
export const stepResourceEvidenceOutput = z.object({ ...envelope, attachments: z.array(stepResourceFile).max(25), totalCandidates: z.number().int().min(0).max(10000), search: prose(200), frozenStep: z.unknown() }).strict();
export type StepResourceHistoryInput = z.infer<typeof stepResourceHistoryInput>;
export type StepResourceEvidenceInput = z.infer<typeof stepResourceEvidenceInput>;
export type StepResourceHistory = z.infer<typeof stepResourceHistoryOutput>;
export type StepResourceEvidence = z.infer<typeof stepResourceEvidenceOutput>;
