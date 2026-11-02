"use client";
import { useEffect, useRef, useState } from "react";
import { trpcReact } from "@/lib/trpcReact";
import { ActionButton } from "@/components/ui/ActionButton";
import { androidReplayCase, androidReplayPlan, androidReplayState, androidReplayPatchInput, androidReplayPatchReceipt, androidReplayPatchedAction, type AndroidReplayCase, type AndroidReplayState, } from "../../api/src/services/androidCaseReplaySchema";
import { admitAndroidNetworkEvidence, androidNetworkEvidence, androidNetworkCatalog, } from "../../api/src/services/androidNetworkEvidenceSchema";
import { correlateAndroidNetwork } from "../../api/src/services/androidNetworkCorrelation";
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
    constructor(public live: Props) { }
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
        if (!this.mounted ||
            !p ||
            this.halted ||
            !this.live.accessAvailable ||
            !this.matches()) {
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
        return (this.mounted &&
            !!p &&
            (this.owner === null || this.owner === p.epochKey) &&
            (this.device === null || this.device === this.live.serial) &&
            (this.connection === null || this.connection === this.live.connectionKey));
    }
    halt() {
        this.halted = true;
    }
}
export function AndroidCaseReplay(props: Props) {
    const [owner] = useState(() => new AndroidReplayOwnership(props));
    owner.bind(props);
    const utils = trpcReact.useUtils();
    const [cases, setCases] = useState<{
        id: string;
        title: string;
    }[]>([]), [caseId, setCaseId] = useState("");
    const [selected, setSelected] = useState<AndroidReplayCase | null>(null), [planText, setPlanText] = useState("");
    const [ticket, setTicket] = useState<{
        ticket: string;
        packageName: string;
        expiresAt: number;
    } | null>(null);
    const [run, setRun] = useState<AndroidReplayState | null>(null), [consent, setConsent] = useState(false), [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState(""), [uncertain, setUncertain] = useState(false), [disclose, setDisclose] = useState(false), [patchReviewed, setPatchReviewed] = useState(false);
    const [receipt, setReceipt] = useState<typeof androidReplayPatchReceipt._output | null>(null);
    const [patchRequestId] = useState(() => crypto.randomUUID());
    const [patchPending, setPatchPending] = useState(false);
    const pending = useRef<typeof androidReplayPatchInput._output | null>(null);
    const [sourceId, setSourceId] = useState(""), [routeKeys, setRouteKeys] = useState(""), [networkApproved, setNetworkApproved] = useState(false);
    const [network, setNetwork] = useState<typeof androidNetworkEvidence._output | null>(null), [networkSelection, setNetworkSelection] = useState<typeof androidReplayPatchInput._output.networkSelection>(null);
    type RequestSetup = { sourceId: string; catalog: typeof androidNetworkCatalog._output };
    const [requestSetup, setRequestSetup] = useState<RequestSetup | null>(null);
    const [captureApproved, setCaptureApproved] = useState(false);
    const approvedCapture = useRef<RequestSetup | null>(null);
    const receivedCapture = useRef("");
    const startedAt = useRef(0), endedAt = useRef(0), retained = useRef<AndroidReplayState | null>(null);
    const stopRequested = useRef(false);
    const [stepByStep, setStepByStep] = useState(false);
    const originalPlan = useRef<typeof androidReplayPlan._output | null>(null);
    const dispatched = useRef<{
        requestId: string;
        sequence: number;
    } | null>(null);
    const visible = owner.matches() && !owner.halted && props.accessAvailable;
    useEffect(() => {
        owner.setMounted(true);
        return () => {
            owner.setMounted(false);
        };
    }, [owner]);
    useEffect(() => {
        if (!visible)
            owner.halt();
    }, [visible, owner]);
    function scopeInput() {
        const p = owner.pin(), id = props.nativeActorId();
        if (!id)
            throw Error("Connect the original account first.");
        return {
            projectId: p.scope.projectId,
            originalOrganizationId: p.scope.organizationId,
            expectedClerkActorId: p.scope.actorId,
            expectedNativeActorId: id,
        };
    }
    async function checkedCase() {
        if (!selected)
            throw Error("Select a supported existing case.");
        try {
            const result = androidReplayCase.parse(await utils.client.liveAppGeneration.replayCase.query({
                ...scopeInput(),
                caseId: selected.id,
                expectedRevision: selected.revision,
            }));
            owner.pin();
            if (result.id !== selected.id || result.revision !== selected.revision)
                throw Error();
            return result;
        }
        catch {
            owner.halt();
            throw Error("Access or case revision could not be verified. This run cannot resume.");
        }
    }
    async function work(fn: () => Promise<unknown>) {
        if (owner.busy || !owner.live.available)
            return;
        owner.setBusy(true);
        setBusy(true);
        setNotice("");
        try {
            owner.pin();
            await fn();
        }
        catch (e) {
            const code = (e as {
                data?: {
                    code?: string;
                };
            } | null)?.data?.code;
            if (code === "FORBIDDEN" || code === "UNAUTHORIZED")
                owner.halt();
            if (owner.matches())
                setNotice(e instanceof Error
                    ? e.message
                    : "The operation stopped. No automatic retry was made.");
        }
        finally {
            owner.setBusy(false);
            if (owner.mounted)
                setBusy(false);
        }
    }
    async function loadCases() {
        const cap = await props.request("/case-replay/v1/capabilities");
        owner.pin();
        if (JSON.stringify(cap) !==
            JSON.stringify({
                version: 1,
                platform: "ANDROID",
                supportedActions: ["TAP"],
                assertions: ["VISIBLE_LABEL"],
                appNetwork: "DEBUG_APP_EXPORT_ONLY",
                appNetworkCapture: { version: 2, transport: "APP_PRIVATE_FILES" },
                backgroundNavigation: false,
            }))
            throw Error("Download the current connector before replay.");
        try {
            const result = await utils.client.liveAppGeneration.replayCases.query(scopeInput());
            owner.pin();
            setCases(result);
        }
        catch {
            owner.halt();
            throw Error("Original case access could not be verified.");
        }
    }
    async function loadCase() {
        let value: AndroidReplayCase;
        try {
            value = androidReplayCase.parse(await utils.client.liveAppGeneration.replayCase.query({
                ...scopeInput(),
                caseId,
            }));
            owner.pin();
        }
        catch {
            owner.halt();
            throw Error("Original case access or supported procedure could not be verified.");
        }
        setSelected(value);
        setRequestSetup(null);
        setCaptureApproved(false);
        setConsent(false);
        setTicket(null);
        setPlanText(JSON.stringify({
            caseId: value.id,
            revision: value.revision,
            packageName: value.packageName ?? "",
            steps: value.steps.map((s) => ({
                stepId: s.id,
                label: s.label ?? s.action.slice(0, 200),
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
        }, null, 2));
    }
    async function inspect() {
        await checkedCase();
        const v = (await props.request("/case-replay/v1/inspect", {
            serial: props.serial,
            scope: owner.pin().scope,
        })) as {
            ticket: string;
            packageName: string;
            expiresAt: number;
        };
        owner.pin();
        if (!/^[a-f0-9]{48}$/.test(v.ticket) ||
            !v.packageName ||
            !Number.isSafeInteger(v.expiresAt))
            throw Error("Unsupported target check.");
        setTicket(v);
        setConsent(false);
    }
    function reviewedPlan() {
        const p = androidReplayPlan.parse(JSON.parse(planText));
        if (!selected ||
            p.caseId !== selected.id ||
            p.revision !== selected.revision ||
            p.steps.length !== selected.steps.length ||
            p.steps.some((s, i) => s.stepId !== selected.steps[i]!.id ||
                s.expectedResult !== selected.steps[i]!.expectedResult))
            throw Error("The selected case steps and expected results must stay unchanged.");
        return p;
    }
    function acceptState(raw: unknown, wantedId?: string) {
        const value = androidReplayState.parse(raw);
        const pin = owner.pin();
        if (value.plan.caseId !== selected?.id ||
            value.plan.revision !== selected.revision ||
            JSON.stringify(value.scope) !== JSON.stringify(pin.scope) ||
            (wantedId && value.id !== wantedId) ||
            JSON.stringify(value.plan) !== JSON.stringify(originalPlan.current) ||
            (retained.current &&
                (value.planHash !== retained.current.planHash ||
                    value.sequence < retained.current.sequence)))
            throw Error("The original replay receipt changed.");
        if (dispatched.current &&
            (value.lastRequestId !== dispatched.current.requestId ||
                value.sequence !== dispatched.current.sequence + 1))
            throw Error("The command receipt was not verified. Do not repeat it.");
        if (value.receipts.length > value.plan.steps.length ||
            value.receipts.some((r, i) => r.stepId !== value.plan.steps[i]!.stepId) ||
            (value.status === "COMPLETED" &&
                (value.receipts.length !== value.plan.steps.length ||
                    value.receipts.some((r) => !r.assertion.passed))))
            throw Error("The complete original assertion receipt is unavailable.");
        const capture = value.networkCapture;
        if (!approvedCapture.current && capture)
            throw Error("Unapproved app request evidence was refused.");
        if (approvedCapture.current && !capture)
            throw Error("Requested app evidence is missing. This run stopped.");
        if (capture?.status === "CAPTURED") {
            const expected = approvedCapture.current!;
            if (capture.metadata.version !== 2 || capture.selection.sourceId !== expected.sourceId ||
                JSON.stringify(capture.metadata.catalog) !== JSON.stringify(expected.catalog) ||
                JSON.stringify(capture.selection.correlation?.catalog) !== JSON.stringify(expected.catalog))
                throw Error("The approved debug source or request routes changed.");
            const metadata = admitAndroidNetworkEvidence(capture.metadata, {
                ...capture.selection, packageName: value.plan.packageName, runId: value.id,
            });
            const snapshot = JSON.stringify(capture);
            if (snapshot !== receivedCapture.current) {
                setNetwork(metadata);
                setNetworkSelection(capture.selection);
                setDisclose(false);
                setPatchReviewed(false);
                receivedCapture.current = snapshot;
            }
        } else if (capture?.status === "UNAVAILABLE") {
            setNetwork(null);
            setNetworkSelection(null);
            setDisclose(false);
            setPatchReviewed(false);
        }
        retained.current = value;
        setRun(value);
        if (!endedAt.current &&
            ["COMPLETED", "ASSERTION_FAILED", "UNCERTAIN", "STOPPED"].includes(value.status))
            endedAt.current = Date.now();
        return value;
    }
    async function start() {
        const plan = reviewedPlan();
        if (!consent ||
            !ticket ||
            ticket.packageName !== plan.packageName ||
            ticket.expiresAt <= Date.now())
            throw Error("Review this exact plan and selected app first.");
        await checkedCase();
        originalPlan.current = plan;
        approvedCapture.current = captureApproved && requestSetup ? structuredClone(requestSetup) : null;
        setCaptureApproved(false);
        startedAt.current = Date.now();
        setConsent(false);
        setUncertain(true);
        setTicket(null);
        const value = acceptState(await props.request("/case-replay/v1/start", {
            ticket: ticket.ticket,
            scope: owner.pin().scope,
            plan,
            ...(approvedCapture.current ? { networkApproval: {
                ...approvedCapture.current, debugMetadata: true, sourceReviewed: true,
                catalogReviewed: true, temporalOnlyReviewed: true,
            } } : {}),
            consent: {
                localObservation: true,
                oneRun: true,
                testAccount: true,
                assertionsReviewed: true,
            },
        }));
        if (JSON.stringify(value.plan) !== JSON.stringify(plan))
            throw Error("The connector changed the reviewed plan.");
        setUncertain(false);
        return value;
    }
    async function step(candidateId?: string, current = retained.current ?? run) {
        if (!current || uncertain)
            throw Error("Recover the retained result first.");
        await checkedCase();
        const requestId = crypto.randomUUID(), command = candidateId ? "retry" : "next";
        dispatched.current = { requestId, sequence: current.sequence };
        setUncertain(true);
        const value = acceptState(await props.request(`/case-replay/v1/${command}`, {
            id: current.id,
            scope: owner.pin().scope,
            revision: current.plan.revision,
            sequence: current.sequence,
            requestId,
            screenId: current.screen?.id,
            ...(candidateId ? { candidateId, retryApproved: true } : {}),
        }), current.id);
        if (value.lastRequestId !== requestId ||
            value.sequence !== current.sequence + 1)
            throw Error("The command receipt was not verified. Do not repeat it.");
        dispatched.current = null;
        setUncertain(false);
        return value;
    }
    async function runAll(initial = retained.current ?? run) {
        let current = initial;
        if (!current || uncertain)
            throw Error("Recover the retained result first.");
        const deadline = Math.min(current.expiresAt, Date.now() + 300000);
        for (let actions = 0; actions < 12 && current.status === "ACTIVE"; actions++) {
            owner.pin();
            if (!owner.live.available) { owner.halt(); throw Error("Connector unavailable. This run stopped."); }
            if (stopRequested.current || Date.now() >= deadline) {
                await stop(current);
                return;
            }
            current = await step(undefined, current);
        }
        if (current.status === "ACTIVE")
            await stop(current);
    }
    async function read() {
        if (!run)
            throw Error("Start outcome is unknown. Do not start another run; review the connector session.");
        await checkedCase();
        acceptState(await props.request("/case-replay/v1/read", {
            id: run.id,
            scope: owner.pin().scope,
        }), run.id);
        dispatched.current = null;
        setUncertain(false);
    }
    async function stop(current = retained.current ?? run) {
        if (!current)
            return;
        acceptState(await props.request("/case-replay/v1/stop", {
            id: current.id,
            scope: owner.pin().scope,
        }), current.id);
        setUncertain(false);
    }
    async function loadRequestSetup(file: File) {
        if (run || uncertain || file.size > 32768)
            throw Error("Choose a bounded debug request setup before the run.");
        await checkedCase();
        const raw = JSON.parse(await file.text());
        owner.pin();
        if (!raw || typeof raw !== "object" || Array.isArray(raw) ||
            Object.keys(raw).sort().join(",") !== "catalog,sourceId" ||
            typeof raw.sourceId !== "string" || !/^[a-z][a-z0-9_-]{0,63}$/.test(raw.sourceId))
            throw Error("Use the app developer’s request setup file.");
        const catalog = androidNetworkCatalog.parse(raw.catalog);
        setRequestSetup({ sourceId: raw.sourceId, catalog });
        setCaptureApproved(false);
        setConsent(false);
    }
    async function intake(file: File) {
        if (!networkApproved ||
            !run ||
            run.status !== "COMPLETED" ||
            file.size > 65536)
            throw Error("Approve the selected debug source and a bounded metadata file first.");
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
            if (!run ||
                run.status !== "COMPLETED" ||
                uncertain ||
                !disclose ||
                !patchReviewed)
                throw Error("Review the completed assertion evidence and separate case patch first.");
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
        const result = androidReplayPatchReceipt.parse(await utils.client.liveAppGeneration.patchReplayCase.mutate(pending.current));
        owner.pin();
        if (result.requestId !== pending.current.requestId ||
            result.caseId !== pending.current.plan.caseId ||
            result.priorRevision !== pending.current.plan.revision)
            throw Error("The saved patch receipt could not be verified.");
        setReceipt(result);
    }
    const networkCorrelation = run && network && networkSelection
        ? correlateAndroidNetwork(network, networkSelection, run.receipts) : null;
    const disabled = busy || !props.available || owner.halted || !visible;
    let draft: typeof androidReplayPlan._input | null = null;
    try {
        const value = JSON.parse(planText);
        if (selected && value?.caseId === selected.id && Array.isArray(value.steps) && value.steps.length === selected.steps.length && value.steps.every((s: {
            stepId?: string;
            locator?: unknown;
            assertion?: unknown;
        }, i: number) => s.stepId === selected.steps[i]!.id && s.locator && s.assertion))
            draft = value;
    }
    catch { /* Advanced input never grants run authority. */ }
    function editPlan(change: (plan: typeof androidReplayPlan._input) => void) {
        if (disabled || !draft)
            return;
        const next = structuredClone(draft);
        change(next);
        setPlanText(JSON.stringify(next, null, 2));
        setConsent(false);
        setCaptureApproved(false);
        setTicket(null);
    }
    return (<section className="panel" aria-label="Replay an existing Android case" data-sentry-mask="true" data-private="true" style={{ display: "grid", gap: 12, overflowWrap: "anywhere" }}>
      <h3>Run a case</h3>
      {!visible ? (<p>
          Access changed. Start a new connection to continue.
        </p>) : (<>
          <p>Choose a case, review its targets, then run. Changes stay pending until you review them.</p>
          {!run && !uncertain && (<>
              <ActionButton type="button" disabled={disabled || !props.serial} onClick={() => void work(loadCases)} tooltip="Load existing cases">Cases</ActionButton>
              <label>
                Test case
                <select value={caseId} disabled={disabled} onChange={(e) => {
                    setCaseId(e.target.value);
                    setSelected(null);
                    setRequestSetup(null);
                    setCaptureApproved(false);
                    setTicket(null);
                    setConsent(false);
                }}>
                  <option value="">Select a case</option>
                  {cases.map((c) => (<option key={c.id} value={c.id}>
                      {c.title}
                    </option>))}
                </select>
              </label>
              <ActionButton type="button" disabled={disabled || !caseId} onClick={() => void work(loadCase)} tooltip="Review selected case">Review</ActionButton>
              {selected && (<>
                  <h4>{selected.title}</h4>
                  <label>App package <input value={draft?.packageName ?? ""} disabled={disabled || !draft} onChange={e => editPlan(p => { p.packageName = e.target.value; })}/></label>
                  <ol>
                    {selected.steps.map((s, index) => (<li key={s.id}>
                        <p>{s.action}</p>
                        <p>Expected: {s.expectedResult}</p>
                        {draft && <fieldset disabled={disabled} style={{ display: "grid", gap: 8, border: 0, padding: 0 }}>
                          <label>Button label <input value={draft.steps[index]!.label} onChange={e => editPlan(p => { p.steps[index]!.label = e.target.value; })}/></label>
                          <label>Find by <select value={draft.steps[index]!.locator.kind} onChange={e => editPlan(p => { p.steps[index]!.locator.kind = e.target.value as "RESOURCE_ID" | "ACCESSIBILITY_ID" | "TEXT_CLASS"; })}>
                            <option value="RESOURCE_ID">Object ID</option><option value="ACCESSIBILITY_ID">Accessibility label</option><option value="TEXT_CLASS">Text and class</option>
                          </select></label>
                          <label>Target <input value={draft.steps[index]!.locator.value} onChange={e => editPlan(p => { p.steps[index]!.locator.value = e.target.value; })}/></label>
                          {draft.steps[index]!.locator.kind === "TEXT_CLASS" && <label>Object class <input value={draft.steps[index]!.locator.className ?? ""} onChange={e => editPlan(p => { p.steps[index]!.locator.className = e.target.value; })}/></label>}
                          <label>Expected label <input value={draft.steps[index]!.assertion.value} onChange={e => editPlan(p => { p.steps[index]!.assertion.value = e.target.value; })}/></label>
                        </fieldset>}
                      </li>))}
                  </ol>
                  <details><summary>Advanced</summary>
                  <label><input type="checkbox" checked={stepByStep} disabled={disabled} onChange={e => { setStepByStep(e.target.checked); setConsent(false); }}/> Step by step</label>
                  <label>
                    Reviewed replay plan
                    <textarea aria-label="Reviewed replay plan" rows={14} value={planText} disabled={disabled} onChange={(e) => {
                        setPlanText(e.target.value);
                        setConsent(false);
                        setTicket(null);
                    }} style={{ width: "100%", fontFamily: "monospace" }}/>
                  </label>
                  <p>
                    Only TAP and exact VISIBLE_LABEL assertions are supported.
                    Supply real locators from the selected app; no bounds-only
                    or invented selectors. An assertion checks this visible
                    label, not every business rule in the case.
                  </p>
                  </details>
                  <details>
                    <summary>App requests</summary>
                    <p>Optional. Requires request tracing in the app’s debug build.</p>
                    <label title="Choose the app developer’s setup containing its source ID and symbolic routes. No credentials or request contents.">Request setup
                      <input aria-label="App request setup" type="file" accept="application/json,.json" disabled={disabled} onChange={e => {
                          const file = e.target.files?.[0];
                          setCaptureApproved(false);
                          setRequestSetup(null);
                          setConsent(false);
                          if (file) void work(() => loadRequestSetup(file));
                          e.target.value = "";
                      }}/>
                    </label>
                    {requestSetup && <>
                      <p>Source: {requestSetup.sourceId}</p>
                      <table><caption>Approved routes</caption><thead><tr><th>Method</th><th>Route</th></tr></thead><tbody>
                        {requestSetup.catalog.routes.map(route => <tr key={route.routeKey}><td>{route.method}</td><td>{route.template}</td></tr>)}
                      </tbody></table>
                      <label><input type="checkbox" checked={captureApproved} disabled={disabled} onChange={e => {
                          setCaptureApproved(e.target.checked); setConsent(false);
                      }}/> Include this debug source and these routes for one run. Matches use timing and do not verify API behavior.</label>
                    </>}
                  </details>
                  <ActionButton type="button" disabled={disabled} onClick={() => void work(inspect)} tooltip="Check selected device’s open app">Check app</ActionButton>
                  {ticket && <p>Open app: {ticket.packageName}</p>}
                  <label>
                    <input type="checkbox" checked={consent} disabled={disabled} onChange={(e) => setConsent(e.target.checked)}/>{" "}
                    I approve this app and test account for one local run of the reviewed taps and label checks.
                  </label>
                  <ActionButton type="button" disabled={disabled || !consent || !ticket} onClick={() => void work(async () => { stopRequested.current = false; const value = await start(); if (!stepByStep)
                    await runAll(value); })} tooltip="Start reviewed run">Run</ActionButton>
                </>)}
            </>)}
          {run && (<>
              <p role="status">
                {run.status}:{" "}
                {run.reason ??
                    `${run.index} of ${run.plan.steps.length} assertions matched`}
              </p>
              <ActionButton type="button" disabled={disabled || uncertain || run.status !== "ACTIVE"} tooltip="Run all remaining reviewed steps, stopping for repair, failed assertions or changed access" onClick={() => void work(async () => { stopRequested.current = false; await runAll(); })}>Run</ActionButton>
              <ActionButton type="button" disabled={disabled || uncertain || run.status !== "ACTIVE"} onClick={() => void work(() => step())} tooltip="Run next reviewed step">Next</ActionButton>
              <ActionButton type="button" disabled={disabled} onClick={() => void work(read)} tooltip="Read retained result without acting">Refresh</ActionButton>
              <ActionButton type="button" disabled={!props.available || owner.halted || !visible || !["ACTIVE", "REPAIR_REVIEW"].includes(run.status)} onClick={() => { stopRequested.current = true; if (owner.busy)
                setNotice("Stopping after the current step.");
            else
                void work(() => stop()); }} tooltip="Stop run">Stop</ActionButton>
              {run.status === "REPAIR_REVIEW" && (<>
                  <p>
                    Target changed. Is one of these the correct button?
                  </p>
                  {run.candidates.map((c) => (<div key={c.id}>
                      <strong>{c.label}</strong>
                      <details><summary>Object details</summary><pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(c, null, 2)}</pre></details>
                      <ActionButton type="button" disabled={disabled || uncertain} onClick={() => void work(async () => { stopRequested.current = false; const value = await step(c.id); await runAll(value); })} tooltip="Approve this candidate and retry once">Use target</ActionButton>
                    </div>))}
                </>)}
              {run.networkCapture?.status === "UNAVAILABLE" && <p role="alert">App requests unavailable. Check the app’s debug integration.</p>}
              <details>
                <summary>
                  Run details
                </summary>
                <pre style={{ whiteSpace: "pre-wrap" }}>
                  {JSON.stringify(run.receipts, null, 2)}
                </pre>
              </details>
              {run.status === "COMPLETED" && !receipt && (<>
                  <details>
                    <summary>
                      Legacy export
                    </summary>
                    <p>
                      Import a legacy metadata export. These events remain unassigned to steps.
                    </p>
                    <label>
                      Approved source ID
                      <input value={sourceId} disabled={disabled || !!patchPending} onChange={(e) => {
                        setSourceId(e.target.value);
                        setNetworkApproved(false);
                        setNetwork(null);
                        setNetworkSelection(null);
                        setDisclose(false);
                        setPatchReviewed(false);
                    }}/>
                    </label>
                    <label>
                      Approved symbolic route keys, one per line
                      <textarea value={routeKeys} disabled={disabled || !!patchPending} onChange={(e) => {
                        setRouteKeys(e.target.value);
                        setNetworkApproved(false);
                        setNetwork(null);
                        setNetworkSelection(null);
                        setDisclose(false);
                        setPatchReviewed(false);
                    }}/>
                    </label>
                    <label>
                      <input type="checkbox" checked={networkApproved} disabled={disabled || !!patchPending} onChange={(e) => {
                        setNetworkApproved(e.target.checked);
                        setNetwork(null);
                        setNetworkSelection(null);
                        setDisclose(false);
                        setPatchReviewed(false);
                    }}/>{" "}
                      I selected and approved this app-owned debug source and
                      these route keys.
                    </label>
                    <input aria-label="Debug app metadata export" type="file" accept="application/json,.json" disabled={disabled || !networkApproved || !!patchPending} onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f)
                            void work(() => intake(f));
                        e.target.value = "";
                    }}/>
                  </details>
                  <p>
                    {network
                        ? `${network.events.length} app-reported HTTP metadata events from ${network.sourceId}; not independently verified and not an API correctness assertion.`
                        : "App HTTP traffic: NOT_CAPTURED."}
                  </p>
                  <details>
                    <summary>Review changes</summary>
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
                      {JSON.stringify({
                        actions: run.receipts.map((r, i) => androidReplayPatchedAction(selected!.steps[i]!.action, run.id, r, network, patchRequestId, networkCorrelation)),
                        plan: run.plan,
                        receipts: run.receipts,
                        network,
                    }, null, 2)}
                    </pre>
                  </details>
                  <label>
                    <input type="checkbox" checked={disclose} disabled={disabled || !!patchPending} onChange={(e) => setDisclose(e.target.checked)}/>{" "}
                    Approve disclosure of this exact local-reported evidence to
                    the original project.
                  </label>
                  <label>
                    <input type="checkbox" checked={patchReviewed} disabled={disabled || !!patchPending} onChange={(e) => setPatchReviewed(e.target.checked)}/>{" "}
                    I reviewed the separate versioned case patch and pending
                    ordinary approval.
                  </label>
                  <ActionButton type="button" disabled={disabled ||
                        (!patchPending &&
                            (!disclose || !patchReviewed || uncertain))} onClick={() => void work(save)} tooltip={patchPending
                    ? "Recover exact patch receipt"
                    : "Save reviewed technical case patch"}>{patchPending ? "Recover" : "Save"}</ActionButton>
                </>)}
            </>)}
          {uncertain && (<p role="alert">
              Result unconfirmed. Refresh to check it; do not repeat the action.
            </p>)}
          {owner.halted && (<p role="alert">
              Access ended. This run cannot resume.
            </p>)}
          {receipt && (<p role="status">
              Version {receipt.versionNumber} saved for review.
            </p>)}
          {notice && <p role="alert">{notice}</p>}
        </>)}
    </section>);
}
