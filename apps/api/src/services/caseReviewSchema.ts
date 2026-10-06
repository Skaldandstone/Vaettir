import { createHash } from "node:crypto";
import { z } from "zod";
import { caseFieldReadScopeSchema, pairedCaseFieldReadPins } from "./caseFieldReadScope.js";
import { caseFieldPresentationJsonBytes } from "./caseFieldPresentationSchema.js";

const id = z.string().min(1).max(200).refine(value => !value.includes("\0") && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value));
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const status = z.enum(["PENDING_REVIEW", "APPROVED", "REJECTED"]);
export const reviewReadInput = z.object({ projectId: id, requestId: z.string().uuid(), originalOrganizationId: id.optional(), expectedClerkActorId: id.optional(), expectedNativeActorId: id.optional() }).strict().superRefine(pairedCaseFieldReadPins);
export const reviewPreviewInput = z.object({ projectId: id, caseId: id, requestId: z.string().uuid(), originalOrganizationId: id.optional(), expectedClerkActorId: id.optional(), expectedNativeActorId: id.optional() }).strict().superRefine(pairedCaseFieldReadPins);
export const reviewPageInput = z.object({ projectId: id, requestId: z.string().uuid(), originalOrganizationId: id.optional(), expectedClerkActorId: id.optional(), expectedNativeActorId: id.optional(), search: z.string().max(200), sort: z.enum(["confidence", "case-id", "title"]), offset: z.number().int().min(0).max(999975), populationHash: hash.optional() }).strict().superRefine(pairedCaseFieldReadPins).superRefine((input, ctx) => { if (input.offset > 0 && !input.populationHash) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Later pages require the reviewed pending population hash." }); });
export const reviewNote = z.discriminatedUnion("operation", [z.object({ operation: z.literal("KEEP") }).strict(), z.object({ operation: z.literal("CLEAR") }).strict(), z.object({ operation: z.literal("SET"), value: z.string().max(4000).refine(value => !value.includes("\0") && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) }).strict()]);
export const reviewDecisionInput = z.object({ projectId: id, caseId: id, originalOrganizationId: id, expectedClerkActorId: id, expectedNativeActorId: id, expectedContentHash: hash, expectedReviewStateHash: hash, decision: z.enum(["APPROVED", "REJECTED"]), note: reviewNote, requestId: z.string().uuid(), confirmed: z.literal(true) }).strict();
export const reviewAccessOutput = z.object({ projectId: id, requestId: z.string().uuid(), readScope: caseFieldReadScopeSchema, canRecover: z.boolean() }).strict();
export const reviewMetadata = z.object({ id, displayId: z.string().max(200), title: z.string().max(4000), confidence: z.number().finite().min(0).max(1).nullable(), sourceFilePath: z.string().max(4000).nullable() }).strict();
export const reviewPageOutput = reviewAccessOutput.extend({ items: z.array(reviewMetadata).max(25), totalPending: z.number().int().min(0).max(1000000), matching: z.number().int().min(0).max(1000000), offset: z.number().int().nonnegative(), populationHash: hash, nextOffset: z.number().int().nonnegative().nullable() }).strict();
export const reviewCountOutput = reviewAccessOutput.extend({ totalPending: z.number().int().min(0).max(1000000) }).strict();
export const reviewStateSchema = z.object({ status, archived: z.boolean(), reviewedById: id.nullable(), reviewedAt: z.string().nullable(), note: z.string().max(4000).nullable(), origin: z.string().max(200), confidence: z.number().finite().min(0).max(1).nullable() }).strict();
export const reviewSnapshotSchema = z.object({ kind: z.enum(["CaseReviewSnapshot/v1", "CaseReviewSnapshot/v2"]), case: z.unknown(), authoredSteps: z.unknown(), effectiveSteps: z.unknown(), sharedProcedure: z.unknown(), prerequisites: z.unknown(), context: z.unknown(), source: z.unknown(), aiBaseline: z.unknown(), state: reviewStateSchema }).strict();
export const reviewPreviewOutput = reviewAccessOutput.extend({ caseId: id, canDecide: z.boolean(), supported: z.boolean(), blockedReason: z.string().max(1000).nullable(), snapshot: reviewSnapshotSchema.nullable(), contentHash: hash.nullable(), reviewStateHash: hash.nullable() }).strict();
export const reviewDecisionOutput = z.object({ projectId: id, caseId: id, requestId: z.string().uuid(), requestHash: hash, decision: z.enum(["APPROVED", "REJECTED"]), replayed: z.boolean(), readScope: caseFieldReadScopeSchema }).strict();
export const CASE_REVIEW_EXCLUSIONS = ["Paid risk/design/automation output", "Comments and prior versions", "Historical/frozen runs and readiness", "Provider/credit state and source-file contents"] as const;
export function reviewRequestHash(input: z.infer<typeof reviewDecisionInput>) { return createHash("sha256").update(JSON.stringify(reviewDecisionInput.parse(input))).digest("hex"); }
export function reviewSnapshotHashes(snapshot: z.infer<typeof reviewSnapshotSchema>) {
  // Explicit supported review projection, NOT the global case revision. Neither
  // parser defaults nor a historical AI baseline substitutes for current prose.
  if (caseFieldPresentationJsonBytes(snapshot) > 524288) throw Error("Unsupported complete review snapshot.");
  const { state, ...content } = snapshot;
  return { contentHash: createHash("sha256").update(JSON.stringify(content)).digest("hex"), reviewStateHash: createHash("sha256").update(JSON.stringify(state)).digest("hex") };
}
