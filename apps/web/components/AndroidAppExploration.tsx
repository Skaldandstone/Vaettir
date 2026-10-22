"use client";

import { useEffect, useState } from "react";
import {
  androidExplorerState,
  androidExplorationScope,
  androidExplorationCommit,
  androidExplorationReceipt,
  androidExplorerTarget as targetSchema,
  androidExplorerDevices as devicesSchema,
  androidExplorerCapabilities as capabilities,
  navigationProposal,
} from "../../api/src/services/androidExplorationSchema";
import {
  buildDeviceConnectorLauncher,
  detectDeviceConnectorPlatform,
} from "@/lib/deviceConnectorLauncher";
import { downloadFile } from "@/lib/download";
import { trpcReact } from "@/lib/trpcReact";
import { deviceCaptureAccessOutput } from "../../api/src/services/deviceCaptureAccessSchema";

type Scope = typeof androidExplorationScope._output;
type State = typeof androidExplorerState._output;
type Commit = typeof androidExplorationCommit._output;
type Props = {
  pairingCode: string;
  currentScope: () => { scope: Scope; epochKey: string } | null;
};
const BASE = "http://127.0.0.1:4775";
const message =
  "The original app session could not be verified. No navigation action was retried. Review the retained session before continuing.";
const defaultNames =
  "Home\nBrowse\nCatalog\nCategories\nDetails\nAbout\nHelp\nMenu";
const reasonText: Record<string, string> = {
  APPROVED_NAVIGATION_EXHAUSTED:
    "Finished the approved navigation. Other areas were not explored.",
  ACTION_LIMIT: "Reached the action limit.",
  SCREEN_LIMIT: "Reached the screen limit.",
  TIME_LIMIT: "Reached the time limit.",
  FORM_AUTH_OR_EMBEDDED_CONTENT:
    "This screen has a protected or unrecognized form, authentication, payment or embedded content. Exploration stopped.",
  SCREEN_CHANGED_REVIEW_REQUIRED:
    "The screen changed outside this session. Exploration stopped for review.",
  TARGET_OR_OBSERVATION_UNAVAILABLE:
    "The selected app or its screen could not be verified.",
  ACTION_OUTCOME_UNCERTAIN_NO_RETRY:
    "The last action’s result could not be verified. It will not be repeated.",
  PAUSED_BY_USER: "Paused. No further navigation is being requested.",
  STOPPED_BY_USER: "Stopped. Recorded journeys remain available for review.",
  UNEXPECTED_BACK_DESTINATION:
    "Back reached an unexpected screen. Exploration stopped.",
  NAVIGATION_CYCLE: "Reached a previously visited screen. Exploration stopped.",
};

// Original imperative ownership is independent of React presentation. Binding
// current props during render prevents a stale asynchronous callback from
// publishing source or dispatching another action under a different account.
type OwnershipState = {
  live: Props;
  owner: string | null;
  controller: AbortController | null;
  running: boolean;
  wanted: "pause" | "stop" | null;
  retained: State | null;
  pendingId: string | null;
  originalScope: Scope | null;
  commitIntent: Commit | null;
  nativeActorId: string | null;
};
class AndroidExplorationOwnership {
  private state: OwnershipState;
  constructor(live: Props) {
    this.state = {
      live,
      owner: null,
      controller: null,
      running: false,
      wanted: null,
      retained: null,
      pendingId: null,
      originalScope: null,
      commitIntent: null,
      nativeActorId: null,
    };
  }
  get live() {
    return this.state.live;
  }
  get owner() {
    return this.state.owner;
  }
  get controller() {
    return this.state.controller;
  }
  get running() {
    return this.state.running;
  }
  get wanted() {
    return this.state.wanted;
  }
  get retained() {
    return this.state.retained;
  }
  get pendingId() {
    return this.state.pendingId;
  }
  get originalScope() {
    return this.state.originalScope;
  }
  get commitIntent() {
    return this.state.commitIntent;
  }
  get nativeActorId() {
    return this.state.nativeActorId;
  }
  patch(value: Partial<OwnershipState>) {
    Object.assign(this.state, value);
  }
  bind(value: Props) {
    this.state.live = value;
  }
}

export function AndroidAppExploration(props: Props) {
  const [ownership] = useState(() => new AndroidExplorationOwnership(props));
  ownership.bind(props);
  const [devices, setDevices] = useState<
      (typeof devicesSchema._output)["devices"]
    >([]),
    [serial, setSerial] = useState("");
  const [target, setTarget] = useState<typeof targetSchema._output | null>(
      null,
    ),
    [state, setState] = useState<State | null>(null);
  const [names, setNames] = useState(defaultNames),
    [consent, setConsent] = useState(false),
    [disclosure, setDisclosure] = useState(false);
  const [selected, setSelected] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState<string | null>(null);
  const [reviewedNavigation, setReviewedNavigation] = useState<string[]>([]);
  const [receipt, setReceipt] = useState<
    typeof androidExplorationReceipt._output | null
  >(null);
  const mutation = trpcReact.liveAppGeneration.commitExploration.useMutation();
  const utils = trpcReact.useUtils();
  const [accessRevoked, setAccessRevoked] = useState(false);
  const [exploring, setExploring] = useState(false);
  const current = props.currentScope(),
    key = current?.epochKey ?? null;
  const visible =
    !!key && (!ownership.owner || ownership.owner === key) && !accessRevoked;
  function scope() {
    const next = ownership.live.currentScope();
    if (!next || (ownership.owner && ownership.owner !== next.epochKey))
      throw Error(message);
    return next;
  }
  useEffect(
    () => () => {
      ownership.patch({ running: false });
      ownership.controller?.abort();
    },
    [ownership],
  );
  useEffect(() => {
    if (!visible) {
      ownership.patch({ running: false });
      ownership.controller?.abort();
    }
  }, [visible, ownership]);
  async function verifyAccess() {
    const pin = scope(),
      readRequestId = crypto.randomUUID();
    try {
      const access = deviceCaptureAccessOutput.parse(
        await utils.client.liveAppGeneration.explorationAccess.query(
          {
            projectId: pin.scope.projectId,
            originalOrganizationId: pin.scope.organizationId,
            expectedClerkActorId: pin.scope.actorId,
            expectedNativeActorId: ownership.nativeActorId ?? undefined,
            readRequestId,
          },
          { signal: AbortSignal.timeout(10000) },
        ),
      );
      if (
        scope().epochKey !== pin.epochKey ||
        access.readRequestId !== readRequestId ||
        access.scope.projectId !== pin.scope.projectId ||
        access.scope.organizationId !== pin.scope.organizationId ||
        access.scope.clerkActorId !== pin.scope.actorId ||
        (ownership.nativeActorId !== null &&
          access.scope.nativeActorId !== ownership.nativeActorId)
      )
        throw Error(message);
      ownership.patch({ nativeActorId: access.scope.nativeActorId });
      return pin;
    } catch {
      ownership.patch({ running: false });
      setAccessRevoked(true);
      throw Error(message);
    }
  }
  async function recheckAccess() {
    setBusy(true);
    try {
      await verifyAccess();
      setAccessRevoked(false);
    } catch {
      /* Retained values stay hidden. */
    } finally {
      setBusy(false);
    }
  }
  async function request(path: string, body?: unknown) {
    const pin = scope();
    ownership.patch({
      owner: ownership.owner ?? pin.epochKey,
      originalScope: ownership.originalScope ?? pin.scope,
    });
    await verifyAccess();
    if (scope().epochKey !== pin.epochKey) throw Error(message);
    if (
      path === "/exploration/v1/next" &&
      !ownership.running &&
      ownership.retained
    )
      return ownership.retained;
    const abort = new AbortController();
    ownership.patch({ controller: abort });
    const timer = setTimeout(() => abort.abort(), 45000);
    try {
      const response = await fetch(BASE + path, {
        method: body === undefined ? "GET" : "POST",
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        headers: {
          "x-vaettir-pairing-code": ownership.live.pairingCode,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: abort.signal,
      });
      if (
        scope().epochKey !== pin.epochKey ||
        response.url !== BASE + path ||
        response.status !== 200 ||
        response.redirected ||
        response.headers.get("content-type")?.split(";")[0] !==
          "application/json" ||
        !response.body
      )
        throw Error(message);
      const reader = response.body.getReader(),
        chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.length;
          if (size > 2 * 1024 * 1024) throw Error(message);
          chunks.push(part.value);
        }
      } finally {
        await reader.cancel().catch(() => undefined);
      }
      if (scope().epochKey !== pin.epochKey) throw Error(message);
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      await verifyAccess();
      if (scope().epochKey !== pin.epochKey) throw Error(message);
      return JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      ) as unknown;
    } finally {
      clearTimeout(timer);
      if (ownership.controller === abort) ownership.patch({ controller: null });
    }
  }
  function accept(raw: unknown) {
    const next = androidExplorerState.parse(raw),
      pin = scope();
    if (
      JSON.stringify(next.scope) !== JSON.stringify(pin.scope) ||
      ownership.pendingId !== next.id ||
      (ownership.retained && next.sequence < ownership.retained.sequence)
    )
      throw Error(message);
    ownership.patch({ retained: next });
    setState(next);
    return next;
  }
  async function connect() {
    setBusy(true);
    setError(null);
    try {
      capabilities.parse(await request("/exploration/v1/capabilities"));
      const found = devicesSchema.parse(
        await request("/devices?source=android"),
      );
      setDevices(found.devices);
      setNotice(
        "Connector ready. Choose the device, then open your test app on it.",
      );
    } catch {
      setError(
        "Open the updated Android connector, then connect again. It uses its own local port and does not replace an already running capture helper.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function inspect() {
    setBusy(true);
    setError(null);
    setConsent(false);
    try {
      const result = targetSchema.parse(
        await request("/exploration/v1/inspect", {
          serial,
          scope: scope().scope,
        }),
      );
      setTarget(result);
      setNotice(null);
    } catch {
      setError(
        "Unlock the selected device and open the test app, then check it again. No screen content was collected.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function drive(initial: State) {
    let latest = initial;
    while (ownership.running && latest.status === "ACTIVE") {
      latest = accept(
        await request("/exploration/v1/next", {
          id: latest.id,
          scope: scope().scope,
          sequence: latest.sequence,
          requestId: crypto.randomUUID(),
        }),
      );
      // Yield between complete commands so Pause/Stop can prevent the next one.
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (ownership.wanted && latest.status === "ACTIVE") {
      latest = accept(
        await request("/exploration/v1/" + ownership.wanted, {
          id: latest.id,
          scope: scope().scope,
        }),
      );
    }
    ownership.patch({ running: false, wanted: null });
    return latest;
  }
  async function start() {
    if (!target || !consent || busy || ownership.retained) return;
    setBusy(true);
    setExploring(true);
    setError(null);
    setNotice(null);
    ownership.patch({ pendingId: target.ticket, running: true, wanted: null });
    try {
      const initial = accept(
        await request("/exploration/v1/start", {
          ticket: target.ticket,
          scope: scope().scope,
          consent: {
            localObservation: true,
            navigation: true,
            testAccount: true,
          },
          navigationNames: names
            .split("\n")
            .map((n) => n.trim())
            .filter(Boolean),
          limits: { actions: 12, screens: 8, seconds: 180 },
        }),
      );
      await drive(initial);
    } catch {
      ownership.patch({ running: false });
      setError(message);
    } finally {
      setExploring(false);
      setBusy(false);
    }
  }
  async function prepareReviewedNavigation() {
    const previous = ownership.retained;
    if (
      !previous ||
      busy ||
      !reviewedNavigation.length ||
      reviewedNavigation.length > 25 ||
      (ownership.commitIntent && !receipt)
    )
      return;
    setBusy(true);
    setError(null);
    try {
      const next = targetSchema.parse(
        await request("/exploration/v1/inspect", {
          serial,
          scope: scope().scope,
        }),
      );
      if (next.packageName !== previous.packageName) throw Error(message);
      // Changing the navigation scope never reuses a consumed target ticket,
      // local consent, selected disclosure, or uncertain hosted request.
      ownership.patch({
        retained: null,
        pendingId: null,
        commitIntent: null,
        running: false,
        wanted: null,
      });
      setState(null);
      setTarget(next);
      setNames(reviewedNavigation.join("\n"));
      setReviewedNavigation([]);
      setSelected([]);
      setConsent(false);
      setDisclosure(false);
      setReceipt(null);
      setNotice(
        "Review the selected navigation and approve a new bounded exploration. No navigation has started. The previous local session remains in helper memory until it exits.",
      );
    } catch {
      setError(
        "Keep the original test app open and restore original project access before preparing another exploration. The previous session is retained; no navigation was requested.",
      );
    } finally {
      setBusy(false);
    }
  }
  function pause(stop = false) {
    ownership.patch({ running: false, wanted: stop ? "stop" : "pause" });
    setNotice(
      stop
        ? "Stopping after the current command. No further navigation will be requested."
        : "Pausing after the current command. No further navigation will be requested.",
    );
  }
  async function readRetained() {
    if (!ownership.pendingId) return;
    setBusy(true);
    setError(null);
    try {
      const value = accept(
        await request("/exploration/v1/read", {
          id: ownership.pendingId,
          scope: scope().scope,
        }),
      );
      setNotice(
        `Retained session: ${value.status}. No device action was requested.`,
      );
    } catch {
      setError(message);
    } finally {
      setBusy(false);
    }
  }
  async function resume() {
    const previous = ownership.retained;
    if (!previous || busy || !["ACTIVE", "PAUSED"].includes(previous.status))
      return;
    setBusy(true);
    setExploring(true);
    setError(null);
    setNotice(null);
    ownership.patch({ wanted: null, running: true });
    try {
      let value = previous;
      if (value.status === "PAUSED")
        value = accept(
          await request("/exploration/v1/resume", {
            id: value.id,
            scope: scope().scope,
          }),
        );
      await drive(value);
    } catch {
      ownership.patch({ running: false });
      setError(message);
    } finally {
      setExploring(false);
      setBusy(false);
    }
  }
  async function stopRetained() {
    if (busy) {
      pause(true);
      return;
    }
    if (!ownership.pendingId) return;
    setBusy(true);
    setError(null);
    try {
      accept(
        await request("/exploration/v1/stop", {
          id: ownership.pendingId,
          scope: scope().scope,
        }),
      );
    } catch {
      setError(message);
    } finally {
      setBusy(false);
    }
  }
  async function addSelected() {
    const retainedState = ownership.retained;
    if (
      !retainedState ||
      retainedState.status === "ACTIVE" ||
      !disclosure ||
      busy ||
      !selected.length
    )
      return;
    const pin = scope();
    // Keep the EXACT request across an uncertain server write. A subsequent
    // click recovers its durable original receipt; it never makes a new UUID.
    ownership.patch({
      commitIntent:
        ownership.commitIntent ??
        androidExplorationCommit.parse({
          projectId: pin.scope.projectId,
          originalOrganizationId: pin.scope.organizationId,
          expectedClerkActorId: pin.scope.actorId,
          requestId: crypto.randomUUID(),
          acknowledgeDisclosure: true,
          journeys: retainedState.journeys.filter((j) =>
            selected.includes(j.id),
          ),
        }),
    });
    const requestPin = ownership.commitIntent!;
    setBusy(true);
    setError(null);
    try {
      const result = androidExplorationReceipt.parse(
        await mutation.mutateAsync(requestPin),
      );
      if (
        scope().epochKey !== pin.epochKey ||
        result.projectId !== pin.scope.projectId ||
        result.organizationId !== pin.scope.organizationId ||
        result.actorClerkId !== pin.scope.actorId ||
        result.requestId !== requestPin.requestId ||
        result.cases.length !== requestPin.journeys.length ||
        new Set(result.cases.map((item) => item.caseId)).size !==
          result.cases.length ||
        JSON.stringify(result.cases.map((item) => item.journeyId).sort()) !==
          JSON.stringify(requestPin.journeys.map((item) => item.id).sort())
      )
        throw Error(message);
      setReceipt(result);
    } catch {
      setError(
        "The add result is unverified. Keep this page and use Recover add result to retry the exact reviewed request safely.",
      );
    } finally {
      setBusy(false);
    }
  }
  function download() {
    const pin = scope();
    const file = buildDeviceConnectorLauncher({
      platform: detectDeviceConnectorPlatform(navigator.userAgent),
      origin: window.location.origin,
      pairingCode: props.pairingCode,
      port: 4775,
    });
    downloadFile(
      file.filename,
      file.content,
      file.mimeType,
      () => scope().epochKey === pin.epochKey,
    );
  }
  const shown = visible ? state : null,
    chosen = shown?.journeys.filter((j) => selected.includes(j.id)) ?? [];
  return (
    <section
      className="panel"
      aria-label="Android app exploration"
      style={{
        marginBlock: 16,
        display: "grid",
        gap: 14,
        overflowWrap: "anywhere",
      }}
    >
      <h2>Connect an app. Explore. Review the tests.</h2>
      <p>
        Explore an Android test app on this computer. Review journeys and
        proposed navigation checks before adding any cases. Local suggestions
        use no AI credits.
      </p>
      {!visible ? (
        <div>
          <p role="status">
            Restore the original signed-in account and project to see this
            session. Private selections and any uncertain add request remain
            retained here.
          </p>
          {key && (!ownership.owner || ownership.owner === key) && (
            <button
              className="btn-secondary"
              type="button"
              disabled={busy}
              onClick={() => void recheckAccess()}
            >
              Recheck original project access
            </button>
          )}
        </div>
      ) : (
        <>
          {!devices.length && !shown && (
            <div>
              <button
                type="button"
                className="btn-secondary"
                disabled={busy || !props.pairingCode}
                onClick={download}
              >
                Download Android connector
              </button>{" "}
              <button
                className="btn-secondary"
                type="button"
                disabled={busy || !props.pairingCode}
                onClick={() => void connect()}
              >
                Connect Android app
              </button>
              <p className="text-muted">
                Open the downloaded launcher once if device policy permits, then
                connect. Requires Node 22 and ADB. Downloading alone does not
                start it.
              </p>
            </div>
          )}
          {!!devices.length && !shown && (
            <>
              <label>
                Test device
                <select
                  aria-label="Exploration device"
                  value={serial}
                  disabled={busy || !!target}
                  onChange={(e) => {
                    setSerial(e.target.value);
                    setTarget(null);
                    setConsent(false);
                  }}
                  style={{ display: "block", maxWidth: "100%" }}
                >
                  <option value="">Choose a device</option>
                  {devices.map((d) => (
                    <option key={d.id} value={d.id} disabled={!d.ready}>
                      {d.name}
                      {d.ready ? "" : ` (${d.status})`}
                    </option>
                  ))}
                </select>
              </label>
              <p>
                Open the test app on that device. Only its current package
                identity is checked here.
              </p>
              <button
                className="btn-secondary"
                type="button"
                disabled={busy || !serial}
                onClick={() => void inspect()}
              >
                {target ? "Check open app again" : "Use the open test app"}
              </button>
            </>
          )}
          {target && !shown && (
            <>
              <h3>Explore {target.packageName}</h3>
              <p>
                Allowed navigation:{" "}
                {names.split("\n").filter(Boolean).join(" · ")}
              </p>
              <details>
                <summary>Review or change allowed navigation</summary>
                <label>
                  Navigation labels allowed for this session
                  <textarea
                    aria-label="Allowed navigation labels"
                    rows={5}
                    disabled={busy}
                    value={names}
                    onChange={(e) => {
                      setNames(e.target.value);
                      setConsent(false);
                    }}
                    style={{
                      display: "block",
                      width: "100%",
                      boxSizing: "border-box",
                    }}
                  />
                </label>
              </details>
              <p className="text-muted">
                One exact label per line. Vaettir will follow matching
                navigation controls, scroll and go back. Ordinary search/filter
                fields are left untouched and their contents are excluded.
                Unrecognized forms, sign-in, payments, embedded content and
                destructive actions stop exploration or are excluded. A label
                cannot guarantee an app’s behavior; use a test account.
              </p>
              <label>
                <input
                  type="checkbox"
                  checked={consent}
                  disabled={busy}
                  onChange={(e) => setConsent(e.target.checked)}
                />{" "}
                I approve local screen observation and this bounded navigation
                in the selected test app and test account. Control labels may
                contain private information; nothing is sent to AI.
              </label>
              <p>
                Up to 12 actions, 8 screens or 3 minutes. Keep the selected app
                open. An app or screen can change while a command runs; use a
                test account.
              </p>
              <button
                className="btn-secondary"
                type="button"
                disabled={busy || !consent}
                onClick={() => void start()}
              >
                Explore normal navigation
              </button>
            </>
          )}
          {exploring && !shown && ownership.pendingId && (
            <div role="status">
              Reading the first app screen. The current command may finish
              before stopping.{" "}
              <button
                className="btn-secondary"
                type="button"
                onClick={() => pause(true)}
              >
                Stop exploration
              </button>
            </div>
          )}
          {shown && (
            <>
              <h3>Exploration {shown.status.toLowerCase()}</h3>
              <p role="status">
                {shown.screens.length} screens observed · {shown.actionCount}{" "}
                navigation actions · {shown.journeys.length} proposed journeys
              </p>
              {shown.reason && (
                <p>
                  {reasonText[shown.reason] ??
                    "Exploration stopped. Review the retained session."}
                </p>
              )}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {exploring ? (
                  <>
                    <button
                      className="btn-secondary"
                      type="button"
                      onClick={() => pause()}
                    >
                      Pause
                    </button>
                    <button
                      className="btn-secondary"
                      type="button"
                      onClick={() => pause(true)}
                    >
                      Stop
                    </button>
                  </>
                ) : (
                  <>
                    {["ACTIVE", "PAUSED"].includes(shown.status) && (
                      <button
                        className="btn-secondary"
                        type="button"
                        disabled={busy}
                        onClick={() => void resume()}
                      >
                        Resume exploration
                      </button>
                    )}
                    {["ACTIVE", "PAUSED"].includes(shown.status) && (
                      <button
                        className="btn-secondary"
                        type="button"
                        disabled={busy}
                        onClick={() => void stopRetained()}
                      >
                        Stop session
                      </button>
                    )}
                  </>
                )}
              </div>
              <p className="text-muted">
                The current command may finish after Pause or Stop. No
                background exploration continues when this page stops requesting
                actions. Unapproved controls and unexplored areas have no
                coverage claim.
              </p>
              {!exploring &&
                ["COMPLETED", "STOPPED"].includes(shown.status) && (
                  <details>
                    <summary>
                      Review detected navigation for another exploration
                    </summary>
                    <p>
                      Select only controls that navigate ordinary screens in
                      this test account. Labels can describe actions with side
                      effects; selection does not make them safe. Known
                      sensitive labels are still refused. The controls stay on
                      this computer until selected journey disclosure.
                    </p>
                    {Array.from(
                      new Set(
                        shown.screens.flatMap((screen) =>
                          screen.controls
                            .filter((control) => control.navigable)
                            .map((control) => control.name),
                        ),
                      ),
                    )
                      .sort()
                      .map((name) => (
                        <label
                          key={name}
                          style={{ display: "block", overflowWrap: "anywhere" }}
                        >
                          <input
                            type="checkbox"
                            checked={reviewedNavigation.includes(name)}
                            disabled={
                              busy || (!!ownership.commitIntent && !receipt)
                            }
                            onChange={(event) =>
                              setReviewedNavigation((previous) =>
                                event.target.checked
                                  ? [...previous, name]
                                  : previous.filter((value) => value !== name),
                              )
                            }
                          />{" "}
                          {name}
                        </label>
                      ))}
                    <p>
                      Starting another exploration replaces this page’s current
                      journey review. Add any selected proposed tests first. An
                      uncertain add must be recovered before continuing.
                    </p>
                    <button
                      className="btn-secondary"
                      type="button"
                      disabled={
                        busy ||
                        !reviewedNavigation.length ||
                        reviewedNavigation.length > 25 ||
                        (!!ownership.commitIntent && !receipt)
                      }
                      onClick={() => void prepareReviewedNavigation()}
                    >
                      Use selected navigation in a new exploration
                    </button>
                  </details>
                )}
              <h3>Review proposed tests</h3>
              <p>
                These suggestions describe reached navigation paths. Expected
                behavior and business rules need review. Adding creates
                pending-review cases and does not record a test pass.
              </p>
              {shown.journeys.map((j) => {
                const proposal = navigationProposal(j);
                return (
                  <article
                    key={j.id}
                    style={{
                      border: "1px solid var(--line)",
                      padding: 12,
                      borderRadius: 8,
                    }}
                  >
                    <label>
                      <input
                        type="checkbox"
                        checked={selected.includes(j.id)}
                        disabled={busy || !!ownership.commitIntent || !!receipt}
                        onChange={(e) => {
                          setSelected((ids) =>
                            e.target.checked
                              ? [...ids, j.id]
                              : ids.filter((id) => id !== j.id),
                          );
                          setDisclosure(false);
                        }}
                      />{" "}
                      {proposal.title}
                    </label>
                    <ol>
                      {j.steps.map((step) => (
                        <li key={step.sequence}>
                          {step.from.label} → {step.action.label} →{" "}
                          {step.to.label}
                        </li>
                      ))}
                    </ol>
                    <p>
                      <strong>Proposed assertion:</strong> {proposal.then[0]}
                    </p>
                    <details>
                      <summary>Exact observed journey</summary>
                      <pre
                        style={{
                          whiteSpace: "pre-wrap",
                          overflowWrap: "anywhere",
                        }}
                      >
                        {JSON.stringify(j, null, 2)}
                      </pre>
                    </details>
                  </article>
                );
              })}
              {!!chosen.length && (
                <>
                  <details>
                    <summary>Review exact selected content to add</summary>
                    <pre
                      style={{
                        whiteSpace: "pre-wrap",
                        overflowWrap: "anywhere",
                      }}
                    >
                      {JSON.stringify(chosen, null, 2)}
                    </pre>
                  </details>
                  <label>
                    <input
                      type="checkbox"
                      checked={disclosure}
                      disabled={busy || !!receipt || !!ownership.commitIntent}
                      onChange={(e) => setDisclosure(e.target.checked)}
                    />{" "}
                    I approve sending these selected journey labels and actions
                    to this Vaettir project and adding the proposed cases as
                    pending review.
                  </label>
                  <button
                    className="btn-secondary"
                    type="button"
                    disabled={
                      busy ||
                      shown.status === "ACTIVE" ||
                      !disclosure ||
                      !!receipt ||
                      selected.length > 12
                    }
                    onClick={() => void addSelected()}
                  >
                    {ownership.commitIntent && !receipt
                      ? "Recover add result"
                      : "Add selected proposed tests"}
                  </button>
                </>
              )}
              {receipt && (
                <p role="status">
                  {receipt.cases.length} selected proposed tests recorded as
                  pending review.
                </p>
              )}
            </>
          )}
          {ownership.pendingId && !busy && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => void readRetained()}
            >
              Read retained session without navigation
            </button>
          )}
          {error && <p role="alert">{error}</p>}
          {notice && <p role="status">{notice}</p>}
        </>
      )}
    </section>
  );
}
