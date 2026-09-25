"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { downloadFile } from "@/lib/download";
import {
  buildDeviceConnectorLauncher,
  createDeviceConnectorPairingCode,
  detectDeviceConnectorPlatform,
  type DeviceConnectorPlatform,
} from "@/lib/deviceConnectorLauncher";
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
type ConnectorStatus = "idle" | "connecting" | "connected";
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
  const connectionAttemptRef = useRef(0);

  useEffect(() => {
    const initialize = window.setTimeout(() => {
      setPairingCode(createDeviceConnectorPairingCode());
      setConnectorPlatform(detectDeviceConnectorPlatform(navigator.userAgent));
    }, 0);
    return () => window.clearTimeout(initialize);
  }, []);

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
  ) {
    const controller = new AbortController();
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
      if (!response.ok) {
        throw new Error(
          payload.error || `Connector returned HTTP ${response.status}.`,
        );
      }
      return payload;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function discoverAndroidDevices() {
    setDiscoveringDevices(true);
    try {
      const response = await connectorRequest<{ devices: AndroidDevice[] }>(
        "/devices?source=android",
      );
      setAndroidDevices(response.devices);
      const readyDevices = response.devices.filter((device) => device.ready);
      const onlyReadyDevice =
        readyDevices.length === 1 ? readyDevices[0] : undefined;
      if (onlyReadyDevice) setDeviceSerial(onlyReadyDevice.id);
      return response.devices;
    } finally {
      setDiscoveringDevices(false);
    }
  }

  async function connectToDeviceConnector() {
    setConnectorStatus("connecting");
    setError(null);
    try {
      await connectorRequest<{ connected: boolean }>("/health");
      setConnectorStatus("connected");
      if (captureMode === "android") {
        try {
          await discoverAndroidDevices();
        } catch (deviceError) {
          setError(
            deviceError instanceof Error
              ? deviceError.message
              : "Android device discovery failed.",
          );
        }
      }
    } catch (connectorError) {
      setConnectorStatus("idle");
      setError(
        connectorError instanceof DOMException &&
          connectorError.name === "AbortError"
          ? "The connector did not respond. Start the downloaded helper, then try again."
          : connectorError instanceof Error
            ? connectorError.message
            : "Could not connect to the device helper.",
      );
    }
  }

  async function waitForDeviceConnector(attempt: number) {
    for (let retry = 0; retry < 80; retry += 1) {
      if (connectionAttemptRef.current !== attempt) return;
      try {
        await connectorRequest<{ connected: boolean }>(
          "/health",
          undefined,
          1_000,
        );
        if (connectionAttemptRef.current !== attempt) return;
        setConnectorStatus("connected");
        setError(null);
        if (captureMode === "android") {
          try {
            await discoverAndroidDevices();
          } catch (deviceError) {
            setError(
              deviceError instanceof Error
                ? deviceError.message
                : "Android device discovery failed.",
            );
          }
        }
        return;
      } catch {
        await new Promise((resolve) => window.setTimeout(resolve, 1_500));
      }
    }
    if (connectionAttemptRef.current === attempt) {
      setConnectorStatus("idle");
      setError(
        "The helper did not start. Open the downloaded file, keep its window open, then choose Reconnect.",
      );
    }
  }

  function downloadConnectorLauncher() {
    try {
      const launcher = buildDeviceConnectorLauncher({
        platform: connectorPlatform,
        origin: window.location.origin,
        pairingCode,
      });
      downloadFile(launcher.filename, launcher.content, launcher.mimeType);
      const attempt = connectionAttemptRef.current + 1;
      connectionAttemptRef.current = attempt;
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
                        Download and open the prepared helper. Pairing is
                        already built in, and this page connects automatically.
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
                            !pairingCode || connectorStatus === "connecting"
                          }
                        >
                          Download{" "}
                          {connectorPlatform === "windows"
                            ? "Windows"
                            : connectorPlatform === "macos"
                              ? "macOS"
                              : "Linux"}{" "}
                          helper
                        </button>
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => void connectToDeviceConnector()}
                          disabled={
                            !pairingCode || connectorStatus === "connecting"
                          }
                        >
                          {connectorStatus === "connected"
                            ? "Reconnect"
                            : "I opened it - connect"}
                        </button>
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
                              ? "Waiting for the helper to open..."
                              : "Not connected yet"}
                        </strong>
                        <span>
                          {connectorStatus === "connected"
                            ? "Keep the helper window open while you capture screens."
                            : connectorStatus === "connecting"
                              ? "Open the downloaded file if your browser did not open it automatically."
                              : "Nothing is uploaded until you capture a screen and generate drafts."}
                        </span>
                      </div>
                      <details>
                        <summary>Manual setup and troubleshooting</summary>
                        <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                          <span className="text-muted" style={{ fontSize: 13 }}>
                            Pairing code:{" "}
                            <code>{pairingCode || "Preparing..."}</code>
                          </span>
                          <span className="text-muted" style={{ fontSize: 13 }}>
                            If the prepared helper is blocked, download the raw
                            connector and run it with Node using the pairing
                            code above.
                          </span>
                          <a
                            className="btn btn-secondary"
                            href="/connectors/vaettir-device-connector.mjs"
                            download="vaettir-device-connector.mjs"
                            style={{ width: "fit-content" }}
                          >
                            Download raw connector
                          </a>
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
                                value={deviceSerial}
                                onChange={(event) =>
                                  setDeviceSerial(event.target.value)
                                }
                                disabled={
                                  connectorStatus !== "connected" ||
                                  discoveringDevices
                                }
                                style={{ width: "100%" }}
                              >
                                <option value="">
                                  {discoveringDevices
                                    ? "Looking for devices..."
                                    : androidDevices.length === 0
                                      ? "No device found"
                                      : "Choose a device"}
                                </option>
                                {androidDevices.map((device) => (
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
                              onClick={() => {
                                setError(null);
                                void discoverAndroidDevices().catch(
                                  (deviceError) =>
                                    setError(
                                      deviceError instanceof Error
                                        ? deviceError.message
                                        : "Android device discovery failed.",
                                    ),
                                );
                              }}
                              disabled={
                                connectorStatus !== "connected" ||
                                discoveringDevices
                              }
                            >
                              Refresh
                            </button>
                          </div>
                          {androidDevices.some(
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
                              value={appiumUrl}
                              onChange={(event) =>
                                setAppiumUrl(event.target.value)
                              }
                              placeholder={
                                captureMode === "ios-remote"
                                  ? "https://provider.example/wd/hub"
                                  : "http://127.0.0.1:4723"
                              }
                              disabled={connectorStatus !== "connected"}
                              style={{ width: "100%" }}
                            />
                          </label>
                          <label>
                            Active session ID
                            <input
                              value={appiumSessionId}
                              onChange={(event) =>
                                setAppiumSessionId(event.target.value)
                              }
                              placeholder="Appium session ID"
                              disabled={connectorStatus !== "connected"}
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
