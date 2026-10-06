import { retainAnalysisRequest } from "./analysis-request-recovery";
import {
  runConfigurationScopeMatches,
  verifiedRunConfigurationAck,
  type ReviewedRunConfiguration,
} from "./run-configuration-request";
import {
  freezeReviewedRunStart,
  reviewedRunStartAccessMatches,
  verifyReviewedRunStartAck,
  type OwnedReviewedRunStart,
  type ReviewedRunStartTransport,
  type ReviewedRunStartAck,
} from "./run-start-reviewed-write";
import type { RunStartReadSnapshot } from "./manual-run-start-reviewed-reader";

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
export type RunStartRecheckToken = Readonly<{
  generation: number;
  visibility: number;
}>;
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
  recheckRequired: boolean;
  pendingEnvelope?: OwnedReviewedRunStart | null;
  reviewedAcknowledgement?: ReviewedRunStartAck | null;
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
  recheckRequired: true,
});
const sameScope = (a: RunStartScope | null, b: RunStartScope | null) =>
  !!a &&
  !!b &&
  a.projectId === b.projectId &&
  a.organizationId === b.organizationId &&
  a.clerkActorId === b.clerkActorId &&
  a.sessionId === b.sessionId;
const rememberSession = (session: Session): Session =>
  session
    ? Object.freeze({ userId: session.userId, sessionId: session.sessionId })
    : null;

/** Browser workflow ownership, not server authorization. It never changes the
 * legacy payload/UUID/hash contract or creates a second request after known ACK.
 * React receives mirrored snapshots; action guards stay synchronous/private. */
export class RunConfigCompletionController {
  private readonly reviewedOwners = new WeakMap<
    ReviewedRunConfiguration,
    OwnedReviewedRunStart
  >();
  private readonly reviewedAcks = new WeakMap<
    ReviewedRunConfiguration,
    ReviewedRunStartAck
  >();
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
  private blocked = false;
  private monitorGeneration = 0;
  private visibilityGeneration = 0;
  private recheck: RunStartRecheckToken | null = null;
  private monitor: {
    resource: object;
    session: () => Session;
    currentResource: () => object | null;
    active: boolean;
    installed: boolean;
    observed: Session;
    unsubscribe?: () => void;
  } | null = null;
  constructor(
    private readonly projectId: string,
    private readonly publish: (view: RunStartCompletionView) => void,
    // Compatibility for old direct-controller test/adapters. The only actual
    // production constructor (the modal) explicitly requires an installed SDK.
    private readonly requireInstalledMonitor = false,
  ) {}
  attach() {
    this.alive = true;
    this.epoch++;
  }
  detach() {
    this.alive = false;
    if (this.requireInstalledMonitor) this.revokeAdmission();
    this.epoch++;
  }
  bindFrame(frame: RunStartFrame) {
    if (
      frame.open !== this.frame.open ||
      (frame.scope && this.origin && !sameScope(this.origin, frame.scope))
    ) {
      this.visibilityGeneration++;
      this.recheck = null;
    }
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
      (!this.requireInstalledMonitor ||
        (!!this.monitor?.installed && !this.blocked)) &&
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
      recheckRequired:
        this.requireInstalledMonitor &&
        (this.blocked || !this.monitor?.installed),
      pendingEnvelope: this.pending
        ? (this.reviewedOwners.get(this.pending.request) ?? null)
        : null,
      reviewedAcknowledgement: this.confirmed
        ? (this.reviewedAcks.get(this.confirmed.request) ?? null)
        : null,
    };
  }
  private revokeAdmission() {
    if (!this.blocked) this.epoch++;
    this.blocked = true;
    this.reviewedEpoch = null;
    this.recheck = null;
    this.monitorGeneration++;
    this.emit();
  }
  /** This is a browser lifecycle proof, never a native tenant/actor read. */
  installSdkMonitor(
    resource: object | null,
    session: () => Session,
    currentResource: () => object | null,
  ) {
    if (this.monitor) this.releaseSdkMonitor(this.monitor);
    if (!resource) {
      this.revokeAdmission();
      return () => {};
    }
    const monitor = {
      resource,
      session,
      currentResource,
      active: true,
      installed: false,
      observed: null as Session,
      unsubscribe: undefined as (() => void) | undefined,
    };
    this.monitor = monitor;
    const changed = () => {
      if (!monitor.active || this.monitor !== monitor) return;
      try {
        if (currentResource() !== resource) {
          this.releaseSdkMonitor(monitor);
          return;
        }
        const next = session();
        if (
          next?.userId !== monitor.observed?.userId ||
          next?.sessionId !== monitor.observed?.sessionId ||
          !next
        ) {
          monitor.observed = rememberSession(next);
          this.revokeAdmission();
        }
      } catch {
        this.releaseSdkMonitor(monitor);
      }
    };
    try {
      monitor.observed = rememberSession(session());
      const addListener = Reflect.get(resource, "addListener");
      if (typeof addListener !== "function") throw Error("Monitor unavailable");
      const unsubscribe: unknown = addListener.call(resource, changed);
      if (typeof unsubscribe === "function")
        monitor.unsubscribe = unsubscribe as () => void;
      if (
        !monitor.unsubscribe ||
        !monitor.active ||
        this.monitor !== monitor ||
        currentResource() !== resource
      )
        throw Error("Monitor unavailable");
      monitor.installed = true;
      this.monitorGeneration++;
      changed();
      this.emit();
    } catch {
      this.releaseSdkMonitor(monitor);
    }
    return () => this.releaseSdkMonitor(monitor);
  }
  private releaseSdkMonitor(
    monitor: NonNullable<RunConfigCompletionController["monitor"]>,
  ) {
    if (monitor.active) {
      monitor.active = false;
      if (this.monitor === monitor) {
        this.monitor = null;
        this.revokeAdmission();
      }
    }
    // Revoke before calling third-party cleanup, even if it throws or emits.
    const unsubscribe = monitor.unsubscribe;
    monitor.unsubscribe = undefined;
    try {
      unsubscribe?.();
    } catch {
      /* Already revoked. */
    }
  }
  private observeSdk() {
    const monitor = this.monitor;
    if (!monitor?.active || !monitor.installed) return false;
    try {
      if (monitor.currentResource() !== monitor.resource) {
        this.releaseSdkMonitor(monitor);
        return false;
      }
      const next = monitor.session();
      if (
        !next ||
        next.userId !== monitor.observed?.userId ||
        next.sessionId !== monitor.observed?.sessionId
      ) {
        monitor.observed = rememberSession(next);
        this.revokeAdmission();
      }
      return (
        !!next &&
        next.userId === this.origin?.clerkActorId &&
        next.sessionId === this.origin?.sessionId
      );
    } catch {
      this.releaseSdkMonitor(monitor);
      return false;
    }
  }
  beginRecheck(session: Session): RunStartRecheckToken | null {
    if (
      !this.alive ||
      !this.frame.open ||
      this.busy ||
      !this.observeSdk() ||
      !session ||
      session.userId !== this.origin?.clerkActorId ||
      session.sessionId !== this.origin?.sessionId ||
      (this.frame.scope && !sameScope(this.origin, this.frame.scope))
    )
      return null;
    const token = Object.freeze({
      generation: this.monitorGeneration,
      visibility: this.visibilityGeneration,
    });
    this.recheck = token;
    return token;
  }
  finishRecheck(token: RunStartRecheckToken, session: Session) {
    if (
      !this.alive ||
      !this.observeSdk() ||
      this.recheck !== token ||
      token.generation !== this.monitorGeneration ||
      token.visibility !== this.visibilityGeneration ||
      !this.frame.open ||
      !this.frame.canWrite ||
      !sameScope(this.origin, this.frame.scope) ||
      !session ||
      session.userId !== this.origin?.clerkActorId ||
      session.sessionId !== this.origin?.sessionId
    )
      return false;
    this.recheck = null;
    this.blocked = false;
    this.epoch++;
    this.reviewedEpoch = null;
    this.error = null;
    this.emit();
    return true;
  }
  private emit() {
    if (this.alive) this.publish(this.snapshot());
  }
  private actionAllowed(session: Session) {
    if (this.requireInstalledMonitor && !this.observeSdk()) return false;
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
    } catch {
      this.error =
        "The configuration could not be reviewed. Check the original project, account, workspace and selected cases. No request was submitted.";
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
      if (this.requireInstalledMonitor) this.observeSdk();
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
      if (!retain && !this.reviewedOwners.has(attempt.request)) {
        this.pending = null;
        this.reviewedEpoch = null;
      }
      // Transport/validation messages can contain private native values. Keep
      // the original cause for refusal classification, never mirror its body.
      this.error = retain
        ? "Run start acknowledgement is unconfirmed. Configuration and the exact original request are retained. Retry only that request; no automatic retry was sent."
        : this.reviewedOwners.has(attempt.request)
          ? "The reviewed start request was refused. Its exact original body/key and configuration remain retained. No replacement or automatic retry was sent."
          : "The reviewed start request was refused. Configuration is retained. Recheck the original access and explicitly review again; no automatic retry was sent.";
      return false;
    } finally {
      const observedSession = currentSession();
      if (this.requireInstalledMonitor) this.observeSdk();
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
  /** Additive prospective transport. A legacy owner without a recorded native
   * envelope is opaque; no fresh read can retrofit that old pending intent. */
  async submitReviewed(
    expectedEpoch: number,
    factory: () => ReviewedRunConfiguration,
    transport: ReviewedRunStartTransport,
    currentSession: () => Session,
    currentMetadata: () => RunStartReadSnapshot | null,
    onConfirmed?: (
      ack: ConfirmedRunStartAck,
      request: ReviewedRunConfiguration,
    ) => void,
  ) {
    if (this.pending && !this.reviewedOwners.has(this.pending.request)) {
      this.error =
        "This older unconfirmed request has no recorded submission-time native author. Its exact body/key remains retained and was not retransmitted or upgraded.";
      this.emit();
      return false;
    }
    let submittedRead: RunStartReadSnapshot | null = null;
    return this.submit(
      expectedEpoch,
      () => {
        const current = currentMetadata();
        if (
          !current ||
          current.observedSessionId !== currentSession()?.sessionId
        )
          throw Error();
        const request = factory(),
          owned = freezeReviewedRunStart(request, current);
        this.reviewedOwners.set(owned.request, owned);
        return owned.request;
      },
      async (request) => {
        const owned = this.reviewedOwners.get(request),
          current = currentMetadata();
        if (
          !owned ||
          !reviewedRunStartAccessMatches(owned, current) ||
          current?.observedSessionId !== currentSession()?.sessionId
        )
          throw Error(
            "Original current access is unavailable; the exact reviewed request is retained.",
          );
        submittedRead = current;
        const raw = await transport(owned.envelope),
          ack = await verifyReviewedRunStartAck(owned, raw);
        this.reviewedAcks.set(request, ack);
        return ack.legacyAck;
      },
      currentSession,
      (ack, request) => {
        const owned = this.reviewedOwners.get(request),
          current = currentMetadata();
        if (
          !owned ||
          current !== submittedRead ||
          !reviewedRunStartAccessMatches(owned, current) ||
          !onConfirmed
        )
          throw Error();
        onConfirmed(ack, request);
      },
    );
  }
  openReviewedConfirmed(
    session: Session,
    currentMetadata: () => RunStartReadSnapshot | null,
    callback:
      | ((ack: ConfirmedRunStartAck, request: ReviewedRunConfiguration) => void)
      | undefined,
    expectedEpoch: number,
  ) {
    return this.openConfirmed(
      session,
      (ack, request) => {
        const owned = this.reviewedOwners.get(request),
          current = currentMetadata();
        if (
          !owned ||
          !this.reviewedAcks.has(request) ||
          !current ||
          !current.data.canRecover ||
          current.origin.projectId !== request.projectId ||
          current.origin.organizationId !== request.originalOrganizationId ||
          current.origin.clerkActorId !== request.expectedClerkActorId ||
          current.observedSessionId !== session?.sessionId ||
          !reviewedRunStartAccessMatches(owned, current) ||
          !callback
        )
          throw Error();
        callback(ack, request);
      },
      expectedEpoch,
    );
  }
}
