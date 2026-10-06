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
  const [capturing, setCapturing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [scannedUrl, setScannedUrl] = useState<string | null>(null);
  const [committedTitles, setCommittedTitles] = useState<string[]>([]);
  const [busyIndex, setBusyIndex] = useState<number | null>(null);
  const connectionAttemptRef = useRef(createDeviceConnectionGeneration());
  const discoveryAttemptRef = useRef(0);
  const [manualSetupOpen, setManualSetupOpen] = useState(false);
  const [manualSetupRevealed, setManualSetupRevealed] = useState(false);
  const [helperMetadataCancellationEpoch, setHelperMetadataCancellationEpoch] = useState(0);
  useLayoutEffect(() => {
    const connection = connectionAttemptRef.current;
    revokeDeviceConnection(connection, { active: helperActorAllowed });
    // Revoke requests and stale/private setup display before the next paint.
    setConnectorStatus(current => current === "blocked" ? "blocked" : "idle");
    setDiscoveringDevices(false); setManualSetupOpen(false); setManualSetupRevealed(false);
    return () => { revokeDeviceConnection(connection, { active: false }); };
  }, [projectId, captureMode, pairingCode, readOnly, actor.isLoaded, actor.isSignedIn, actor.userId, actor.sessionId, helperReadFresh, helperOrganizationId, helperActorAllowed]);

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
    setGenerating(true);
    setError(null);
    setDrafts(null);
    setCommittedTitles([]);
    try {
      const res =
        captureMode === "web"
          ? await generateMutation.mutateAsync({ projectId, startUrl })
          : await generateDeviceMutation.mutateAsync({
              projectId,
              capture: deviceCapture as DeviceCapture,
            });
      setDrafts(res);
      setScannedUrl(
        captureMode === "web"
          ? startUrl
          : `${deviceCapture?.appName ?? "App"} on ${deviceCapture?.deviceName ?? "device"}`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }

  async function selectCapture(file: File | undefined) {
    setError(null);
    setDeviceCapture(null);
    if (!file) return;
    try {
      const capture = JSON.parse(await file.text()) as DeviceCapture;
      if (
        capture.version !== 1 ||
        !Array.isArray(capture.screens) ||
        capture.screens.length === 0
      ) {
        throw new Error("This is not a Vaettir device-capture manifest.");
      }
      const expectedSource =
        captureMode === "android"
          ? "ANDROID_ADB"
          : captureMode === "ios-connected"
            ? "IOS_CONNECTED"
            : "IOS_REMOTE";
      if (capture.source !== expectedSource) {
        throw new Error(
          `This file reports ${capture.source}; the selected source expects ${expectedSource}.`,
        );
      }
      setDeviceCapture(capture);
    } catch (captureError) {
      setError(
        captureError instanceof Error
          ? captureError.message
          : "Could not read the capture file.",
      );
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
        throw new Error(
          payload.error || `Connector returned HTTP ${response.status}.`,
        );
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
      const readyDevices = response.devices.filter((device) => device.ready);
      const onlyReadyDevice =
        readyDevices.length === 1 ? readyDevices[0] : undefined;
      if (onlyReadyDevice) setDeviceSerial(onlyReadyDevice.id);
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
    setDiscoveringDevices(false); setManualSetupOpen(false); setManualSetupRevealed(false);
    setConnectorStatus("connecting");
    setError(null);
    try {
      const health = await connectorRequest<{ connected: boolean }>("/health", undefined, 8_000, attempt);
      if (!currentDeviceConnection(connectionAttemptRef.current, attempt)) return;
      if (health.connected !== true) throw Error("No paired helper response was verified.");
      setConnectorStatus("connected");
      if (captureMode === "android") {
        try {
          await discoverAndroidDevices(attempt);
        } catch (deviceError) {
          if (!currentDeviceConnection(connectionAttemptRef.current, attempt)) return;
          setError(
            deviceError instanceof Error
              ? deviceError.message
              : "Android device discovery failed.",
          );
        }
      }
    } catch (connectorError) {
      if (!currentDeviceConnection(connectionAttemptRef.current, attempt)) return;
      setConnectorStatus("idle");
      setError(
        connectorError instanceof DOMException &&
          connectorError.name === "AbortError"
          ? "No paired helper response was received. This does not identify a Windows policy or prove that the helper launched. Review the instructions, then retry explicitly."
          : connectorError instanceof Error
            ? connectorError.message
            : "Could not connect to the device helper.",
      );
    }
  }

  async function waitForDeviceConnector(attempt: number) {
    for (let retry = 0; retry < 80; retry += 1) {
      if (!currentDeviceConnection(connectionAttemptRef.current, attempt)) return;
      try {
        const health = await connectorRequest<{ connected: boolean }>(
          "/health",
          undefined,
          1_000,
          attempt,
        );
        if (!currentDeviceConnection(connectionAttemptRef.current, attempt)) return;
        if (health.connected !== true) throw Error("No paired helper response was verified.");
        setConnectorStatus("connected");
        setError(null);
        if (captureMode === "android") {
          try {
            await discoverAndroidDevices(attempt);
          } catch (deviceError) {
            if (!currentDeviceConnection(connectionAttemptRef.current, attempt)) return;
            setError(
              deviceError instanceof Error
                ? deviceError.message
                : "Android device discovery failed.",
            );
          }
        }
        return;
      } catch {
        if (!currentDeviceConnection(connectionAttemptRef.current, attempt)) return;
        await new Promise((resolve) => window.setTimeout(resolve, 1_500));
      }
    }
    if (currentDeviceConnection(connectionAttemptRef.current, attempt)) {
      setConnectorStatus("idle");
      setError(
        "No paired helper response was received. Downloading does not prove that Windows launched it, and this timeout does not identify the cause. If Windows refused launch, report it below; otherwise review setup and retry explicitly.",
      );
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
      const attempt = beginDeviceConnection(connectionAttemptRef.current);
      if (attempt === null) return;
      setDiscoveringDevices(false); setManualSetupOpen(false); setManualSetupRevealed(false);
      setConnectorStatus("connecting");
      setError(null);
      void waitForDeviceConnector(attempt);
    } catch (launcherError) {
      setError(
        launcherError instanceof Error
          ? launcherError.message
          : "The device helper could not be prepared.",
      );
    }
  }

  function cancelHelperSetupChecks() {
    // The metadata surface revokes its own owner before invoking this bridge.
    // Abort this page's polling/discovery too, without attributing retained
    // captures or paid drafts to a newly reviewed identity or claiming they stopped.
    revokeDeviceConnection(connectionAttemptRef.current, { blocked: true });
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
    catch (deviceError) { if (currentDeviceConnection(connectionAttemptRef.current, attempt)) setError(deviceError instanceof Error ? deviceError.message : "Android device discovery failed."); }
  }

  async function captureCurrentScreen() {
    setCapturing(true);
    setError(null);
    try {
      const response = await connectorRequest<{ capture: DeviceCapture }>(
        "/capture",
        {
          method: "POST",
          body: JSON.stringify({
            source: captureMode,
            label: screenLabel.trim() || undefined,
            serial:
              captureMode === "android"
                ? deviceSerial.trim() || undefined
                : undefined,
            appiumUrl: captureMode === "android" ? undefined : appiumUrl.trim(),
            sessionId:
              captureMode === "android" ? undefined : appiumSessionId.trim(),
          }),
        },
      );
      setDeviceCapture((current) => {
        if (!current) return response.capture;
        if (
          current.source !== response.capture.source ||
          current.deviceName !== response.capture.deviceName
        ) {
          return response.capture;
        }
        return {
          ...current,
          capturedAt: response.capture.capturedAt,
          appName: response.capture.appName ?? current.appName,
          screens: [...current.screens, ...response.capture.screens].slice(
            0,
            25,
          ),
        };
      });
      setScreenLabel("");
    } catch (captureError) {
      setError(
        captureError instanceof Error
          ? captureError.message
          : "Device capture failed.",
      );
    } finally {
      setCapturing(false);
    }
  }

  async function commit(index: number) {
    const draft = drafts?.[index];
    if (!draft) return;
    setBusyIndex(index);
    setError(null);
    try {
      await commitMutation.mutateAsync({ projectId, ...draft });
      setCommittedTitles((prev) => [...prev, draft.title]);
      setDrafts((prev) => (prev ? prev.filter((_, i) => i !== index) : prev));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyIndex(null);
    }
  }

  function discard(index: number) {
    setDrafts((prev) => (prev ? prev.filter((_, i) => i !== index) : prev));
  }

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
                onClick={() => {
                  setCaptureMode(mode);
                  setDeviceCapture(null);
                  setError(null);
                }}
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
                  value={startUrl}
                  onChange={(event) => setStartUrl(event.target.value)}
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
                      <strong>Connect this computer</strong>
                      <p
                        className="text-muted"
                        style={{ fontSize: 13, margin: 0 }}
                      >
                        Download an unsigned launcher script and open it only
                        if your device policy permits. Pairing is
                        already built in, and this page connects automatically
                        once the helper is running. This is an unsigned script;
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
                            ? "Reconnect"
                            : "I opened it - connect"}
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
                            ? "Computer connected"
                            : connectorStatus === "connecting"
                              ? "Waiting for a paired helper response..."
                              : connectorStatus === "blocked"
                                ? "Windows launch blocked (reported by you)"
                              : "Not connected yet"}
                        </strong>
                        <span>
                          {connectorStatus === "connected"
                            ? "Keep the helper window open while you capture screens."
                            : connectorStatus === "connecting"
                              ? "This page has not verified launch or device access. Open the reviewed launcher only if policy permits, or report a blocked launch below."
                              : connectorStatus === "blocked"
                                ? "This page stopped waiting and canceled its health/discovery requests. Already started local discovery may finish; its results are ignored. The blocking policy or product remains unverified."
                              : "Nothing is uploaded until you capture a screen and generate drafts."}
                        </span>
                      </div>
                      {!helperActorAllowed && <p role="status">Current loaded, signed-in original-account/organization access with freshly completed protected project/member reads and a full editor seat is required. Private pairing draft and device selections remain retained but hidden; no connection/download/discovery retry is authorized. Local health is not server authorization or device acceptance.</p>}
                      {connectorStatus === "blocked" && <div role="status"><DeviceHelperBlockedLaunchGuidance reportedBlocked={true} /><p>Your private pairing draft remains retained. Reporting this did not launch a helper, change policy or perform device capture. Signed trusted distribution and actual Windows/device acceptance remain separate.</p><button type="button" className="btn-secondary" onClick={showPolicyPermittedManualSetup}>Show manual instructions only if policy permits</button></div>}
                      <details open={manualSetupOpen} onToggle={event => setManualSetupOpen(event.currentTarget.open)}>
                        <summary>Manual setup and troubleshooting</summary>
                        <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                          {!helperActorAllowed || connectorStatus === "blocked" && !manualSetupRevealed ? <p>Pairing code and private setup command are hidden. Restore the original account/full seat and review device policy first, then explicitly choose “Show manual instructions only if policy permits.” This alternative is not a bypass or permission grant.</p> : <>
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
                            choose Reconnect.
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
                                value={helperActorAllowed ? deviceSerial : ""}
                                onChange={(event) =>
                                  setDeviceSerial(event.target.value)
                                }
                                disabled={
                                  !helperActorAllowed || connectorStatus !== "connected" ||
                                  discoveringDevices
                                }
                                style={{ width: "100%" }}
                              >
                                <option value="">
                                  {!helperActorAllowed
                                    ? "Restore original account/project access"
                                    : discoveringDevices
                                    ? "Looking for devices..."
                                    : androidDevices.length === 0
                                      ? "No device found"
                                      : "Choose a device"}
                                </option>
                                {(helperActorAllowed ? androidDevices : []).map((device) => (
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
                                !helperActorAllowed || connectorStatus !== "connected" ||
                                discoveringDevices
                              }
                            >
                              Refresh
                            </button>
                          </div>
                          {helperActorAllowed && androidDevices.some(
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
                              value={helperActorAllowed ? appiumUrl : ""}
                              onChange={(event) =>
                                setAppiumUrl(event.target.value)
                              }
                              placeholder={
                                captureMode === "ios-remote"
                                  ? "https://provider.example/wd/hub"
                                  : "http://127.0.0.1:4723"
                              }
                              disabled={!helperActorAllowed || connectorStatus !== "connected"}
                              style={{ width: "100%" }}
                            />
                          </label>
                          <label>
                            Active session ID
                            <input
                              value={helperActorAllowed ? appiumSessionId : ""}
                              onChange={(event) =>
                                setAppiumSessionId(event.target.value)
                              }
                              placeholder="Appium session ID"
                              disabled={!helperActorAllowed || connectorStatus !== "connected"}
                              style={{ width: "100%" }}
                            />
                          </label>
                        </div>
                      )}
                      <label>
                        Screen name
                        <input
                          value={screenLabel}
                          onChange={(event) =>
                            setScreenLabel(event.target.value)
                          }
                          placeholder="For example: Sign in, Cart, Checkout"
                          disabled={connectorStatus !== "connected"}
                          style={{ width: "100%" }}
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => void captureCurrentScreen()}
                        disabled={
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
                    </div>
                  </section>
                </div>
                {deviceCapture && (
                  <div className="status-panel success">
                    <strong>
                      {deviceCapture.deviceName}: {deviceCapture.screens.length}{" "}
                      screen
                      {deviceCapture.screens.length === 1 ? "" : "s"} ready
                    </strong>
                    <span>
                      {deviceCapture.screens
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
                generating ||
                (captureMode === "web" ? !startUrl.trim() : !deviceCapture)
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

          {committedTitles.length > 0 && (
            <p style={{ color: "var(--frost)" }}>
              Saved {committedTitles.length} test case(s) as pending review:{" "}
              {committedTitles.join(", ")}
            </p>
          )}

          {drafts && drafts.length === 0 && committedTitles.length === 0 && (
            <p className="text-muted">
              No uncovered or demonstrably stale cases were found. The capture
              may be fully covered, or it may not contain enough evidence to
              justify a change.
            </p>
          )}

          {drafts && drafts.length > 0 && (
            <div style={{ marginTop: 24 }}>
              <h2>Drafts from {scannedUrl}</h2>
              <p className="text-muted" style={{ fontSize: 13 }}>
                Nothing is saved yet. Commit each draft you want to keep, or
                discard it.
              </p>
              {drafts.map((draft, i) => (
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
