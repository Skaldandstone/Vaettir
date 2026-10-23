import type { planExecutionAccessOutput, planExecutionPageOutput, PlanExecutionAccessInput, PlanExecutionPageInput } from "../../api/src/services/planExecutionReadSchema";
import { inspectRunStartReadWire, RunStartReadRenderGuard } from "./manual-run-start-reviewed-reader";
import { planExecutionTemplateExactSchema } from "../../api/src/services/planExecutionTemplateExactSchema";

export type PlanExecutionReadProjection = "ACCESS" | "PAGE";
export type PlanExecutionReadInput = PlanExecutionAccessInput | PlanExecutionPageInput;
export type PlanExecutionReadAccessInput = PlanExecutionAccessInput;
export type PlanExecutionReadPageInput = PlanExecutionPageInput;
export type PlanExecutionReadWire = (typeof planExecutionAccessOutput)["_output"] | (typeof planExecutionPageOutput)["_output"];
export type PlanExecutionReadPageWire = (typeof planExecutionPageOutput)["_output"];
export type PlanExecutionReadOrigin = Readonly<{ projectId: string; testPlanId: string; organizationId: string; clerkActorId: string; nativeActorId: string }>;
export type PlanExecutionReadSnapshot = Readonly<{ origin: PlanExecutionReadOrigin; observedSessionId: string; projection: PlanExecutionReadProjection; epoch: number; revision: number; receivedAt: string; data: PlanExecutionReadWire }>;
export const PLAN_EXECUTION_BROWSER_BOUNDS = Object.freeze({ ACCESS: 8192, PAGE: 2097152, template: 1048576, selected: 1048576, candidates: 524288, cases: 500, configurations: 20, page: 50 });
export const inspectPlanExecutionReadWire = inspectRunStartReadWire;
export class PlanExecutionReadRenderGuard extends RunStartReadRenderGuard {}
const refused = () => Error("The complete plan execution projection is unsupported. No native value, hash, selected identity or interpretation was substituted, normalized or clipped.");
type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue => !!value && typeof value === "object" && !Array.isArray(value);
const fields = (value: unknown, required: readonly string[], optional: readonly string[] = []): value is RecordValue => record(value) && required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
const text = (value: unknown, maximum: number, minimum = 0): value is string => typeof value === "string" && value.length >= minimum && value.length <= maximum;
export const planExecutionReadIdentity = (value: unknown): value is string => text(value, 200, 1) && ![...value].some(character => { const code = character.codePointAt(0)!; return code < 32 || code >= 127 && code <= 159 || code >= 0xd800 && code <= 0xdfff; });
const uuid = (value: unknown): value is string => text(value, 36) && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const hash = (value: unknown) => text(value, 64) && /^[a-f0-9]{64}$/.test(value);
const integer = (value: unknown, minimum: number, maximum: number): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
const choices = (value: unknown, catalog: readonly string[]): value is string => typeof value === "string" && catalog.includes(value);
const searchText = (value: unknown): value is string => text(value, 200) && ![...value].some(character => character === "\0" || character.codePointAt(0)! >= 0xd800 && character.codePointAt(0)! <= 0xdfff);
function freezeCopy<T>(value: T): T {
  if (!value || typeof value !== "object") return value;
  return Object.freeze(Array.isArray(value) ? value.map(freezeCopy) : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, freezeCopy(item)]))) as T;
}
export function samePlanExecutionReadOrigin(a: PlanExecutionReadOrigin | null, b: PlanExecutionReadOrigin | null) {
  return !!a && !!b && a.projectId === b.projectId && a.testPlanId === b.testPlanId && a.organizationId === b.organizationId && a.clerkActorId === b.clerkActorId && a.nativeActorId === b.nativeActorId;
}
export function planExecutionCandidateBrowserKey(input: PlanExecutionPageInput) {
  return JSON.stringify(["PlanExecutionCandidates/v1", input.projectId, input.testPlanId, input.originalOrganizationId, input.expectedClerkActorId, input.expectedNativeActorId, input.search, input.limit]);
}
export function planExecutionReviewedReadKey(input: PlanExecutionReadInput, projection: PlanExecutionReadProjection) {
  inspectPlanExecutionReadWire(input, 16384);
  const common = ["projectId", "testPlanId", "originalOrganizationId", "expectedClerkActorId", "requestId"];
  if (!choices(projection, ["ACCESS", "PAGE"]) || !fields(input, projection === "ACCESS" ? common : [...common, "expectedNativeActorId", "search", "limit"], projection === "ACCESS" ? ["expectedNativeActorId"] : ["cursor"]) || ![input.projectId, input.testPlanId, input.originalOrganizationId, input.expectedClerkActorId].every(planExecutionReadIdentity) || !uuid(input.requestId) || Object.hasOwn(input, "expectedNativeActorId") && !planExecutionReadIdentity(input.expectedNativeActorId)) throw refused();
  if (projection === "PAGE") {
    if (!("search" in input) || !searchText(input.search) || !integer(input.limit, 1, 50) || input.cursor !== undefined && (!fields(input.cursor, ["scopeKey", "lastId"]) || !text(input.cursor.scopeKey, 8192) || !planExecutionReadIdentity(input.cursor.lastId) || input.cursor.scopeKey !== planExecutionCandidateBrowserKey(input))) throw refused();
  }
  return JSON.stringify([projection, input.projectId, input.testPlanId, input.originalOrganizationId, input.expectedClerkActorId, input.expectedNativeActorId ?? null, input.requestId, ...("search" in input ? [input.search, input.limit, input.cursor ? [input.cursor.scopeKey, input.cursor.lastId] : null] : [])]);
}
export function isPlanExecutionPageInput(input: PlanExecutionReadInput): input is PlanExecutionReadPageInput {
  try { planExecutionReviewedReadKey(input, "PAGE"); return true; } catch { return false; }
}
export function planExecutionReadWireSignature(raw: unknown, projection: PlanExecutionReadProjection) {
  try { inspectPlanExecutionReadWire(raw, PLAN_EXECUTION_BROWSER_BOUNDS[projection]); return JSON.stringify(raw); } catch { return null; }
}
const shortFields = ["platform", "build", "hardwareRevision", "firmwareVersion", "rig", "batchOrLot", "calibrationReference", "protocolReference"];
const contextFields = ["configuration", "environment", ...shortFields];
function configuration(value: unknown) {
  return fields(value, contextFields) && contextFields.every(key => text(value[key], shortFields.includes(key) ? 300 : 2000));
}
function interpretedTemplate(value: unknown): value is RecordValue {
  if (record(value) && value.version === 2) return planExecutionTemplateExactSchema.safeParse(value).success && Array.isArray(value.testCaseIds) && value.testCaseIds.every(planExecutionReadIdentity);
  return fields(value, ["version", "testCaseIds", "configurations"]) && value.version === 1 && Array.isArray(value.testCaseIds) && value.testCaseIds.length <= 500 && value.testCaseIds.every(planExecutionReadIdentity) && new Set(value.testCaseIds).size === value.testCaseIds.length && Array.isArray(value.configurations) && value.configurations.length <= 20 && value.configurations.every(item => fields(item, ["id", "name", "context"]) && uuid(item.id) && text(item.name, 120, 1) && configuration(item.context)) && new Set(value.configurations.map(item => (item as RecordValue).id)).size === value.configurations.length;
}
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((item, index) => sameJson(item, b[index]));
  return record(a) && record(b) && Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(key => Object.hasOwn(b, key) && sameJson(a[key], b[key]));
}
/** Verify, but do not apply, the declared legacy trim/default interpretation.
 * Raw native JSONB text is retained byte-for-byte; it is not a native precision
 * codec or approval of a normalized save. Unsupported raw structure refuses. */
function rawTemplateMatches(rawText: string, template: unknown, interpretation: unknown) {
  let raw: unknown;
  try { raw = JSON.parse(rawText); inspectPlanExecutionReadWire(raw, PLAN_EXECUTION_BROWSER_BOUNDS.template); } catch { return false; }
  if (!record(raw)) return false;
  if (Object.keys(raw).length === 0) return template === null && interpretation === "UNCONFIGURED_EMPTY_OBJECT";
  if (raw.version === 2) return interpretation === "EXACT_LITERAL_V2_READ_ONLY" && interpretedTemplate(raw) && interpretedTemplate(template) && template.version === 2 && sameJson(raw, template);
  if (!interpretedTemplate(template) || template.version !== 1 || !fields(raw, ["version", "testCaseIds", "configurations"]) || raw.version !== 1 || !sameJson(raw.testCaseIds, template.testCaseIds) || !Array.isArray(raw.configurations) || raw.configurations.length !== (template.configurations as unknown[]).length) return false;
  for (let index = 0; index < raw.configurations.length; index++) {
    const native = raw.configurations[index], view = (template.configurations as RecordValue[])[index];
    if (!fields(native, ["id", "name", "context"]) || !view || native.id !== view.id || typeof native.name !== "string" || native.name.trim() !== view.name || !fields(native.context, [], contextFields)) return false;
    const mapped = view.context as RecordValue;
    for (const key of contextFields) {
      const original = native.context[key];
      if (original !== undefined && typeof original !== "string" || (original === undefined ? "" : (original as string).trim()) !== mapped[key]) return false;
    }
  }
  return interpretation === (sameJson(raw, template) ? "EXACT_SUPPORTED" : "LEGACY_NORMALIZED");
}
function metadata(value: unknown): value is RecordValue {
  return fields(value, ["id", "title", "displayId", "reviewStatus", "archived"]) && planExecutionReadIdentity(value.id) && text(value.title, 10000) && text(value.displayId, 200) && choices(value.reviewStatus, ["PENDING_REVIEW", "APPROVED", "REJECTED"]) && typeof value.archived === "boolean";
}
function utf8Compare(a: string, b: string) {
  const encoder = new TextEncoder(), left = encoder.encode(a), right = encoder.encode(b);
  for (let index = 0; index < Math.min(left.length, right.length); index++) if (left[index] !== right[index]) return left[index]! - right[index]!;
  return left.length - right.length;
}
function page(raw: RecordValue, input: PlanExecutionPageInput) {
  if (!fields(raw.plan, ["id", "projectId", "name", "status"]) || raw.plan.id !== input.testPlanId || raw.plan.projectId !== input.projectId || !text(raw.plan.name, 10000) || !choices(raw.plan.status, ["DRAFT", "ACTIVE", "IN_REVIEW", "APPROVED", "ARCHIVED"]) || !fields(raw.rawTemplate, ["sqlNull", "jsonText"]) || raw.rawTemplate.sqlNull !== false || !text(raw.rawTemplate.jsonText, PLAN_EXECUTION_BROWSER_BOUNDS.template) || new TextEncoder().encode(raw.rawTemplate.jsonText).length > PLAN_EXECUTION_BROWSER_BOUNDS.template || !hash(raw.templateHash) || !rawTemplateMatches(raw.rawTemplate.jsonText, raw.template, raw.interpretation) || !Array.isArray(raw.selected) || raw.selected.length > 500 || !Array.isArray(raw.candidates) || raw.candidates.length > input.limit || raw.search !== input.search || raw.limit !== input.limit || raw.candidateScopeKey !== planExecutionCandidateBrowserKey(input) || !Array.isArray(raw.limitations) || raw.limitations.length > 8 || !raw.limitations.every(item => text(item, 1000))) return false;
  inspectPlanExecutionReadWire(raw.selected, PLAN_EXECUTION_BROWSER_BOUNDS.selected);
  inspectPlanExecutionReadWire(raw.candidates, PLAN_EXECUTION_BROWSER_BOUNDS.candidates);
  const ids = raw.template === null ? [] : (raw.template as RecordValue).testCaseIds as string[];
  if (ids.length !== raw.selected.length || !raw.selected.every((item, index) => fields(item, ["testCaseId", "state", "metadata"]) && item.testCaseId === ids[index] && choices(item.state, ["AVAILABLE", "ARCHIVED", "MISSING"]) && (item.state === "MISSING" ? item.metadata === null : metadata(item.metadata) && item.metadata.id === item.testCaseId && item.metadata.archived === (item.state === "ARCHIVED")))) return false;
  for (let index = 0; index < raw.candidates.length; index++) {
    const item = raw.candidates[index], previous = index === 0 ? input.cursor?.lastId : (raw.candidates[index - 1] as RecordValue).id as string;
    if (!metadata(item) || item.archived || previous !== undefined && utf8Compare(previous, item.id as string) >= 0) return false;
  }
  return raw.nextCursor === null || fields(raw.nextCursor, ["scopeKey", "lastId"]) && raw.nextCursor.scopeKey === raw.candidateScopeKey && !!raw.candidates.length && raw.nextCursor.lastId === (raw.candidates.at(-1) as RecordValue).id;
}
export function admitPlanExecutionRead(raw: unknown, input: PlanExecutionReadInput, projection: PlanExecutionReadProjection, clerkActorId: string, original: PlanExecutionReadOrigin | null = null) {
  try {
    const requestedKey = planExecutionReviewedReadKey(input, projection);
    inspectPlanExecutionReadWire(raw, PLAN_EXECUTION_BROWSER_BOUNDS[projection]);
    if (original) { inspectPlanExecutionReadWire(original, 8192); if (!Object.isFrozen(original) || !fields(original, ["projectId", "testPlanId", "organizationId", "clerkActorId", "nativeActorId"]) || !Object.values(original).every(planExecutionReadIdentity)) return null; }
    if (!planExecutionReadIdentity(clerkActorId) || clerkActorId !== input.expectedClerkActorId || !fields(raw, projection === "ACCESS" ? ["readContext", "hasFullEditorAccess"] : ["readContext", "hasFullEditorAccess", "plan", "rawTemplate", "template", "templateHash", "interpretation", "selected", "candidates", "search", "limit", "candidateScopeKey", "nextCursor", "limitations"]) || typeof raw.hasFullEditorAccess !== "boolean" || !fields(raw.readContext, ["requestId", "requestedKey", "projection", "scope"]) || raw.readContext.requestId !== input.requestId || raw.readContext.requestedKey !== requestedKey || raw.readContext.projection !== projection || !fields(raw.readContext.scope, ["projectId", "testPlanId", "organizationId", "actorId", "actorClerkUserId"]) || !Object.values(raw.readContext.scope).every(planExecutionReadIdentity)) return null;
    const scope = raw.readContext.scope;
    const origin = Object.freeze({ projectId: input.projectId, testPlanId: input.testPlanId, organizationId: input.originalOrganizationId, clerkActorId, nativeActorId: scope.actorId as string });
    if (scope.projectId !== origin.projectId || scope.testPlanId !== origin.testPlanId || scope.organizationId !== origin.organizationId || scope.actorClerkUserId !== origin.clerkActorId || input.expectedNativeActorId !== undefined && scope.actorId !== input.expectedNativeActorId || original && !samePlanExecutionReadOrigin(original, origin) || projection === "PAGE" && (!("search" in input) || !page(raw, input))) return null;
    return Object.freeze({ origin: original ?? origin, data: freezeCopy(raw) as PlanExecutionReadWire });
  } catch { return null; }
}
