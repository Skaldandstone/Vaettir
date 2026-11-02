"use client";
import { useEffect, useRef, useState } from "react";
import { trpcReact } from "@/lib/trpcReact";
import {
  androidReplayCase,
  androidReplayPlan,
  androidReplayState,
  androidReplayPatchInput,
  androidReplayPatchReceipt,
  androidReplayPatchedAction,
  type AndroidReplayCase,
  type AndroidReplayState,
} from "../../api/src/services/androidCaseReplaySchema";
import {
  admitAndroidNetworkEvidence,
  androidNetworkEvidence,
} from "../../api/src/services/androidNetworkEvidenceSchema";
import type { androidExplorationScope } from "../../api/src/services/androidExplorationSchema";

type Props = {
  serial: string;
  connectionKey: string;
  available: boolean;
  accessAvailable: boolean;
  currentScope: () => {
    scope: typeof androidExplorationScope._output;
    epochKey: string;
  } | null;
  nativeActorId: () => string | null;
  request: (path: string, body?: unknown) => Promise<unknown>;
};
// A denial or scope transition consumes this component's run authority. Restoring
// access cannot resume the retained run; only read/receipt recovery is offered.
export class AndroidReplayOwnership {
  owner: string | null = null;
  device: string | null = null;
  connection: string | null = null;
  busy = false;
  halted = false;
  mounted = true;
  constructor(public live: Props) {}
  bind(props: Props) {
    this.live = props;
  }
  setMounted(value: boolean) {
    this.mounted = value;
  }
  setBusy(value: boolean) {
    this.busy = value;
  }
  pin() {
    const p = this.live.currentScope();
    if (
      !this.mounted ||
      !p ||
      this.halted ||
      !this.live.accessAvailable ||
      !this.matches()
    ) {
      this.halt();
      throw Error("Original replay authority ended.");
    }
    this.owner ??= p.epochKey;
    this.device ??= this.live.serial;
    this.connection ??= this.live.connectionKey;
    return p;
  }
  matches() {
    const p = this.live.currentScope();
    return (
      this.mounted &&
      !!p &&
      (this.owner === null || this.owner === p.epochKey) &&
      (this.device === null || this.device === this.live.serial) &&
      (this.connection === null || this.connection === this.live.connectionKey)
    );
  }
  halt() {
    this.halted = true;
  }
}
export function AndroidCaseReplay(props: Props) {
  const [owner] = useState(() => new AndroidReplayOwnership(props));
  owner.bind(props);
  const utils = trpcReact.useUtils();
  const [cases, setCases] = useState<{ id: string; title: string }[]>([]),
    [caseId, setCaseId] = useState("");
  const [selected, setSelected] = useState<AndroidReplayCase | null>(null),
    [planText, setPlanText] = useState("");
  const [ticket, setTicket] = useState<{
    ticket: string;
    packageName: string;
    expiresAt: number;
  } | null>(null);
  const [run, setRun] = useState<AndroidReplayState | null>(null),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(""),
    [uncertain, setUncertain] = useState(false),
    [disclose, setDisclose] = useState(false),
    [patchReviewed, setPatchReviewed] = useState(false);
  const [receipt, setReceipt] = useState<
    typeof androidReplayPatchReceipt._output | null
  >(null);
  const [patchRequestId] = useState(() => crypto.randomUUID());
  const [patchPending, setPatchPending] = useState(false);
  const pending = useRef<typeof androidReplayPatchInput._output | null>(null);
  const [sourceId, setSourceId] = useState(""),
    [routeKeys, setRouteKeys] = useState(""),
    [networkApproved, setNetworkApproved] = useState(false);
  const [network, setNetwork] = useState<
      typeof androidNetworkEvidence._output | null
    >(null),
    [networkSelection, setNetworkSelection] =
      useState<typeof androidReplayPatchInput._output.networkSelection>(null);
  const startedAt = useRef(0),
    endedAt = useRef(0),
    retained = useRef<AndroidReplayState | null>(null);
  const originalPlan = useRef<typeof androidReplayPlan._output | null>(null);
  const dispatched = useRef<{ requestId: string; sequence: number } | null>(
    null,
  );
  const visible = owner.matches() && !owner.halted && props.accessAvailable;
  useEffect(() => {
    owner.setMounted(true);
    return () => {
      owner.setMounted(false);
    };
  }, [owner]);
  useEffect(() => {
    if (!visible) owner.halt();
  }, [visible, owner]);
  function scopeInput() {
    const p = owner.pin(),
      id = props.nativeActorId();
    if (!id) throw Error("Connect the original account first.");
    return {
      projectId: p.scope.projectId,
      originalOrganizationId: p.scope.organizationId,
      expectedClerkActorId: p.scope.actorId,
      expectedNativeActorId: id,
    };
  }
  async function checkedCase() {
    if (!selected) throw Error("Select a supported existing case.");
    try {
      const result = androidReplayCase.parse(
        await utils.client.liveAppGeneration.replayCase.query({
          ...scopeInput(),
          caseId: selected.id,
          expectedRevision: selected.revision,
        }),
      );
      owner.pin();
      if (result.id !== selected.id || result.revision !== selected.revision)
        throw Error();
      return result;
    } catch {
      owner.halt();
      throw Error(
        "Access or case revision could not be verified. This run cannot resume.",
      );
    }
  }
  async function work(fn: () => Promise<void>) {
    if (owner.busy || !owner.live.available) return;
    owner.setBusy(true);
    setBusy(true);
    setNotice("");
    try {
      owner.pin();
      await fn();
    } catch (e) {
      const code = (e as { data?: { code?: string } } | null)?.data?.code;
      if (code === "FORBIDDEN" || code === "UNAUTHORIZED") owner.halt();
      if (owner.matches())
        setNotice(
          e instanceof Error
            ? e.message
            : "The operation stopped. No automatic retry was made.",
        );
    } finally {
      owner.setBusy(false);
      if (owner.mounted) setBusy(false);
    }
  }
  async function loadCases() {
    const cap = await props.request("/case-replay/v1/capabilities");
    owner.pin();
    if (
      JSON.stringify(cap) !==
      JSON.stringify({
        version: 1,
        platform: "ANDROID",
        supportedActions: ["TAP"],
        assertions: ["VISIBLE_LABEL"],
        appNetwork: "DEBUG_APP_EXPORT_ONLY",
        backgroundNavigation: false,
      })
    )
      throw Error("Download the current connector before replay.");
    try {
      const result =
        await utils.client.liveAppGeneration.replayCases.query(scopeInput());
      owner.pin();
      setCases(result);
    } catch {
      owner.halt();
      throw Error("Original case access could not be verified.");
    }
  }
  async function loadCase() {
    let value: AndroidReplayCase;
    try {
      value = androidReplayCase.parse(
        await utils.client.liveAppGeneration.replayCase.query({
          ...scopeInput(),
          caseId,
        }),
      );
      owner.pin();
    } catch {
      owner.halt();
      throw Error(
        "Original case access or supported procedure could not be verified.",
      );
    }
    setSelected(value);
    setConsent(false);
    setTicket(null);
    setPlanText(
      JSON.stringify(
        {
          caseId: value.id,
          revision: value.revision,
          packageName: value.packageName ?? "",
          steps: value.steps.map((s) => ({
            stepId: s.id,
            label: s.label ?? "",
            expectedResult: s.expectedResult,
            locator: s.locator ?? {
              kind: "RESOURCE_ID",
              value: "",
              className: null,
            },
            assertion: {
              kind: "VISIBLE_LABEL",
              value: "",
              relationReviewed: true,
            },
          })),
        },
        null,
        2,
      ),
    );
  }
  async function inspect() {
    await checkedCase();
    const v = (await props.request("/case-replay/v1/inspect", {
      serial: props.serial,
      scope: owner.pin().scope,
    })) as { ticket: string; packageName: string; expiresAt: number };
    owner.pin();
    if (
      !/^[a-f0-9]{48}$/.test(v.ticket) ||
      !v.packageName ||
      !Number.isSafeInteger(v.expiresAt)
    )
      throw Error("Unsupported target check.");
    setTicket(v);
    setConsent(false);
  }
  function reviewedPlan() {
    const p = androidReplayPlan.parse(JSON.parse(planText));
    if (
      !selected ||
      p.caseId !== selected.id ||
      p.revision !== selected.revision ||
      p.steps.length !== selected.steps.length ||
      p.steps.some(
        (s, i) =>
          s.stepId !== selected.steps[i]!.id ||
          s.expectedResult !== selected.steps[i]!.expectedResult,
      )
    )
      throw Error(
        "The selected case steps and expected results must stay unchanged.",
      );
    return p;
  }
  function acceptState(raw: unknown, wantedId?: string) {
    const value = androidReplayState.parse(raw);
    const pin = owner.pin();
    if (
      value.plan.caseId !== selected?.id ||
      value.plan.revision !== selected.revision ||
      JSON.stringify(value.scope) !== JSON.stringify(pin.scope) ||
      (wantedId && value.id !== wantedId) ||
      JSON.stringify(value.plan) !== JSON.stringify(originalPlan.current) ||
      (retained.current &&
        (value.planHash !== retained.current.planHash ||
          value.sequence < retained.current.sequence))
    )
      throw Error("The original replay receipt changed.");
    if (
      dispatched.current &&
      (value.lastRequestId !== dispatched.current.requestId ||
        value.sequence !== dispatched.current.sequence + 1)
    )
      throw Error("The command receipt was not verified. Do not repeat it.");
    if (
      value.receipts.length > value.plan.steps.length ||
      value.receipts.some((r, i) => r.stepId !== value.plan.steps[i]!.stepId) ||
      (value.status === "COMPLETED" &&
        (value.receipts.length !== value.plan.steps.length ||
          value.receipts.some((r) => !r.assertion.passed)))
    )
      throw Error("The complete original assertion receipt is unavailable.");
    retained.current = value;
    setRun(value);
    if (
      !endedAt.current &&
      ["COMPLETED", "ASSERTION_FAILED", "UNCERTAIN", "STOPPED"].includes(
        value.status,
      )
    )
      endedAt.current = Date.now();
    return value;
  }
  async function start() {
    const plan = reviewedPlan();
    if (
      !consent ||
      !ticket ||
      ticket.packageName !== plan.packageName ||
      ticket.expiresAt <= Date.now()
    )
      throw Error("Review this exact plan and selected app first.");
    await checkedCase();
    originalPlan.current = plan;
    startedAt.current = Date.now();
    setConsent(false);
    setUncertain(true);
    setTicket(null);
    const value = acceptState(
      await props.request("/case-replay/v1/start", {
        ticket: ticket.ticket,
        scope: owner.pin().scope,
        plan,
        consent: {
          localObservation: true,
          oneRun: true,
          testAccount: true,
          assertionsReviewed: true,
        },
      }),
    );
    if (JSON.stringify(value.plan) !== JSON.stringify(plan))
      throw Error("The connector changed the reviewed plan.");
    setUncertain(false);
  }
  async function step(candidateId?: string) {
    if (!run || uncertain) throw Error("Recover the retained result first.");
    await checkedCase();
    const requestId = crypto.randomUUID(),
      command = candidateId ? "retry" : "next";
    dispatched.current = { requestId, sequence: run.sequence };
    setUncertain(true);
    const value = acceptState(
      await props.request(`/case-replay/v1/${command}`, {
        id: run.id,
        scope: owner.pin().scope,
        revision: run.plan.revision,
        sequence: run.sequence,
        requestId,
        screenId: run.screen?.id,
        ...(candidateId ? { candidateId, retryApproved: true } : {}),
      }),
      run.id,
    );
    if (
      value.lastRequestId !== requestId ||
      value.sequence !== run.sequence + 1
    )
      throw Error("The command receipt was not verified. Do not repeat it.");
    dispatched.current = null;
    setUncertain(false);
  }
  async function read() {
    if (!run)
      throw Error(
        "Start outcome is unknown. Do not start another run; review the connector session.",
      );
    await checkedCase();
    acceptState(
      await props.request("/case-replay/v1/read", {
        id: run.id,
        scope: owner.pin().scope,
      }),
      run.id,
    );
    dispatched.current = null;
    setUncertain(false);
  }
  async function stop() {
    if (!run) return;
    acceptState(
      await props.request("/case-replay/v1/stop", {
        id: run.id,
        scope: owner.pin().scope,
      }),
      run.id,
    );
    setUncertain(false);
  }
  async function intake(file: File) {
    if (
      !networkApproved ||
      !run ||
      run.status !== "COMPLETED" ||
      file.size > 65536
    )
      throw Error(
        "Approve the selected debug source and a bounded metadata file first.",
      );
    await checkedCase();
    const selection = {
      sourceId,
      approvedRouteKeys: routeKeys.split("\n").filter(Boolean),
      startedAt: startedAt.current,
      endedAt: endedAt.current,
    };
    const raw = JSON.parse(await file.text());
    owner.pin();
    const value = admitAndroidNetworkEvidence(raw, {
      ...selection,
      packageName: run.plan.packageName,
      runId: run.id,
    });
    setNetwork(value);
    setNetworkSelection(selection);
    setDisclose(false);
    setPatchReviewed(false);
  }
  async function save() {
    if (!pending.current) {
      if (
        !run ||
        run.status !== "COMPLETED" ||
        uncertain ||
        !disclose ||
        !patchReviewed
      )
        throw Error(
          "Review the completed assertion evidence and separate case patch first.",
        );
      await checkedCase();
      pending.current = androidReplayPatchInput.parse({
        ...scopeInput(),
        requestId: patchRequestId,
        plan: run.plan,
        planHash: run.planHash,
        runId: run.id,
        receipts: run.receipts,
        network,
        networkSelection,
        localReportedEvidenceReviewed: true,
        patchReviewed: true,
        disclosureApproved: true,
      });
    }
    setPatchPending(true);
    // Retain this exact request across a lost write reply. No new UUID or patch.
    const result = androidReplayPatchReceipt.parse(
      await utils.client.liveAppGeneration.patchReplayCase.mutate(
        pending.current,
      ),
    );
    owner.pin();
    if (
      result.requestId !== pending.current.requestId ||
      result.caseId !== pending.current.plan.caseId ||
      result.priorRevision !== pending.current.plan.revision
    )
      throw Error("The saved patch receipt could not be verified.");
    setReceipt(result);
  }
  const disabled = busy || !props.available || owner.halted || !visible;
  return (
    <section
      className="panel"
      aria-label="Replay an existing Android case"
      style={{ display: "grid", gap: 12, overflowWrap: "anywhere" }}
    >
      <h3>Replay an existing case</h3>
      {!visible ? (
        <p>
          Original account, project, device or replay authority changed.
          Retained replay evidence is hidden; restoring access cannot resume
          this run.
        </p>
      ) : (
        <>
          <p>
            Select a case with its own steps. Review each tap locator and
            visible-text assertion against the unchanged expected result.
            Shared-library, unstructured and unsupported steps need manual
            execution.
          </p>
          {!run && !uncertain && (
            <>
              <button
                type="button"
                disabled={disabled || !props.serial}
                onClick={() => void work(loadCases)}
              >
                Load existing cases
              </button>
              <label>
                Existing case (first 100 by ID)
                <select
                  value={caseId}
                  disabled={disabled}
                  onChange={(e) => {
                    setCaseId(e.target.value);
                    setSelected(null);
                    setTicket(null);
                    setConsent(false);
                  }}
                >
                  <option value="">Select a case</option>
                  {cases.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={disabled || !caseId}
                onClick={() => void work(loadCase)}
              >
                Review selected case
              </button>
              {selected && (
                <>
                  <h4>{selected.title}</h4>
                  <ol>
                    {selected.steps.map((s) => (
                      <li key={s.id}>
                        <p>{s.action}</p>
                        <p>Expected: {s.expectedResult}</p>
                      </li>
                    ))}
                  </ol>
                  <label>
                    Reviewed replay plan
                    <textarea
                      aria-label="Reviewed replay plan"
                      rows={14}
                      value={planText}
                      disabled={disabled}
                      onChange={(e) => {
                        setPlanText(e.target.value);
                        setConsent(false);
                        setTicket(null);
                      }}
                      style={{ width: "100%", fontFamily: "monospace" }}
                    />
                  </label>
                  <p>
                    Only TAP and exact VISIBLE_LABEL assertions are supported.
                    Supply real locators from the selected app; no bounds-only
                    or invented selectors. An assertion checks this visible
                    label, not every business rule in the case.
                  </p>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => void work(inspect)}
                  >
                    Check selected device’s open app
                  </button>
                  {ticket && <p>Open app: {ticket.packageName}</p>}
                  <label>
                    <input
                      type="checkbox"
                      checked={consent}
                      disabled={disabled}
                      onChange={(e) => setConsent(e.target.checked)}
                    />{" "}
                    I approve this exact app, test account, local observation
                    and one run. I reviewed how each assertion represents the
                    unchanged expected result.
                  </label>
                  <button
                    type="button"
                    disabled={disabled || !consent || !ticket}
                    onClick={() => void work(start)}
                  >
                    Start reviewed run
                  </button>
                </>
              )}
            </>
          )}
          {run && (
            <>
              <p role="status">
                {run.status}:{" "}
                {run.reason ??
                  `${run.index} of ${run.plan.steps.length} assertions matched`}
              </p>
              <p>
                Run {run.id}. Before/after focus observations are not atomic.
                Evidence is reported by this local connector.
              </p>
              <button
                type="button"
                disabled={disabled || uncertain || run.status !== "ACTIVE"}
                onClick={() => void work(() => step())}
              >
                Run next reviewed step
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => void work(read)}
              >
                Read retained result without acting
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => void work(stop)}
              >
                Stop run
              </button>
              {run.status === "REPAIR_REVIEW" && (
                <>
                  <p>
                    The original target did not resolve. Choose a replacement
                    only if it is the intended path. Each choice approves one
                    fresh, bounded retry; assertions stay unchanged.
                  </p>
                  {run.candidates.map((c) => (
                    <div key={c.id}>
                      <pre style={{ whiteSpace: "pre-wrap" }}>
                        {JSON.stringify(c, null, 2)}
                      </pre>
                      <button
                        type="button"
                        disabled={disabled || uncertain}
                        onClick={() => void work(() => step(c.id))}
                      >
                        Approve this candidate and retry once
                      </button>
                    </div>
                  ))}
                </>
              )}
              <details>
                <summary>
                  Exact selectors, ADB commands and assertion evidence
                </summary>
                <pre style={{ whiteSpace: "pre-wrap" }}>
                  {JSON.stringify(run.receipts, null, 2)}
                </pre>
              </details>
              {run.status === "COMPLETED" && !receipt && (
                <>
                  <details>
                    <summary>
                      Optional app HTTP evidence from an approved debug build
                    </summary>
                    <p>
                      ADB does not capture app HTTP traffic. Integrate the debug
                      instrumentation example into the selected app. Configure
                      this run ID before the run’s actions, then export only its
                      approved route metadata. No TLS interception, rooting,
                      global logs, URLs, headers or bodies are accepted.
                    </p>
                    <label>
                      Approved source ID
                      <input
                        value={sourceId}
                        disabled={disabled || !!patchPending}
                        onChange={(e) => {
                          setSourceId(e.target.value);
                          setNetworkApproved(false);
                          setNetwork(null);
                          setNetworkSelection(null);
                          setDisclose(false);
                          setPatchReviewed(false);
                        }}
                      />
                    </label>
                    <label>
                      Approved symbolic route keys, one per line
                      <textarea
                        value={routeKeys}
                        disabled={disabled || !!patchPending}
                        onChange={(e) => {
                          setRouteKeys(e.target.value);
                          setNetworkApproved(false);
                          setNetwork(null);
                          setNetworkSelection(null);
                          setDisclose(false);
                          setPatchReviewed(false);
                        }}
                      />
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={networkApproved}
                        disabled={disabled || !!patchPending}
                        onChange={(e) => {
                          setNetworkApproved(e.target.checked);
                          setNetwork(null);
                          setNetworkSelection(null);
                          setDisclose(false);
                          setPatchReviewed(false);
                        }}
                      />{" "}
                      I selected and approved this app-owned debug source and
                      these route keys.
                    </label>
                    <input
                      aria-label="Debug app metadata export"
                      type="file"
                      accept="application/json,.json"
                      disabled={disabled || !networkApproved || !!patchPending}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void work(() => intake(f));
                        e.target.value = "";
                      }}
                    />
                  </details>
                  <p>
                    {network
                      ? `${network.events.length} app-reported HTTP metadata events from ${network.sourceId}; not independently verified and not an API correctness assertion.`
                      : "App HTTP traffic: NOT_CAPTURED."}
                  </p>
                  <details>
                    <summary>Review exact case patch and disclosure</summary>
                    <p>
                      Append the reviewed technical evidence below to each
                      step’s action, create a new version and audit receipt, and
                      return ordinary case approval to pending. Expected
                      results, responses, other fields and original source
                      provenance are preserved. The saved action evidence
                      becomes context for the existing UI Automator draft
                      option; no draft is generated or charged here.
                    </p>
                    <pre style={{ whiteSpace: "pre-wrap" }}>
                      {JSON.stringify(
                        {
                          actions: run.receipts.map((r, i) =>
                            androidReplayPatchedAction(
                              selected!.steps[i]!.action,
                              run.id,
                              r,
                              network,
                              patchRequestId,
                            ),
                          ),
                          plan: run.plan,
                          receipts: run.receipts,
                          network,
                        },
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                  <label>
                    <input
                      type="checkbox"
                      checked={disclose}
                      disabled={disabled || !!patchPending}
                      onChange={(e) => setDisclose(e.target.checked)}
                    />{" "}
                    Approve disclosure of this exact local-reported evidence to
                    the original project.
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={patchReviewed}
                      disabled={disabled || !!patchPending}
                      onChange={(e) => setPatchReviewed(e.target.checked)}
                    />{" "}
                    I reviewed the separate versioned case patch and pending
                    ordinary approval.
                  </label>
                  <button
                    type="button"
                    disabled={
                      disabled ||
                      (!patchPending &&
                        (!disclose || !patchReviewed || uncertain))
                    }
                    onClick={() => void work(save)}
                  >
                    {patchPending
                      ? "Recover exact patch receipt"
                      : "Save reviewed technical case patch"}
                  </button>
                </>
              )}
            </>
          )}
          {uncertain && (
            <p role="alert">
              The last operation is unresolved. Read its retained result; never
              repeat the action. If the start reply was lost, reconcile the
              connector session manually.
            </p>
          )}
          {owner.halted && (
            <p role="alert">
              Replay authority ended. Restoring access does not resume this run.
            </p>
          )}
          {receipt && (
            <p role="status">
              Saved case version {receipt.versionNumber}. Ordinary approval and
              physical-device acceptance remain separate.
            </p>
          )}
          {notice && <p role="alert">{notice}</p>}
        </>
      )}
    </section>
  );
}
