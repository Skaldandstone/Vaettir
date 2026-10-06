import { ownedDeviceSemanticCapture, type OwnedDeviceSemanticCapture } from "../../api/src/services/deviceCaptureAccessSchema";
import { captureJsonContentCost, fitsCaptureRetainedContent, retainCaptureJson, type CaptureSession, type LocalCaptureRequest } from "./device-capture-ownership";

export type CapturePublicationOrigin = Readonly<{ projectId: string; organizationId: string; clerkActorId: string }>;
export type CapturePublicationSelection = Readonly<{ mode: "android"; serial: string }> |
  Readonly<{ mode: "ios-connected" | "ios-remote"; appiumUrl: string; appiumSessionId: string }>;
export type CapturePublicationFrame = Readonly<{ origin: CapturePublicationOrigin; active: boolean; readable: boolean;
  session: CaptureSession | null; connection: Readonly<{ epoch: number; pairingCode: string }>;
  selection: CapturePublicationSelection; screenLabel: string }>;
export type CapturePublicationSdk = Readonly<{ current(): CaptureSession | null; generation(): number; subscribe(callback: () => void): () => void }>;
export type CapturePublicationLease = Readonly<{ id: number; signal: AbortSignal }>;
export type CapturePublication = Readonly<{ capture: OwnedDeviceSemanticCapture; request: LocalCaptureRequest;
  requestText: string; provenance: "CURRENT_CLIENT_REQUEST_RESPONSE_NOT_TARGET_VERIFICATION";
  foregroundTargetVerified: false; processingPermissionGranted: false; spendingApprovalGranted: false }>;
type State = "PREPARED" | "DISPATCHED" | "RECEIVED" | "RECEIVED_PRIVATE" | "UNKNOWN" | "UNSUPPORTED" | "REVOKED";
type Record = { lease: CapturePublicationLease; controller: AbortController; epoch: number; sdkGeneration: number;
  frame: CapturePublicationFrame; sourceKey: string; request: LocalCaptureRequest; requestText: string;
  state: State; raw: unknown; rawRetained: boolean; publication: CapturePublication | null };
type Cost = { bytes: number; nodes: number };
export const capturePublicationRefusal = "The original capture result cannot be published in this current frame. Prior values and the original intent remain private; no automatic retry or target/processing permission was inferred.";
const refuse = () => Error(capturePublicationRefusal);
function sameOrigin(a: CapturePublicationOrigin, b: CapturePublicationOrigin) { return a.projectId === b.projectId && a.organizationId === b.organizationId && a.clerkActorId === b.clerkActorId; }
function scalar(value: unknown, maximum: number): value is string { return typeof value === "string" && value.length > 0 && value.length <= maximum && !value.includes("\0"); }
function exactKeys(raw: unknown, keys: readonly string[]) { return !!raw && typeof raw === "object" && !Array.isArray(raw) && Object.getPrototypeOf(raw) === Object.prototype &&
  Reflect.ownKeys(raw).length === keys.length && Reflect.ownKeys(raw).every(key => typeof key === "string" && keys.includes(key)); }
function supportedFrame(raw: CapturePublicationFrame, origin: CapturePublicationOrigin, session: CaptureSession | null) {
  // Cost traversal refuses getters/symbols/hidden fields before field access.
  if (captureJsonContentCost(raw).bytes > 16384 || !exactKeys(raw, ["origin", "active", "readable", "session", "connection", "selection", "screenLabel"]) ||
    !exactKeys(raw.origin, ["projectId", "organizationId", "clerkActorId"]) || !exactKeys(raw.session, ["userId", "sessionId"]) || !exactKeys(raw.connection, ["epoch", "pairingCode"]) ||
    raw.active !== true || raw.readable !== true || !sameOrigin(raw.origin, origin) ||
    !raw.session || !session || session.userId !== origin.clerkActorId || session.userId !== raw.session.userId || session.sessionId !== raw.session.sessionId ||
    !scalar(session.userId, 200) || !scalar(session.sessionId, 200) || !Number.isSafeInteger(raw.connection.epoch) || raw.connection.epoch < 0 ||
    !/^[A-F0-9]{12}$/.test(raw.connection.pairingCode) || typeof raw.screenLabel !== "string" || raw.screenLabel.length > 200 || !raw.screenLabel.trim()) return false;
  if (raw.selection.mode === "android") return exactKeys(raw.selection, ["mode", "serial"]) && scalar(raw.selection.serial, 200) && !!raw.selection.serial.trim();
  if (!["ios-connected", "ios-remote"].includes(raw.selection.mode) || !scalar(raw.selection.appiumSessionId, 200) ||
    !raw.selection.appiumSessionId.trim() || !scalar(raw.selection.appiumUrl, 2000) || !exactKeys(raw.selection, ["mode", "appiumUrl", "appiumSessionId"])) return false;
  const url = new URL(raw.selection.appiumUrl); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
}
function requestFor(frame: CapturePublicationFrame): LocalCaptureRequest {
  return frame.selection.mode === "android" ? { source: frame.selection.mode, label: frame.screenLabel, serial: frame.selection.serial } :
    { source: frame.selection.mode, label: frame.screenLabel, appiumUrl: frame.selection.appiumUrl, sessionId: frame.selection.appiumSessionId };
}
function expectedSource(selection: CapturePublicationSelection) { return selection.mode === "android" ? "ANDROID_ADB" : selection.mode === "ios-connected" ? "IOS_CONNECTED" : "IOS_REMOTE"; }

/** Private SOURCE publication owner, NOT a native authorization/dispatch,
 * foreground proof, operation receipt, processing/spending or retry grant.
 * Existing values are retained LEGACY_UNATTRIBUTED, never used as a baseline.
 * No default fetch, helper/device/provider operation or credential generation. */
export class DeviceCapturePublicationOwner {
  private readonly origin: CapturePublicationOrigin;
  private readonly prior: readonly unknown[];
  private readonly costs = new Map<string, Cost>();
  private readonly records: Record[] = [];
  private readonly captures = new Map<string, OwnedDeviceSemanticCapture>();
  private latest: Record | null = null;
  private frame: CapturePublicationFrame | null = null;
  private frameKey = "";
  private epoch = 0;
  private observedSdk = "";
  private readonly cleanup: (() => void) | null;
  private installed = false;
  private disposed = false;
  constructor(origin: CapturePublicationOrigin, private readonly sdk: CapturePublicationSdk,
    private readonly liveFrame: () => CapturePublicationFrame | null, initialUnattributed: readonly unknown[] = []) {
    if (captureJsonContentCost(origin).bytes > 4096 || !exactKeys(origin, ["projectId", "organizationId", "clerkActorId"]) || !scalar(origin.projectId, 200) || !scalar(origin.organizationId, 200) || !scalar(origin.clerkActorId, 200) || initialUnattributed.length > 100) throw refuse();
    this.origin = this.store("origin", origin);
    // Preflight ALL prior values before copying any, never evict to admit a
    // new owner. Constructor refusal leaves the caller's originals untouched.
    const changes = initialUnattributed.map((value, index) => ({ key: `prior:${index}`, cost: this.cost(`prior:${index}`, value) }));
    if (!this.fits(changes)) throw refuse();
    this.prior = initialUnattributed.map((value, index) => this.store(`prior:${index}`, value));
    this.observeSdk();
    let cleanup: unknown;
    try { cleanup = sdk.subscribe(() => this.observeSdk()); } catch { cleanup = null; }
    this.cleanup = typeof cleanup === "function" ? cleanup as () => void : null;
    this.installed = this.cleanup !== null;
  }
  private cost(key: string, value: unknown): Cost { const cost = captureJsonContentCost(value); return { bytes: cost.bytes + new TextEncoder().encode(key).length + 256, nodes: cost.nodes + 16 }; }
  private fits(changes: readonly { key: string; cost: Cost }[], reserve: Cost = { bytes: 0, nodes: 0 }) {
    const next = new Map(this.costs); for (const item of changes) next.set(item.key, item.cost);
    return fitsCaptureRetainedContent([...next.values()], reserve);
  }
  private store<T>(key: string, value: T): Readonly<T> { const cost = this.cost(key, value); if (!this.fits([{ key, cost }])) throw refuse();
    const copy = retainCaptureJson(value); this.costs.set(key, cost); return copy; }
  private revoke() {
    this.epoch++; this.frame = null; this.frameKey = "";
    // State revocation precedes abort listeners/reentrant parent callbacks.
    for (const record of this.records) {
      if (record.state === "PREPARED") record.state = "REVOKED";
      else if (record.state === "DISPATCHED") record.state = "UNKNOWN";
    }
    for (const record of this.records) if (record.state === "REVOKED" || record.state === "UNKNOWN") record.controller.abort();
  }
  private observeSdk() {
    let identity: string;
    try { const generation = this.sdk.generation(), session = this.sdk.current();
      if (!Number.isSafeInteger(generation) || generation < 0 || captureJsonContentCost(session).bytes > 2048 || session !== null && !exactKeys(session, ["userId", "sessionId"])) throw refuse();
      identity = JSON.stringify({ generation, session });
    } catch { identity = "UNSUPPORTED"; }
    if (identity !== this.observedSdk) { this.observedSdk = identity; this.revoke(); try { this.store("sdk-observation", identity); } catch { this.observedSdk = "UNSUPPORTED"; } }
  }
  update(frame: CapturePublicationFrame | null) {
    this.observeSdk(); if (this.disposed) return;
    try {
      if (!frame || !supportedFrame(frame, this.origin, this.sdk.current())) { this.revoke(); return; }
      const key = JSON.stringify(frame); if (key === this.frameKey) return;
      this.revoke(); this.frame = this.store("frame", frame); this.frameKey = key;
    } catch { this.revoke(); }
  }
  private current(record?: Record) {
    this.observeSdk();
    try { const live = this.liveFrame();
      if (this.disposed || !this.installed || !this.frame || !live || !supportedFrame(live, this.origin, this.sdk.current()) || JSON.stringify(live) !== this.frameKey) { if (this.frame) this.revoke(); return false; }
      return !record || this.latest === record && record.epoch === this.epoch && record.sdkGeneration === this.sdk.generation() && JSON.stringify(record.frame) === this.frameKey;
    } catch { this.revoke(); return false; }
  }
  begin(request: LocalCaptureRequest): CapturePublicationLease | null {
    if (!this.current() || !this.frame || this.records.length >= 100 || this.records.some(record => ["PREPARED", "DISPATCHED", "UNKNOWN", "UNSUPPORTED", "RECEIVED_PRIVATE"].includes(record.state))) return null;
    try {
      if (captureJsonContentCost(request).bytes > 32768 || JSON.stringify(request) !== JSON.stringify(requestFor(this.frame))) return null;
      const id = this.records.length + 1, frame = this.frame, requestText = JSON.stringify(request), sdkGeneration = this.sdk.generation();
      const sourceKey = JSON.stringify({ origin: this.origin, session: frame.session, connection: frame.connection, selection: frame.selection, sdkGeneration });
      const metadata = { id, frame, request, requestText, sourceKey, epoch: this.epoch, sdkGeneration };
      const key = `intent:${id}`, cost = this.cost(key, metadata);
      if (!this.fits([{ key, cost }])) return null;
      const saved = retainCaptureJson(metadata), controller = new AbortController(), lease = Object.freeze({ id, signal: controller.signal });
      const record: Record = { lease, controller, epoch: saved.epoch, sdkGeneration, frame: saved.frame,
        sourceKey: saved.sourceKey, request: saved.request, requestText: saved.requestText, state: "PREPARED", raw: null, rawRetained: false, publication: null };
      this.costs.set(key, cost); this.records.push(record); this.latest = record; return lease;
    } catch { return null; }
  }
  markDispatched(lease: CapturePublicationLease): boolean {
    const record = this.records.find(item => item.lease === lease);
    if (!record || record.state !== "PREPARED" || !this.current(record)) return false;
    // Reserve complete raw response + candidate before caller transport.
    // This accounts retained content, not transport parsing/total JS heap.
    if (!this.fits([], { bytes: 2 * 8388608 + 65536, nodes: 2 * 100000 + 128 })) { record.state = "UNSUPPORTED"; return false; }
    record.state = "DISPATCHED"; return this.current(record);
  }
  markUnknown(lease: CapturePublicationLease) {
    const record = this.records.find(item => item.lease === lease);
    if (record && ["DISPATCHED", "UNKNOWN"].includes(record.state)) record.state = "UNKNOWN";
  }
  receive(lease: CapturePublicationLease, raw: unknown): boolean {
    const record = this.records.find(item => item.lease === lease);
    if (!record || !["DISPATCHED", "UNKNOWN"].includes(record.state)) return false;
    try {
      // Admit/retain late data under its ORIGINAL lease even after scope loss.
      // Unsupported oversize/getter data is NOT claimed completely retained.
      record.raw = this.store(`raw:${lease.id}`, raw);
      record.rawRetained = true;
      if (!raw || typeof raw !== "object" || Array.isArray(raw) || Reflect.ownKeys(raw).length !== 1 || !Object.hasOwn(raw, "capture")) { record.state = "UNSUPPORTED"; return false; }
      const decoded = ownedDeviceSemanticCapture.safeParse((raw as { capture: unknown }).capture);
      if (!decoded.success || decoded.data.source !== expectedSource(record.frame.selection) || new Set(decoded.data.screens.map(screen => screen.id)).size !== decoded.data.screens.length) { record.state = "UNSUPPORTED"; return false; }
      if (!this.current(record)) { record.state = "RECEIVED_PRIVATE"; return false; }
      const previous = this.captures.get(record.sourceKey);
      if (previous && (previous.source !== decoded.data.source || previous.deviceName !== decoded.data.deviceName || previous.appName !== decoded.data.appName)) { record.state = "UNSUPPORTED"; return false; }
      const screens = [...(previous?.screens ?? []), ...decoded.data.screens];
      if (screens.length > 25 || new Set(screens.map(screen => screen.id)).size !== screens.length) { record.state = "UNSUPPORTED"; return false; }
      const candidate = { ...decoded.data, screens }, parsed = ownedDeviceSemanticCapture.safeParse(candidate);
      if (!parsed.success || !this.current(record)) { record.state = "UNSUPPORTED"; return false; }
      // Charge every historical immutable candidate, not merely the map's
      // newest view: prior records still retain their publication pointers.
      const captureKey = `publication:${lease.id}`, cost = this.cost(captureKey, { capture: parsed.data, request: record.request, requestText: record.requestText });
      if (!this.fits([{ key: captureKey, cost }])) { record.state = "UNSUPPORTED"; return false; }
      const saved = retainCaptureJson(parsed.data); this.costs.set(captureKey, cost);
      record.publication = Object.freeze({ capture: saved, request: record.request, requestText: record.requestText,
        provenance: "CURRENT_CLIENT_REQUEST_RESPONSE_NOT_TARGET_VERIFICATION", foregroundTargetVerified: false, processingPermissionGranted: false, spendingApprovalGranted: false });
      this.captures.set(record.sourceKey, saved); record.state = "RECEIVED"; return true;
    } catch { record.state = record.rawRetained ? "UNSUPPORTED" : "UNKNOWN"; return false; }
  }
  canPublish(lease: CapturePublicationLease): boolean { const record = this.records.find(item => item.lease === lease); return !!record && record.state === "RECEIVED" && !!record.publication && this.current(record); }
  currentPublication(lease: CapturePublicationLease): CapturePublication | null { const record = this.records.find(item => item.lease === lease); return record && this.canPublish(lease) ? record.publication : null; }
  currentStatus(): Readonly<{ busy: boolean; uncertain: boolean; unsupported: boolean; canBegin: boolean }> {
    if (!this.current()) return { busy: false, uncertain: false, unsupported: false, canBegin: false };
    return { busy: this.records.some(record => record.state === "PREPARED" || record.state === "DISPATCHED"), uncertain: this.records.some(record => record.state === "UNKNOWN" || record.state === "RECEIVED_PRIVATE"),
      unsupported: this.records.some(record => record.state === "UNSUPPORTED"), canBegin: this.records.length < 100 && !this.records.some(record => ["PREPARED", "DISPATCHED", "UNKNOWN", "UNSUPPORTED", "RECEIVED_PRIVATE"].includes(record.state)) };
  }
  /** Synchronous guard for every parent state updater/error/finally handler.
   * It is not an async permission or a mandate to clear user inputs. */
  ownsCurrentFrame(lease: CapturePublicationLease): boolean { const record = this.records.find(item => item.lease === lease); return !!record && this.current(record); }
  retainedMetadata(): Readonly<{ legacyUnattributedValues: number; intents: number; completeRawResponses: number; bytes: number; nodes: number }> | null {
    if (!this.current()) return null;
    let bytes = 0, nodes = 0; for (const cost of this.costs.values()) { bytes += cost.bytes; nodes += cost.nodes; }
    return { legacyUnattributedValues: this.prior.length, intents: this.records.length, completeRawResponses: this.records.filter(record => record.rawRetained).length, bytes, nodes };
  }
  dispose() { if (this.disposed) return; this.disposed = true; this.installed = false; this.revoke(); try { this.cleanup?.(); } catch { /* Revoked BEFORE cleanup. */ } }
}
