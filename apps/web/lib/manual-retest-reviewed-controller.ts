import type { RouterInputs, RouterOutputs } from "./trpcReact";
import { admitRetestRead, freezeRetestRead, inspectRetestWire, retestIdentity, sameRetestOrigin, type RetestReviewedInput, type RetestReviewedOrigin, type RetestReviewedSnapshot } from "./manual-retest-reviewed-read";
import { verifiedReviewedRetestAck } from "./manual-retest-scope-ack";
type Request = RouterInputs["manualRetest"]["start"];
export type ReviewedRetestEnvelope = RouterInputs["manualRetest"]["startReviewed"];
type Ack = RouterOutputs["manualRetest"]["startReviewed"];
type Session = { userId: string; sessionId: string } | null;
export type ReviewedRetestFrame = { snapshot: RetestReviewedSnapshot | null; current: () => RetestReviewedSnapshot | null; open: boolean; active: boolean };
type Held = { request: Readonly<Request>; envelope: Readonly<ReviewedRetestEnvelope> | null; origin: RetestReviewedOrigin; originalSessionId: string; requestHash: string; reviewSnapshot: RetestReviewedSnapshot | null; reviewedEpoch: number; ambiguous: boolean; submitted: boolean };
export type ReviewedRetestView = { epoch: number; readable: boolean; busy: boolean; reviewed: boolean; pending: boolean; known: boolean; canReview: boolean; canSubmit: boolean; canRetry: boolean; canPublish: boolean; receipt: Ack | null; error: string | null };
const validUUID = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
function supportedRequest(value: unknown): value is Request {
  try { inspectRetestWire(value, 8192, true); } catch { return false; }
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>, keys = Object.keys(r);
  if (!["projectId", "sourceRunId", "testCaseId", "expectedReviewHash", "idempotencyKey"].every(k => Object.hasOwn(r, k)) || keys.some(k => !["projectId", "sourceRunId", "testCaseId", "expectedReviewHash", "idempotencyKey", "expectedScope"].includes(k)) || ![r.projectId, r.sourceRunId, r.testCaseId].every(retestIdentity) || typeof r.expectedReviewHash !== "string" || !/^[a-f0-9]{64}$/.test(r.expectedReviewHash) || !validUUID(r.idempotencyKey)) return false;
  if (r.expectedScope === undefined) return true;
  const s = r.expectedScope as Record<string, unknown>;
  return !!s && typeof s === "object" && !Array.isArray(s) && Object.keys(s).length === 3 && ["projectId", "organizationId", "clerkActorId"].every(k => Object.hasOwn(s, k) && retestIdentity(s[k])) && s.projectId === r.projectId;
}
function rawRequestCopy(request: Request): Readonly<Request> {
  // Preserve exact optional omission and caller property order. Unlike new
  // request construction, a retained legacy body must never gain scope pins.
  if (!supportedRequest(request)) throw Error("Unsupported retained retest request");
  const copy = structuredClone(request); if (copy.expectedScope) Object.freeze(copy.expectedScope); return Object.freeze(copy);
}
/** Exact old qualityProfileHash projection, including omission, independent
 * from the outer native pin and UUID (the run ID separately binds N + UUID). */
export async function reviewedRetestRequestHash(request: Request) {
  if (!supportedRequest(request)) throw Error("Unsupported retained retest request");
  const projection = { projectId: request.projectId, sourceRunId: request.sourceRunId, testCaseId: request.testCaseId, expectedReviewHash: request.expectedReviewHash, ...(request.expectedScope === undefined ? {} : { expectedScope: { projectId: request.expectedScope.projectId, organizationId: request.expectedScope.organizationId, clerkActorId: request.expectedScope.clerkActorId } }) };
  function canonical(v: unknown): string { if (v && typeof v === "object") return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`; return JSON.stringify(v); }
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(projection))); return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
}
const validatedSnapshots = new WeakSet<RetestReviewedSnapshot>();
function validatedSnapshot(s: RetestReviewedSnapshot | null) {
  if (!s || !Object.isFrozen(s)) return false;
  if (validatedSnapshots.has(s)) return true;
  try {
    const keys = ["origin", "observedSessionId", "projection", "epoch", "revision", "receivedAt", "data"];
    if (Reflect.ownKeys(s).length !== keys.length || keys.some(k => { const d = Object.getOwnPropertyDescriptor(s, k); return !d?.enumerable || !("value" in d); }) || !Object.isFrozen(s.origin) || !Object.isFrozen(s.data) || !retestIdentity(s.observedSessionId) || !Number.isSafeInteger(s.epoch) || s.epoch < 0 || !Number.isSafeInteger(s.revision) || s.revision < 0 || typeof s.receivedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(s.receivedAt) || new Date(s.receivedAt).toISOString() !== s.receivedAt) return false;
    const key = JSON.parse(s.data.readContext.requested) as { version?: unknown; request?: unknown; readRequestId?: unknown; expectedNativeActorId?: unknown };
    if (key.version !== 1 || Object.keys(key).some(k => !["version", "request", "readRequestId", "expectedNativeActorId"].includes(k))) return false;
    const input = { request: key.request, readRequestId: key.readRequestId, ...(key.expectedNativeActorId === undefined ? {} : { expectedNativeActorId: key.expectedNativeActorId }) } as RetestReviewedInput;
    const admitted = admitRetestRead(s.data, input, s.projection, s.origin.clerkActorId, s.origin);
    if (!admitted) return false;
    // Admission already bounded and descriptor-checked the full DTO. Cache
    // only a recursively immutable snapshot, never a shallow frozen facade.
    const pending: unknown[] = [s.data, s.origin];
    while (pending.length) { const v = pending.pop(); if (v && typeof v === "object") { if (!Object.isFrozen(v)) return false; pending.push(...Object.values(v)); } }
    validatedSnapshots.add(s); return true;
  } catch { return false; }
}
/** No SDK/cache emulation here: frame.current must be the independently
 * monitored read hook, and must return this EXACT immutable snapshot. */
export class ManualRetestReviewedController {
  private frame: ReviewedRetestFrame = { snapshot: null, current: () => null, open: false, active: false };
  private alive = false; private epoch = 0; private renderBlocked = false; private busy = false;
  private lifetime = 0;
  private original: RetestReviewedOrigin | null = null; private originalSessionId: string | null = null;
  private admittedSnapshot: RetestReviewedSnapshot | null = null; private blocked = new Set<string>();
  private reviewed: Held | null = null; private pending: Held | null = null; private known: { held: Held; ack: Ack; published: boolean } | null = null;
  private error: string | null = null;
  constructor(private readonly publish: (view: ReviewedRetestView) => void) {}
  attach() { this.alive = true; this.lifetime++; this.epoch++; }
  detach() { this.alive = false; this.lifetime++; this.renderBlocked = true; this.epoch++; }
  private read(frame = this.frame) { try { return frame.snapshot && frame.current() === frame.snapshot && validatedSnapshot(frame.snapshot) ? frame.snapshot : null; } catch { return null; } }
  private blockOld() { const s = this.admittedSnapshot; if (s && !this.read(this.frame)) { const id = s.data.readContext.requestId; if (!this.blocked.has(id)) { this.blocked.add(id); this.epoch++; } } }
  renderView(frame: ReviewedRetestFrame) { this.blockOld(); if (frame.snapshot !== this.frame.snapshot || frame.open !== this.frame.open || frame.active !== this.frame.active || !this.read(frame)) { if (!this.renderBlocked) { this.renderBlocked = true; this.epoch++; } } return this.view(); }
  bind(frame: ReviewedRetestFrame) {
    this.blockOld();
    if (frame.snapshot !== this.frame.snapshot || frame.open !== this.frame.open || frame.active !== this.frame.active) this.epoch++;
    this.frame = frame; this.renderBlocked = false;
    const s = this.read(frame);
    this.admittedSnapshot = s;
    if (!this.original && s) { this.original = freezeRetestRead(s.origin); this.originalSessionId = s.observedSessionId; }
    this.emit();
  }
  private owned(s: RetestReviewedSnapshot | null) { return !!s && sameRetestOrigin(s.origin, this.original) && !this.blocked.has(s.data.readContext.requestId); }
  private full() { const s = this.read(); return this.owned(s) && s!.projection === "PREVIEW" && "preview" in s!.data ? s : null; }
  private relation() { const s = this.read(); return this.owned(s) && s!.projection === "LINKS" && "links" in s!.data && !!this.known && s!.data.links.retests.some(r => r.testRunId === this.known!.ack.testRunId) ? s : null; }
  view(): ReviewedRetestView {
    this.blockOld(); const s = this.read(), readable = this.alive && !this.renderBlocked && this.frame.open && this.frame.active && this.owned(s), full = readable && !!this.full(), relationship = readable && !!this.relation();
    return { epoch: this.epoch, readable, busy: this.busy, reviewed: !!this.reviewed, pending: !!this.pending, known: !!this.known, canReview: full && !this.busy && !this.pending && !this.known, canSubmit: full && !this.busy && !this.pending && !this.known && this.reviewed?.reviewedEpoch === this.epoch && this.reviewed?.reviewSnapshot === s && this.reviewed?.originalSessionId === s?.observedSessionId, canRetry: full && !this.busy && !!this.pending?.envelope && !this.known, canPublish: relationship && !this.busy && !!this.known && !this.known.published, receipt: relationship ? this.known!.ack : null, error: readable ? this.error : null };
  }
  private emit() { if (this.alive) this.publish(this.view()); }
  private current(session: Session, epoch: number, expected?: RetestReviewedSnapshot | null) {
    const s = this.read();
    if (s && (session?.userId !== s.origin.clerkActorId || session?.sessionId !== s.observedSessionId)) { this.blocked.add(s.data.readContext.requestId); this.epoch++; return false; }
    return epoch === this.epoch && this.view().readable && !!s && (expected === undefined || s === expected) && session?.userId === this.original?.clerkActorId && session?.sessionId === s.observedSessionId;
  }
  private matches(request: Request, origin: RetestReviewedOrigin) { return request.projectId === origin.projectId && request.sourceRunId === origin.sourceRunId && request.testCaseId === origin.testCaseId && !!request.expectedScope && request.expectedScope.projectId === origin.projectId && request.expectedScope.organizationId === origin.organizationId && request.expectedScope.clerkActorId === origin.clerkActorId; }
  async review(request: Request, session: () => Session, epoch: number) {
    const s = this.full();
    if (!s || !this.current(session(), epoch, s) || !this.view().canReview || !this.original || !supportedRequest(request) || !this.matches(request, this.original) || !("preview" in s.data) || request.expectedReviewHash !== s.data.preview.reviewHash) return false;
    this.busy = true; this.error = null; this.emit();
    try {
      const copied = rawRequestCopy(request), requestHash = await reviewedRetestRequestHash(copied);
      if (!this.current(session(), epoch, s) || this.pending || this.known) return false;
      this.reviewed = { request: copied, envelope: Object.freeze({ request: copied, expectedNativeActorId: this.original.nativeActorId }), origin: this.original, originalSessionId: s.observedSessionId, requestHash, reviewSnapshot: s, reviewedEpoch: epoch, ambiguous: false, submitted: false };
      return true;
    } catch { if (this.current(session(), epoch, s)) this.error = "The exact local request could not be reviewed. Nothing was sent; retain the original draft."; return false; }
    finally { this.busy = false; this.emit(); }
  }
  /** Migration-only retention, NOT authority or approval. A legacy body without
   * scope remains byte-for-byte held and has no transmit-able outer envelope. */
  async retainLegacySubmitted(request: Request, original: RetestReviewedOrigin, originalSessionId: string) {
    try { inspectRetestWire(original, 8192); } catch { return false; }
    if (!this.alive || this.busy || this.pending || this.reviewed || this.known || !supportedRequest(request) || !retestIdentity(originalSessionId) || Object.keys(original).length !== 6 || !["projectId", "sourceRunId", "testCaseId", "organizationId", "clerkActorId", "nativeActorId"].every(k => Object.hasOwn(original, k)) || !Object.values(original).every(retestIdentity) || this.original && !sameRetestOrigin(this.original, original) || request.projectId !== original.projectId || request.sourceRunId !== original.sourceRunId || request.testCaseId !== original.testCaseId || request.expectedScope !== undefined && !this.matches(request, original)) return false;
    const lifetime = this.lifetime;
    this.busy = true;
    try {
      const copied = rawRequestCopy(request), pinned = freezeRetestRead(original);
      const requestHash = await reviewedRetestRequestHash(copied);
      if (!this.alive || this.lifetime !== lifetime || this.pending || this.reviewed || this.known || this.original && !sameRetestOrigin(this.original, pinned)) return false;
      this.original ??= pinned; this.originalSessionId ??= originalSessionId;
      this.pending = { request: copied, envelope: copied.expectedScope === undefined ? null : Object.freeze({ request: copied, expectedNativeActorId: pinned.nativeActorId }), origin: pinned, originalSessionId, requestHash, reviewSnapshot: null, reviewedEpoch: -1, ambiguous: true, submitted: true };
      return true;
    } catch { return false; } finally { this.busy = false; this.emit(); }
  }
  async submit(epoch: number, send: (input: Readonly<ReviewedRetestEnvelope>) => Promise<unknown>, session: () => Session, beforeDispatch?: () => void) {
    const s = this.full(), v = this.view();
    if (!s || !this.current(session(), epoch, s) || (!v.canSubmit && !v.canRetry)) return false;
    const held = this.pending ?? this.reviewed;
    if (!held?.envelope || !this.original || !sameRetestOrigin(held.origin, this.original)) return false;
    const wasSubmitted = held.submitted; let dispatched = false;
    this.busy = true; this.error = null; this.emit();
    try {
      if (!this.current(session(), epoch, s)) return false;
      beforeDispatch?.(); if (!this.current(session(), epoch, s)) return false;
      this.pending = held; held.submitted = true; dispatched = true;
      const response = await send(held.envelope), ack = await verifiedReviewedRetestAck(held.envelope, response);
      if (this.pending !== held) return false;
      if (!ack) { held.ambiguous = true; if (this.current(session(), epoch, s)) this.error = "The response did not prove the identical native-owner request. Keep and retry only its original UUID after current FULL review access is verified."; return false; }
      // Known ACK settles privately FIRST; current UI/SDK loss cannot turn it
      // back into an unknown attempt. Current LINKS is still needed to publish.
      this.pending = null; this.reviewed = null; this.known = { held, ack, published: false };
      // No automatic navigation/invalidations from a PREVIEW or ACCESS frame.
      return true;
    } catch (cause) {
      if (dispatched && this.pending === held) {
        const code = (cause as { data?: { code?: unknown } })?.data?.code;
        const definitive = typeof code === "string" && ["BAD_REQUEST", "CONFLICT", "FORBIDDEN", "UNAUTHORIZED", "NOT_FOUND", "PRECONDITION_FAILED"].includes(code);
        if (definitive && !held.ambiguous && !wasSubmitted) { this.pending = null; this.reviewed = null; }
        else held.ambiguous = true;
      }
      if (this.current(session(), epoch, s)) this.error = dispatched ? "Retest was not confirmed. Retain the exact original request; do not create another UUID." : "Current local review changed before dispatch. Nothing was sent; retain your draft.";
      return false;
    } finally { this.busy = false; this.emit(); }
  }
  publishConfirmed(session: Session, epoch: number, publish: (receipt: Ack) => void) {
    const s = this.relation();
    if (!s || !this.current(session, epoch, s) || !this.view().canPublish || !this.known) return false;
    const held = this.known; held.published = true;
    if (!this.current(session, epoch, s)) { held.published = false; return false; }
    try { publish(held.ack); } catch { held.published = false; if (this.current(session, epoch, s)) this.error = "The retest receipt is known, but local synchronization failed. Refresh current links; never resubmit the accepted UUID."; }
    this.emit(); return true;
  }
}
