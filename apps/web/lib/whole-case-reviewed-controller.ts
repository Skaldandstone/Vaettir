import {
  wholeCaseAck,
  type WholeCaseOrigin,
} from "./whole-case-reviewed-draft";
import type {
  ManualCaseReviewedWrite,
  ManualCaseReviewedPreview,
  ManualCaseReviewedAck,
} from "@vaettir/api/src/services/manualCaseResultSchema";
type Session = { userId: string; sessionId: string } | null;
type Frame = {
  origin: WholeCaseOrigin | null;
  open: boolean;
  canRecover: boolean;
  canWrite: boolean;
  activation: string;
  readerActivation?: string;
  parentCurrent?: (() => boolean) | null;
  parentActivation?: string;
};
type Held = {
  request: ManualCaseReviewedWrite;
  baseline: ManualCaseReviewedPreview;
  origin: WholeCaseOrigin;
  ambiguous: boolean;
  reviewEpoch: number;
  readerActivation: string;
};
export type WholeCaseCompletion = {
  epoch: number;
  authorized: boolean;
  busy: boolean;
  reviewed: boolean;
  pending: ManualCaseReviewedWrite | null;
  confirmed: ManualCaseReviewedAck | null;
  error: string | null;
  canEdit: boolean;
  canSubmit: boolean;
  canRetry: boolean;
  canPublish: boolean;
};
export const emptyWholeCaseCompletion = (): WholeCaseCompletion => ({
  epoch: 0,
  authorized: false,
  busy: false,
  reviewed: false,
  pending: null,
  confirmed: null,
  error: null,
  canEdit: false,
  canSubmit: false,
  canRetry: false,
  canPublish: false,
});
const same = (a: WholeCaseOrigin | null, b: WholeCaseOrigin | null) =>
  !!a && !!b && JSON.stringify(a) === JSON.stringify(b);
function immutable<T>(value: T): T {
  const copied = structuredClone(value);
  const freeze = (v: unknown) => {
    if (v && typeof v === "object") {
      Object.values(v).forEach(freeze);
      Object.freeze(v);
    }
  };
  freeze(copied);
  return copied;
}
/** Private settlement independent of React; never lets a later frame consume an older handler. */
export class WholeCaseReviewedController {
  private frame: Frame = {
    origin: null,
    open: false,
    canRecover: false,
    canWrite: false,
    activation: "",
  };
  private origin: WholeCaseOrigin | null = null;
  private alive = false;
  private epoch = 0;
  private busy = false;
  private reviewed: Held | null = null;
  private pending: Held | null = null;
  private confirmed: {
    held: Held;
    ack: ManualCaseReviewedAck;
    publishedEpoch: number | null;
  } | null = null;
  private error: string | null = null;
  private blockedReaders = new Set<string>();
  private parentRequired = false;
  private renderBlocked = false;
  constructor(private readonly publish: (v: WholeCaseCompletion) => void) {}
  attach() {
    this.alive = true;
    this.epoch++;
  }
  detach() {
    this.alive = false;
    this.epoch++;
  }
  private frameKey(frame: Frame) {
    return JSON.stringify([frame.origin, frame.open, frame.canRecover, frame.canWrite, frame.activation, frame.readerActivation ?? null, frame.parentActivation ?? null]);
  }
  private parentCurrent(frame: Frame) {
    if (frame.parentCurrent !== undefined) this.parentRequired = true;
    if (!this.parentRequired && frame.parentCurrent === undefined) return true;
    try { return typeof frame.parentCurrent === "function" && typeof frame.parentActivation === "string" && frame.parentActivation.length > 0 && frame.parentActivation.length <= 200 && frame.parentCurrent() === true; } catch { return false; }
  }
  /** Revocation only before layout. No parent callback becomes write authority. */
  renderView(frame: Frame) {
    if ((this.frameKey(frame) !== this.frameKey(this.frame) || !this.parentCurrent(frame)) && !this.renderBlocked) { this.renderBlocked = true; this.epoch++; }
    return this.snapshot();
  }
  bind(frame: Frame) {
    if (this.frameKey(frame) !== this.frameKey(this.frame)) this.epoch++;
    this.renderBlocked = false;
    this.frame = {
      ...frame,
      origin: frame.origin ? immutable(frame.origin) : null,
      canRecover:
        frame.canRecover &&
        !this.blockedReaders.has(frame.readerActivation ?? frame.activation),
      canWrite:
        frame.canWrite &&
        !this.blockedReaders.has(frame.readerActivation ?? frame.activation),
    };
    if (!this.origin && frame.origin && frame.canRecover)
      this.origin = this.frame.origin;
    this.emit();
  }
  snapshot(): WholeCaseCompletion {
    const parentCurrent = this.parentCurrent(this.frame);
    if (!parentCurrent) {
      const reader = this.frame.readerActivation ?? this.frame.activation;
      if (reader && !this.blockedReaders.has(reader)) { this.blockedReaders.add(reader); this.epoch++; }
    }
    const authorized =
      !this.renderBlocked && parentCurrent &&
      this.alive &&
      this.frame.open &&
      this.frame.canRecover &&
      !this.blockedReaders.has(
        this.frame.readerActivation ?? this.frame.activation,
      ) &&
      same(this.origin, this.frame.origin);
    return {
      epoch: this.epoch,
      authorized,
      busy: this.busy,
      reviewed: !!this.reviewed,
      pending: this.pending?.request ?? null,
      confirmed: this.confirmed?.ack ?? null,
      error: this.error,
      canEdit:
        authorized &&
        this.frame.canWrite &&
        !this.busy &&
        !this.pending &&
        !this.confirmed,
      canSubmit:
        authorized &&
        this.frame.canWrite &&
        !this.busy &&
        this.reviewed?.reviewEpoch === this.epoch &&
        !this.pending &&
        !this.confirmed,
      canRetry:
        authorized &&
        !this.busy &&
        !!this.pending &&
        same(this.pending.origin, this.frame.origin),
      canPublish:
        authorized &&
        !this.busy &&
        !!this.confirmed &&
        this.confirmed.publishedEpoch !== this.epoch,
    };
  }
  private emit() {
    if (this.alive) this.publish(this.snapshot());
  }
  current(session: Session, epoch: number) {
    this.observeSession(session);
    return (
      epoch === this.epoch &&
      this.snapshot().authorized &&
      session?.userId === this.origin?.clerkActorId &&
      session?.sessionId === this.origin?.sessionId
    );
  }
  review(
    request: ManualCaseReviewedWrite,
    baseline: ManualCaseReviewedPreview,
    session: Session,
    epoch: number,
  ) {
    if (
      !this.current(session, epoch) ||
      !this.snapshot().canEdit ||
      !this.origin
    )
      return false;
    const input = request.mode === "EXACT" ? request : request.request;
    try {
      const projection = JSON.parse(baseline.readContext.requested) as {
        original: string;
        expectedNativeActorId: string;
      };
      const original = JSON.parse(projection.original) as {
        projectId: string;
        testRunId: string;
        testCaseId: string;
      };
      if (
        baseline.readContext.projection !== "PREVIEW" ||
        original.projectId !== this.origin.projectId ||
        original.testRunId !== this.origin.testRunId ||
        original.testCaseId !== this.origin.testCaseId ||
        projection.expectedNativeActorId !== this.origin.nativeActorId
      )
        return false;
    } catch {
      return false;
    }
    if (
      input.projectId !== this.origin.projectId ||
      input.testRunId !== this.origin.testRunId ||
      input.testCaseId !== this.origin.testCaseId ||
      input.expectedScope.organizationId !== this.origin.organizationId ||
      input.expectedScope.clerkActorId !== this.origin.clerkActorId ||
      request.expectedNativeActorId !== this.origin.nativeActorId ||
      baseline.readContext.scope.actorId !== this.origin.nativeActorId
    )
      return false;
    if (
      request.mode === "EXACT" &&
      (request.expectedFrozenEvidenceHash !== baseline.frozenEvidenceHash ||
        request.expectedCurrentFingerprint !== baseline.currentFingerprint ||
        request.expectedRevisionId !== baseline.currentRevisionId ||
        baseline.readContext.scope.projectId !== this.origin.projectId ||
        baseline.readContext.scope.organizationId !==
          this.origin.organizationId ||
        baseline.readContext.scope.clerkActorId !== this.origin.clerkActorId ||
        !baseline.canWrite)
    )
      return false;
    this.reviewed = {
      request: immutable(request),
      baseline: immutable(baseline),
      origin: this.origin,
      ambiguous: false,
      reviewEpoch: this.epoch,
      readerActivation: this.frame.readerActivation ?? this.frame.activation,
    };
    this.error = null;
    this.emit();
    return true;
  }
  edited(session: Session, epoch: number) {
    if (!this.current(session, epoch) || !this.snapshot().canEdit) return false;
    this.reviewed = null;
    this.emit();
    return true;
  }
  publishConfirmed(session: Session, epoch: number, callback: () => void) {
    if (
      !this.current(session, epoch) ||
      !this.snapshot().canPublish ||
      !this.confirmed
    )
      return false;
    this.confirmed.publishedEpoch = epoch;
    try {
      callback();
    } catch {
      this.confirmed.publishedEpoch = null;
      this.error =
        "Observation is confirmed; refreshing failed. Refresh this receipt, not the write.";
    }
    this.emit();
    return true;
  }
  /** Explicit new review only after a known confirmation; does not manufacture a fresh write. */
  nextReview(session: Session, epoch: number) {
    if (
      !this.current(session, epoch) ||
      this.busy ||
      this.pending ||
      !this.confirmed
    )
      return false;
    this.confirmed = null;
    this.reviewed = null;
    this.error = null;
    this.emit();
    return true;
  }
  async submit(
    epoch: number,
    send: (input: ManualCaseReviewedWrite) => Promise<unknown>,
    session: () => Session,
    afterConfirmed: () => void,
    beforeDispatch?: () => void,
  ) {
    if (
      !this.current(session(), epoch) ||
      (!this.snapshot().canSubmit && !this.snapshot().canRetry)
    )
      return false;
    const held = this.pending ?? this.reviewed;
    if (!held) return false;
    const previouslySubmitted = this.pending !== null;
    let dispatched = false;
    this.pending = held;
    this.busy = true;
    this.error = null;
    this.emit();
    try {
      if (!this.current(session(), epoch)) return false;
      beforeDispatch?.();
      if (!this.current(session(), epoch)) return false;
      dispatched = true;
      const response = await send(held.request),
        ack = await wholeCaseAck(held.request, held.baseline, response);
      this.revokeWrongSession(session(), held);
      if (this.pending !== held) return false;
      if (!ack)
        throw Error(
          "The response did not match the exact UUID, native author, case, revision and request hash. Outcome is unknown.",
        );
      this.pending = null;
      this.reviewed = null;
      this.confirmed = { held, ack: immutable(ack), publishedEpoch: null };
      this.busy = false;
      if (this.current(session(), epoch))
        this.publishConfirmed(session(), epoch, afterConfirmed);
      else this.emit();
      return true;
    } catch (error) {
      if (this.pending !== held) return false;
      const code = (error as { data?: { code?: string } }).data?.code;
      const definite = [
        "BAD_REQUEST",
        "PRECONDITION_FAILED",
        "CONFLICT",
        "FORBIDDEN",
        "UNAUTHORIZED",
        "NOT_FOUND",
      ].includes(code ?? "");
      if (!definite && dispatched) held.ambiguous = true;
      // A definite FIRST refusal allows explicit re-review without losing prose.
      if (definite && dispatched && !held.ambiguous) {
        this.pending = null;
        this.reviewed = null;
      }
      this.error = `${error instanceof Error ? error.message : "Observation response unknown."} ${held.ambiguous ? "Keep and retry only this identical original UUID." : "Retain your draft and explicitly review a fresh baseline."}`;
      return false;
    } finally {
      if (!dispatched && !previouslySubmitted && this.pending === held) this.pending = null;
      this.revokeWrongSession(session(), held);
      this.busy = false;
      this.emit();
    }
  }
  private revokeWrongSession(session: Session, held: Held) {
    if (
      session?.userId !== held.origin.clerkActorId ||
      session?.sessionId !== held.origin.sessionId
    ) {
      this.blockReader(held.readerActivation);
      this.observeSession(session);
    }
  }
  /** Installed SDK listener and synchronous handlers revoke admitted read UUIDs.
   * A returned SDK A alone cannot unlock A's old native read. */
  observeSession(session: Session) {
    if (
      this.origin &&
      (session?.userId !== this.origin.clerkActorId ||
        session?.sessionId !== this.origin.sessionId)
    )
      this.blockReader(this.frame.readerActivation ?? this.frame.activation);
  }
  private blockReader(reader: string) {
    if (this.blockedReaders.has(reader)) return;
    this.blockedReaders.add(reader);
    this.frame = { ...this.frame, canRecover: false, canWrite: false };
    this.epoch++;
    this.emit();
  }
}
