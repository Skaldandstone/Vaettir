import { stepResourceHistoryInput, stepResourceEvidenceInput, stepResourceHistoryOutput, stepResourceEvidenceOutput,
  type StepResourceHistoryInput, type StepResourceEvidenceInput, type StepResourceHistory, type StepResourceEvidence } from "@vaettir/api/src/services/manualStepExecutionResourcesSchema";
import { caseFieldPresentationJsonBytes } from "@vaettir/api/src/services/caseFieldPresentationSchema";
import type { StepReviewOrigin } from "./step-execution-review-draft";
import type { StepReviewSession } from "./step-execution-review-completion";

export type StepResourceKind = "HISTORY" | "EVIDENCE";
export type StepResourceInput = StepResourceHistoryInput | StepResourceEvidenceInput;
export type StepResourceData = StepResourceHistory | StepResourceEvidence;
export type StepResourceFrame = Readonly<{ origin: StepReviewOrigin | null; active: boolean; hookSession: StepReviewSession; expectedProcedureHash: string | null }>;
export type StepResourceIntent = Readonly<{ search: string; limit: number; cursor: string | null }>;
export type StepResourceView = Readonly<{ epoch: number; busy: boolean; canRequest: boolean; data: StepResourceData | null; error: string; intent: StepResourceIntent | null }>;
export type StepResourceTransport = (input: Readonly<StepResourceInput>) => Promise<unknown>;
type Original = Omit<StepReviewOrigin, "stepIndex">;
const sameSession = (left: StepReviewSession, right: StepReviewSession) => !!left && !!right && left.userId === right.userId && left.sessionId === right.sessionId;
const sameOriginal = (left: StepReviewOrigin, right: Original) => left.projectId === right.projectId && left.testRunId === right.testRunId && left.testCaseId === right.testCaseId && left.organizationId === right.organizationId && left.clerkActorId === right.clerkActorId && left.nativeActorId === right.nativeActorId;
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") { const record = value as Record<string, unknown>; return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`; }
  return JSON.stringify(value) ?? "null";
}
function bounded<T>(value: T): Readonly<T> {
  if (caseFieldPresentationJsonBytes(value) > 4456448) throw Error("Unsupported complete resource wire view.");
  const stack: unknown[] = [value]; while (stack.length) { const item = stack.pop(); if (typeof item === "number" && Number.isInteger(item) && !Number.isSafeInteger(item)) throw Error("Unsupported raw numeric precision."); if (item && typeof item === "object") stack.push(...Object.values(item)); }
  const cloned = structuredClone(value), freeze: unknown[] = [cloned]; while (freeze.length) { const item = freeze.pop(); if (item && typeof item === "object") { freeze.push(...Object.values(item)); Object.freeze(item); } } return cloned;
}
export async function stepResourceClientRequestKey(kind: StepResourceKind, input: Readonly<StepResourceInput>) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical({ kind, input })));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}
export function decodeStepResource(kind: StepResourceKind, raw: unknown, input: Readonly<StepResourceInput>, requestKey: string, procedureHash: string, expectedPopulation: string | null): StepResourceData {
  bounded(raw); const parsed = kind === "HISTORY" ? stepResourceHistoryOutput.safeParse(raw) : stepResourceEvidenceOutput.safeParse(raw);
  if (!parsed.success) throw Error("The complete resource response is unsupported.");
  const data = parsed.data, scope = data.scope;
  if (data.projectId !== input.projectId || data.testRunId !== input.testRunId || data.testCaseId !== input.testCaseId || data.stepIndex !== input.stepIndex || data.readRequestId !== input.readRequestId || data.requestKey !== requestKey || data.procedureHash !== procedureHash || expectedPopulation !== null && data.populationHash !== expectedPopulation || scope.projectId !== input.projectId || scope.organizationId !== input.originalOrganizationId || scope.actorId !== input.expectedNativeActorId || scope.actorClerkUserId !== input.expectedClerkActorId) throw Error("The exact original-reader resource frame did not match.");
  if (kind === "EVIDENCE" && (!("search" in data) || !("search" in input) || data.search !== input.search) || kind === "HISTORY" && !("revisions" in data)) throw Error("The exact resource intent did not match.");
  const rows = "revisions" in data ? data.revisions : data.attachments;
  if (rows.length > input.limit || new Set(rows.map(row => row.id)).size !== rows.length || !rows.length && data.nextCursor !== null || ("totalRevisions" in data ? data.totalRevisions : data.totalCandidates) < rows.length) throw Error("The resource page does not match its complete bounded intent.");
  if ("revisions" in data && data.revisions.some((row, index) => index > 0 && row.revisionNumber >= data.revisions[index - 1]!.revisionNumber)) throw Error("The history page has unsupported stored revision order.");
  const frozen = data.frozenStep;
  if (!frozen || typeof frozen !== "object" || Array.isArray(frozen) || (frozen as { order?: unknown }).order !== input.stepIndex || typeof (frozen as { action?: unknown }).action !== "string" || !(frozen as { action: string }).action || (frozen as { action: string }).action.length > 10000) throw Error("The resource view lacks the requested frozen coordinate.");
  return bounded(data);
}
/** Labels only, no selection pruning or file opening. The caller must pass only
 * its currently readable draft IDs and admitted same-frame resource view. */
export function retainedStepEvidence(selected: readonly string[], fresh: StepResourceEvidence | null) {
  if (selected.length > 20 || selected.some(id => typeof id !== "string" || !id)) throw Error("Retained evidence IDs are unsupported; no IDs were removed.");
  return selected.map(id => { const file = fresh?.attachments.find(item => item.id === id); return Object.freeze({ id, file: file ?? null, availableInPage: !!file, label: file ? file.fileName : "Stored reference unavailable in this page" }); });
}

/** One read lane, not an editor. No buffer, selected-evidence, write receipt or
 * provider state can be reset by search, pagination, collapse or auth movement. */
export class StepResourceReader {
  private frame: StepResourceFrame = { origin: null, active: false, hookSession: null, expectedProcedureHash: null };
  private original: Original | null = null;
  private frameKey = "";
  private renderedKey: string | null = null;
  private sdkIdentity: string;
  private sdkGeneration = 0;
  private epoch = 0;
  private attached = false;
  private request = 0;
  private busy = false;
  private admitted: StepResourceData | null = null;
  private admittedEpoch = -1;
  private previousPrivate: StepResourceData | null = null;
  private error = "";
  private intent: StepResourceIntent;
  private expectedPopulation: string | null = null;
  constructor(readonly kind: StepResourceKind, private readonly publish: (view: StepResourceView) => void, private readonly currentSession: () => StepReviewSession, private readonly hash = stepResourceClientRequestKey) {
    this.sdkIdentity = JSON.stringify(currentSession()); this.intent = Object.freeze({ search: "", limit: kind === "HISTORY" ? 10 : 25, cursor: null });
  }
  attach() { this.attached = true; this.invalidate(); }
  detach() { this.attached = false; this.invalidate(); }
  private invalidate() { this.epoch++; this.request++; this.busy = false; if (this.admitted) this.previousPrivate = this.admitted; this.admitted = null; this.admittedEpoch = -1; this.error = ""; }
  observeSession(session: StepReviewSession, emit = true) {
    const identity = JSON.stringify(session); if (identity !== this.sdkIdentity) { this.sdkIdentity = identity; this.sdkGeneration++; this.invalidate(); if (emit) this.emit(); }
  }
  sessionGeneration() { this.observeSession(this.currentSession(), false); return this.sdkGeneration; }
  bindFrame(frame: StepResourceFrame) {
    this.observeSession(this.currentSession(), false);
    const next = JSON.stringify([canonical(frame), this.sdkGeneration]), old = this.frame.origin;
    const changed = next !== this.frameKey;
    if (changed) { this.invalidate(); this.frameKey = next; if (old && (old.stepIndex !== frame.origin?.stepIndex || this.frame.expectedProcedureHash !== frame.expectedProcedureHash)) { this.intent = Object.freeze({ ...this.intent, cursor: null }); this.expectedPopulation = null; } }
    this.frame = Object.freeze({ ...frame, origin: frame.origin ? Object.freeze({ ...frame.origin }) : null, hookSession: frame.hookSession ? Object.freeze({ ...frame.hookSession }) : null });
    if (!this.original && frame.origin && this.canRequest()) { const { stepIndex: _step, ...original } = frame.origin; this.original = Object.freeze(original); }
    if (changed) this.emit(); return changed && this.canRequest();
  }
  matchesFrame(frame: StepResourceFrame) { this.observeSession(this.currentSession(), false); const key = JSON.stringify([canonical(frame), this.sdkGeneration]); return key === this.frameKey && (this.renderedKey === null || key === this.renderedKey); }
  /** Render intent revokes an older frame before layout commit; it cannot
   * adopt new authority or issue a read. Stale handlers never call this method. */
  renderView(frame: StepResourceFrame): StepResourceView {
    this.observeSession(this.currentSession(), false); const key = JSON.stringify([canonical(frame), this.sdkGeneration]);
    if (key !== this.renderedKey) { this.renderedKey = key; if (key !== this.frameKey) this.invalidate(); }
    if (key !== this.frameKey) return Object.freeze({ epoch: this.epoch, busy: false, canRequest: false, data: null, error: "", intent: null });
    return this.snapshot();
  }
  private canRequest() {
    const origin = this.frame.origin;
    return this.attached && (this.renderedKey === null || this.renderedKey === this.frameKey) && this.frame.active && !!origin && (!this.original || sameOriginal(origin, this.original)) && Number.isInteger(origin.stepIndex) && origin.stepIndex >= 0 && origin.stepIndex <= 499 && this.frame.hookSession?.userId === origin.clerkActorId && sameSession(this.frame.hookSession, this.currentSession()) && (this.frame.expectedProcedureHash === null || /^[a-f0-9]{64}$/.test(this.frame.expectedProcedureHash));
  }
  private current(epoch: number) { this.observeSession(this.currentSession(), false); return epoch === this.epoch && this.canRequest(); }
  snapshot(): StepResourceView {
    this.observeSession(this.currentSession(), false); const readable = this.canRequest();
    return Object.freeze({ epoch: this.epoch, busy: readable && this.busy, canRequest: readable, data: readable && this.admittedEpoch === this.epoch ? this.admitted : null, error: readable ? this.error : "", intent: readable ? this.intent : null });
  }
  private emit() { this.publish(this.snapshot()); }
  currentData(epoch: number, data: StepResourceData | null, action: (current: StepResourceData) => boolean): boolean {
    if (!data || !this.current(epoch) || this.busy || this.admitted !== data || this.admittedEpoch !== epoch || this.frame.expectedProcedureHash === null || data.procedureHash !== this.frame.expectedProcedureHash) return false;
    return action(data);
  }
  private input(): Readonly<StepResourceInput> {
    const origin = this.frame.origin!;
    const ref = { projectId: origin.projectId, testRunId: origin.testRunId, testCaseId: origin.testCaseId, stepIndex: origin.stepIndex, originalOrganizationId: origin.organizationId, expectedClerkActorId: origin.clerkActorId, expectedNativeActorId: origin.nativeActorId, readRequestId: crypto.randomUUID(), cursor: this.intent.cursor, limit: this.intent.limit };
    return bounded(this.kind === "HISTORY" ? stepResourceHistoryInput.parse(ref) : stepResourceEvidenceInput.parse({ ...ref, search: this.intent.search }));
  }
  async read(transport: StepResourceTransport) {
    if (!this.canRequest() || this.busy) return;
    this.invalidate(); const epoch = this.epoch, ticket = this.request, session = this.frame.hookSession, expectedProcedureHash = this.frame.expectedProcedureHash, expectedPopulation = this.expectedPopulation;
    const owns = () => this.current(epoch) && this.request === ticket && sameSession(session, this.currentSession());
    this.busy = true; this.emit();
    try {
      const input = this.input(), requestKey = await this.hash(this.kind, input); if (!owns()) return;
      const raw = await transport(input); if (!owns()) return;
      if (expectedProcedureHash === null) { this.error = "Current frozen procedure authority is unavailable. Raw resource bodies remain private; explicitly refresh the procedure first."; return; }
      const data = decodeStepResource(this.kind, raw, input, requestKey, expectedProcedureHash, expectedPopulation); if (!owns()) return;
      this.admitted = data; this.admittedEpoch = epoch; this.error = "";
    } catch { if (owns()) this.error = "This exact original-reader resource view could not be verified. Stored metadata and editor entries remain retained; explicitly refresh or narrow this read view."; }
    finally { if (owns()) { this.busy = false; this.emit(); } }
  }
  refresh(epoch: number, transport: StepResourceTransport) { if (!this.current(epoch) || this.busy) return Promise.resolve(); this.intent = Object.freeze({ ...this.intent, cursor: null }); this.expectedPopulation = null; return this.read(transport); }
  next(epoch: number, transport: StepResourceTransport) {
    if (!this.current(epoch) || this.busy || !this.admitted?.nextCursor || this.admittedEpoch !== this.epoch) return Promise.resolve();
    this.expectedPopulation = this.admitted.populationHash; this.intent = Object.freeze({ ...this.intent, cursor: this.admitted.nextCursor }); return this.read(transport);
  }
  setSearch(search: string, epoch: number, transport: StepResourceTransport) {
    if (this.kind !== "EVIDENCE" || !this.current(epoch) || this.busy) return Promise.resolve();
    try { stepResourceEvidenceInput.parse({ ...this.input(), search }); } catch { return Promise.resolve(); }
    this.intent = Object.freeze({ ...this.intent, search, cursor: null }); this.expectedPopulation = null; return this.read(transport);
  }
  setLimit(limit: number, epoch: number, transport: StepResourceTransport) {
    if (!this.current(epoch) || this.busy || !Number.isInteger(limit) || limit < 1 || limit > 25) return Promise.resolve();
    this.intent = Object.freeze({ ...this.intent, limit, cursor: null }); this.expectedPopulation = null; return this.read(transport);
  }
}
