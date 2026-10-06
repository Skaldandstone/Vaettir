"use client";
import { useLayoutEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { trpcReact } from "./trpcReact";
import { currentSessionScope, sameAuthScope } from "./auth-query-cache";
import { deviceHelperSetupAccessInput, deviceHelperSetupAccessOutput, deviceHelperSetupAccessRequestText,
  deviceHelperSetupMetadataBytes, type DeviceHelperSetupAccessInput } from "../../api/src/services/deviceHelperSetupAccessSchema";
import { DeviceHelperSetup, type DeviceHelperSetupFrame, type ReadPairedHealth, type ReadSetupAccess, type SetupBuffers, type SetupAttempt, type SetupIntent } from "./device-helper-setup";
import { captureJsonContentCost, retainCaptureJson, type CaptureSdk, type CaptureSession } from "./device-capture-ownership";
import type { DeviceCaptureOrigin } from "../../api/src/services/deviceCaptureAccessSchema";

export type HelperSetupIntent = Readonly<{ projectId: string; originalOrganizationId: string | null; active: boolean;
  platform: DeviceHelperSetupFrame["platform"]; mode: DeviceHelperSetupFrame["mode"]; pairingCode: string; connectionEpoch: number; buffers: SetupBuffers }>;
type Frame = Readonly<HelperSetupIntent & { loaded: boolean; signedIn: boolean; hookSession: CaptureSession | null }>;
type Bootstrap = (input: DeviceHelperSetupAccessInput, signal: AbortSignal) => Promise<unknown>;
export type HelperSetupView = Readonly<{ status: string; busy: boolean; canReview: boolean; canCheck: boolean; paired: boolean; description: string;
  currentScope: DeviceCaptureOrigin | null; deviceOperationPerformed: false; processingPermissionGranted: false; spendingApprovalGranted: false }>;
type Resource = { loaded?: boolean; session?: { id: string; user: { id: string } } | null; addListener?: (callback: () => void) => unknown };
function helperResource() { return (typeof window === "undefined" ? null : window.Clerk) as Resource | null | undefined; }
function setupBufferKey(buffers: SetupBuffers): string | null {
  try {
    if (!buffers || typeof buffers !== "object" || Array.isArray(buffers) || Object.getPrototypeOf(buffers) !== Object.prototype || Reflect.ownKeys(buffers).length > 50 ||
      Reflect.ownKeys(buffers).some(key => typeof key !== "string" || !key || key.length > 80)) return null;
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(buffers))) if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value") ||
      descriptor.value !== null && !["string", "number", "boolean"].includes(typeof descriptor.value) || typeof descriptor.value === "string" && descriptor.value.length > 65536) return null;
    return captureJsonContentCost(buffers).bytes <= 65536 ? JSON.stringify(buffers) : null;
  } catch { return null; }
}
function setupFrameKey(frame: Frame): string | null {
  if (typeof frame.active !== "boolean" || typeof frame.loaded !== "boolean" || typeof frame.signedIn !== "boolean" ||
    !["windows", "macos", "linux"].includes(frame.platform) || !["android", "ios-connected", "ios-remote"].includes(frame.mode) ||
    setupBufferKey(frame.buffers) === null || typeof frame.projectId !== "string" || frame.projectId.length > 200 ||
    frame.originalOrganizationId !== null && (typeof frame.originalOrganizationId !== "string" || frame.originalOrganizationId.length > 200) ||
    frame.hookSession && (typeof frame.hookSession.userId !== "string" || typeof frame.hookSession.sessionId !== "string" || frame.hookSession.userId.length > 200 || frame.hookSession.sessionId.length > 200) ||
    typeof frame.pairingCode !== "string" || frame.pairingCode.length > 12 || !Number.isSafeInteger(frame.connectionEpoch)) return null;
  return JSON.stringify({ projectId: frame.projectId, originalOrganizationId: frame.originalOrganizationId, active: frame.active,
    loaded: frame.loaded, signedIn: frame.signedIn, hookSession: frame.hookSession ? { userId: frame.hookSession.userId, sessionId: frame.hookSession.sessionId } : null,
    platform: frame.platform, mode: frame.mode, pairingCode: frame.pairingCode, connectionEpoch: frame.connectionEpoch, buffers: frame.buffers });
}
export function currentHelperSetupSession(): CaptureSession | null {
  const resource = helperResource();
  const session = resource?.session;
  return resource?.loaded && typeof resource.addListener === "function" && typeof session?.id === "string" && session.id.length <= 200 && typeof session.user?.id === "string" && session.user.id.length <= 200 ? currentSessionScope(session) : null;
}
type InstalledSdk = CaptureSdk & { generation(): number };
export function createInstalledHelperSdk(): InstalledSdk {
  let installed: { resource: Resource; active: boolean } | null = null;
  let generation = 0;
  return { current: () => {
    if (installed?.active && helperResource() !== installed.resource) { installed.active = false; generation++; }
    if (!installed?.active) return null;
    return currentHelperSetupSession();
  }, generation: () => generation, subscribe: callback => {
    const resource = helperResource();
    if (!resource || typeof resource.addListener !== "function") { installed = null; return () => undefined; }
    const token = { resource, active: true }; let cleanup: unknown;
    try { cleanup = resource.addListener(() => { if (token.active) callback(); }); }
    catch { token.active = false; installed = null; callback(); return () => undefined; }
    if (typeof cleanup !== "function") { token.active = false; installed = null; callback(); return () => undefined; }
    installed = token; callback();
    return () => { token.active = false; if (installed === token) installed = null; try { cleanup(); } catch { /* Revoked before cleanup, no authority retained. */ } };
  } };
}
function boundedBootstrapReply(raw: unknown) {
  // Exact primitive metadata tree only, before schema parsing or property
  // access. Getters, symbols, unknown nested bodies and oversized values refuse
  // whole; no strip/redaction claim or temporary private-body clone.
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.getPrototypeOf(raw) !== Object.prototype) throw Error("Unsupported setup metadata response.");
  const allowed = new Set(["readRequestId", "requestKey", "scope", "role", "seatType", "authorization", "identityEstablishment", "deviceOperationPerformed", "helperLaunchPerformed", "windowsLaunchAcceptanceVerified", "foregroundTargetVerified", "captureConsentGranted", "processingPermissionGranted", "spendingApprovalGranted", "legacyDraftAttributionVerified"]);
  const descriptors = Object.getOwnPropertyDescriptors(raw);
  if (Reflect.ownKeys(raw).length !== allowed.size || Reflect.ownKeys(raw).some(key => typeof key !== "string" || !allowed.has(key))) throw Error("Unsupported setup metadata response.");
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) throw Error("Unsupported setup metadata response.");
    const value: unknown = descriptor.value;
    if (key === "scope") {
      if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw Error("Unsupported setup metadata response.");
      const fields = new Set(["projectId", "organizationId", "nativeActorId", "clerkActorId"]);
      if (Reflect.ownKeys(value).length !== 4 || Reflect.ownKeys(value).some(field => typeof field !== "string" || !fields.has(field))) throw Error("Unsupported setup metadata response.");
      for (const item of Object.values(Object.getOwnPropertyDescriptors(value))) if (!item.enumerable || !Object.hasOwn(item, "value") || typeof item.value !== "string" || item.value.length > 200) throw Error("Unsupported setup metadata response.");
    } else if (typeof value !== "boolean" && (typeof value !== "string" || value.length > 200)) throw Error("Unsupported setup metadata response.");
  }
  if (captureJsonContentCost(raw).bytes > 8192) throw Error("Unsupported setup metadata response.");
}
export async function deviceHelperSetupClientKey(input: DeviceHelperSetupAccessInput) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(deviceHelperSetupAccessRequestText(input)));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

/** Retained metadata-only owner. No automatic read/poll/discovery and no legacy
 * pairing/capture/paid-draft attribution. Session/frame loss hides, not deletes.
 * This class never exposes private setup details or supplies action grants. */
export class DeviceHelperSetupOwner {
  private frame: Frame | null = null;
  private binding = "";
  private epoch = 0;
  private sdkIdentity: string;
  private attached = false;
  private original: { projectId: string; organizationId: string; clerkActorId: string } | null = null;
  private origin: DeviceCaptureOrigin | null = null;
  private setup: DeviceHelperSetup | null = null;
  private attempt: SetupAttempt | null = null;
  private busy = false;
  private busyEpoch = -1;
  private admittedEpoch = -1;
  private error = "";
  private blocked = false;
  private uncertainHealth = false;
  private bootstrapSignal: AbortController | null = null;
  private readonly bootstrapInputs: DeviceHelperSetupAccessInput[] = [];
  private readonly setupObservers = new Set<() => void>();
  private readonly buffers: SetupBuffers;
  private readonly bufferKey: string;
  constructor(private readonly sdk: CaptureSdk, private readonly publish: () => void, buffers: SetupBuffers) {
    const key = setupBufferKey(buffers); if (key === null) throw Error("Unsupported complete setup buffers.");
    this.buffers = retainCaptureJson(buffers); this.bufferKey = key; this.sdkIdentity = JSON.stringify(sdk.current());
  }
  attach() { this.attached = true; this.publish(); }
  detach() { this.attached = false; this.invalidate(); }
  private invalidate() { this.epoch++; this.admittedEpoch = -1; this.error = ""; this.bootstrapSignal?.abort(); this.setup?.update(null); }
  observeSdk() {
    const identity = JSON.stringify(this.sdk.current());
    if (identity !== this.sdkIdentity) { this.sdkIdentity = identity; this.invalidate(); this.setupObservers.forEach(observe => observe()); this.publish(); }
  }
  bind(frame: Frame) {
    this.observeSdk(); const key = setupFrameKey(frame);
    if (key === null) { if (this.binding !== "UNSUPPORTED_FRAME") this.invalidate(); this.binding = "UNSUPPORTED_FRAME"; this.frame = null; return; }
    if (key !== this.binding) { this.binding = key; this.invalidate(); }
    this.frame = frame;
    this.setup?.update(this.setupFrame());
  }
  private valid() {
    const frame = this.frame, session = this.sdk.current();
    return this.attached && !!frame && frame.active && frame.loaded && frame.signedIn && !!frame.originalOrganizationId && !!frame.hookSession && sameAuthScope(frame.hookSession, session) &&
      (!this.original || this.original.projectId === frame.projectId && this.original.organizationId === frame.originalOrganizationId && this.original.clerkActorId === session?.userId) &&
      setupBufferKey(frame.buffers) === this.bufferKey && ["windows", "macos", "linux"].includes(frame.platform) && ["android", "ios-connected", "ios-remote"].includes(frame.mode) &&
      /^[A-F0-9]{12}$/.test(frame.pairingCode) && Number.isSafeInteger(frame.connectionEpoch) && frame.connectionEpoch >= 0;
  }
  private setupFrame(): DeviceHelperSetupFrame | null {
    const f = this.frame; return f && this.origin && this.valid() ? { origin: this.origin, active: true, loaded: f.loaded, signedIn: f.signedIn,
      hookSession: f.hookSession ? { userId: f.hookSession.userId, sessionId: f.hookSession.sessionId } : null,
      platform: f.platform, mode: f.mode, pairingCode: f.pairingCode, connectionEpoch: f.connectionEpoch } : null;
  }
  private current(epoch: number) { this.observeSdk(); return this.valid() && epoch === this.epoch; }
  matches(frame: Frame) { this.observeSdk(); const key = setupFrameKey(frame); return key !== null && this.binding === key && this.valid(); }
  view(): HelperSetupView {
    this.observeSdk(); const readable = this.valid(), scoped = readable && this.admittedEpoch === this.epoch, setup = scoped ? this.setup?.view() : null;
    const busy = readable && this.busy && this.busyEpoch === this.epoch;
    return Object.freeze({ status: !readable ? "PRIVATE" : this.blocked ? "BLOCKED" : busy ? "BUSY" : setup?.status ?? "REVIEW_REQUIRED", busy,
      canReview: readable && !this.busy, canCheck: scoped && !this.busy && setup?.status === "READY" && !this.blocked,
      paired: scoped && setup?.liveness?.kind === "PAIRED_LIVENESS_ONLY", currentScope: scoped && setup?.details ? this.origin : null,
      description: !readable ? "Original setup metadata is retained privately. Restore the same account/workspace and explicitly review a fresh native read." : this.error || setup?.description || "Review current setup identity explicitly. This does not attribute retained legacy drafts or approve any device, download or processing action.",
      deviceOperationPerformed: false, processingPermissionGranted: false, spendingApprovalGranted: false });
  }
  async review(bootstrap: Bootstrap, read: ReadSetupAccess): Promise<void> {
    this.observeSdk(); if (!this.valid() || this.busy || !this.frame || this.bootstrapInputs.length >= 64) return;
    const frame = this.frame, epoch = this.epoch;
    this.busy = true; this.busyEpoch = epoch; this.admittedEpoch = -1; this.error = ""; this.publish();
    // Synchronous publishing may trigger an SDK/frame movement before hashing.
    if (!this.current(epoch)) { this.busy = false; return; }
    const signal = new AbortController(); this.bootstrapSignal = signal;
    try {
      if (!this.original) this.original = Object.freeze({ projectId: frame.projectId, organizationId: frame.originalOrganizationId!, clerkActorId: frame.hookSession!.userId });
      if (!this.origin) {
        const input = deviceHelperSetupAccessInput.parse({ kind: "ESTABLISH_CURRENT_SETUP_SCOPE", projectId: this.original.projectId,
          originalOrganizationId: this.original.organizationId, expectedClerkActorId: this.original.clerkActorId, readRequestId: crypto.randomUUID() });
        this.bootstrapInputs.push(retainCaptureJson(input)); const key = await deviceHelperSetupClientKey(input); if (!this.current(epoch)) return;
        const raw = await bootstrap(input, signal.signal); if (!this.current(epoch)) return;
        boundedBootstrapReply(raw); const decoded = deviceHelperSetupAccessOutput.safeParse(raw);
        if (!decoded.success || deviceHelperSetupMetadataBytes(decoded.data) > 8192 || decoded.data.requestKey !== key || decoded.data.readRequestId !== input.readRequestId ||
          decoded.data.scope.projectId !== this.original.projectId || decoded.data.scope.organizationId !== this.original.organizationId || decoded.data.scope.clerkActorId !== this.original.clerkActorId) throw Error("Unsupported current setup identity.");
        if (!this.current(epoch)) return;
        this.origin = retainCaptureJson(decoded.data.scope);
        // One installed listener belongs to the mounted hook. The retained
        // foundation subscribes only to this owner's private observer set, so
        // collapse/resource replacement/unmount cannot leave a global listener.
        const sdk: CaptureSdk = { current: () => this.sdk.current(), subscribe: observe => { this.setupObservers.add(observe); return () => { this.setupObservers.delete(observe); }; } };
        this.setup = new DeviceHelperSetup(this.origin, this.buffers, sdk, () => this.setupFrame());
        this.setup.update(this.setupFrame());
      }
      const intent: SetupIntent = this.blocked ? "MANUAL_POLICY_REVIEW" : this.uncertainHealth || this.setup?.view().status === "UNKNOWN" ? "RETRY_UNKNOWN" : "CONNECT";
      const attempt = this.setup?.beginReview(intent); if (!attempt) throw Error("Explicit current setup review is unavailable.");
      this.attempt = attempt; const admitted = await this.setup!.authorize(attempt, read); if (!this.current(epoch)) return;
      if (!admitted) throw Error("Current setup authorization could not be verified.");
      this.admittedEpoch = epoch; this.uncertainHealth = false;
    } catch { if (this.current(epoch)) this.error = "The complete current setup read was refused or unsupported. Earlier buffers/uncertain attempts remain private; no device action or legacy ownership was inferred."; }
    finally { this.busy = false; if (this.current(epoch)) this.publish(); }
  }
  async check(read: ReadSetupAccess, health: ReadPairedHealth | undefined): Promise<void> {
    this.observeSdk(); const epoch = this.epoch;
    if (!health || !this.view().canCheck || !this.setup || !this.attempt) return;
    this.busy = true; this.busyEpoch = epoch; this.uncertainHealth = true; this.publish();
    try { if (!this.current(epoch)) return; const paired = await this.setup.checkPairedLiveness(this.attempt, read, health); if (this.current(epoch) && paired) this.uncertainHealth = false; }
    finally { this.busy = false; if (this.current(epoch)) this.publish(); }
  }
  reportBlocked() { this.blocked = true; this.setup?.reportBlockedLaunch(); this.invalidate(); this.publish(); }
}

export type DeviceHelperSetupWorkflow = Readonly<{ view: HelperSetupView; review(): Promise<void>; checkPaired(): Promise<void>; reportBlocked(): void; healthAvailable: boolean }>;
/** Always mount this owner outside conditional auth/seat/device sections. Only
 * native metadata RPC is wired; local health must be explicitly injected. */
export function useDeviceHelperSetup(intent: HelperSetupIntent, health?: ReadPairedHealth): DeviceHelperSetupWorkflow {
  const auth = useAuth(), [, publish] = useState(0), utils = trpcReact.useUtils();
  const frame: Frame = { projectId: intent.projectId, originalOrganizationId: intent.originalOrganizationId, active: intent.active,
    platform: intent.platform, mode: intent.mode, pairingCode: intent.pairingCode, connectionEpoch: intent.connectionEpoch, buffers: intent.buffers,
    loaded: auth.isLoaded, signedIn: !!auth.isSignedIn,
    hookSession: auth.isLoaded && auth.isSignedIn && auth.userId && auth.sessionId ? { userId: auth.userId, sessionId: auth.sessionId } : null };
  const [sdk] = useState<InstalledSdk>(() => createInstalledHelperSdk());
  const [owner] = useState(() => new DeviceHelperSetupOwner(sdk, () => publish(value => value + 1), intent.buffers));
  owner.bind(frame); // Render intent revokes stale private views before layout.
  const installationGeneration = sdk.generation();
  const resource = (typeof window === "undefined" ? null : window.Clerk) as Resource | null | undefined;
  useLayoutEffect(() => { owner.attach(); const unsubscribe = sdk.subscribe(() => owner.observeSdk());
    return () => { unsubscribe(); owner.detach(); }; }, [owner, resource, sdk, installationGeneration]);
  const read: ReadSetupAccess = input => utils.deviceCaptureAccess.read.fetch(input, { staleTime: 0 });
  const bootstrap: Bootstrap = input => utils.deviceHelperSetupAccess.establishCurrent.fetch(input, { staleTime: 0 });
  const guarded = (action: () => Promise<void>) => owner.matches(frame) ? action() : Promise.resolve();
  return { view: owner.view(), healthAvailable: !!health,
    review: () => guarded(() => owner.review(bootstrap, read)), checkPaired: () => guarded(() => owner.check(read, health)),
    reportBlocked: () => { if (owner.matches(frame)) owner.reportBlocked(); } };
}
