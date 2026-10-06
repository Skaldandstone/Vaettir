import { z } from "zod";
import { retestPreviewInputSchema, retestStartInputSchema } from "./manualRetestInputSchema.js";
import { manualRetestObservedScopeSchema, manualRetestStartOutputSchema } from "./manualRetestScopeSchema.js";
import { caseFieldPresentationJsonBytes } from "./caseFieldPresentationSchema.js";

// Server-only transport schemas. Browser readers must use RouterOutputs/types,
// not import this graph. Old parsed inner requests/hashes remain unchanged.
const identity = z.string().min(1).max(200);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const pinnedRequest = retestPreviewInputSchema.refine(input => input.expectedScope !== undefined && input.expectedScope.projectId === input.projectId);
export const retestAccessReviewedInput = z.object({ request: retestPreviewInputSchema, readRequestId: z.string().uuid(), expectedNativeActorId: identity.optional() }).strict();
export const retestPreviewReviewedInput = z.object({ request: pinnedRequest, readRequestId: z.string().uuid(), expectedNativeActorId: identity }).strict();
export const retestLinksReviewedInput = z.object({ request: retestPreviewInputSchema.extend({ before: identity.optional() }).refine(input => input.expectedScope !== undefined && input.expectedScope.projectId === input.projectId), readRequestId: z.string().uuid(), expectedNativeActorId: identity }).strict();
export const retestStartReviewedInput = z.object({ request: retestStartInputSchema.refine(input => input.expectedScope !== undefined && input.expectedScope.projectId === input.projectId), expectedNativeActorId: identity }).strict();
export type RetestReviewedReadInput = z.infer<typeof retestAccessReviewedInput> | z.infer<typeof retestLinksReviewedInput>;
export function retestReviewedReadKey(input: RetestReviewedReadInput) {
  return JSON.stringify({ version: 1, request: input.request, readRequestId: input.readRequestId, ...(input.expectedNativeActorId === undefined ? {} : { expectedNativeActorId: input.expectedNativeActorId }) });
}
const readContext = z.object({ requestId: z.string().uuid(), requested: z.string().max(4096), projection: z.enum(["ACCESS", "PREVIEW", "LINKS"]), scope: manualRetestObservedScopeSchema }).strict();
export const retestAccessReviewedOutput = z.object({ readContext: readContext.extend({ projection: z.literal("ACCESS") }).strict(), basis: z.literal("CURRENT_PROJECT_MEMBER_ONLY"), sourceRelationshipVerified: z.literal(false) }).strict();
const text = z.string().max(10000);
const procedure = z.object({
  testCaseId: identity, title: text, validationDomain: z.string().max(100), reviewStatus: z.string().max(100), background: text.nullable(),
  given: z.array(text).max(500), when: z.array(text).max(500), then: z.array(text).max(500),
  verificationProfile: z.object({ setup: text, safety: text, instruments: text, acceptanceCriteria: text }).strict(),
  steps: z.array(z.object({ order: z.number().int().nonnegative(), action: text, expectedActionOrData: text.nullable(), expectedResult: text.nullable(), expectedResponse: text.nullable(), mediaAttachmentIds: z.array(z.string().max(200)).max(100) }).strict()).max(500),
}).strict();
const reference = z.string().max(300);
const configuration = z.object({ configuration: z.string().max(2000), platform: reference, build: reference, hardwareRevision: reference, firmwareVersion: reference, rig: reference, batchOrLot: reference, environment: z.string().max(2000), calibrationReference: reference, protocolReference: reference }).strict();
const measurement = z.object({ name: z.string().min(1).max(200), unit: z.string().min(1).max(40), value: z.number().finite(), lowerLimit: z.number().finite().optional(), upperLimit: z.number().finite().optional(), instrument: z.string().max(200) }).strict();
const observations = z.object({ specimen: z.string().max(300), hardwareRevision: z.string().max(200), firmwareVersion: z.string().max(200), environment: z.string().max(1000), measurements: z.array(measurement).max(100) }).strict();
const sourceResult = z.object({ id: identity, testCaseId: identity, status: z.enum(["PASS", "FAIL", "BLOCKED", "SKIP", "FLAKY"]), note: text.nullable(), errorMessage: text.nullable(), observations }).strict();
const dataset = z.object({ batchId: z.string().regex(/^dataset_[a-f0-9]{64}$/), datasetId: identity, datasetHash: hash, rowIndex: z.number().int().min(0).max(49), rowName: z.string().min(1).max(200), values: z.record(z.string().max(10000)) }).strict();
const preview = z.object({ scope: manualRetestObservedScopeSchema, requested: z.string().max(4096), stepFieldLabels: z.record(z.string().max(200)), projectId: identity, sourceRunId: identity, testCaseId: identity, displayId: identity, reviewHash: hash, sourceOutcome: z.enum(["FAIL", "BLOCKED"]), configuration, caseDefinitions: z.array(procedure).min(1).max(1000), sourceResults: z.array(sourceResult).min(1).max(500), prerequisiteCount: z.number().int().min(0).max(999), credits: z.literal(0), sourceDatasetExecution: dataset.nullable() }).strict();
export const retestPreviewReviewedOutput = z.object({ readContext: readContext.extend({ projection: z.literal("PREVIEW") }).strict(), basis: z.literal("LEGACY_BOUNDED_PREPARATION_V1"), preview }).strict();
const date = z.date().refine(value => value.getUTCFullYear() >= 1 && value.getUTCFullYear() <= 9999);
const links = z.object({ scope: manualRetestObservedScopeSchema, requested: z.string().max(4096), original: z.object({ testRunId: identity, capturedOutcome: z.enum(["FAIL", "BLOCKED"]) }).strict().nullable(), retests: z.array(z.object({ testRunId: identity, startedAt: date, status: z.enum(["RUNNING", "PASSED", "FAILED", "PARTIAL"]) }).strict()).max(10), nextCursor: identity.nullable() }).strict();
export const retestLinksReviewedOutput = z.object({ readContext: readContext.extend({ projection: z.literal("LINKS") }).strict(), links }).strict();
export const retestStartReviewedOutput = manualRetestStartOutputSchema.extend({ scope: manualRetestStartOutputSchema.shape.scope.unwrap() }).strict();

/** An additional DTO admission, not native JSON precision or raw audit proof.
 * No trim/default/coercion/unknown-key dropping is introduced at this boundary.
 * Date labels retain the existing service's JS-Date projection limitation. */
export function boundedRetestReviewedOutput<S extends z.ZodTypeAny>(schema: S, value: unknown, maxBytes = 2097152): z.output<S> {
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 2097152) throw Error("Unsupported retest projection bound");
  if (caseFieldPresentationJsonBytes(dateProjection(value)) > maxBytes) throw Error("Unsupported bounded retest projection");
  const parsed = schema.safeParse(value);
  if (!parsed.success || !sameRepresentation(value, parsed.data)) throw Error("Unsupported bounded retest projection");
  return parsed.data;
}
function dateProjection(value: unknown): unknown {
  // Native service output has Dates only at retest links. Validate descriptors
  // first and copy for byte measurement; no arbitrary toJSON/accessors execute.
  let count = 0;
  const seen = new Set<object>();
  function visit(item: unknown, depth: number): unknown {
    if (++count > 100000 || depth > 64) throw Error("Unsupported retest structure");
    if (item instanceof Date) { if (Object.getPrototypeOf(item) !== Date.prototype || Reflect.ownKeys(item).length || !Number.isFinite(Date.prototype.getTime.call(item))) throw Error("Unsupported retest date"); return Date.prototype.toISOString.call(item); }
    if (!item || typeof item !== "object") return item;
    if (seen.has(item)) throw Error("Unsupported retest cycle");
    if (!Array.isArray(item) && ![Object.prototype, null].includes(Object.getPrototypeOf(item))) throw Error("Unsupported retest object");
    const descriptors = Object.getOwnPropertyDescriptors(item);
    if (Reflect.ownKeys(item).length !== Object.keys(descriptors).length || Object.values(descriptors).some(d => d.get || d.set || !d.enumerable && !(Array.isArray(item) && "value" in d && d === descriptors.length))) throw Error("Unsupported retest descriptors");
    seen.add(item);
    try {
      if (Array.isArray(item)) {
        if (Object.getPrototypeOf(item) !== Array.prototype || Object.keys(descriptors).some(key => key !== "length" && !/^(0|[1-9]\d*)$/.test(key)) || Object.keys(descriptors).length !== item.length + 1) throw Error("Unsupported retest array");
        return item.map(entry => visit(entry, depth + 1));
      }
      return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, visit(descriptor.value, depth + 1)]));
    } finally { seen.delete(item); }
  }
  return visit(value, 0);
}
function sameRepresentation(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a instanceof Date && b instanceof Date) return Date.prototype.getTime.call(a) === Date.prototype.getTime.call(b);
  if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) return false;
  const left = Object.getOwnPropertyDescriptors(a), right = Object.getOwnPropertyDescriptors(b);
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && sameRepresentation(left[key]!.value, right[key]!.value));
}
