"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { downloadFile } from "@/lib/download";
import { DeviceHelperBlockedLaunchGuidance } from "@/components/DeviceHelperBlockedLaunchGuidance";
import { DeviceHelperSetupStatus } from "@/components/DeviceHelperSetupStatus";
import {
  buildDeviceConnectorLauncher,
  createDeviceConnectorPairingCode,
  detectDeviceConnectorPlatform,
  type DeviceConnectorPlatform,
} from "@/lib/deviceConnectorLauncher";
import { createDeviceConnectionGeneration, revokeDeviceConnection, beginDeviceConnection, currentDeviceConnection, registerDeviceConnectionRequest } from "@/lib/device-connector-connection";
import { DEVICE_HELPER_HEALTH_URL, deviceHelperHealthResponseRefusal, readDeviceHelperHealthResponse } from "@/lib/device-helper-health-response";
import { createInstalledHelperSdk } from "@/lib/use-device-helper-setup";
import { DeviceCapturePublicationOwner, capturePublicationRefusal, type CapturePublicationFrame } from "@/lib/device-capture-publication-lease";
import { captureJsonContentCost, fitsCaptureRetainedContent, retainCaptureJson } from "@/lib/device-capture-ownership";
import { ownedDeviceSemanticCapture } from "../../../../../api/src/services/deviceCaptureAccessSchema";
import { canEditProject } from "@/lib/membership";
import {
  trpcReact,
  useReadOnlySeat,
  type RouterInputs,
  type RouterOutputs,
} from "@/lib/trpcReact";

type Draft = RouterOutputs["liveAppGeneration"]["generateFromUrl"][number];
type DeviceCapture =
  RouterInputs["liveAppGeneration"]["generateFromDeviceCapture"]["capture"];
type CaptureMode = "web" | "android" | "ios-connected" | "ios-remote";
type ConnectorStatus = "idle" | "connecting" | "connected" | "blocked";
type AndroidDevice = {
  id: string;
  name: string;
  status: string;
  ready: boolean;
};

const CONNECTOR_URL = "http://127.0.0.1:4774";
const CAPTURE_DISPATCH_GAP = "Device capture is unavailable: this helper has no implemented foreground-app verification or scoped capture/processing-consent admission. Paired liveness and workspace metadata do not grant that permission. No device request was made; existing values are retained.";
type CaptureClientScope = Readonly<{ projectId: string; organizationId: string; clerkActorId: string; sessionId: string; sdkGeneration: number; uiEpoch: number; connectionEpoch: number; mode: CaptureMode }>;
type RetainedLiveValue = Readonly<{ scope: CaptureClientScope; kind: "CAPTURE" | "DRAFTS" | "FILE_TEXT" | "COMMIT_LABEL"; value: unknown; cost: { bytes: number; nodes: number } }>;
type ScopedCommitLabel = Readonly<{ scope: CaptureClientScope; label: Readonly<{ title: string }> }>;
type CapturePageOwnership = { sdkInstalled: boolean; sdkIdentity: string; observers: Set<() => void>; epoch: number; connectionEpoch: number;
  read: { projectId: string; organizationId: string | undefined; actor: ReturnType<typeof useAuth>; helperActorAllowed: boolean; captureMode: CaptureMode; startUrl: string; screenLabel: string; deviceSerial: string; appiumUrl: string; appiumSessionId: string; pairingCode: string };
  owner: DeviceCapturePublicationOwner | null; captureScope: CaptureClientScope | null; draftScope: CaptureClientScope | null; currentDrafts: readonly Draft[] | null; retained: RetainedLiveValue[]; commitLabels: ScopedCommitLabel[];
  importIntent: number; generationIntent: number; commitIntent: number; generateBusy: boolean; commitBusy: boolean };
/** Imperative mounted ownership, separate from React presentation state. */
class LiveCapturePageOwnership {
  private state: CapturePageOwnership;
  constructor(read: CapturePageOwnership["read"]) { this.state = { sdkInstalled: false, sdkIdentity: "", observers: new Set(), epoch: 0, connectionEpoch: 0,
    read, owner: null, captureScope: null, draftScope: null, currentDrafts: null, retained: [], commitLabels: [], importIntent: 0, generationIntent: 0, commitIntent: 0, generateBusy: false, commitBusy: false }; }
  get read() { return this.state.read; } get sdkInstalled() { return this.state.sdkInstalled; } get sdkIdentity() { return this.state.sdkIdentity; }
  get epoch() { return this.state.epoch; } get connectionEpoch() { return this.state.connectionEpoch; } get observers() { return this.state.observers; }
  get owner() { return this.state.owner; } get captureScope() { return this.state.captureScope; } get draftScope() { return this.state.draftScope; }
  get retained() { return this.state.retained; } get importIntent() { return this.state.importIntent; } get generationIntent() { return this.state.generationIntent; }
  get commitLabels() { return this.state.commitLabels; }
  get currentDrafts() { return this.state.currentDrafts; }
  get commitIntent() { return this.state.commitIntent; } get generateBusy() { return this.state.generateBusy; } get commitBusy() { return this.state.commitBusy; }
  bind(read: CapturePageOwnership["read"]) { this.state.read = read; }
  bindDrafts(drafts: readonly Draft[] | null) { this.state.currentDrafts = drafts; }
  setInstalled(value: boolean) { this.state.sdkInstalled = value; }
  setConnectionEpoch(value: number) { this.state.connectionEpoch = value; }
  sdkChanged(identity: string) { if (identity === this.state.sdkIdentity) return false; this.state.sdkIdentity = identity; this.invalidate(); return true; }
  invalidate() { this.state.epoch++; this.state.owner?.update(null); }
  updateInput(patch: Partial<CapturePageOwnership["read"]>) { this.invalidate(); this.state.read = { ...this.state.read, ...patch }; }
  setOwner(owner: DeviceCapturePublicationOwner) { this.state.owner = owner; }
  setCaptureScope(scope: CaptureClientScope) { this.state.captureScope = scope; }
  setDraftScope(scope: CaptureClientScope) { this.state.draftScope = scope; }
  beginImport() { return ++this.state.importIntent; }
  beginGeneration() { this.state.generateBusy = true; return ++this.state.generationIntent; }
  settleGeneration() { this.state.generateBusy = false; }
  beginCommit() { this.state.commitBusy = true; return ++this.state.commitIntent; }
  settleCommit() { this.state.commitBusy = false; }
}

// SSE-181: deliberately its own page, not folded into /reverse-engineer or
// the shared /test-cases/review queue - there's no prior test to diff a
// live-app-generated draft against, which is a real difference a reviewer
// should see, not just a label. Visibly marked EXPERIMENTAL (dashed
// var(--ember) border, not the calm var(--line) panels used elsewhere)
// since server-side browser automation against a caller-supplied URL is a
// genuinely new, unproven capability behind a tight allowlist - see
// trpc.ts's liveAppScanProcedure and its own comment. A temp UI, per
// explicit instruction, ahead of a real one once this proves out.
export default function LiveAppGenerationPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const readOnly = useReadOnlySeat(projectId);
  const actor = useAuth();
  const [pairingOrigin, setPairingOrigin] = useState<{ projectId: string; organizationId: string; clerkActorId: string } | null>(null);
  const helperAuthReady = actor.isLoaded && !!actor.isSignedIn && !!actor.userId && !!actor.sessionId;
  const helperProject = trpcReact.project.byId.useQuery({ id: projectId }, { enabled: helperAuthReady, retry: false, staleTime: 0, refetchOnWindowFocus: false });
  const helperOrganizations = trpcReact.organization.mine.useQuery(undefined, { enabled: helperAuthReady, retry: false, staleTime: 0, refetchOnWindowFocus: false });
  const helperOrganizationId = helperProject.data?.id === projectId ? helperProject.data.organizationId : undefined;
  const helperMember = helperOrganizations.data?.find(organization => organization.id === helperOrganizationId);
  const helperReadFresh = helperAuthReady && !helperProject.error && !helperProject.isFetching && !helperProject.isPaused && helperProject.isFetchedAfterMount && helperProject.data?.id === projectId && !helperOrganizations.error && !helperOrganizations.isFetching && !helperOrganizations.isPaused && helperOrganizations.isFetchedAfterMount && !!helperOrganizationId;
  const eligibleActor = helperReadFresh && !readOnly && canEditProject(helperMember);
  const helperActorAllowed = eligibleActor && (!pairingOrigin || pairingOrigin.projectId === projectId && pairingOrigin.organizationId === helperOrganizationId && pairingOrigin.clerkActorId === actor.userId);

  const [captureMode, setCaptureMode] = useState<CaptureMode>("web");
  const [startUrl, setStartUrl] = useState("");
  const [deviceCapture, setDeviceCapture] = useState<DeviceCapture | null>(
    null,
  );
  const [connectorStatus, setConnectorStatus] =
    useState<ConnectorStatus>("idle");
  const [pairingCode, setPairingCode] = useState("");
  const [connectorPlatform, setConnectorPlatform] =
    useState<DeviceConnectorPlatform>("windows");
  const [androidDevices, setAndroidDevices] = useState<AndroidDevice[]>([]);
  const [discoveringDevices, setDiscoveringDevices] = useState(false);
  const [screenLabel, setScreenLabel] = useState("");
  const [deviceSerial, setDeviceSerial] = useState("");
  const [appiumUrl, setAppiumUrl] = useState("http://127.0.0.1:4723");
  const [appiumSessionId, setAppiumSessionId] = useState("");
  const [capturing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<readonly Draft[] | null>(null);
  const [scannedUrl, setScannedUrl] = useState<string | null>(null);
  const [committedTitles] = useState<string[]>([]);
  // Legacy labels have no original scope attribution. Retain them privately;
  // a later eligible draft must never reveal or relabel that historical list.
  void committedTitles;
  const [busyIndex, setBusyIndex] = useState<number | null>(null);
  const connectionAttemptRef = useRef(createDeviceConnectionGeneration());
  const discoveryAttemptRef = useRef(0);
  const [manualSetupOpen, setManualSetupOpen] = useState(false);
  const [manualSetupRevealed, setManualSetupRevealed] = useState(false);
  const [helperMetadataCancellationEpoch, setHelperMetadataCancellationEpoch] = useState(0);
  const [captureSdk] = useState(() => createInstalledHelperSdk());
  const [, setCaptureSdkRevision] = useState(0);
  const [capturePage] = useState(() => new LiveCapturePageOwnership({ projectId, organizationId: helperOrganizationId, actor, helperActorAllowed, captureMode, startUrl, screenLabel, deviceSerial, appiumUrl, appiumSessionId, pairingCode }));
  capturePage.bind({ projectId, organizationId: helperOrganizationId, actor, helperActorAllowed, captureMode, startUrl, screenLabel, deviceSerial, appiumUrl, appiumSessionId, pairingCode });
  capturePage.bindDrafts(drafts);
  function currentCaptureClientScope(): CaptureClientScope | null {
    const read = capturePage.read, sdkSession = captureSdk.current();
    if (!capturePage.sdkInstalled || !read.helperActorAllowed || !read.organizationId || !read.actor.isLoaded || !read.actor.isSignedIn ||
      !read.actor.userId || !read.actor.sessionId || sdkSession?.userId !== read.actor.userId || sdkSession.sessionId !== read.actor.sessionId) return null;
    return { projectId: read.projectId, organizationId: read.organizationId, clerkActorId: read.actor.userId, sessionId: read.actor.sessionId,
      sdkGeneration: captureSdk.generation(), uiEpoch: capturePage.epoch, connectionEpoch: connectionAttemptRef.current.epoch, mode: read.captureMode };
  }
  function ownsCaptureClientScope(scope: CaptureClientScope | null): boolean { const current = currentCaptureClientScope(); return !!scope && !!current && JSON.stringify(scope) === JSON.stringify(current); }
  function captureInputFrameKey(): string { const read = capturePage.read; return JSON.stringify([read.projectId, read.organizationId, read.captureMode,
    read.startUrl, read.screenLabel, read.deviceSerial, read.appiumUrl, read.appiumSessionId, read.pairingCode]); }
  function updateCaptureInput(patch: Partial<Pick<typeof capturePage.read, "captureMode" | "startUrl" | "screenLabel" | "deviceSerial" | "appiumUrl" | "appiumSessionId">>) {
    if (!currentCaptureClientScope()) return;
    capturePage.updateInput(patch);
    if (patch.captureMode !== undefined) setCaptureMode(patch.captureMode);
    if (patch.startUrl !== undefined) setStartUrl(patch.startUrl);
    if (patch.screenLabel !== undefined) setScreenLabel(patch.screenLabel);
    if (patch.deviceSerial !== undefined) setDeviceSerial(patch.deviceSerial);
    if (patch.appiumUrl !== undefined) setAppiumUrl(patch.appiumUrl);
    if (patch.appiumSessionId !== undefined) setAppiumSessionId(patch.appiumSessionId);
  }
  function retainLiveValue<T>(scope: CaptureClientScope, kind: RetainedLiveValue["kind"], value: T): Readonly<T> | null {
    try {
      const cost = captureJsonContentCost({ scope, kind, value });
      if (capturePage.retained.length >= 100 || !fitsCaptureRetainedContent([...capturePage.retained.map(item => item.cost), cost])) return null;
      const copy = retainCaptureJson(value); capturePage.retained.push({ scope, kind, value: copy, cost }); return copy;
    } catch { return null; }
  }
  function currentCaptureFrame(): CapturePublicationFrame | null {
    const scope = currentCaptureClientScope(), read = capturePage.read;
    if (!scope || scope.mode === "web") return null;
    return { origin: { projectId: scope.projectId, organizationId: scope.organizationId, clerkActorId: scope.clerkActorId },
      active: currentDeviceConnection(connectionAttemptRef.current, scope.connectionEpoch), readable: read.helperActorAllowed,
      session: { userId: scope.clerkActorId, sessionId: scope.sessionId }, connection: { epoch: scope.connectionEpoch, pairingCode: read.pairingCode },
      selection: scope.mode === "android" ? { mode: scope.mode, serial: read.deviceSerial } : { mode: scope.mode, appiumUrl: read.appiumUrl, appiumSessionId: read.appiumSessionId }, screenLabel: read.screenLabel };
  }
  // Independent installed SDK listener, not the metadata card's cached view.
  // Revoke publication before any cleanup/reentrant listener or next paint.
  const captureSdkResource = typeof window === "undefined" ? null : window.Clerk;
  useLayoutEffect(() => {
    const connection = connectionAttemptRef.current;
    revokeDeviceConnection(connection, { active: helperActorAllowed });
    capturePage.setConnectionEpoch(connection.epoch);
    // Revoke requests and stale/private setup display before the next paint.
    setConnectorStatus(current => current === "blocked" ? "blocked" : "idle");
    setDiscoveringDevices(false); setManualSetupOpen(false); setManualSetupRevealed(false);
    return () => { revokeDeviceConnection(connection, { active: false }); capturePage.setConnectionEpoch(connection.epoch); };
  }, [capturePage, projectId, captureMode, pairingCode, readOnly, actor.isLoaded, actor.isSignedIn, actor.userId, actor.sessionId, helperReadFresh, helperOrganizationId, helperActorAllowed]);
  useLayoutEffect(() => {
    capturePage.setInstalled(true);
    const observe = () => {
      const identity = JSON.stringify({ generation: captureSdk.generation(), session: captureSdk.current() });
      if (!capturePage.sdkChanged(identity)) return;
      capturePage.observers.forEach(callback => callback());
      revokeDeviceConnection(connectionAttemptRef.current, { active: helperActorAllowed });
      capturePage.setConnectionEpoch(connectionAttemptRef.current.epoch);
      setCaptureSdkRevision(value => value + 1);
    };
    const unsubscribe = captureSdk.subscribe(observe); observe();
    return () => { capturePage.setInstalled(false); capturePage.invalidate(); capturePage.observers.forEach(callback => callback()); unsubscribe(); };
  }, [capturePage, captureSdk, captureSdkResource, helperActorAllowed]);

  useEffect(() => {
    if (!eligibleActor || pairingOrigin || pairingCode) return;
    const initialize = window.setTimeout(() => {
      if (!connectionAttemptRef.current.active) return;
      setPairingOrigin({ projectId, organizationId: helperOrganizationId!, clerkActorId: actor.userId! });
      setPairingCode(createDeviceConnectorPairingCode());
      setConnectorPlatform(detectDeviceConnectorPlatform(navigator.userAgent));
    }, 0);
    return () => window.clearTimeout(initialize);
  }, [eligibleActor, projectId, helperOrganizationId, actor.userId, actor.sessionId, pairingOrigin, pairingCode]);

  const generateMutation =
    trpcReact.liveAppGeneration.generateFromUrl.useMutation();
  const generateDeviceMutation =
    trpcReact.liveAppGeneration.generateFromDeviceCapture.useMutation();
  const commitMutation = trpcReact.liveAppGeneration.commitDraft.useMutation();

  async function generate() {
    const scope = currentCaptureClientScope();
    if (!scope || capturePage.generateBusy) return;
    const mode = scope.mode, url = capturePage.read.startUrl, captured = deviceCapture;
    if (mode !== "web" && (!captured || !ownsCaptureClientScope(capturePage.captureScope))) return;
    const intent = capturePage.beginGeneration();
    setGenerating(true);
    setError(null);
    // Presentation retention only. Existing paid mutation/receipt/recovery
    // contracts are unchanged and are NOT cleared by a client scope guard.
    try {
      const res =
        mode === "web"
          ? await generateMutation.mutateAsync({ projectId: scope.projectId, startUrl: url })
          : await generateDeviceMutation.mutateAsync({
              projectId: scope.projectId,
              capture: captured as DeviceCapture,
            });
      const retained = retainLiveValue(scope, "DRAFTS", res);
      if (!retained) {
        if (ownsCaptureClientScope(scope) && capturePage.generationIntent === intent) setError("The complete generated result could not be retained. Earlier drafts remain private; no retry or paid outcome was inferred.");
        return;
      }
      if (!ownsCaptureClientScope(scope) || capturePage.generationIntent !== intent) return;
      capturePage.setDraftScope(scope);
      setDrafts(previous => ownsCaptureClientScope(scope) && capturePage.generationIntent === intent ? retained : previous);
      setScannedUrl(previous => ownsCaptureClientScope(scope) && capturePage.generationIntent === intent ? mode === "web" ? url : `${captured?.appName ?? "App"} on ${captured?.deviceName ?? "device"}` : previous);
    } catch {
      if (ownsCaptureClientScope(scope) && capturePage.generationIntent === intent) setError("Generation did not return a confirmed current result. Earlier drafts remain retained; paid request recovery is not implemented by this presentation guard.");
    } finally {
      capturePage.settleGeneration();
      setGenerating(previous => ownsCaptureClientScope(scope) && capturePage.generationIntent === intent ? false : previous);
    }
  }

  async function selectCapture(file: File | undefined) {
    const scope = currentCaptureClientScope(), intent = capturePage.beginImport();
    if (!scope) return;
    const inputFrame = captureInputFrameKey();
    setError(null);
    if (!file) return;
    try {
      if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > 8388608) throw Error("unsupported");
      const text = await file.text();
      if (!retainLiveValue(scope, "FILE_TEXT", text)) throw Error("unsupported");
      const raw: unknown = JSON.parse(text); captureJsonContentCost(raw);
      const parsed = ownedDeviceSemanticCapture.safeParse(raw); if (!parsed.success) throw Error("unsupported");
      const capture = parsed.data;
      const expectedSource =
        scope.mode === "android"
          ? "ANDROID_ADB"
          : scope.mode === "ios-connected"
            ? "IOS_CONNECTED"
            : "IOS_REMOTE";
      const retained = retainLiveValue(scope, "CAPTURE", capture);
      if (scope.mode === "web" || capture.source !== expectedSource || !retained) throw Error("unsupported");
      if (!ownsCaptureClientScope(scope) || capturePage.importIntent !== intent || inputFrame !== captureInputFrameKey()) return;
      capturePage.setCaptureScope(scope);
      setDeviceCapture(previous => ownsCaptureClientScope(scope) && capturePage.importIntent === intent && inputFrame === captureInputFrameKey() ? retained : previous);
    } catch {
      if (ownsCaptureClientScope(scope) && capturePage.importIntent === intent && inputFrame === captureInputFrameKey()) setError("The complete selected capture file was refused or unavailable. Previous captures/drafts remain retained. This does not verify foreground targeting or approve AI processing.");
    }
  }

  async function connectorRequest<T>(
    path: string,
    init?: RequestInit,
    timeoutMs = 8_000,
    attempt?: number,
  ) {
    const controller = new AbortController();
    const release = attempt === undefined ? () => undefined : registerDeviceConnectionRequest(connectionAttemptRef.current, attempt, controller);
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${CONNECTOR_URL}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          "x-vaettir-pairing-code": pairingCode.trim().toUpperCase(),
          ...init?.headers,
        },
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      } & T;
      if (attempt !== undefined && !currentDeviceConnection(connectionAttemptRef.current, attempt)) throw new DOMException("Connection request was superseded.", "AbortError");
      if (!response.ok) {
        throw new Error("The local helper request did not return a confirmed result. The response body was not exposed; any local operation outcome remains unverified.");
      }
      return payload;
    } finally {
      release();
      window.clearTimeout(timeout);
    }
  }

  async function discoverAndroidDevices(attempt = connectionAttemptRef.current.epoch) {
    if (!currentDeviceConnection(connectionAttemptRef.current, attempt)) return [];
    const discovery = ++discoveryAttemptRef.current;
    setDiscoveringDevices(true);
    try {
      const response = await connectorRequest<{ devices: AndroidDevice[] }>(
        "/devices?source=android",
        undefined, 8_000, attempt,
      );
      if (!currentDeviceConnection(connectionAttemptRef.current, attempt) || discovery !== discoveryAttemptRef.current) return [];
      setAndroidDevices(response.devices);
      // Discovery is not the user's target selection, even for one device.
      return response.devices;
    } catch (cause) {
      if (!currentDeviceConnection(connectionAttemptRef.current, attempt) || discovery !== discoveryAttemptRef.current) return [];
      throw cause;
    } finally {
      if (currentDeviceConnection(connectionAttemptRef.current, attempt) && discovery === discoveryAttemptRef.current) setDiscoveringDevices(false);
    }
  }

  async function connectToDeviceConnector() {
    if (!helperActorAllowed) return;
    const attempt = beginDeviceConnection(connectionAttemptRef.current);
    if (attempt === null) return;
    capturePage.setConnectionEpoch(attempt);
    setDiscoveringDevices(false); setManualSetupOpen(false); setManualSetupRevealed(false);
    setConnectorStatus("connecting");
    setError(null);
    const controller = new AbortController();
    const release = registerDeviceConnectionRequest(connectionAttemptRef.current, attempt, controller);
    const timeout = window.setTimeout(() => controller.abort(), 8_000);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await fetch(DEVICE_HELPER_HEALTH_URL, {
        signal: controller.signal, redirect: "error", credentials: "omit", cache: "no-store",
        headers: { "x-vaettir-pairing-code": pairingCode.trim().toUpperCase() },
      });
      if (!currentDeviceConnection(connectionAttemptRef.current, attempt)) return;
      reader = response.body?.getReader();
      if (!reader) throw Error(deviceHelperHealthResponseRefusal);
      const nativeReader = reader;
      await readDeviceHelperHealthResponse({
        url: response.url, status: response.status, redirected: response.redirected,
        contentType: response.headers.get("content-type"), contentLength: response.headers.get("content-length"),
      }, { read: () => nativeReader.read(), cancel: () => nativeReader.cancel() }, controller.signal,
      () => currentDeviceConnection(connectionAttemptRef.current, attempt));
      if (!currentDeviceConnection(connectionAttemptRef.current, attempt)) return;
      // Exact v2 is paired liveness only. Do not discover or select a device,
      // retry, upload or infer capture/processing permission from this reply.
      setConnectorStatus("connected");
    } catch {
      if (!currentDeviceConnection(connectionAttemptRef.current, attempt)) return;
      setConnectorStatus("idle");
      setError(deviceHelperHealthResponseRefusal);
    } finally {
      try { reader?.releaseLock(); } catch { /* Cancellation may still be settling. */ }
      release(); window.clearTimeout(timeout);
    }
  }

  function downloadConnectorLauncher() {
    if (!helperActorAllowed || !connectionAttemptRef.current.active) return;
    try {
      const launcher = buildDeviceConnectorLauncher({
        platform: connectorPlatform,
        origin: window.location.origin,
        pairingCode,
      });
      downloadFile(launcher.filename, launcher.content, launcher.mimeType);
      // Download prepares a local file only: no automatic health requests,
      // retries, discovery, target selection or authority changes.
    } catch {
      setError("The unsigned helper could not be prepared. Launch and device access remain unverified.");
    }
  }

  function cancelHelperSetupChecks() {
    // The metadata surface revokes its own owner before invoking this bridge.
    // Abort this page's health/discovery too, without attributing retained
    // captures or paid drafts to a newly reviewed identity or claiming they stopped.
    revokeDeviceConnection(connectionAttemptRef.current, { blocked: true });
    capturePage.setConnectionEpoch(connectionAttemptRef.current.epoch);
    discoveryAttemptRef.current++;
    setHelperMetadataCancellationEpoch(current => current + 1);
    setConnectorStatus("blocked"); setDiscoveringDevices(false); setError(null);
    setManualSetupOpen(false); setManualSetupRevealed(false);
    // Pairing and selected capture drafts are deliberately retained privately.
    // Reporting an OS refusal never runs a command or changes security policy.
  }
  function reportBlockedWindowsHelper() {
    if (connectorPlatform !== "windows" || capturing || generating) return;
    cancelHelperSetupChecks();
  }
  function showPolicyPermittedManualSetup() { if (!helperActorAllowed || !connectionAttemptRef.current.active) return; setManualSetupRevealed(true); setManualSetupOpen(true); }
  async function refreshAndroidDevices() {
    const attempt = connectionAttemptRef.current.epoch;
    if (!helperActorAllowed || connectorStatus !== "connected" || !currentDeviceConnection(connectionAttemptRef.current, attempt)) return;
    setError(null);
    try { await discoverAndroidDevices(attempt); }
    catch { if (currentDeviceConnection(connectionAttemptRef.current, attempt)) setError("Device discovery did not return a confirmed current list. Previous device choices remain retained; no target permission was inferred."); }
  }

  async function captureCurrentScreen() {
    const scope = currentCaptureClientScope(), frame = currentCaptureFrame();
    if (!scope || !frame) return;
    if (!capturePage.owner) {
      const sdk = { current: () => capturePage.sdkInstalled ? captureSdk.current() : null, generation: () => captureSdk.generation(),
        subscribe: (observe: () => void) => { capturePage.observers.add(observe); return () => { capturePage.observers.delete(observe); }; } };
      try { capturePage.setOwner(new DeviceCapturePublicationOwner(frame.origin, sdk, currentCaptureFrame,
        [deviceCapture, drafts].filter(value => value !== null))); } catch { setError(capturePublicationRefusal); return; }
    }
    capturePage.owner?.update(frame);
    // The v2 helper/access DTOs explicitly provide no foreground-target or
    // scoped processing-consent admission. Do NOT fabricate a boolean grant,
    // infer it from a connection/read, or dispatch merely to test the lease.
    // Actual native target/consent proof is a separate required cutover gate.
    setError(previous => ownsCaptureClientScope(scope) ? CAPTURE_DISPATCH_GAP : previous);
  }

  async function commit(index: number) {
    const draft = drafts?.[index];
    const scope = currentCaptureClientScope(), originalDrafts = drafts;
    if (!draft || !scope || !ownsCaptureClientScope(capturePage.draftScope) || capturePage.currentDrafts !== originalDrafts || capturePage.commitBusy || capturePage.commitLabels.length >= 100 || !retainLiveValue(scope, "DRAFTS", originalDrafts)) return;
    const label = retainLiveValue(scope, "COMMIT_LABEL", { title: draft.title });
    if (!label) return;
    const intent = capturePage.beginCommit();
    setBusyIndex(index);
    setError(null);
    try {
      await commitMutation.mutateAsync({ projectId: scope.projectId, ...draft });
      if (ownsCaptureClientScope(scope) && capturePage.commitIntent === intent && capturePage.currentDrafts === originalDrafts) capturePage.commitLabels.push({ scope, label });
      setDrafts(prev => ownsCaptureClientScope(scope) && capturePage.commitIntent === intent && prev === originalDrafts ? prev?.filter(value => value !== draft) ?? prev : prev);
    } catch {
      if (ownsCaptureClientScope(scope) && capturePage.commitIntent === intent) setError("Saving did not return a confirmed current response. The original draft remains retained; this guard does not supply paid/native request recovery.");
    } finally {
      capturePage.settleCommit();
      setBusyIndex(previous => ownsCaptureClientScope(scope) && capturePage.commitIntent === intent ? null : previous);
    }
  }

  function discard(index: number) {
    const scope = currentCaptureClientScope(), original = drafts;
    if (!scope || !ownsCaptureClientScope(capturePage.draftScope) || !original || !retainLiveValue(scope, "DRAFTS", original)) return;
    setDrafts(previous => ownsCaptureClientScope(scope) && previous === original ? previous.filter((_, i) => i !== index) : previous);
  }

  const presentationSession = captureSdk.current();
  const presentationScope: CaptureClientScope | null = capturePage.sdkInstalled && helperActorAllowed && helperOrganizationId && actor.userId && actor.sessionId &&
    presentationSession?.userId === actor.userId && presentationSession.sessionId === actor.sessionId ?
    { projectId, organizationId: helperOrganizationId, clerkActorId: actor.userId, sessionId: actor.sessionId, sdkGeneration: captureSdk.generation(),
      uiEpoch: capturePage.epoch, connectionEpoch: capturePage.connectionEpoch, mode: captureMode } : null;
  const captureInputsAllowed = presentationScope !== null;
  const presentedCapture = presentationScope && JSON.stringify(presentationScope) === JSON.stringify(capturePage.captureScope) ? deviceCapture : null;
  const presentedDrafts = presentationScope && JSON.stringify(presentationScope) === JSON.stringify(capturePage.draftScope) ? drafts : null;
  const presentedScannedUrl = presentedDrafts ? scannedUrl : null;
  const presentedCommittedTitles = presentationScope ? capturePage.commitLabels.filter(entry => JSON.stringify(entry.scope) === JSON.stringify(presentationScope)).map(entry => entry.label.title) : [];

  return (
    <div>
      <h1>Generate test cases from a live app</h1>
      <div
        style={{
          display: "inline-block",
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: 0.5,
          textTransform: "uppercase",
          color: "var(--ember)",
          border: "1px dashed var(--ember)",
          borderRadius: 999,
          padding: "2px 10px",
          marginBottom: 12,
        }}
      >
        Experimental — early access
      </div>
      <p>
        Observe a web app or capture a real Android/iOS screen, then draft BDD
        test cases grounded in the controls that were actually present. Nothing
        is saved until you review each draft.
      </p>

      <DeviceHelperSetupStatus
        intent={{
          kind: "CURRENT_METADATA_ONLY",
          projectId,
          originalOrganizationId: helperOrganizationId ?? "",
          active: helperReadFresh,
          connectionEpoch: helperMetadataCancellationEpoch,
          reportedBlocked: connectorStatus === "blocked",
        }}
        onReportedBlocked={cancelHelperSetupChecks}
      />

      {readOnly && (
        <p className="text-muted" style={{ fontSize: 13 }}>
          You have read-only access to this organization — generating test cases
          is hidden.
        </p>
      )}

      {!readOnly && (
        <>
          <div className="tab-bar" style={{ marginTop: 16 }}>
            {(
              [
                ["web", "Web URL"],
                ["android", "Android / ADB"],
                ["ios-connected", "Connected iOS"],
                ["ios-remote", "Remote iOS"],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                className={captureMode === mode ? "active" : ""}
                onClick={() => updateCaptureInput({ captureMode: mode })}
              >
                {label}
              </button>
            ))}
          </div>
          <div
            style={{
              display: "grid",
              gap: 8,
              maxWidth: 720,
              border: "1px dashed var(--ember)",
              borderRadius: 8,
              padding: 16,
              margin: "16px 0",
            }}
          >
            {captureMode === "web" ? (
              <label>
                Start URL{" "}
                <span style={{ color: "var(--muted-dim)" }}>
                  (public http/https only - private and internal addresses are
                  rejected)
                </span>
                <input
                  value={captureInputsAllowed ? startUrl : ""}
                  disabled={!captureInputsAllowed}
                  onChange={(event) => updateCaptureInput({ startUrl: event.target.value })}
                  placeholder="https://your-staging-app.example.com"
                  style={{ width: "100%" }}
                />
              </label>
            ) : (
              <>
                <div style={{ display: "grid", gap: 16 }}>
                  <div>
                    <strong>
                      {captureMode === "android"
                        ? "Capture Android screens directly from this page"
                        : captureMode === "ios-connected"
                          ? "Capture a connected iPhone or iPad from this page"
                          : "Capture an active remote iOS device session"}
                    </strong>
                    <p
                      className="text-muted"
                      style={{ fontSize: 13, margin: "6px 0 0" }}
                    >
                      A small connector runs on the computer attached to the
                      device. Raw hierarchy, screenshots, and provider
                      credentials stay on that computer. Vaettir receives only
                      named controls such as buttons, fields, tabs, and labels.
                    </p>
                  </div>

                  <section
                    style={{
                      display: "grid",
                      gridTemplateColumns: "36px minmax(0, 1fr)",
                      gap: 12,
                      alignItems: "start",
                    }}
                  >
                    <span className="metric-icon frost" aria-hidden="true">
                      1
                    </span>
                    <div style={{ display: "grid", gap: 10 }}>
                      <strong>Check this computer&apos;s helper</strong>
                      <p
                        className="text-muted"
                        style={{ fontSize: 13, margin: 0 }}
                      >
                        Download an unsigned launcher script and open it only
                        if your device policy permits. Pairing is
                        already built in. Downloading makes no helper requests.
                        After opening it, explicitly check for a paired response.
                        This is an unsigned script;
                        your organization may block it. It does not require
                        administrator access or changes to security protection.
                        Downloading is not proof of launch, signing, device
                        access or capture.
                        It requires{" "}
                        {captureMode === "android"
                          ? "Node 22 and ADB"
                          : captureMode === "ios-connected"
                            ? "Node 22 on macOS, Xcode, Appium, and WebDriverAgent"
                            : "Node 22 and an active Appium-compatible provider session"}
                        .
                      </p>
                      <div
                        style={{ display: "flex", flexWrap: "wrap", gap: 8 }}
                      >
                        <button
                          type="button"
                          onClick={downloadConnectorLauncher}
                          disabled={
                            !helperActorAllowed || !pairingCode || connectorStatus === "connecting"
                          }
                        >
                          Download{" "}
                          {connectorPlatform === "windows"
                            ? "Windows"
                            : connectorPlatform === "macos"
                              ? "macOS"
                              : "Linux"}{" "}
                          unsigned launcher
                        </button>
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => void connectToDeviceConnector()}
                          disabled={
                            !helperActorAllowed || !pairingCode || connectorStatus === "connecting"
                          }
                        >
                          {connectorStatus === "connected"
                            ? "Recheck paired response"
                            : "Check paired response"}
                        </button>
                        {connectorPlatform === "windows" && <button type="button" className="btn-secondary" onClick={reportBlockedWindowsHelper} disabled={capturing || generating}>Windows blocked this helper</button>}
                      </div>
                      <div
                        className={`status-panel ${
                          connectorStatus === "connected" ? "success" : ""
                        }`}
                        role="status"
                      >
                        <strong>
                          {connectorStatus === "connected"
                            ? "Paired helper response received (v2)"
                            : connectorStatus === "connecting"
                              ? "Waiting for a paired helper response..."
                              : connectorStatus === "blocked"
                                ? "Windows launch blocked (reported by you)"
                              : "Paired response not verified"}
                        </strong>
                        <span>
                          {connectorStatus === "connected"
                            ? "This is liveness only, not launch acceptance, foreground app isolation, device selection or capture/processing permission. Device discovery and target selection require separate explicit actions."
                            : connectorStatus === "connecting"
                              ? "One bounded paired-response check is in progress, with no automatic retry or device discovery. Launch and device access remain unverified."
                              : connectorStatus === "blocked"
                                ? "This page stopped waiting and canceled its health/discovery requests. Already started local discovery may finish; its results are ignored. The blocking policy or product remains unverified."
                              : "Downloading does not start checks or discover devices. Open the reviewed launcher only if policy permits, then choose Check paired response."}
                        </span>
                      </div>
                      {!captureInputsAllowed && <p role="status">Original independent session/project/workspace access is not current. Private pairing, selections, captures and paid drafts remain retained but hidden. Setup metadata and paired liveness do not approve device/source processing.</p>}
                      {connectorStatus === "blocked" && <div role="status"><DeviceHelperBlockedLaunchGuidance reportedBlocked={true} /><p>Your private pairing draft remains retained. Reporting this did not launch a helper, change policy or perform device capture. Signed trusted distribution and actual Windows/device acceptance remain separate.</p><button type="button" className="btn-secondary" onClick={showPolicyPermittedManualSetup}>Show manual instructions only if policy permits</button></div>}
                      <details open={manualSetupOpen} onToggle={event => setManualSetupOpen(event.currentTarget.open)}>
                        <summary>Manual setup and troubleshooting</summary>
                        <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                          {!captureInputsAllowed || connectorStatus === "blocked" && !manualSetupRevealed ? <p>Pairing code and private setup command are hidden. Restore the original account/full seat and review device policy first, then explicitly choose “Show manual instructions only if policy permits.” This alternative is not a bypass or permission grant.</p> : <>
                          <span className="text-muted" style={{ fontSize: 13 }}>
                            Pairing code:{" "}
                            <code>{pairingCode || "Preparing..."}</code>
                          </span>
                          <span className="text-muted" style={{ fontSize: 13 }}>
                            If Windows says it cannot access the helper, its
                            launch outcome remains unverified. Do not disable antivirus, add an
                            exclusion or run as administrator. Ask your security
                            administrator to review the blocked download. This
                            page cannot identify or override the blocking
                            policy.
                          </span>
                          <a
                            className="btn btn-secondary"
                            href="/connectors/vaettir-device-connector.mjs"
                            download="vaettir-device-connector.mjs"
                            style={{ width: "fit-content" }}
                          >
                            Download raw connector
                          </a>
                          <span className="text-muted" style={{ fontSize: 13 }}>
                            Manual alternative, only if your policy permits:
                            review the downloaded connector, then open a
                            terminal in its folder and run the command below
                            with Node 22 or newer. Adjust the filename if your
                            browser renamed it. Keep the terminal open and
                            choose Check paired response.
                          </span>
                          <code style={{ overflowWrap: "anywhere" }}>
                            {'node "vaettir-device-connector.mjs" --pairing-code '}
                            {pairingCode || "YOUR_PAIRING_CODE"}
                          </code>
                          <span className="text-muted" style={{ fontSize: 13 }}>
                            The pairing code is private. Do not share the
                            prepared helper or a screenshot of this code.
                            Capture and upload still require your selections on
                            this page.
                          </span>
                          </>}
                        </div>
                      </details>
                    </div>
                  </section>

                  <section
                    style={{
                      display: "grid",
                      gridTemplateColumns: "36px minmax(0, 1fr)",
                      gap: 12,
                      alignItems: "start",
                      opacity: connectorStatus === "connected" ? 1 : 0.55,
                    }}
                  >
                    <span className="metric-icon frost" aria-hidden="true">
                      2
                    </span>
                    <div style={{ display: "grid", gap: 8 }}>
                      <strong>Capture each important screen</strong>
                      {captureMode === "android" ? (
                        <div style={{ display: "grid", gap: 8 }}>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "end",
                              gap: 8,
                            }}
                          >
                            <label style={{ flex: 1 }}>
                              Android device
                              <select
                                value={captureInputsAllowed ? deviceSerial : ""}
                                onChange={(event) =>
                                  updateCaptureInput({ deviceSerial: event.target.value })
                                }
                                disabled={
                                  !captureInputsAllowed || connectorStatus !== "connected" ||
                                  discoveringDevices
                                }
                                style={{ width: "100%" }}
                              >
                                <option value="">
                                  {!captureInputsAllowed
                                    ? "Restore original account/project access"
                                    : discoveringDevices
                                    ? "Looking for devices..."
                                    : androidDevices.length === 0
                                      ? "No device found"
                                      : "Choose a device"}
                                </option>
                                {(captureInputsAllowed ? androidDevices : []).map((device) => (
                                  <option
                                    key={device.id}
                                    value={device.id}
                                    disabled={!device.ready}
                                  >
                                    {device.name}
                                    {device.ready ? "" : ` (${device.status})`}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <button
                              type="button"
                              className="btn-secondary"
                              onClick={() => void refreshAndroidDevices()}
                              disabled={
                                !captureInputsAllowed || connectorStatus !== "connected" ||
                                discoveringDevices
                              }
                            >
                              Refresh
                            </button>
                          </div>
                          {captureInputsAllowed && androidDevices.some(
                            (device) => device.status === "unauthorized",
                          ) && (
                            <span
                              className="text-muted"
                              style={{ fontSize: 13 }}
                            >
                              Unlock the device and accept its USB debugging
                              prompt, then refresh.
                            </span>
                          )}
                        </div>
                      ) : (
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns:
                              "repeat(auto-fit, minmax(220px, 1fr))",
                            gap: 8,
                          }}
                        >
                          <label>
                            Appium server
                            <input
                              value={captureInputsAllowed ? appiumUrl : ""}
                              onChange={(event) =>
                                updateCaptureInput({ appiumUrl: event.target.value })
                              }
                              placeholder={
                                captureMode === "ios-remote"
                                  ? "https://provider.example/wd/hub"
                                  : "http://127.0.0.1:4723"
                              }
                              disabled={!captureInputsAllowed || connectorStatus !== "connected"}
                              style={{ width: "100%" }}
                            />
                          </label>
                          <label>
                            Active session ID
                            <input
                              value={captureInputsAllowed ? appiumSessionId : ""}
                              onChange={(event) =>
                                updateCaptureInput({ appiumSessionId: event.target.value })
                              }
                              placeholder="Appium session ID"
                              disabled={!captureInputsAllowed || connectorStatus !== "connected"}
                              style={{ width: "100%" }}
                            />
                          </label>
                        </div>
                      )}
                      <label>
                        Screen name
                        <input
                          value={captureInputsAllowed ? screenLabel : ""}
                          onChange={(event) =>
                            updateCaptureInput({ screenLabel: event.target.value })
                          }
                          placeholder="For example: Sign in, Cart, Checkout"
                          disabled={!captureInputsAllowed || connectorStatus !== "connected"}
                          style={{ width: "100%" }}
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => void captureCurrentScreen()}
                        disabled={
                          !captureInputsAllowed ||
                          connectorStatus !== "connected" ||
                          capturing ||
                          (captureMode === "android" && !deviceSerial) ||
                          (captureMode !== "android" &&
                            (!appiumUrl.trim() || !appiumSessionId.trim()))
                        }
                      >
                        {capturing
                          ? "Capturing current screen…"
                          : "Capture current screen"}
                      </button>
                      <p role="status" className="text-muted">{CAPTURE_DISPATCH_GAP}</p>
                    </div>
                  </section>
                </div>
                {presentedCapture && (
                  <div className="status-panel success">
                    <strong>
                      {presentedCapture.deviceName}: {presentedCapture.screens.length}{" "}
                      screen
                      {presentedCapture.screens.length === 1 ? "" : "s"} imported (foreground unverified)
                    </strong>
                    <span>
                      {presentedCapture.screens
                        .map((screen) => screen.label)
                        .join(" · ")}
                    </span>
                  </div>
                )}
                <details>
                  <summary>Already have a Vaettir capture file?</summary>
                  <label style={{ display: "block", marginTop: 8 }}>
                    Import capture (.json)
                    <input
                      type="file"
                      accept="application/json,.json"
                      onChange={(event) =>
                        void selectCapture(event.target.files?.[0])
                      }
                    />
                  </label>
                </details>
              </>
            )}
            <button
              onClick={generate}
              disabled={
                !captureInputsAllowed || generating ||
                (captureMode === "web" ? !startUrl.trim() : !presentedCapture)
              }
            >
              {generating
                ? "Generating grounded drafts…"
                : captureMode === "web"
                  ? "Crawl and generate drafts"
                  : "Generate from device capture"}
            </button>
          </div>

          {error && <p style={{ color: "var(--ember)" }}>{error}</p>}

          {presentedDrafts && presentedCommittedTitles.length > 0 && (
            <p style={{ color: "var(--frost)" }}>
              Saved {presentedCommittedTitles.length} test case(s) as pending review:{" "}
              {presentedCommittedTitles.join(", ")}
            </p>
          )}

          {presentedDrafts && presentedDrafts.length === 0 && presentedCommittedTitles.length === 0 && (
            <p className="text-muted">
              No uncovered or demonstrably stale cases were found. The capture
              may be fully covered, or it may not contain enough evidence to
              justify a change.
            </p>
          )}

          {presentedDrafts && presentedDrafts.length > 0 && (
            <div style={{ marginTop: 24 }}>
              <h2>Drafts from {presentedScannedUrl}</h2>
              <p className="text-muted" style={{ fontSize: 13 }}>
                Nothing is saved yet. Commit each draft you want to keep, or
                discard it.
              </p>
              {presentedDrafts.map((draft, i) => (
                <div
                  key={`${draft.title}-${i}`}
                  style={{
                    border: "1px solid var(--line)",
                    borderRadius: 8,
                    padding: 16,
                    marginBottom: 12,
                  }}
                >
                  <h3>{draft.title}</h3>
                  <p>
                    <strong>{draft.testType}</strong> · confidence{" "}
                    {(draft.confidence * 100).toFixed(0)}%
                  </p>
                  <div
                    className={`status-panel ${draft.coverageDisposition === "STALE_EXISTING" ? "warning" : "success"}`}
                  >
                    <strong>
                      {draft.coverageDisposition === "STALE_EXISTING"
                        ? `Update existing: ${draft.matchedExistingTestCaseTitle ?? draft.matchedExistingTestCaseId}`
                        : "New, uncovered behavior"}
                    </strong>
                    <span>{draft.coverageRationale}</span>
                    <small>
                      Observed in release{" "}
                      {draft.observedReleaseCommit.slice(0, 12)}
                    </small>
                  </div>
                  {draft.background && (
                    <p>
                      <em>Background: {draft.background}</em>
                    </p>
                  )}
                  <ul>
                    {draft.given.map((s, j) => (
                      <li key={`g${j}`}>Given {s}</li>
                    ))}
                    {draft.when.map((s, j) => (
                      <li key={`w${j}`}>When {s}</li>
                    ))}
                    {draft.then.map((s, j) => (
                      <li key={`t${j}`}>Then {s}</li>
                    ))}
                  </ul>
                  <h4>Executable action detail</h4>
                  <div className="table-scroll">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Action</th>
                          <th>Target</th>
                          <th>Stable selector / event</th>
                          <th>Expected</th>
                        </tr>
                      </thead>
                      <tbody>
                        {draft.steps.map((step, stepIndex) => (
                          <tr key={`${step.action}-${stepIndex}`}>
                            <td>{step.action}</td>
                            <td>
                              {step.target.role}: {step.target.name}
                            </td>
                            <td>
                              <code>
                                {[
                                  step.target.stableId &&
                                    `objectId=${step.target.stableId}`,
                                  step.target.selector &&
                                    `selector=${step.target.selector}`,
                                  step.target.event &&
                                    `event=${step.target.event}`,
                                  step.target.route &&
                                    `route=${step.target.route}`,
                                ]
                                  .filter(Boolean)
                                  .join(" · ") || "Accessible role + name"}
                              </code>
                            </td>
                            <td>{step.expectedResult}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {draft.tags.length > 0 && (
                    <p className="text-muted" style={{ fontSize: 12 }}>
                      Tags: {draft.tags.join(", ")}
                    </p>
                  )}
                  {draft.notes && (
                    <p>
                      <small>{draft.notes}</small>
                    </p>
                  )}
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      justifyContent: "flex-end",
                    }}
                  >
                    <button
                      className="btn-secondary"
                      onClick={() => discard(i)}
                      disabled={busyIndex === i}
                    >
                      Discard
                    </button>
                    <button
                      onClick={() => commit(i)}
                      disabled={busyIndex === i}
                    >
                      {busyIndex === i
                        ? "Saving…"
                        : draft.coverageDisposition === "STALE_EXISTING"
                          ? "Update existing case for review"
                          : "Save new case for review"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
