import type { ReviewedRunConfiguration } from "./run-configuration-request";
import { admitRunStartRead, runStartReadIdentity, type RunStartReadSnapshot, type RunStartReadInput } from "./manual-run-start-reviewed-reader";
import { admitPlanExecutionRead, inspectPlanExecutionReadWire, type PlanExecutionReadSnapshot, type PlanExecutionReadPageInput, type PlanExecutionReadPageWire } from "./plan-execution-reviewed-reader";
import { freezeReviewedRunStart, verifyReviewedRunStartAck, expectedReviewedRunId, type OwnedReviewedRunStart, type ReviewedRunStartEnvelope } from "./run-start-reviewed-write";

export type ReviewedPlanRunRequest = ReviewedRunConfiguration & {
  planReference: { testPlanId: string; expectedTemplateHash: string; configurationId: string };
};
export type OwnedReviewedPlanStart = Omit<OwnedReviewedRunStart, "request"> & Readonly<{
  request: ReviewedPlanRunRequest;
  planOrigin: PlanExecutionReadSnapshot["origin"];
  submittedPlanReadRequestId: string;
  selectedConfigurationId: string;
  templateHash: string;
  cohortVerified: false;
  receiptVerified: false;
}>;
export type ReviewedPlanStartSelection = Readonly<{
  intent: "UNSENT";
  plan: PlanExecutionReadSnapshot | null;
  profile: RunStartReadSnapshot | null;
  configurationId: string;
  currentPlan: () => PlanExecutionReadSnapshot | null;
  currentProfile: () => RunStartReadSnapshot | null;
}>;
const unavailable = () => Error("A new unsent plan execution requires exact current original native template/profile/selection/configuration agreement. No historical attempt was adopted and nothing was submitted.");
const fields = (value: unknown, required: readonly string[]): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === required.length && required.every(key => Object.hasOwn(value, key));
const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
function frozenTree(value: unknown): boolean {
  if (!value || typeof value !== "object") return true;
  return Object.isFrozen(value) && Object.values(value).every(frozenTree);
}
function copy<T>(value: T): T {
  if (!value || typeof value !== "object") return value;
  return Object.freeze(Array.isArray(value) ? value.map(copy) : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copy(item)]))) as T;
}
function snapshot(value: unknown) {
  inspectPlanExecutionReadWire(value);
  return fields(value, ["origin", "observedSessionId", "projection", "epoch", "revision", "receivedAt", "data"]) && frozenTree(value) && runStartReadIdentity(value.observedSessionId) && typeof value.epoch === "number" && Number.isSafeInteger(value.epoch) && value.epoch >= 0 && typeof value.revision === "number" && Number.isSafeInteger(value.revision) && value.revision >= 0 && typeof value.receivedAt === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.receivedAt) && new Date(value.receivedAt).toISOString() === value.receivedAt;
}
function planPage(value: PlanExecutionReadSnapshot): PlanExecutionReadPageWire {
  if (!snapshot(value) || value.projection !== "PAGE") throw unavailable();
  const tuple: unknown = JSON.parse(value.data.readContext.requestedKey);
  if (!Array.isArray(tuple) || tuple.length !== 10 || tuple[0] !== "PAGE" || tuple[1] !== value.origin.projectId || tuple[2] !== value.origin.testPlanId || tuple[3] !== value.origin.organizationId || tuple[4] !== value.origin.clerkActorId || tuple[5] !== value.origin.nativeActorId || !uuid(tuple[6]) || typeof tuple[7] !== "string" || typeof tuple[8] !== "number" || !(tuple[9] === null || Array.isArray(tuple[9]) && tuple[9].length === 2 && typeof tuple[9][0] === "string" && typeof tuple[9][1] === "string")) throw unavailable();
  const input: PlanExecutionReadPageInput = { projectId: value.origin.projectId, testPlanId: value.origin.testPlanId, originalOrganizationId: value.origin.organizationId, expectedClerkActorId: value.origin.clerkActorId, expectedNativeActorId: value.origin.nativeActorId, requestId: tuple[6], search: tuple[7], limit: tuple[8], ...(tuple[9] === null ? {} : { cursor: { scopeKey: tuple[9][0] as string, lastId: tuple[9][1] as string } }) };
  const admitted = admitPlanExecutionRead(value.data, input, "PAGE", value.origin.clerkActorId, value.origin);
  if (!admitted || !("plan" in admitted.data) || JSON.stringify(admitted.data) !== JSON.stringify(value.data)) throw unavailable();
  return admitted.data as PlanExecutionReadPageWire;
}
function profileInput(value: RunStartReadSnapshot): RunStartReadInput {
  if (!snapshot(value) || value.projection !== "PREVIEW") throw unavailable();
  const tuple: unknown = JSON.parse(value.data.readContext.requestedKey);
  if (!Array.isArray(tuple) || tuple.length !== 6 || tuple[0] !== "PREVIEW" || tuple[1] !== value.origin.projectId || tuple[2] !== value.origin.organizationId || tuple[3] !== value.origin.clerkActorId || tuple[4] !== value.origin.nativeActorId || !uuid(tuple[5])) throw unavailable();
  return { projectId: value.origin.projectId, originalOrganizationId: value.origin.organizationId, expectedClerkActorId: value.origin.clerkActorId, expectedNativeActorId: value.origin.nativeActorId, requestId: tuple[5] };
}
/** PROSPECTIVE UNSENT ONLY. This does not upgrade or rewrap a retained old
 * attempt. Current callbacks must be the independent readers' current getters;
 * caller/controller SDK/frame ownership is still required at actual dispatch. */
export function freezeReviewedPlanStart(request: ReviewedPlanRunRequest, selection: ReviewedPlanStartSelection): OwnedReviewedPlanStart {
  try {
    if (!selection || typeof selection !== "object" || Array.isArray(selection) || ![Object.prototype, null].includes(Object.getPrototypeOf(selection))) throw unavailable();
    const descriptors = Object.getOwnPropertyDescriptors(selection), keys = Reflect.ownKeys(selection), expected = ["intent", "plan", "profile", "configurationId", "currentPlan", "currentProfile"];
    if (keys.length !== expected.length || keys.some(key => typeof key !== "string" || !expected.includes(key) || !descriptors[key]?.enumerable || !("value" in descriptors[key]!)) || selection.intent !== "UNSENT" || !selection.plan || !selection.profile || !uuid(selection.configurationId) || typeof selection.currentPlan !== "function" || typeof selection.currentProfile !== "function") throw unavailable();
    // Own the original provided bytes before external callbacks can mutate a
    // caller-owned draft. This temporary copy is not returned unless all gates
    // pass. No trim/default/parser or inferred native field enters the body.
    inspectPlanExecutionReadWire(request);
    if (!fields(request, ["projectId", "testCaseIds", "expectedProfileHash", "executionContext", "idempotencyKey", "originalOrganizationId", "expectedClerkActorId", "planReference"])) throw unavailable();
    const retained = copy(request), plan = selection.plan, profile = selection.profile;
    if (selection.currentPlan() !== plan || selection.currentProfile() !== profile) throw unavailable();
    const page = planPage(plan), profileRead = admitRunStartRead(profile.data, profileInput(profile), "PREVIEW", profile.origin.clerkActorId, profile.origin);
    if (!profileRead || JSON.stringify(profileRead.data) !== JSON.stringify(profile.data) || !page.hasFullEditorAccess || !page.template || page.interpretation !== "EXACT_SUPPORTED" || page.plan.status === "ARCHIVED" || plan.origin.projectId !== profile.origin.projectId || plan.origin.organizationId !== profile.origin.organizationId || plan.origin.clerkActorId !== profile.origin.clerkActorId || plan.origin.nativeActorId !== profile.origin.nativeActorId || plan.observedSessionId !== profile.observedSessionId || !fields(retained.planReference, ["testPlanId", "expectedTemplateHash", "configurationId"]) || retained.planReference.testPlanId !== plan.origin.testPlanId || retained.planReference.expectedTemplateHash !== page.templateHash || retained.planReference.configurationId !== selection.configurationId || !hash(retained.planReference.expectedTemplateHash) || !uuid(retained.idempotencyKey)) throw unavailable();
    const preset = page.template.configurations.find(item => item.id === selection.configurationId);
    if (!preset || !retained.testCaseIds.length || retained.testCaseIds.length > 500 || retained.testCaseIds.length !== page.template.testCaseIds.length || retained.testCaseIds.some((id, index) => id !== page.template!.testCaseIds[index]) || page.selected.some(item => item.state !== "AVAILABLE" || item.metadata?.archived !== false || item.metadata.reviewStatus !== "APPROVED") || !fields(retained.executionContext, Object.keys(preset.context)) || Object.keys(preset.context).some(key => retained.executionContext[key as keyof typeof preset.context] !== preset.context[key as keyof typeof preset.context])) throw unavailable();
    // Reader admission already verified the complete raw native representation
    // equals this exact supported interpretation. Check selected raw context
    // once more explicitly rather than using a mutable current-case fallback.
    const raw = JSON.parse(page.rawTemplate.jsonText) as { configurations: Array<{ id: string; context: Record<string, unknown> }> };
    const nativePreset = raw.configurations.find(item => item.id === selection.configurationId);
    if (!nativePreset || !fields(nativePreset.context, Object.keys(preset.context)) || Object.keys(preset.context).some(key => nativePreset.context[key] !== retained.executionContext[key as keyof typeof preset.context])) throw unavailable();
    // Reuse existing complete profile/FULL/new-intent validation. Removing the
    // plan reference here is ONLY a validation view, never the dispatched body.
    const base = freezeReviewedRunStart({ projectId: retained.projectId, testCaseIds: retained.testCaseIds, expectedProfileHash: retained.expectedProfileHash, executionContext: retained.executionContext, idempotencyKey: retained.idempotencyKey, originalOrganizationId: retained.originalOrganizationId, expectedClerkActorId: retained.expectedClerkActorId }, profile);
    const envelope: ReviewedRunStartEnvelope = Object.freeze({ mode: "START", projectId: base.origin.projectId, originalOrganizationId: base.origin.organizationId, expectedClerkActorId: base.origin.clerkActorId, expectedNativeActorId: base.origin.nativeActorId, request: retained });
    inspectPlanExecutionReadWire(envelope);
    if (selection.currentPlan() !== plan || selection.currentProfile() !== profile) throw unavailable();
    return Object.freeze({ ...base, request: retained, envelope, planOrigin: plan.origin, submittedPlanReadRequestId: page.readContext.requestId, selectedConfigurationId: selection.configurationId, templateHash: page.templateHash, cohortVerified: false as const, receiptVerified: false as const });
  } catch { throw unavailable(); }
}
/** Shared old p,N,UUID target and complete outer/inner ACK rules remain exact.
 * This ACK does not add plan/cohort content provenance absent from its wire. */
export function expectedReviewedPlanRunId(owned: OwnedReviewedPlanStart) { return expectedReviewedRunId(owned); }
export function verifyReviewedPlanStartAck(owned: OwnedReviewedPlanStart, value: unknown) { return verifyReviewedRunStartAck(owned, value); }
