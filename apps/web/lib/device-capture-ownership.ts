import { deviceCaptureAccessInput, deviceCaptureAccessOutput, deviceCaptureAccessRequestText,
  deviceCaptureAccessScope, ownedDeviceSemanticCapture, type DeviceCaptureAccessInput,
  type DeviceCaptureAccessOutput, type DeviceCaptureOrigin, type OwnedDeviceSemanticCapture,
} from "../../api/src/services/deviceCaptureAccessSchema";

export type CaptureSession = Readonly<{ userId: string; sessionId: string }>;
export type CaptureSdk = { current: () => CaptureSession | null; subscribe: (observe: () => void) => () => void };
export type CaptureSelection = Readonly<{ mode: "android"; serial: string; approvedForegroundAppLabel: string }> |
  Readonly<{ mode: "ios-connected" | "ios-remote"; appiumUrl: string; appiumSessionId: string; approvedForegroundAppLabel: string }>;
export type DeviceCaptureFrame = Readonly<{ origin: DeviceCaptureOrigin; active: boolean; loaded: boolean; signedIn: boolean;
  hookSession: CaptureSession | null; connection: Readonly<{ connected: boolean; epoch: number; pairingCode: string }>;
  selection: CaptureSelection; screenLabel: string }>;
export type LocalCaptureRequest = Readonly<{ source: CaptureSelection["mode"]; label: string; serial?: string; appiumUrl?: string; sessionId?: string }>;
export type CaptureOperation = Readonly<{ id: string; accessInput: DeviceCaptureAccessInput }>;
type OperationState = { public: CaptureOperation; frame: DeviceCaptureFrame; epoch: number; sourceKey: string; controller: AbortController;
  access: DeviceCaptureAccessOutput | null; state: "REVIEWING" | "AUTHORIZING" | "AUTHORIZED" | "DISPATCHED" | "SUCCEEDED" | "UNKNOWN" | "UNSUPPORTED" | "REVOKED";
  rawResponse: unknown | null };
const generic = () => Error("This exact original capture intent is not current or its complete response is unsupported. Retained data was not replaced.");
const sourceFor = (mode: CaptureSelection["mode"]) => mode === "android" ? "ANDROID_ADB" : mode === "ios-connected" ? "IOS_CONNECTED" : "IOS_REMOTE";
const sameSession = (a: CaptureSession | null, b: CaptureSession | null) => !!a && !!b && !!a.userId && !!a.sessionId && a.userId.length <= 200 && a.sessionId.length <= 200 && a.userId === b.userId && a.sessionId === b.sessionId;

/** Bounded, plain JSON only; no getters/toJSON hooks, defaulting or clipping. */
export function retainCaptureJson<T>(value: T): Readonly<T> {
  const stack = [{ value: value as unknown, depth: 0 }]; let nodes = 0, estimate = 0;
  while (stack.length) {
    const entry = stack.pop()!; if (++nodes > 100000 || entry.depth > 64) throw generic();
    if (entry.value === null || typeof entry.value === "boolean") estimate += 5;
    else if (typeof entry.value === "string") estimate += new TextEncoder().encode(entry.value).length + 2;
    else if (typeof entry.value === "number") { if (!Number.isFinite(entry.value) || Number.isInteger(entry.value) && !Number.isSafeInteger(entry.value) || Object.is(entry.value, -0)) throw generic(); estimate += 32; }
    else if (entry.value && typeof entry.value === "object") {
      // Repeated references in an acyclic value serialize losslessly. Cycles
      // necessarily exceed the depth bound before serialization is attempted.
      if (!Array.isArray(entry.value) && Object.getPrototypeOf(entry.value) !== Object.prototype) throw generic();
      const descriptors = Object.getOwnPropertyDescriptors(entry.value);
      if (Reflect.ownKeys(entry.value).some(key => typeof key !== "string") || Object.keys(descriptors).length > 10000) throw generic();
      if (Array.isArray(entry.value) && (entry.value.length > 10000 || Object.keys(descriptors).length !== entry.value.length + 1)) throw generic();
      for (const [key, descriptor] of Object.entries(descriptors)) { if (Array.isArray(entry.value) && key === "length") continue;
        if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) throw generic(); estimate += new TextEncoder().encode(key).length + 4; stack.push({ value: descriptor.value, depth: entry.depth + 1 }); }
    } else throw generic();
    if (estimate > 8388608) throw generic();
  }
  if (new TextEncoder().encode(JSON.stringify(value)).length > 8388608) throw generic();
  const copy = structuredClone(value), freeze: unknown[] = [copy];
  while (freeze.length) { const entry = freeze.pop(); if (entry && typeof entry === "object") { freeze.push(...Object.values(entry)); Object.freeze(entry); } }
  return copy;
}
function sourceKey(frame: DeviceCaptureFrame) {
  // Private, page-local identity. NEVER send, log or use this as a hosted key.
  return JSON.stringify([frame.origin, frame.hookSession, frame.connection, frame.selection]);
}
function supportedFrame(frame: DeviceCaptureFrame | null, origin: DeviceCaptureOrigin, sdk: CaptureSession | null): frame is DeviceCaptureFrame {
  if (!frame || !frame.active || !frame.loaded || !frame.signedIn || JSON.stringify(frame.origin) !== JSON.stringify(origin) || !sameSession(frame.hookSession, sdk) || sdk?.userId !== origin.clerkActorId || !frame.connection.connected || !Number.isSafeInteger(frame.connection.epoch) || frame.connection.epoch < 0 || !/^[A-F0-9]{12}$/.test(frame.connection.pairingCode) || !frame.screenLabel.trim() || frame.screenLabel.length > 200 || !frame.selection.approvedForegroundAppLabel.trim() || frame.selection.approvedForegroundAppLabel.length > 200) return false;
  if (frame.selection.mode === "android") return !!frame.selection.serial.trim() && frame.selection.serial.length <= 200;
  if (!["ios-connected", "ios-remote"].includes(frame.selection.mode) || !frame.selection.appiumSessionId.trim() || frame.selection.appiumSessionId.length > 200 || frame.selection.appiumUrl.length > 2000) return false;
  try { const url = new URL(frame.selection.appiumUrl); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
}
export async function captureAccessClientRequestKey(input: DeviceCaptureAccessInput) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(deviceCaptureAccessRequestText(input)));
  return Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, "0")).join("");
}

/** Unmounted foundation. No default RPC, connector, processing or file action.
 * Explicit caller-supplied transport is admitted only within a current original
 * frame. User-confirmed foreground intent is NOT native app-target proof. */
export class DeviceCaptureOwnership {
  private readonly origin: DeviceCaptureOrigin;
  private frame: DeviceCaptureFrame | null = null;
  private epoch = 0;
  private sdkIdentity: string;
  private readonly unsubscribe: () => void;
  private operation: OperationState | null = null;
  private readonly operations: OperationState[] = [];
  private readonly captures = new Map<string, OwnedDeviceSemanticCapture>();
  private readonly retainedDrafts: unknown[] = [];
  private disposed = false;
  constructor(origin: DeviceCaptureOrigin, private readonly sdk: CaptureSdk, private readonly currentFrame: () => DeviceCaptureFrame | null,
    initialDrafts: readonly unknown[] = []) {
    this.origin = retainCaptureJson(deviceCaptureAccessScope.parse(origin));
    this.sdkIdentity = JSON.stringify(sdk.current());
    if (initialDrafts.length > 100) throw generic();
    const retained = retainCaptureJson(initialDrafts);
    for (const draft of retained) this.retainedDrafts.push(draft);
    this.unsubscribe = sdk.subscribe(() => this.observeSdk());
  }
  private observeSdk() { const identity = JSON.stringify(this.sdk.current()); if (identity !== this.sdkIdentity) { this.sdkIdentity = identity; this.revoke(); } }
  private revoke() {
    this.epoch++;
    if (this.operation) { this.operation.controller.abort();
      if (this.operation.state === "DISPATCHED") this.operation.state = "UNKNOWN";
      else if (["REVIEWING", "AUTHORIZING", "AUTHORIZED"].includes(this.operation.state)) this.operation.state = "REVOKED"; }
    this.frame = null;
  }
  update(frame: DeviceCaptureFrame | null) {
    this.observeSdk();
    if (this.disposed) return;
    const safe = supportedFrame(frame, this.origin, this.sdk.current()) ? retainCaptureJson(frame) : null;
    if (JSON.stringify(this.frame) !== JSON.stringify(safe)) { this.revoke(); this.frame = safe; }
  }
  private current(state?: OperationState) {
    this.observeSdk(); const live = this.currentFrame();
    if (this.disposed || !this.frame || !supportedFrame(live, this.origin, this.sdk.current()) || JSON.stringify(live) !== JSON.stringify(this.frame)) { if (this.frame) this.revoke(); return false; }
    return !state || this.operation === state && state.epoch === this.epoch && JSON.stringify(state.frame) === JSON.stringify(this.frame);
  }
  /** Explicit user event only. This does not authorize AI generation. */
  beginIntent(confirmedForegroundScope: boolean): CaptureOperation | null {
    if (!confirmedForegroundScope || !this.current() || !this.frame || this.operation && ["REVIEWING", "AUTHORIZING", "AUTHORIZED", "DISPATCHED", "UNKNOWN", "UNSUPPORTED"].includes(this.operation.state) || this.operations.length >= 100) return null;
    const id = crypto.randomUUID(), accessInput = deviceCaptureAccessInput.parse({ projectId: this.origin.projectId, originalOrganizationId: this.origin.organizationId,
      expectedClerkActorId: this.origin.clerkActorId, expectedNativeActorId: this.origin.nativeActorId, readRequestId: id });
    const publicOperation = retainCaptureJson({ id, accessInput });
    const state: OperationState = { public: publicOperation, frame: this.frame, epoch: this.epoch, sourceKey: sourceKey(this.frame), controller: new AbortController(), access: null, state: "REVIEWING", rawResponse: null };
    this.operation = state; this.operations.push(state); return publicOperation;
  }
  async authorize(operation: CaptureOperation, read: (input: DeviceCaptureAccessInput) => Promise<unknown>): Promise<boolean> {
    const state = this.operation;
    if (!state || state.public !== operation || state.state !== "REVIEWING" || !this.current(state)) return false;
    state.state = "AUTHORIZING";
    try {
      const key = await captureAccessClientRequestKey(operation.accessInput); if (!this.current(state)) return false;
      const raw = await read(operation.accessInput); if (!this.current(state)) return false;
      const parsed = deviceCaptureAccessOutput.safeParse(retainCaptureJson(raw));
      if (!parsed.success || parsed.data.requestKey !== key || parsed.data.readRequestId !== operation.id || JSON.stringify(parsed.data.scope) !== JSON.stringify(this.origin)) throw generic();
      if (!this.current(state)) return false;
      state.access = retainCaptureJson(parsed.data); state.state = "AUTHORIZED"; return true;
    } catch { if (this.current(state)) state.state = "REVOKED"; return false; }
  }
  async capture(operation: CaptureOperation, send: (request: LocalCaptureRequest, pairingCode: string, signal: AbortSignal) => Promise<unknown>): Promise<boolean> {
    const state = this.operation;
    if (!state || state.public !== operation || state.state !== "AUTHORIZED" || !state.access || !this.current(state)) return false;
    const selection = state.frame.selection;
    const request = retainCaptureJson({ source: selection.mode, label: state.frame.screenLabel,
      ...(selection.mode === "android" ? { serial: selection.serial } : { appiumUrl: selection.appiumUrl, sessionId: selection.appiumSessionId }) });
    state.state = "DISPATCHED"; // Private busy before invoking caller transport.
    try {
      if (!this.current(state)) return false;
      const raw = await send(request, state.frame.connection.pairingCode, state.controller.signal);
      if (!this.current(state)) return false;
      const saved = retainCaptureJson(raw); state.rawResponse = saved;
      if (!saved || typeof saved !== "object" || Array.isArray(saved) || Object.keys(saved).length !== 1 || !Object.hasOwn(saved, "capture")) throw generic();
      const parsed = ownedDeviceSemanticCapture.safeParse((saved as { capture: unknown }).capture);
      if (!parsed.success || parsed.data.source !== sourceFor(selection.mode) || new Set(parsed.data.screens.map(screen => screen.id)).size !== parsed.data.screens.length) throw generic();
      const previous = this.captures.get(state.sourceKey);
      if (previous && (previous.source !== parsed.data.source || previous.deviceName !== parsed.data.deviceName || previous.appName !== parsed.data.appName)) throw generic();
      const screens = [...(previous?.screens ?? []), ...parsed.data.screens];
      if (screens.length > 25 || new Set(screens.map(screen => screen.id)).size !== screens.length) throw generic();
      const whole = ownedDeviceSemanticCapture.safeParse({ ...parsed.data, screens });
      if (!whole.success || !this.current(state)) throw generic();
      this.captures.set(state.sourceKey, retainCaptureJson(whole.data)); state.state = "SUCCEEDED"; return true;
    } catch { if (state.state === "DISPATCHED") state.state = state.rawResponse === null ? "UNKNOWN" : "UNSUPPORTED"; return false; }
  }
  // UNKNOWN/unsupported attempts remain retained and block replacement here.
  // No connector receipt/recovery contract exists; a later explicit recovery
  // design must not equate cancellation with no operation or discard silently.
  view(): Readonly<{ capture: OwnedDeviceSemanticCapture | null; drafts: readonly unknown[]; busy: boolean; uncertain: boolean; unsupported: boolean }> {
    const current = this.operation;
    if (!current || !this.current(current) || !current.access) return { capture: null, drafts: [], busy: false, uncertain: false, unsupported: false };
    return { capture: this.captures.get(current.sourceKey) ?? null, drafts: this.retainedDrafts.slice(), busy: current.state === "DISPATCHED",
      uncertain: current.state === "UNKNOWN", unsupported: current.state === "UNSUPPORTED" };
  }
  dispose() { this.revoke(); this.disposed = true; this.unsubscribe(); }
}
