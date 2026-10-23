import { deviceCaptureAccessInput, deviceCaptureAccessOutput, deviceCaptureAccessScope,
  type DeviceCaptureAccessInput, type DeviceCaptureAccessOutput, type DeviceCaptureOrigin,
} from "../../api/src/services/deviceCaptureAccessSchema";
import { captureAccessClientRequestKey, captureJsonContentCost, retainCaptureJson,
  type CaptureSdk, type CaptureSession } from "./device-capture-ownership";
import { pairedHelperLiveness, unsupportedHelperProtocolMessage, type PairedHelperLiveness } from "./device-helper-protocol";

export type SetupBuffers = Readonly<Record<string, string | number | boolean | null>>;
export type DeviceHelperSetupFrame = Readonly<{ origin: DeviceCaptureOrigin; active: boolean; loaded: boolean; signedIn: boolean;
  hookSession: CaptureSession | null; platform: "windows" | "macos" | "linux"; mode: "android" | "ios-connected" | "ios-remote";
  pairingCode: string; connectionEpoch: number }>;
export type SetupIntent = "CONNECT" | "RETRY_UNKNOWN" | "RETRY_BLOCKED" | "MANUAL_POLICY_REVIEW";
export type SetupAttempt = Readonly<{ id: string; intent: SetupIntent; accessInput: DeviceCaptureAccessInput }>;
export type SetupDetails = Readonly<{ scope: DeviceCaptureOrigin; platform: DeviceHelperSetupFrame["platform"]; mode: DeviceHelperSetupFrame["mode"];
  pairingCode: string; buffers: SetupBuffers; unsignedScriptOnly: true; requiresNodeMajor: 22;
  processingPermissionGranted: false; semanticRedactionGuaranteed: false; windowsPolicyVerified: false }>;
export type ReadSetupAccess = (input: DeviceCaptureAccessInput, signal: AbortSignal) => Promise<unknown>;
export type ReadPairedHealth = (input: Readonly<{ method: "GET"; path: "/health"; pairingCode: string; attemptId: string }>, signal: AbortSignal) => Promise<unknown>;
type State = { public: SetupAttempt; frame: DeviceHelperSetupFrame; epoch: number; signal: AbortController;
  state: "NEW" | "AUTHORIZING" | "READY" | "CHECKING" | "PAIRED" | "UNKNOWN" | "UNSUPPORTED" | "REFUSED" | "REVOKED";
  access: DeviceCaptureAccessOutput | null; details: SetupDetails | null; liveness: PairedHelperLiveness | null; rawHealth: unknown | null };
const unsupported = () => Error("The complete original setup metadata is unsupported. Retained buffers were not rebound, clipped or claimed redacted.");
const privateDescription = "Current original native/session setup access is not verified. Private setup values remain retained and hidden.";
const blockedDescription = "Windows launch was reported blocked. The cause is unverified; protection was not changed. Cancellation does not prove a helper stopped or never started.";
const sameScope = (a: DeviceCaptureOrigin, b: DeviceCaptureOrigin) => a.projectId === b.projectId && a.organizationId === b.organizationId && a.nativeActorId === b.nativeActorId && a.clerkActorId === b.clerkActorId;
function sessionKey(scope: CaptureSession | null) { return scope && typeof scope.userId === "string" && typeof scope.sessionId === "string" && scope.userId.length <= 200 && scope.sessionId.length <= 200 ? JSON.stringify({ userId: scope.userId, sessionId: scope.sessionId }) : "null"; }
function currentFrame(frame: DeviceHelperSetupFrame | null, origin: DeviceCaptureOrigin, sdk: CaptureSession | null): frame is DeviceHelperSetupFrame {
  if (!frame || frame.active !== true || frame.loaded !== true || frame.signedIn !== true || !sameScope(frame.origin, origin) || !sdk?.sessionId || sdk.userId !== origin.clerkActorId || sessionKey(frame.hookSession) !== sessionKey(sdk) ||
    !["windows", "macos", "linux"].includes(frame.platform) || !["android", "ios-connected", "ios-remote"].includes(frame.mode) || !/^[A-F0-9]{12}$/.test(frame.pairingCode) || !Number.isSafeInteger(frame.connectionEpoch) || frame.connectionEpoch < 0) return false;
  return true;
}
function setupBuffers(raw: SetupBuffers) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.getPrototypeOf(raw) !== Object.prototype || Reflect.ownKeys(raw).length > 50 || Reflect.ownKeys(raw).some(key => typeof key !== "string")) throw unsupported();
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(raw))) {
    if (!key || key.length > 80 || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) throw unsupported();
    const value: unknown = descriptor.value;
    // Setup primitive drafts only: no imported manifests/graphs/source bodies.
    if (value !== null && !["string", "number", "boolean"].includes(typeof value)) throw unsupported();
  }
  return raw;
}

/** SOURCE-only, unmounted setup metadata. No default network, download, helper,
 * discovery, source capture, provider, OS policy or processing operation.
 * Current read authority is not a persistent device/processing permission. */
export class DeviceHelperSetup {
  private readonly origin: DeviceCaptureOrigin;
  private readonly buffers: SetupBuffers;
  private readonly storage = new Map<string, { bytes: number; nodes: number }>();
  private frame: DeviceHelperSetupFrame | null = null;
  private epoch = 0;
  private observedSdk: string;
  private readonly unsubscribe: () => void;
  private readonly attempts: State[] = [];
  private currentAttempt: State | null = null;
  private blocked = false;
  private manualReveal: string | null = null;
  private disposed = false;
  constructor(origin: DeviceCaptureOrigin, buffers: SetupBuffers, private readonly sdk: CaptureSdk, private readonly liveFrame: () => DeviceHelperSetupFrame | null) {
    const parsed = deviceCaptureAccessScope.safeParse(origin); if (!parsed.success) throw unsupported();
    this.origin = this.store("origin", parsed.data, 8192);
    this.buffers = this.store("buffers", setupBuffers(buffers), 65536);
    this.observedSdk = this.store("sdk", sessionKey(sdk.current()), 1024);
    this.unsubscribe = sdk.subscribe(() => this.observeSdk());
  }
  private store<T>(key: string, value: T, maximum: number): Readonly<T> {
    const cost = captureJsonContentCost(value); if (cost.bytes > maximum) throw unsupported();
    const next = new Map(this.storage); next.set(key, { bytes: cost.bytes + new TextEncoder().encode(key).length + 128, nodes: cost.nodes + 8 });
    let bytes = 0, nodes = 0; for (const entry of next.values()) { bytes += entry.bytes; nodes += entry.nodes; }
    if (bytes > 524288 || nodes > 16000) throw unsupported();
    const copy = retainCaptureJson(value); this.storage.set(key, next.get(key)!); return copy;
  }
  private admitHealthReadBudget() {
    let bytes = 0, nodes = 0; for (const entry of this.storage.values()) { bytes += entry.bytes; nodes += entry.nodes; }
    // No concurrent setup dispatch is admitted while CHECKING. Reserve room
    // before the injected health read for the complete 512-byte response and
    // next 8-KiB native echo plus keys/bookkeeping/structural overhead. This is
    // retained-content accounting, not a bound on transport parsing/V8 heap.
    if (bytes + 13312 > 524288 || nodes + 8192 > 16000) throw unsupported();
  }
  private revoke() {
    this.epoch++; this.manualReveal = null;
    const attempt = this.currentAttempt;
    if (attempt) { attempt.signal.abort(); if (attempt.state === "CHECKING") attempt.state = "UNKNOWN";
      else if (["NEW", "AUTHORIZING", "READY"].includes(attempt.state)) attempt.state = "REVOKED"; }
    this.frame = null; this.storage.delete("frame");
  }
  private observeSdk() { const key = sessionKey(this.sdk.current()); if (key !== this.observedSdk) {
    this.revoke(); try { this.observedSdk = this.store("sdk", key, 1024); } catch { this.observedSdk = "null"; this.storage.delete("sdk"); }
  } }
  update(frame: DeviceHelperSetupFrame | null) {
    this.observeSdk(); if (this.disposed) return;
    if (!currentFrame(frame, this.origin, this.sdk.current())) { this.revoke(); return; }
    if (JSON.stringify(this.frame) !== JSON.stringify(frame)) {
      this.revoke(); try { this.frame = this.store("frame", frame, 8192); } catch { this.frame = null; }
    }
  }
  private current(attempt?: State) {
    this.observeSdk(); const live = this.liveFrame();
    if (this.disposed || !this.frame || !currentFrame(live, this.origin, this.sdk.current()) || JSON.stringify(live) !== JSON.stringify(this.frame)) { if (this.frame) this.revoke(); return false; }
    return !attempt || this.currentAttempt === attempt && attempt.epoch === this.epoch && JSON.stringify(attempt.frame) === JSON.stringify(this.frame);
  }
  /** Caller invokes only from an explicit setup/retry/manual-review user event.
   * New metadata attempts retain earlier UNKNOWN records; they do not retry a
   * capture/write operation or imply the earlier helper attempt did nothing. */
  beginReview(intent: SetupIntent): SetupAttempt | null {
    if (!["CONNECT", "RETRY_UNKNOWN", "RETRY_BLOCKED", "MANUAL_POLICY_REVIEW"].includes(intent) || !this.current() || !this.frame || this.attempts.length >= 64) return null;
    if (this.currentAttempt && ["NEW", "AUTHORIZING", "CHECKING"].includes(this.currentAttempt.state)) return null;
    if (this.blocked && !["RETRY_BLOCKED", "MANUAL_POLICY_REVIEW"].includes(intent) || this.currentAttempt?.state === "UNKNOWN" && intent === "CONNECT") return null;
    const id = crypto.randomUUID(), accessInput = deviceCaptureAccessInput.parse({ projectId: this.origin.projectId, originalOrganizationId: this.origin.organizationId,
      expectedClerkActorId: this.origin.clerkActorId, expectedNativeActorId: this.origin.nativeActorId, readRequestId: id });
    try {
      const request = this.store(`attempt:${id}`, { id, intent, accessInput, frame: this.frame, epoch: this.epoch }, 16384);
      const publicAttempt = this.store(`public:${id}`, { id: request.id, intent: request.intent, accessInput: request.accessInput }, 8192);
      const state: State = { public: publicAttempt, frame: this.frame, epoch: this.epoch, signal: new AbortController(), state: "NEW", access: null, details: null, liveness: null, rawHealth: null };
      if (intent === "RETRY_BLOCKED") this.blocked = false;
      this.manualReveal = null; this.currentAttempt = state; this.attempts.push(state); return publicAttempt;
    } catch { return null; }
  }
  private async freshAccess(attempt: State, input: DeviceCaptureAccessInput, read: ReadSetupAccess) {
    const key = await captureAccessClientRequestKey(input); if (!this.current(attempt)) return null;
    try {
      const raw = await read(input, attempt.signal.signal); if (!this.current(attempt)) return null;
      // Conservative cost remains charged to this nonce even when strict
      // parsing drops the temporary raw copy. Not a raw-response history API.
      const bounded = this.store(`access:${input.readRequestId}`, raw, 8192);
      const parsed = deviceCaptureAccessOutput.safeParse(bounded);
      if (!parsed.success || parsed.data.readRequestId !== input.readRequestId || parsed.data.requestKey !== key || !sameScope(parsed.data.scope, this.origin) || !this.current(attempt)) {
        if (this.current(attempt)) attempt.access = null; return null;
      }
      return parsed.data;
    } catch { if (this.current(attempt)) attempt.access = null; throw unsupported(); }
  }
  async authorize(attempt: SetupAttempt, read: ReadSetupAccess): Promise<boolean> {
    const state = this.currentAttempt;
    if (!state || state.public !== attempt || state.state !== "NEW" || !this.current(state)) return false;
    state.state = "AUTHORIZING";
    try {
      const access = await this.freshAccess(state, attempt.accessInput, read); if (!this.current(state)) return false;
      if (!access) throw unsupported();
      const details = this.store(`details:${attempt.id}`, { scope: this.origin, platform: state.frame.platform, mode: state.frame.mode,
        pairingCode: state.frame.pairingCode, buffers: this.buffers, unsignedScriptOnly: true, requiresNodeMajor: 22,
        processingPermissionGranted: false, semanticRedactionGuaranteed: false, windowsPolicyVerified: false } as const, 73728);
      if (!this.current(state)) return false;
      state.access = access; state.details = details; state.state = "READY"; return true;
    } catch { if (this.current(state)) state.state = "REFUSED"; return false; }
  }
  async checkPairedLiveness(attempt: SetupAttempt, read: ReadSetupAccess, health: ReadPairedHealth): Promise<boolean> {
    const state = this.currentAttempt;
    if (!state || state.public !== attempt || state.state !== "READY" || !state.access || this.blocked || !this.current(state)) return false;
    state.state = "CHECKING"; // Before asynchronous authorization/transport.
    let transportStarted = false;
    try {
      const beforeInput = { ...attempt.accessInput, readRequestId: crypto.randomUUID() };
      const before = await this.freshAccess(state, beforeInput, read); if (!this.current(state)) return false; if (!before) throw unsupported();
      this.admitHealthReadBudget();
      const request = retainCaptureJson({ method: "GET" as const, path: "/health" as const, pairingCode: state.frame.pairingCode, attemptId: attempt.id });
      transportStarted = true;
      const raw = await health(request, state.signal.signal); if (!this.current(state)) return false;
      state.rawHealth = this.store(`health:${attempt.id}`, raw, 512);
      const liveness = this.store(`liveness:${attempt.id}`, pairedHelperLiveness(state.rawHealth), 1024);
      const afterInput = { ...attempt.accessInput, readRequestId: crypto.randomUUID() };
      const after = await this.freshAccess(state, afterInput, read); if (!this.current(state)) return false; if (!after) throw unsupported();
      state.access = after; state.liveness = liveness; state.state = "PAIRED"; return true;
    } catch { if (this.current(state)) state.state = !transportStarted ? "REFUSED" : state.rawHealth === null ? "UNKNOWN" : "UNSUPPORTED"; return false; }
  }
  reportBlockedLaunch() { this.blocked = true; this.revoke(); }
  revealManualDetailsOnlyIfPolicyPermits(attempt: SetupAttempt, explicitlyConfirmedPolicy: boolean) {
    const state = this.currentAttempt;
    if (!state || state.public !== attempt || attempt.intent !== "MANUAL_POLICY_REVIEW" || !explicitlyConfirmedPolicy || !state.access || state.state !== "READY" || !this.current(state)) return false;
    this.manualReveal = attempt.id; return true;
  }
  view(): Readonly<{ status: "PRIVATE" | "BLOCKED" | State["state"]; details: SetupDetails | null; liveness: PairedHelperLiveness | null; description: string }> {
    const state = this.currentAttempt;
    if (!state || !this.current(state)) return { status: this.blocked ? "BLOCKED" : "PRIVATE", details: null, liveness: null, description: this.blocked ? blockedDescription : privateDescription };
    if (!state.access) return { status: this.blocked ? "BLOCKED" : state.state, details: null, liveness: null, description: this.blocked ? blockedDescription : privateDescription };
    const details = !["AUTHORIZING", "CHECKING", "REFUSED", "REVOKED"].includes(state.state) && (!this.blocked || this.manualReveal === state.public.id) ? state.details : null;
    return { status: this.blocked ? "BLOCKED" : state.state, details, liveness: this.blocked || state.state !== "PAIRED" ? null : state.liveness,
      description: this.blocked ? blockedDescription : state.state === "UNSUPPORTED" ? unsupportedHelperProtocolMessage : state.state === "UNKNOWN" ? "The paired-health response is uncertain. No launch, stop, receipt or source processing outcome was inferred. Retry only explicitly." : "Scoped setup metadata only. Unsigned delivery and named semantic controls are not verified safe/redacted source or processing permission." };
  }
  /** Synchronous LOCAL metadata presentation only. The captured native read
   * scope and live SDK/epoch/frame are rechecked, NOT fresh server suspension/
   * seat, Windows, device or processing authority. Never use this callback as
   * a download, capture or processing grant. Those callers remain unmounted. */
  currentData(expected: SetupDetails, action: (value: SetupDetails) => void) {
    const state = this.currentAttempt, view = this.view();
    if (!state || !this.current(state) || view.details !== expected || !state.access || !sameScope(state.access.scope, this.origin)) return false;
    action(expected); return true;
  }
  dispose() { this.revoke(); this.disposed = true; this.unsubscribe(); }
}
