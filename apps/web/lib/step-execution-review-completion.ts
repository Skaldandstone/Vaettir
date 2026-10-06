import { manualStartDefinitivelyRejected } from "./manual-run-start";
import { assertStepReviewAck, freezeStepReviewInput, freezeStepReviewValue, makeStepReviewDraft, sameStepReviewReader, stepReviewInputParts, stepReviewRequestHash,
  type StepReviewBuffer, type StepReviewDraft, type StepReviewOrigin, type StepReviewPending, type StepReviewWire } from "./step-execution-review-draft";
import type { ReviewedStepAck, ReviewedStepWriteInput } from "@vaettir/api/src/services/manualStepExecutionReviewSchema";

export type StepReviewSession = Readonly<{ userId: string; sessionId: string }> | null;
export type StepReviewCaseRef = Readonly<{ projectId: string; testRunId: string; testCaseId: string }>;
export type StepReviewFrame = Readonly<{ visible: boolean; readOnly: boolean; activation: string; observedSessionId: string | null; observedSdkGeneration: number; fresh: StepReviewWire | null; parentCurrent?: (() => boolean) | null; parentActivation?: string }>;
export type StepReviewCompletionView = Readonly<{ epoch: number; readable: boolean; authorityReadable: boolean; busy: boolean; canEdit: boolean; canReview: boolean; canSave: boolean; reviewed: boolean; baselineChanged: boolean; hasPending: boolean; pendingKey: string | null; draft: StepReviewDraft | null; acknowledgement: Readonly<ReviewedStepAck> | null; notice: string }>;
type NativeContext = Omit<StepReviewOrigin, "stepIndex">;
const sessionMatches = (session: StepReviewSession, user: string, id: string | null) => !!session && !!id && session.userId === user && session.sessionId === id;
/** Browser workflow state only. Native authorization remains server-owned. */
export class StepReviewCompletionController {
  private frame: StepReviewFrame = { visible: false, readOnly: true, activation: "", observedSessionId: null, observedSdkGeneration: 0, fresh: null };
  private frameKey = "";
  private renderBlocked = false;
  private sdkIdentity: string;
  private sdkGeneration = 0;
  private origin: NativeContext | null = null;
  private epoch = 0;
  private attached = false;
  private busy = false;
  private draft: StepReviewDraft | null = null;
  private reviewedIdentity: string | null = null;
  private pending: (StepReviewPending & { wasSubmitted: boolean }) | null = null;
  private acknowledgement: Readonly<ReviewedStepAck> | null = null;
  private notice = "";
  private noticePrivate = false;
  private blockedActivations = new Set<string>();
  private parentRequired = false;
  constructor(private readonly ref: StepReviewCaseRef, private readonly publish: (view: StepReviewCompletionView) => void, private readonly currentSession: () => StepReviewSession,
    private readonly hash: (input: Readonly<ReviewedStepWriteInput>) => Promise<string> = stepReviewRequestHash) { this.ref = Object.freeze({ ...ref }); this.sdkIdentity = JSON.stringify(currentSession()); }
  attach() { this.attached = true; this.epoch++; }
  detach() { this.attached = false; this.epoch++; }
  private keyFor(frame: StepReviewFrame) {
    const fresh = frame.fresh;
    return JSON.stringify([frame.visible, frame.readOnly, frame.activation, frame.observedSessionId, frame.observedSdkGeneration, !!fresh, fresh?.projectId, fresh?.testRunId, fresh?.testCaseId, fresh?.stepIndex, fresh?.scope, fresh?.canRecover, fresh?.canRecord, fresh?.supported, fresh?.procedureHash, fresh?.currentFingerprint, frame.parentActivation ?? null]);
  }
  private parentCurrent(frame: StepReviewFrame) {
    if (frame.parentCurrent !== undefined) this.parentRequired = true;
    if (!this.parentRequired && frame.parentCurrent === undefined) return true;
    try { return typeof frame.parentCurrent === "function" && typeof frame.parentActivation === "string" && frame.parentActivation.length > 0 && frame.parentActivation.length <= 200 && frame.parentCurrent() === true; } catch { return false; }
  }
  /** Render may revoke old authority before layout, but cannot grant new reads.
   * Retained buffers/requests remain private until the actual frame is bound. */
  renderView(frame: StepReviewFrame): StepReviewCompletionView {
    if ((this.frameKey !== this.keyFor(frame) || !this.parentCurrent(frame)) && !this.renderBlocked) {
      this.renderBlocked = true; this.epoch++;
    }
    return this.snapshot();
  }
  matchesFrame(frame: StepReviewFrame) { return !this.renderBlocked && this.frameKey === this.keyFor(frame); }
  bindFrame(frame: StepReviewFrame) {
    this.observeSession(this.currentSession(), false);
    const fresh = frame.fresh;
    if (fresh && frame.observedSdkGeneration !== this.sdkGeneration) this.blockedActivations.add(frame.activation);
    const key = this.keyFor(frame);
    if (key !== this.frameKey) { this.epoch++; this.frameKey = key; }
    this.renderBlocked = false;
    this.frame = Object.freeze({ ...frame });
    this.observeSession(this.currentSession(), false);
    if (!this.origin && this.authorityReadable()) this.origin = Object.freeze({ projectId: this.ref.projectId, testRunId: this.ref.testRunId, testCaseId: this.ref.testCaseId, organizationId: fresh!.scope.organizationId, clerkActorId: fresh!.scope.actorClerkUserId, nativeActorId: fresh!.scope.actorId });
    this.emit();
  }
  /** Installed Clerk resource listener calls this synchronously. A→B→A latches
   * the old native-read activation revoked before a React auth commit. */
  observeSession(session: StepReviewSession, emit = true) {
    const identity = JSON.stringify(session), moved = identity !== this.sdkIdentity;
    if (moved) { this.sdkIdentity = identity; this.sdkGeneration++; this.epoch++; }
    const fresh = this.frame.fresh;
    if (fresh && (moved || !sessionMatches(session, fresh.scope.actorClerkUserId, this.frame.observedSessionId)) && !this.blockedActivations.has(this.frame.activation)) {
      this.blockedActivations.add(this.frame.activation); this.epoch++;
      if (emit) this.emit();
    } else if (moved && emit) {
      this.emit();
    }
  }
  sessionGeneration() { this.observeSession(this.currentSession(), false); return this.sdkGeneration; }
  private authorityReadable() {
    const fresh = this.frame.fresh;
    if (!this.parentCurrent(this.frame)) { if (this.frame.activation && !this.blockedActivations.has(this.frame.activation)) { this.blockedActivations.add(this.frame.activation); this.epoch++; } return false; }
    if (this.renderBlocked || !this.attached || !this.frame.visible || !fresh || !this.frame.activation || fresh.readRequestId !== this.frame.activation || fresh.projectId !== this.ref.projectId || fresh.testRunId !== this.ref.testRunId || fresh.testCaseId !== this.ref.testCaseId || this.blockedActivations.has(this.frame.activation)) return false;
    this.observeSession(this.currentSession(), false);
    if (this.frame.observedSdkGeneration !== this.sdkGeneration || this.blockedActivations.has(this.frame.activation) || !sessionMatches(this.currentSession(), fresh.scope.actorClerkUserId, this.frame.observedSessionId)) return false;
    return !this.origin || sameStepReviewReader(fresh.scope, { ...this.origin, stepIndex: fresh.stepIndex });
  }
  private bodyReadable() { return this.authorityReadable() && !!this.frame.fresh?.supported && !!this.frame.fresh.frozenDefinition && (!this.draft || this.frame.fresh.stepIndex === this.draft.origin.stepIndex && sameStepReviewReader(this.frame.fresh.scope, this.draft.origin)); }
  private writable() { return this.authorityReadable() && !this.frame.readOnly && !!this.frame.fresh?.canRecover; }
  private sameDraft(identity: string | null) { return (this.draft?.identity ?? null) === identity; }
  private current(epoch: number, identity?: string | null) { return epoch === this.epoch && this.authorityReadable() && (identity === undefined || this.sameDraft(identity)); }
  private emit() { this.publish(this.snapshot()); }
  snapshot(): StepReviewCompletionView {
    const fresh = this.frame.fresh, sameStep = !this.draft || fresh?.stepIndex === this.draft.origin.stepIndex;
    const authorityReadable = this.authorityReadable() && sameStep, readable = this.bodyReadable();
    const changed = !!this.draft && (this.draft.procedureHash !== fresh?.procedureHash || this.draft.currentFingerprint !== fresh?.currentFingerprint);
    const canEdit = readable && this.writable() && !!fresh?.canRecord && !this.busy && !this.pending && !this.acknowledgement;
    return Object.freeze({ epoch: this.epoch, readable, authorityReadable, busy: this.busy, canEdit, canReview: canEdit && !!this.draft,
      canSave: !this.busy && !this.acknowledgement && this.writable() && (this.pending ? (this.pending.wasSubmitted || readable && !!fresh?.canRecord && !changed && this.frame.observedSessionId === this.pending.draft.reviewedSessionId) && fresh!.stepIndex === this.pending.draft.origin.stepIndex : canEdit && !!this.draft && this.reviewedIdentity === this.draft.identity && !changed && this.frame.observedSessionId === this.draft.reviewedSessionId),
      reviewed: !!this.draft && this.reviewedIdentity === this.draft.identity && this.frame.observedSessionId === this.draft.reviewedSessionId, baselineChanged: readable && changed, hasPending: !!this.pending, pendingKey: authorityReadable ? this.pending?.input.idempotencyKey ?? null : null,
      draft: readable ? this.draft : null, acknowledgement: authorityReadable ? this.acknowledgement : null, notice: authorityReadable && (!this.noticePrivate || readable) ? this.notice : "" });
  }
  change(buffer: StepReviewBuffer, epoch: number, identity: string | null) {
    if (!this.current(epoch, identity) || !this.snapshot().canEdit || !this.origin) return false;
    const fresh = this.frame.fresh!;
    if (!this.draft) this.draft = makeStepReviewDraft({ ...this.origin, stepIndex: fresh.stepIndex }, fresh, this.frame.observedSessionId!, buffer, crypto.randomUUID());
    else this.draft = freezeStepReviewValue({ ...this.draft, identity: crypto.randomUUID(), buffer });
    this.reviewedIdentity = null; this.notice = ""; this.emit(); return true;
  }
  reviewCurrent(epoch: number, identity: string | null) {
    if (!this.current(epoch, identity) || !this.snapshot().canReview || !this.draft || !this.origin) return false;
    const reviewed = makeStepReviewDraft(this.draft.origin, this.frame.fresh!, this.frame.observedSessionId!, this.draft.buffer, crypto.randomUUID());
    try { stepReviewInputParts(reviewed); } catch { this.notice = "The entered values are unsupported. Raw text remains retained; choose an explicit outcome and lossless readings/correction reason."; this.noticePrivate = true; this.emit(); return false; }
    this.draft = reviewed; this.reviewedIdentity = reviewed.identity; this.notice = "Current frozen procedure and entered observations explicitly reviewed. This does not certify a fix or release."; this.noticePrivate = false; this.emit(); return true;
  }
  async submit(epoch: number, record: (input: Readonly<ReviewedStepWriteInput>) => Promise<unknown>, onAcknowledged?: (ack: Readonly<ReviewedStepAck>) => void | Promise<void>, onUnconfirmedChange?: (value: boolean) => void) {
    if (!this.current(epoch) || !this.snapshot().canSave || !this.draft || this.busy) return;
    const draft = this.pending?.draft ?? this.draft, activation = this.frame.activation, sessionId = this.frame.observedSessionId;
    const owns = () => this.current(epoch, draft.identity) && this.writable() && this.frame.activation === activation && this.frame.observedSessionId === sessionId && this.frame.fresh?.stepIndex === draft.origin.stepIndex;
    const ownsBody = () => owns() && this.bodyReadable();
    this.busy = true; this.notice = ""; this.emit(); // Private synchronously, before hash/await.
    let held = this.pending;
    try {
      if (!held) {
        const input = freezeStepReviewInput(draft, crypto.randomUUID()), requestHash = await this.hash(input);
        this.observeSession(this.currentSession(), false);
        if (!ownsBody() || this.pending || this.draft !== draft) return;
        held = Object.freeze({ input, requestHash, draft, everAmbiguous: false, wasSubmitted: false }); this.pending = held;
      }
      if (!owns()) return;
      if (ownsBody()) onUnconfirmedChange?.(true);
      this.observeSession(this.currentSession(), false); if (!owns()) return;
      held = Object.freeze({ ...held, wasSubmitted: true }); this.pending = held;
      const response = await record(held.input);
      this.observeSession(this.currentSession(), false);
      const ack = assertStepReviewAck(response, held);
      if (this.pending !== held) return;
      this.pending = null; this.acknowledgement = ack; // Exact late ACK settles privately.
      if (!ownsBody()) return;
      this.notice = "The exact step request is acknowledged. Other outcomes and completion remain separate."; this.noticePrivate = false;
      onUnconfirmedChange?.(false); this.observeSession(this.currentSession(), false);
      if (!ownsBody()) return;
      try { await onAcknowledged?.(ack); this.observeSession(this.currentSession(), false); }
      catch { this.observeSession(this.currentSession(), false); if (ownsBody()) this.notice = "Step acknowledged, but refreshing failed. Refresh reads only; do not send another observation."; }
    } catch (cause) {
      this.observeSession(this.currentSession(), false);
      if (held && this.pending === held) {
        const rejected = owns() && manualStartDefinitivelyRejected(cause, held.everAmbiguous);
        this.pending = rejected ? null : Object.freeze({ ...held, everAmbiguous: true });
        if (rejected && ownsBody()) onUnconfirmedChange?.(false);
      }
      if (owns()) { this.notice = this.pending ? "The response is uncertain or refused after an earlier uncertain attempt. Keep the exact UUID and request for recovery." : "The reviewed request was refused. Entries are retained; refresh and explicitly review current evidence."; this.noticePrivate = false; }
    } finally {
      this.observeSession(this.currentSession(), false);
      // No RPC was invoked for this held request. It has no unknown native
      // outcome and must not strand an unsent buffer after session movement.
      if (held && this.pending === held && !held.wasSubmitted) this.pending = null;
      this.busy = false; this.emit();
    }
  }
  discardUnsaved(epoch: number, identity: string | null) {
    if (!this.current(epoch, identity) || !this.snapshot().canEdit || this.busy || this.pending || this.acknowledgement) return false;
    this.draft = null; this.reviewedIdentity = null; this.notice = ""; this.emit(); return true;
  }
  async synchronizeAcknowledged(epoch: number, callback: (ack: Readonly<ReviewedStepAck>) => void | Promise<void>) {
    if (!this.current(epoch) || !this.bodyReadable() || !this.writable() || !this.acknowledgement || this.busy) return;
    const ack = this.acknowledgement, activation = this.frame.activation;
    this.busy = true; this.emit();
    try {
      // Publishing busy can synchronously revoke installed SDK/frame authority.
      // A known receipt stays private; it never licenses an old page refresh.
      if (!this.current(epoch) || !this.bodyReadable() || !this.writable() || this.frame.activation !== activation || this.acknowledgement !== ack) return;
      await callback(ack); this.observeSession(this.currentSession(), false);
    }
    catch { this.observeSession(this.currentSession(), false); if (this.current(epoch) && this.frame.activation === activation) this.notice = "The receipt remains acknowledged; current view refresh failed."; }
    finally { this.observeSession(this.currentSession(), false); this.busy = false; this.emit(); }
  }
  finishAcknowledged(epoch: number, releasePending?: () => void) {
    if (!this.current(epoch) || !this.bodyReadable() || !this.acknowledgement || this.busy || this.pending) return false;
    // A late ACK may have settled privately without notifying its original
    // parent. Explicit release under a fresh original read can clear that one
    // step's pending barrier; it does not submit or refresh any native result.
    try { releasePending?.(); } catch { this.notice = "The receipt remains acknowledged; its parent pending state could not be released."; this.emit(); return false; }
    this.observeSession(this.currentSession(), false);
    if (!this.current(epoch) || !this.bodyReadable()) return false;
    this.draft = null; this.reviewedIdentity = null; this.acknowledgement = null; this.notice = ""; this.emit(); return true;
  }
}
