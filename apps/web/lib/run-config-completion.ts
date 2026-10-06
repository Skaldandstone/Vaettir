import { retainAnalysisRequest } from "./analysis-request-recovery";
import {
  runConfigurationScopeMatches,
  verifiedRunConfigurationAck,
  type ReviewedRunConfiguration,
} from "./run-configuration-request";

export type ConfirmedRunStartAck = {
  testRunId: string;
  originalOrganizationId: string;
  expectedClerkActorId: string;
  idempotencyKey: string;
};
export type RunStartScope = {
  projectId: string;
  organizationId: string;
  clerkActorId: string;
  sessionId: string;
};
export type RunStartFrame = {
  scope: RunStartScope | null;
  open: boolean;
  canWrite: boolean;
  draftKey?: string;
};
type Session = { userId: string; sessionId: string } | null;
type Confirmation = {
  request: ReviewedRunConfiguration;
  acknowledgement: ConfirmedRunStartAck;
  scope: RunStartScope;
  opened: boolean;
  openedEpoch: number | null;
};
export type RunStartCompletionView = {
  activationEpoch: number;
  pendingRequest: ReviewedRunConfiguration | null;
  confirmed: Confirmation | null;
  busy: boolean;
  error: string | null;
  authorized: boolean;
  canStart: boolean;
  canRetry: boolean;
  canOpen: boolean;
  canEdit: boolean;
};
export const emptyRunStartCompletion = (): RunStartCompletionView => ({
  activationEpoch: 0,
  pendingRequest: null,
  confirmed: null,
  busy: false,
  error: null,
  authorized: false,
  canStart: false,
  canRetry: false,
  canOpen: false,
  canEdit: false,
});
const sameScope = (a: RunStartScope | null, b: RunStartScope | null) =>
  !!a &&
  !!b &&
  a.projectId === b.projectId &&
  a.organizationId === b.organizationId &&
  a.clerkActorId === b.clerkActorId &&
  a.sessionId === b.sessionId;

/** Browser workflow ownership, not server authorization. It never changes the
 * legacy payload/UUID/hash contract or creates a second request after known ACK.
 * React receives mirrored snapshots; action guards stay synchronous/private. */
export class RunConfigCompletionController {
  private frame: RunStartFrame = { scope: null, open: false, canWrite: false };
  private origin: RunStartScope | null = null;
  private alive = false;
  private epoch = 0;
  private reviewedEpoch: number | null = null;
  private pending: {
    request: ReviewedRunConfiguration;
    scope: RunStartScope;
    ambiguous: boolean;
  } | null = null;
  private confirmed: Confirmation | null = null;
  private busy = false;
  private error: string | null = null;
  constructor(
    private readonly projectId: string,
    private readonly publish: (view: RunStartCompletionView) => void,
  ) {}
  attach() {
    this.alive = true;
    this.epoch++;
  }
  detach() {
    this.alive = false;
    this.epoch++;
  }
  bindFrame(frame: RunStartFrame) {
    if (JSON.stringify(this.frame) !== JSON.stringify(frame)) this.epoch++;
    this.frame = {
      ...frame,
      scope: frame.scope ? Object.freeze({ ...frame.scope }) : null,
    };
    if (
      !this.origin &&
      frame.open &&
      frame.canWrite &&
      frame.scope?.projectId === this.projectId
    )
      this.origin = this.frame.scope;
    this.emit();
  }
  snapshot(): RunStartCompletionView {
    const authorized =
      this.alive &&
      this.frame.open &&
      this.frame.canWrite &&
      sameScope(this.origin, this.frame.scope);
    const confirmed = this.confirmed
      ? {
          ...this.confirmed,
          opened:
            this.confirmed.opened && this.confirmed.openedEpoch === this.epoch,
        }
      : null;
    return {
      activationEpoch: this.epoch,
      pendingRequest: this.pending?.request ?? null,
      confirmed,
      busy: this.busy,
      error: this.error,
      authorized,
      canStart:
        authorized &&
        !this.busy &&
        !this.pending &&
        !this.confirmed &&
        this.reviewedEpoch === this.epoch,
      canRetry:
        authorized &&
        !this.busy &&
        !!this.pending &&
        sameScope(this.pending.scope, this.frame.scope),
      canOpen:
        authorized &&
        !this.busy &&
        !!this.confirmed &&
        this.confirmed.openedEpoch !== this.epoch &&
        sameScope(this.confirmed.scope, this.frame.scope),
      canEdit: authorized && !this.busy && !this.pending && !this.confirmed,
    };
  }
  private emit() {
    if (this.alive) this.publish(this.snapshot());
  }
  private actionAllowed(session: Session) {
    return (
      this.snapshot().authorized &&
      !!session &&
      session.userId === this.origin?.clerkActorId &&
      session.sessionId === this.origin?.sessionId
    );
  }
  review(session: Session, expectedEpoch: number) {
    if (
      expectedEpoch !== this.epoch ||
      !this.actionAllowed(session) ||
      this.busy ||
      this.pending ||
      this.confirmed
    )
      return false;
    this.reviewedEpoch = this.epoch;
    this.error = null;
    this.emit();
    return true;
  }
  revokeReview() {
    this.reviewedEpoch = null;
    this.emit();
  }
  canEdit(session: Session, expectedEpoch: number) {
    return (
      expectedEpoch === this.epoch &&
      this.actionAllowed(session) &&
      this.snapshot().canEdit
    );
  }
  frameCurrent(session: Session, expectedEpoch: number) {
    return expectedEpoch === this.epoch && this.actionAllowed(session);
  }
  openConfirmed(
    session: Session,
    callback:
      | ((ack: ConfirmedRunStartAck, request: ReviewedRunConfiguration) => void)
      | undefined,
    expectedEpoch: number,
  ) {
    if (
      expectedEpoch !== this.epoch ||
      !this.actionAllowed(session) ||
      !this.snapshot().canOpen ||
      !this.confirmed
    )
      return false;
    if (!callback) {
      this.error =
        "The run is confirmed, but this host has no guarded open action. Keep the confirmed receipt; do not start another run.";
      this.emit();
      return false;
    }
    const receipt = this.confirmed;
    // Synchronous latch prevents duplicate navigation from rapid/stale clicks.
    this.confirmed = { ...receipt, opened: true, openedEpoch: this.epoch };
    this.emit();
    try {
      callback(receipt.acknowledgement, receipt.request);
      return true;
    } catch {
      this.confirmed = { ...receipt, opened: false, openedEpoch: null };
      this.error =
        "The run is confirmed, but opening it failed. Retry Open confirmed run; do not submit another start.";
      this.emit();
      return false;
    }
  }
  async submit(
    expectedEpoch: number,
    factory: () => ReviewedRunConfiguration,
    onStart: (request: ReviewedRunConfiguration) => Promise<unknown>,
    currentSession: () => Session,
    onConfirmed?: (
      ack: ConfirmedRunStartAck,
      request: ReviewedRunConfiguration,
    ) => void,
  ) {
    const view = this.snapshot();
    if (
      expectedEpoch !== this.epoch ||
      !this.actionAllowed(currentSession()) ||
      (!view.canStart && !view.canRetry)
    )
      return false;
    let owned = this.pending;
    try {
      if (!owned) {
        const request = factory();
        if (!runConfigurationScopeMatches(request, this.origin))
          throw Error(
            "Review the original project, account and workspace before starting. No request was submitted.",
          );
        owned = { request, scope: this.origin!, ambiguous: false };
        this.pending = owned;
      }
    } catch (cause) {
      this.error =
        cause instanceof Error
          ? cause.message
          : "The configuration could not be reviewed.";
      this.emit();
      return false;
    }
    const attempt = owned,
      submittedEpoch = this.epoch;
    this.busy = true;
    this.error = null;
    this.emit();
    try {
      const acknowledgement = await onStart(attempt.request);
      const observedSession = currentSession();
      if (
        observedSession?.userId !== attempt.scope.clerkActorId ||
        observedSession?.sessionId !== attempt.scope.sessionId
      ) {
        // SDK loss can precede React's auth commit. Revoke this local display
        // frame before publishing a receipt; fresh original access must rebind.
        this.frame = { ...this.frame, canWrite: false };
        this.epoch++;
      }
      if (!verifiedRunConfigurationAck(attempt.request, acknowledgement))
        throw Error(
          "The acknowledgement did not match the original run scope and UUID. Retry only the retained request.",
        );
      if (this.pending !== attempt) return false; // Never settle a replacement.
      this.pending = null;
      this.confirmed = {
        request: attempt.request,
        acknowledgement: Object.freeze({
          testRunId: acknowledgement.testRunId,
          originalOrganizationId: acknowledgement.originalOrganizationId,
          expectedClerkActorId: acknowledgement.expectedClerkActorId,
          idempotencyKey: acknowledgement.idempotencyKey,
        }),
        scope: attempt.scope,
        opened: false,
        openedEpoch: null,
      };
      this.reviewedEpoch = null;
      this.busy = false;
      // Exact ACK is privately settled even after access loss/unmount. No draft
      // values are reset and no visible callback crosses the original epoch.
      if (this.epoch === submittedEpoch && this.actionAllowed(currentSession()))
        this.openConfirmed(currentSession(), onConfirmed, submittedEpoch);
      else this.emit();
      return true;
    } catch (cause) {
      if (this.pending !== attempt) return false;
      const retain = retainAnalysisRequest(attempt.ambiguous, cause);
      attempt.ambiguous = retain;
      if (!retain) {
        this.pending = null;
        this.reviewedEpoch = null;
      }
      this.error = `${cause instanceof Error ? cause.message : "Run start response unknown."} Configuration is retained. No automatic retry was sent.`;
      return false;
    } finally {
      const observedSession = currentSession();
      if (
        observedSession?.userId !== attempt.scope.clerkActorId ||
        observedSession?.sessionId !== attempt.scope.sessionId
      ) {
        // Rejections can skip the successful-response branch altogether. Never
        // publish an actionable old frame while the SDK already lost its scope.
        this.frame = { ...this.frame, canWrite: false };
        this.epoch++;
      }
      this.busy = false;
      this.emit();
    }
  }
}
