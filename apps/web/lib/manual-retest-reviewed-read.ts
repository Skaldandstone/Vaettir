import type { RouterInputs, RouterOutputs } from "./trpcReact";
export type RetestProjection = "ACCESS" | "PREVIEW" | "LINKS";
export type RetestReviewedInput = RouterInputs["manualRetest"]["accessReviewed"] | RouterInputs["manualRetest"]["previewReviewed"] | RouterInputs["manualRetest"]["linksReviewed"];
export type RetestReviewedWire = RouterOutputs["manualRetest"]["accessReviewed"] | RouterOutputs["manualRetest"]["previewReviewed"] | RouterOutputs["manualRetest"]["linksReviewed"];
export type RetestReviewedOrigin = Readonly<{ projectId: string; sourceRunId: string; testCaseId: string; organizationId: string; clerkActorId: string; nativeActorId: string }>;
export type RetestReviewedSnapshot = Readonly<{ origin: RetestReviewedOrigin; observedSessionId: string; projection: RetestProjection; epoch: number; revision: number; receivedAt: string; data: RetestReviewedWire }>;
export const RETEST_BROWSER_BOUNDS = Object.freeze({ ACCESS: 8192, PREVIEW: 2097152, LINKS: 16384, depth: 64, nodes: 100000, array: 1000, objectKeys: 10000 });
const refused = () => Error("The complete retest wire projection is unsupported or outside browser inspection bounds. Nothing was clipped, coerced, defaulted or substituted.");
type RecordValue = Record<string, unknown>;
const record = (v: unknown): v is RecordValue => !!v && typeof v === "object" && !Array.isArray(v);
const fields = (v: unknown, required: readonly string[], optional: readonly string[] = []): v is RecordValue => record(v) && required.every(k => Object.hasOwn(v, k)) && Object.keys(v).every(k => required.includes(k) || optional.includes(k));
const text = (v: unknown, max: number, min = 0): v is string => typeof v === "string" && v.length >= min && v.length <= max;
export const retestIdentity = (v: unknown): v is string => text(v, 200, 1) && !Array.from(v).some(c => { const n = c.codePointAt(0)!; return n < 32 || n >= 127 && n <= 159 || n >= 0xd800 && n <= 0xdfff; });
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const integer = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): v is number => finite(v) && Number.isSafeInteger(v) && v >= min && v <= max;
const array = (v: unknown, max: number, each: (v: unknown) => boolean): v is unknown[] => Array.isArray(v) && v.length <= max && v.every(each);
const nullableText = (v: unknown, max = 10000) => v === null || text(v, max);
const uuid = (v: unknown): v is string => text(v, 36) && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const hash = (v: unknown) => text(v, 64) && /^[a-f0-9]{64}$/.test(v);
const dictionary = (v: unknown, max: number) => record(v) && Object.values(v).every(x => text(x, max));
function scope(v: unknown): v is RecordValue { return fields(v, ["projectId", "organizationId", "clerkActorId", "actorId"]) && Object.values(v).every(retestIdentity); }
function utc(v: unknown): v is string { if (!text(v, 24) || !/^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)) return false; const d = new Date(v); return Number.isFinite(d.getTime()) && d.toISOString() === v; }
/** Descriptor walk precedes property reads/clone/serialization. Request-only
 * undefined omission is explicit; wire responses never admit undefined. */
export function inspectRetestWire(value: unknown, cap: number = RETEST_BROWSER_BOUNDS.PREVIEW, request = false) {
  if (!integer(cap, 1, RETEST_BROWSER_BOUNDS.PREVIEW)) throw refused();
  let bytes = 0, nodes = 0; const seen = new Set<object>(), encoder = new TextEncoder();
  function add(s: string) { bytes += encoder.encode(s).length; if (bytes > cap) throw refused(); }
  function visit(v: unknown, depth: number) {
    if (++nodes > RETEST_BROWSER_BOUNDS.nodes || depth > RETEST_BROWSER_BOUNDS.depth) throw refused();
    if (v === null || typeof v === "boolean" || finite(v)) { add(JSON.stringify(v)); return; }
    if (v === undefined && request) { add("null"); return; }
    if (typeof v === "string") { for (const c of v) { const n = c.codePointAt(0)!; if (n >= 0xd800 && n <= 0xdfff) throw refused(); } add(JSON.stringify(v)); return; }
    if (!v || typeof v !== "object" || seen.has(v)) throw refused();
    const isArray = Array.isArray(v), proto = Object.getPrototypeOf(v), keys = Reflect.ownKeys(v);
    if (proto !== (isArray ? Array.prototype : Object.prototype) && !(proto === null && !isArray) || keys.some(k => typeof k !== "string") || keys.length > RETEST_BROWSER_BOUNDS.objectKeys) throw refused();
    seen.add(v); add(isArray ? "[" : "{");
    if (isArray) {
      if (v.length > RETEST_BROWSER_BOUNDS.array || keys.length !== v.length + 1 || keys.some(k => k !== "length" && (!/^(0|[1-9]\d*)$/.test(String(k)) || Number(k) >= v.length))) throw refused();
      for (let i = 0; i < v.length; i++) { const d = Object.getOwnPropertyDescriptor(v, String(i)); if (!d?.enumerable || !("value" in d)) throw refused(); if (i) add(","); visit(d.value, depth + 1); }
    } else {
      let i = 0; for (const k of keys) { const d = Object.getOwnPropertyDescriptor(v, k)!; if (!d.enumerable || !("value" in d)) throw refused(); if (i++) add(","); add(JSON.stringify(k) + ":"); visit(d.value, depth + 1); }
    }
    add(isArray ? "]" : "}"); seen.delete(v);
  }
  visit(value, 0); return Object.freeze({ bytes, nodes });
}
/** Explicitly reproduce server old-inner parser key order without defaults.
 * Optional undefined keys stay omitted; malformed/extra keys are not accepted. */
export function retestReviewedBrowserKey(input: RetestReviewedInput) {
  inspectRetestWire(input, 8192, true);
  if (!fields(input, ["request", "readRequestId"], ["expectedNativeActorId"]) || !uuid(input.readRequestId) || input.expectedNativeActorId !== undefined && !retestIdentity(input.expectedNativeActorId)) throw refused();
  const r: RecordValue = input.request;
  if (!fields(r, ["projectId", "sourceRunId", "testCaseId"], ["expectedScope", "before"]) || ![r.projectId, r.sourceRunId, r.testCaseId].every(retestIdentity) || r.before !== undefined && !retestIdentity(r.before)) throw refused();
  const s = r.expectedScope;
  if (s !== undefined && (!fields(s, ["projectId", "organizationId", "clerkActorId"]) || !Object.values(s).every(retestIdentity) || s.projectId !== r.projectId)) throw refused();
  return JSON.stringify({ version: 1, request: { projectId: r.projectId, sourceRunId: r.sourceRunId, testCaseId: r.testCaseId, ...(s === undefined ? {} : { expectedScope: { projectId: s.projectId, organizationId: s.organizationId, clerkActorId: s.clerkActorId } }), ...(r.before === undefined ? {} : { before: r.before }) }, readRequestId: input.readRequestId, ...(input.expectedNativeActorId === undefined ? {} : { expectedNativeActorId: input.expectedNativeActorId }) });
}
function oldReadKey(input: RetestReviewedInput) { return JSON.stringify(JSON.parse(retestReviewedBrowserKey(input)).request); }
function procedure(v: unknown) {
  return fields(v, ["testCaseId", "title", "validationDomain", "reviewStatus", "background", "given", "when", "then", "verificationProfile", "steps"]) && retestIdentity(v.testCaseId) && text(v.title, 10000) && text(v.validationDomain, 100) && text(v.reviewStatus, 100) && nullableText(v.background) && [v.given, v.when, v.then].every(a => array(a, 500, x => text(x, 10000))) && fields(v.verificationProfile, ["setup", "safety", "instruments", "acceptanceCriteria"]) && Object.values(v.verificationProfile).every(x => text(x, 10000)) && array(v.steps, 500, s => fields(s, ["order", "action", "expectedActionOrData", "expectedResult", "expectedResponse", "mediaAttachmentIds"]) && integer(s.order) && text(s.action, 10000) && [s.expectedActionOrData, s.expectedResult, s.expectedResponse].every(x => nullableText(x)) && array(s.mediaAttachmentIds, 100, x => text(x, 200)));
}
function observations(v: unknown) {
  return fields(v, ["specimen", "hardwareRevision", "firmwareVersion", "environment", "measurements"]) && text(v.specimen, 300) && text(v.hardwareRevision, 200) && text(v.firmwareVersion, 200) && text(v.environment, 1000) && array(v.measurements, 100, m => fields(m, ["name", "unit", "value", "instrument"], ["lowerLimit", "upperLimit"]) && text(m.name, 200, 1) && text(m.unit, 40, 1) && finite(m.value) && text(m.instrument, 200) && (!Object.hasOwn(m, "lowerLimit") || finite(m.lowerLimit)) && (!Object.hasOwn(m, "upperLimit") || finite(m.upperLimit)) && (m.lowerLimit === undefined || m.upperLimit === undefined || (m.lowerLimit as number) <= (m.upperLimit as number)));
}
function preview(v: unknown, input: RetestReviewedInput) {
  if (!fields(v, ["scope", "requested", "stepFieldLabels", "projectId", "sourceRunId", "testCaseId", "displayId", "reviewHash", "sourceOutcome", "configuration", "caseDefinitions", "sourceResults", "prerequisiteCount", "credits", "sourceDatasetExecution"]) || !scope(v.scope) || v.requested !== oldReadKey(input) || v.projectId !== input.request.projectId || v.sourceRunId !== input.request.sourceRunId || v.testCaseId !== input.request.testCaseId || !retestIdentity(v.displayId) || !hash(v.reviewHash) || typeof v.sourceOutcome !== "string" || !["FAIL", "BLOCKED"].includes(v.sourceOutcome) || v.credits !== 0 || !dictionary(v.stepFieldLabels, 200)) return false;
  const short = ["platform", "build", "hardwareRevision", "firmwareVersion", "rig", "batchOrLot", "calibrationReference", "protocolReference"], c = v.configuration;
  if (!fields(c, ["configuration", "environment", ...short]) || !text(c.configuration, 2000) || !text(c.environment, 2000) || !short.every(k => text(c[k], 300)) || !array(v.caseDefinitions, 1000, procedure) || !v.caseDefinitions.length || !integer(v.prerequisiteCount, 0, 999) || v.prerequisiteCount !== v.caseDefinitions.length - 1) return false;
  const ids = v.caseDefinitions.map(d => (d as RecordValue).testCaseId);
  if (new Set(ids).size !== ids.length || !ids.includes(v.testCaseId) || !array(v.sourceResults, 500, r => fields(r, ["id", "testCaseId", "status", "note", "errorMessage", "observations"]) && retestIdentity(r.id) && ids.includes(r.testCaseId) && typeof r.status === "string" && ["PASS", "FAIL", "BLOCKED", "SKIP", "FLAKY"].includes(r.status) && nullableText(r.note) && nullableText(r.errorMessage) && observations(r.observations)) || !v.sourceResults.length || new Set(v.sourceResults.map(r => (r as RecordValue).testCaseId)).size !== v.sourceResults.length) return false;
  if (!v.sourceResults.some(r => (r as RecordValue).testCaseId === v.testCaseId && (r as RecordValue).status === v.sourceOutcome)) return false;
  const d = v.sourceDatasetExecution;
  return d === null || fields(d, ["batchId", "datasetId", "datasetHash", "rowIndex", "rowName", "values"]) && text(d.batchId, 72) && /^dataset_[a-f0-9]{64}$/.test(d.batchId) && retestIdentity(d.datasetId) && hash(d.datasetHash) && integer(d.rowIndex, 0, 49) && text(d.rowName, 200, 1) && dictionary(d.values, 10000);
}
function links(v: unknown, input: RetestReviewedInput) {
  return fields(v, ["scope", "requested", "original", "retests", "nextCursor"]) && scope(v.scope) && v.requested === oldReadKey(input) && (v.original === null || fields(v.original, ["testRunId", "capturedOutcome"]) && retestIdentity(v.original.testRunId) && typeof v.original.capturedOutcome === "string" && ["FAIL", "BLOCKED"].includes(v.original.capturedOutcome)) && array(v.retests, 10, r => fields(r, ["testRunId", "startedAt", "status"]) && retestIdentity(r.testRunId) && utc(r.startedAt) && typeof r.status === "string" && ["RUNNING", "PASSED", "FAILED", "PARTIAL"].includes(r.status)) && new Set(v.retests.map(r => (r as RecordValue).testRunId)).size === v.retests.length && (v.nextCursor === null || retestIdentity(v.nextCursor) && !!v.retests.length && (v.retests.at(-1) as RecordValue).testRunId === v.nextCursor);
}
export function sameRetestOrigin(a: RetestReviewedOrigin | null, b: RetestReviewedOrigin | null) { return !!a && !!b && ["projectId", "sourceRunId", "testCaseId", "organizationId", "clerkActorId", "nativeActorId"].every(k => a[k as keyof RetestReviewedOrigin] === b[k as keyof RetestReviewedOrigin]); }
export function freezeRetestRead<T>(value: T): T { inspectRetestWire(value); const copy = structuredClone(value), pending: unknown[] = [copy]; while (pending.length) { const v = pending.pop(); if (v && typeof v === "object") { pending.push(...Object.values(v)); Object.freeze(v); } } return copy; }
function sameNativeScope(a: unknown, b: unknown) { return scope(a) && scope(b) && ["projectId", "organizationId", "clerkActorId", "actorId"].every(k => (a as RecordValue)[k] === (b as RecordValue)[k]); }
export function admitRetestRead(raw: unknown, input: RetestReviewedInput, projection: RetestProjection, clerkActorId: string, original: RetestReviewedOrigin | null) {
  try {
    if (typeof projection !== "string" || !["ACCESS", "PREVIEW", "LINKS"].includes(projection)) return null;
    const requested = retestReviewedBrowserKey(input);
    if (projection !== "LINKS" && Object.hasOwn(input.request, "before")) return null;
    inspectRetestWire(raw, RETEST_BROWSER_BOUNDS[projection]);
    if (!retestIdentity(clerkActorId) || !record(raw) || !fields(raw.readContext, ["requestId", "requested", "projection", "scope"]) || raw.readContext.requestId !== input.readRequestId || raw.readContext.requested !== requested || raw.readContext.projection !== projection || !scope(raw.readContext.scope)) return null;
    const s = raw.readContext.scope as RecordValue;
    if (s.projectId !== input.request.projectId || s.clerkActorId !== clerkActorId || input.request.expectedScope && (s.organizationId !== input.request.expectedScope.organizationId || s.clerkActorId !== input.request.expectedScope.clerkActorId) || input.expectedNativeActorId !== undefined && s.actorId !== input.expectedNativeActorId || projection !== "ACCESS" && (!input.expectedNativeActorId || !input.request.expectedScope)) return null;
    const origin: RetestReviewedOrigin = Object.freeze({ projectId: input.request.projectId, sourceRunId: input.request.sourceRunId, testCaseId: input.request.testCaseId, organizationId: s.organizationId as string, clerkActorId, nativeActorId: s.actorId as string });
    if (original && !sameRetestOrigin(origin, original)) return null;
    if (projection === "ACCESS" ? !fields(raw, ["readContext", "basis", "sourceRelationshipVerified"]) || raw.basis !== "CURRENT_PROJECT_MEMBER_ONLY" || raw.sourceRelationshipVerified !== false : projection === "PREVIEW" ? !fields(raw, ["readContext", "basis", "preview"]) || raw.basis !== "LEGACY_BOUNDED_PREPARATION_V1" || !preview(raw.preview, input) || !sameNativeScope((raw.preview as RecordValue).scope, s) : !fields(raw, ["readContext", "links"]) || !links(raw.links, input) || !sameNativeScope((raw.links as RecordValue).scope, s)) return null;
    return Object.freeze({ origin, data: freezeRetestRead(raw) as RetestReviewedWire });
  } catch { return null; }
}
/** Render only revokes; layout alone can publish. A cache epoch cannot be
 * cleared by an already-posted effect after cache/resource A-B-A. */
export class RetestReadRenderGuard {
  private frame: object | null = null; private view: object | null = null; private render = 0; private cache = 0; private blocked: string | null = null; private stamp: Readonly<{renderGeneration: number; cacheGeneration: number}> = Object.freeze({ renderGeneration: 0, cacheGeneration: 0 });
  observe(frame: object, view: object | null) { if (this.frame !== frame || this.view !== view) { this.frame = frame; this.view = view; this.render++; } if (this.stamp.renderGeneration !== this.render || this.stamp.cacheGeneration !== this.cache) this.stamp = Object.freeze({ renderGeneration: this.render, cacheGeneration: this.cache }); return this.stamp; }
  matchesRender(s: { renderGeneration: number }) { return this.render === s.renderGeneration; }
  matchesRead(s: { renderGeneration: number; cacheGeneration: number }, id: string | null) { return this.matchesRender(s) && s.cacheGeneration === this.cache && !this.isBlocked(id); }
  isBlocked(id: string | null) { return !!id && id === this.blocked; }
  candidateFrame() { return this.view ? this.frame : null; }
  revokeCache(id: string | null) { this.cache++; this.blocked = id; }
  revokeActions() { this.render++; }
}
