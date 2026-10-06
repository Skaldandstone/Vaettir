"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import { trpcReact, type RouterInputs, type RouterOutputs } from "@/lib/trpcReact";
import { parseStepMeasurements, isDefinitiveStepRejection, type StepReading, type StepStatus } from "@/lib/step-execution-form";
import { Modal } from "./Modal";
import { technicalBehaviorLabel } from "@/lib/case-authoring-fields";

type ExecutionCase = RouterOutputs["manualExecution"]["getForExecution"]["cases"][number];
type CurrentStep = NonNullable<ExecutionCase["stepResults"][number]["current"]>;
type StepRequest = RouterInputs["manualExecution"]["recordStepResult"];
type Observations = NonNullable<ExecutionCase["currentResult"]>["observations"];
type Draft = { stepIndex: number; current: CurrentStep | null; status: StepStatus | ""; note: string; context: Omit<Observations, "measurements">; readings: StepReading[]; attachmentIds: string[]; attachmentNames: Record<string, string>; correctionReason: string };
function draftFor(index: number, current: CurrentStep | null): Draft {
  const observations = current?.observations;
  return { stepIndex: index, current, status: current?.status ?? "", note: current?.note ?? "", context: { specimen: observations?.specimen ?? "", hardwareRevision: observations?.hardwareRevision ?? "", firmwareVersion: observations?.firmwareVersion ?? "", environment: observations?.environment ?? "" }, readings: (observations?.measurements ?? []).map(item => ({ ...item, value: String(item.value), lowerLimit: item.lowerLimit === undefined ? "" : String(item.lowerLimit), upperLimit: item.upperLimit === undefined ? "" : String(item.upperLimit) })), attachmentIds: current?.evidenceAttachments.map(item => item.id) ?? [], attachmentNames: Object.fromEntries(current?.evidenceAttachments.map(item => [item.id, item.fileName]) ?? []), correctionReason: "" };
}

function RevisionDetails({ revision }: { revision: CurrentStep }) {
  return <div style={{ overflowWrap: "anywhere" }}>{revision.note && <p style={{ whiteSpace: "pre-wrap" }}>Actual outcome: {revision.note}</p>}{Object.entries(revision.observations).filter(([key, value]) => key !== "measurements" && value).map(([key, value]) => <p key={key}>{key.replace(/([A-Z])/g, " $1")}: {String(value)}</p>)}<ul style={{ paddingLeft: 20 }}>{revision.observations.measurements.map((reading, index) => <li key={index}>{reading.name}: {reading.value} {reading.unit}. Limits {reading.lowerLimit ?? "none"} to {reading.upperLimit ?? "none"}. Instrument {reading.instrument || "not supplied"}.</li>)}</ul>{revision.correctionReason && <p>Correction reason: {revision.correctionReason}</p>}<p>Stored evidence: {revision.evidenceAttachments.map(file => file.fileName).join(", ") || "none"}</p></div>;
}

function StepHistory({ testRunId, testCaseId, stepIndex }: { testRunId: string; testCaseId: string; stepIndex: number }) {
  const [cursor, setCursor] = useState<string | undefined>();
  const query = trpcReact.manualExecution.stepResultHistory.useQuery({ testRunId, testCaseId, stepIndex, cursor, limit: 10 });
  return <div>{query.error ? <p role="alert">Revision history could not be loaded.</p> : !query.data ? <p role="status">Loading revision history…</p> : <><ol style={{ paddingLeft: 20 }}>{query.data.revisions.map(revision => <li key={revision.id} style={{ marginTop: 10, overflowWrap: "anywhere" }}><strong>{revision.status}</strong> · {revision.actorName} · {new Date(revision.recordedAt).toLocaleString()}<RevisionDetails revision={revision} /></li>)}</ol>{query.data.revisions.length === 0 && <p>No recorded revisions for this step.</p>}<div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}><button className="btn-secondary" disabled={!cursor} onClick={() => setCursor(undefined)}>Latest revisions</button><button className="btn-secondary" disabled={!query.data.nextCursor} onClick={() => setCursor(query.data?.nextCursor ?? undefined)}>Older revisions</button></div></>}</div>;
}

export function StepExecutionPanel({ testRunId, testCase, stepFieldLabels, active, readable = true, readScope, disabled, blockedBy, onModeActive, onChanged, onUnconfirmedChange }: { testRunId: string; testCase: ExecutionCase; stepFieldLabels: Record<string, string>; active: boolean; readable?: boolean; readScope?: { projectId: string; originalOrganizationId?: string; expectedClerkActorId?: string }; disabled: boolean; blockedBy: string[]; onModeActive: () => void; onChanged: () => Promise<unknown>; onUnconfirmedChange?: (pending: boolean) => void }) {
  const utils = trpcReact.useUtils();
  const readableNow = useRef(false);
  useLayoutEffect(() => {
    readableNow.current = readable;
    return () => { readableNow.current = false; };
  }, [readable]);
  const mutation = trpcReact.manualExecution.recordStepResult.useMutation();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [open, setOpen] = useState(false);
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<StepRequest | null>(null);
  const [everAmbiguous, setEverAmbiguous] = useState(false);
  const [definitiveRejection, setDefinitiveRejection] = useState(false);
  const [savedRevisionId, setSavedRevisionId] = useState<string | null>(null);
  const [freshCurrent, setFreshCurrent] = useState<{ current: CurrentStep | null } | null>(null);
  const [search, setSearch] = useState("");
  const [evidenceCursor, setEvidenceCursor] = useState<string | undefined>();
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const evidenceQuery = trpcReact.manualExecution.listStepEvidence.useQuery({ testRunId, search: search.trim(), cursor: evidenceCursor }, { enabled: readable && open && evidenceOpen });
  const prefix = useId();
  const hasSteps = testCase.stepResults.some(item => item.current);
  const selectedStep = draft ? testCase.steps[draft.stepIndex] : null;
  const locked = busy || Boolean(attempt) || Boolean(savedRevisionId) || Boolean(freshCurrent) || disabled;
  const physical = testCase.validationDomain !== "SOFTWARE";
  function select(index: number) {
    if (!readable) return;
    if (draft && !savedRevisionId) { if (draft.stepIndex === index) setOpen(true); return; }
    setDraft(draftFor(index, testCase.stepResults.find(item => item.stepIndex === index)?.current ?? null));
    setOpen(true); setReview(false); setError(null); setAttempt(null); setEverAmbiguous(false); setDefinitiveRejection(false); setSavedRevisionId(null); setFreshCurrent(null); setHistoryOpen(false); setEvidenceOpen(false);
  }
  function update(change: Partial<Draft>) { setDraft(current => current ? { ...current, ...change } : current); }
  function makeRequest(): StepRequest {
    if (!draft) throw new Error("Select a step before recording.");
    if (!draft.status) throw new Error("Choose the observed outcome explicitly before recording.");
    if (draft.current && !draft.correctionReason.trim()) throw new Error("Enter a correction reason before creating a new revision.");
    if (["PASS", "FAIL"].includes(draft.status) && blockedBy.length) throw new Error("Required prerequisite cases must pass before recording Pass or Fail.");
    return { testRunId, testCaseId: testCase.testCaseId, stepIndex: draft.stepIndex, status: draft.status, note: draft.note.trim(), observations: { ...draft.context, measurements: parseStepMeasurements(draft.readings, draft.status) }, evidenceAttachmentIds: [...draft.attachmentIds], expectedRevisionId: draft.current?.id ?? null, correctionReason: draft.correctionReason.trim() || undefined, idempotencyKey: crypto.randomUUID() };
  }
  function reviewDraft() { if (!readableNow.current) return; try { makeRequest(); setReview(true); setError(null); } catch (cause) { setError(cause instanceof Error ? cause.message : "Review the entered result."); } }
  async function save() {
    if (!readable || !draft || !review || disabled || busy || savedRevisionId || freshCurrent) return;
    setBusy(true); setError(null);
    try {
      const request = attempt ?? makeRequest();
      setAttempt(request);
      onUnconfirmedChange?.(true);
      const result = await mutation.mutateAsync(request);
      setSavedRevisionId(result.revisionId); onUnconfirmedChange?.(false); onModeActive();
      try { await onChanged(); } catch { setError("The revision was saved, but the displayed summary could not be refreshed. Refresh saved outcomes without submitting another revision."); }
      void utils.manualExecution.stepResultHistory.invalidate({ testRunId, testCaseId: testCase.testCaseId, stepIndex: draft.stepIndex });
    } catch (cause) {
      const code = cause && typeof cause === "object" && "data" in cause && cause.data && typeof cause.data === "object" && "code" in cause.data ? cause.data.code : null;
      const rejected = isDefinitiveStepRejection(code, everAmbiguous);
      if (rejected) onUnconfirmedChange?.(false);
      if (!rejected) setEverAmbiguous(true);
      setDefinitiveRejection(rejected);
      setError(`${cause instanceof Error ? cause.message : "The revision response could not be confirmed."} ${rejected ? "The reviewed request was rejected. Refresh current evidence and review your correction." : "A previous response may be unconfirmed. Retrying keeps the identical receipt and result; restore access if needed."}`);
    } finally { setBusy(false); }
  }
  async function refreshRejected() {
    if (!readable || !draft || busy || !definitiveRejection || everAmbiguous) return;
    setBusy(true);
    try {
      const result = await utils.manualExecution.getForExecution.fetch({ testRunId, ...readScope });
      const currentCase = result.cases.find(item => item.testCaseId === testCase.testCaseId);
      if (!currentCase || !currentCase.stepExecutionAvailable) throw new Error("Per-step recording is no longer available for this case.");
      setFreshCurrent({ current: currentCase.stepResults.find(item => item.stepIndex === draft.stepIndex)?.current ?? null });
      setError(null);
    } catch (cause) { setError(`${cause instanceof Error ? cause.message : "Current evidence could not be loaded."} Your entries and receipt are retained.`); }
    finally { setBusy(false); }
  }
  async function viewFile(attachmentId: string) {
    if (!readableNow.current) return;
    try { const { viewUrl } = await utils.testCaseAttachments.getViewUrl.fetch({ attachmentId }); if (readableNow.current) window.open(viewUrl, "_blank", "noopener,noreferrer"); }
    catch { setError("This stored file could not be opened. Its recorded reference is retained."); }
  }
  if (!readable) return null; // State stays mounted; private bodies and modal are not rendered.
  if (!testCase.stepExecutionAvailable && !hasSteps) return <p className="text-muted">{testCase.currentResult ? "This case already has a case-level verdict. Start a separate run to record structured step outcomes." : "This run has no frozen structured steps available for per-step outcomes. Use an explicit case-level result."}</p>;
  return <section style={{ margin: "14px 0" }}>
    {disabled && <p role="status" className="text-muted">Recording requires current edit access and an active run. Recorded step history remains available.</p>}
    {!active && !hasSteps ? <><button className="btn-secondary" disabled={disabled} onClick={onModeActive}>Record step-by-step</button><p className="text-muted">Choose individual step outcomes, or use the case-level controls below. Recording a step locks this case into step-level results for this run.</p></> : <>
      <h3>Step outcomes</h3><p className="text-muted">{testCase.stepResults.filter(item => item.current).length} / {testCase.steps.length} recorded. The case verdict is derived only after all steps have an outcome; no missing step is assumed to pass.</p>
      <ol style={{ paddingLeft: 20, margin: 0 }}>{testCase.steps.map((step, index) => { const result = testCase.stepResults.find(item => item.stepIndex === index); return <li key={index} className="panel" style={{ padding: 10, marginBottom: 10, overflowWrap: "anywhere" }}><strong>{step.action}</strong>{step.expectedResult && <p>Expected: {step.expectedResult}</p>}<p>{result?.current?.status ?? "Not recorded"}{result?.current && ` · ${result.current.actorName} · ${new Date(result.current.recordedAt).toLocaleString()}`}</p>{result?.current?.note && <p>Actual: {result.current.note}</p>}<button className="btn-secondary" disabled={Boolean(draft && !savedRevisionId && draft.stepIndex !== index)} onClick={() => select(index)}>{result?.current ? "View / correct step" : "Record step"}</button></li>; })}</ol>
      {draft && !open && !savedRevisionId && <div><p>A draft or unconfirmed request for step {draft.stepIndex + 1} is retained on this page.</p><button className="btn-secondary" onClick={() => setOpen(true)}>Resume step draft</button>{!attempt && <button className="btn-secondary" onClick={() => setDraft(null)}>Discard unsaved step draft</button>}</div>}
    </>}
    <Modal open={open} title={`Step ${(draft?.stepIndex ?? 0) + 1} outcome`} onClose={() => setOpen(false)} dismissible={!busy}>
      {draft && selectedStep && <>
        <section aria-label="Frozen step definition"><h3 style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{selectedStep.action}</h3>{selectedStep.expectedActionOrData != null && <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}><strong>{technicalBehaviorLabel(stepFieldLabels.expectedActionOrData)}:</strong> {selectedStep.expectedActionOrData || <em>Empty text</em>}</p>}{selectedStep.expectedResult != null && <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}><strong>{stepFieldLabels.expectedResult ?? "Expected result"}:</strong> {selectedStep.expectedResult || <em>Empty text</em>}</p>}{selectedStep.expectedResponse != null && <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}><strong>{stepFieldLabels.expectedResponse ?? "Expected response"}:</strong> {selectedStep.expectedResponse || <em>Empty text</em>}</p>}<p className="text-muted">Frozen definition from this run. Editing the current test case does not change this procedure.</p></section>
        {disabled && <p role="status">This run is read-only or your current access does not allow recording. Saved history remains available.</p>}
        {draft.current && <p>Current revision: {draft.current.status}, recorded by {draft.current.actorName} at {new Date(draft.current.recordedAt).toLocaleString()}. A correction appends evidence rather than overwriting it.</p>}
        {!review ? <fieldset disabled={locked} style={{ border: 0, padding: 0, minWidth: 0 }}>
          <label htmlFor={`${prefix}-status`}>Observed outcome</label><select id={`${prefix}-status`} value={draft.status} onChange={event => update({ status: event.target.value as StepStatus | "" })} style={{ width: "100%", margin: "6px 0 12px" }}><option value="">Choose observed outcome</option>{(["PASS", "FAIL", "BLOCKED", "SKIP"] as const).map(status => <option key={status} value={status}>{status === "PASS" ? "Pass" : status === "FAIL" ? "Fail" : status === "BLOCKED" ? "Blocked" : "Skip"}</option>)}</select>
          <label htmlFor={`${prefix}-note`}>What actually happened</label><textarea id={`${prefix}-note`} value={draft.note} maxLength={10000} rows={3} onChange={event => update({ note: event.target.value })} style={{ width: "100%", display: "block", margin: "6px 0 12px" }} />
          {draft.current && <label>Why is this evidence being corrected?<textarea value={draft.correctionReason} maxLength={2000} rows={2} onChange={event => update({ correctionReason: event.target.value })} style={{ width: "100%", display: "block", marginTop: 6 }} /></label>}
          <details open={physical || undefined}><summary>{physical ? "Measurements and controlled context" : "Optional measured evidence"}</summary><p className="text-muted">Operator-entered readings. Use approved units, limits and calibrated instrument references; no instrument is controlled here.</p>{([["specimen", "Device / lot / controlled sample"], ["hardwareRevision", "Hardware revision"], ["firmwareVersion", "Firmware / software version"], ["environment", "Observed environment"]] as const).map(([key, label]) => <label key={key} style={{ display: "block", margin: "10px 0" }}>{label}<input value={draft.context[key]} maxLength={key === "environment" ? 1000 : key === "specimen" ? 300 : 200} onChange={event => update({ context: { ...draft.context, [key]: event.target.value } })} style={{ width: "100%", display: "block", marginTop: 4 }} /></label>)}{draft.readings.map((reading, index) => <fieldset key={index} style={{ margin: "12px 0", minWidth: 0 }}><legend>Measurement {index + 1}</legend>{([["name", "Measurement"], ["value", "Measured value"], ["unit", "Unit"], ["lowerLimit", "Approved lower limit (optional)"], ["upperLimit", "Approved upper limit (optional)"], ["instrument", "Instrument / calibration reference"]] as const).map(([key, label]) => <label key={key} style={{ display: "block", margin: "8px 0" }}>{label}<input value={reading[key]} maxLength={key === "unit" ? 40 : 200} onChange={event => update({ readings: draft.readings.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: event.target.value } : item) })} style={{ width: "100%", display: "block" }} /></label>)}<button className="btn-secondary" onClick={() => update({ readings: draft.readings.filter((_, itemIndex) => itemIndex !== index) })}>Remove measurement {index + 1}</button></fieldset>)}<button className="btn-secondary" disabled={draft.readings.length >= 100} onClick={() => update({ readings: [...draft.readings, { name: "", value: "", unit: "", lowerLimit: "", upperLimit: "", instrument: "" }] })}>Add measurement</button></details>
          <button className="btn-secondary" style={{ marginTop: 12 }} onClick={() => setEvidenceOpen(value => !value)}>{evidenceOpen ? "Hide stored evidence" : "Link stored images, video or documents"}</button>
          {evidenceOpen && <section><p className="text-muted">Choose confirmed uploaded files from this project. Upload new media through the case editor first; entering a file name does not upload evidence.</p><label>Find uploaded files<input value={search} maxLength={200} onChange={event => { setSearch(event.target.value); setEvidenceCursor(undefined); }} style={{ width: "100%", display: "block" }} /></label>{evidenceQuery.error ? <p role="alert">Stored files could not be loaded. Selected references are retained.</p> : !evidenceQuery.data ? <p role="status">Loading uploaded files…</p> : <>{evidenceQuery.data.attachments.map(file => <label key={file.id} style={{ display: "flex", gap: 8, margin: "10px 0", overflowWrap: "anywhere" }}><input type="checkbox" checked={draft.attachmentIds.includes(file.id)} disabled={draft.attachmentIds.length >= 20 && !draft.attachmentIds.includes(file.id)} onChange={event => update({ attachmentIds: event.target.checked ? [...draft.attachmentIds, file.id] : draft.attachmentIds.filter(id => id !== file.id), attachmentNames: { ...draft.attachmentNames, [file.id]: file.fileName } })} />{file.fileName}</label>)}<button className="btn-secondary" disabled={!evidenceQuery.data.nextCursor} onClick={() => setEvidenceCursor(evidenceQuery.data?.nextCursor ?? undefined)}>More stored files</button><button className="btn-secondary" disabled={!evidenceCursor} onClick={() => setEvidenceCursor(undefined)}>First file page</button></>}</section>}
        </fieldset> : <section><h3>Review recorded evidence</h3><p><strong>{draft.status}</strong> · {draft.note || "No actual-outcome note supplied"}</p>{draft.correctionReason && <p>Correction reason: {draft.correctionReason}</p>}<ul>{draft.readings.map((reading, index) => <li key={index} style={{ overflowWrap: "anywhere" }}>{reading.name}: {reading.value} {reading.unit}; instrument {reading.instrument || "not supplied"}; limits {reading.lowerLimit || "none"} to {reading.upperLimit || "none"}</li>)}</ul>{Object.entries(draft.context).filter(([, value]) => value).map(([key, value]) => <p key={key} style={{ overflowWrap: "anywhere" }}>{key}: {value}</p>)}<p>{draft.attachmentIds.length} linked files: {draft.attachmentIds.map(id => draft.attachmentNames[id] ?? id).join(", ") || "none"}</p><p className="text-muted">This saves one observed step outcome without AI credits, execution, equipment control or regulated electronic signature.</p></section>}
        {draft.attachmentIds.length > 0 && <details><summary>Selected stored evidence ({draft.attachmentIds.length})</summary>{draft.attachmentIds.map(id => <div key={id} style={{ overflowWrap: "anywhere", marginTop: 8 }}>{draft.attachmentNames[id] ?? "Stored file reference"} <button className="btn-secondary" onClick={() => void viewFile(id)}>Open file</button></div>)}</details>}
        <button className="btn-secondary" style={{ marginTop: 12 }} onClick={() => setHistoryOpen(value => !value)}>{historyOpen ? "Hide revision history" : "View revision history"}</button>{historyOpen && <StepHistory testRunId={testRunId} testCaseId={testCase.testCaseId} stepIndex={draft.stepIndex} />}
        {error && <p role="alert">{error}</p>}{savedRevisionId && <p role="status">Revision saved. Other steps remain separate; finishing the run is an explicit action.</p>}
        {freshCurrent && <div className="panel"><p>Current stored revision: {freshCurrent.current?.status ?? "Not recorded"}. Your entered outcome is retained. Review the new evidence before deliberately saving your entered values as a correction.</p>{freshCurrent.current && <RevisionDetails revision={freshCurrent.current} />}<button className="btn-secondary" onClick={() => { update({ current: freshCurrent.current, correctionReason: "" }); setFreshCurrent(null); setAttempt(null); setReview(false); setDefinitiveRejection(false); setHistoryOpen(true); }}>Use current baseline and review my correction</button><button className="btn-secondary" onClick={() => setFreshCurrent(null)}>Keep existing draft baseline</button></div>}
        <footer style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 8, marginTop: 18 }}><button className="btn-secondary" disabled={busy} onClick={() => setOpen(false)}>Close and keep draft</button>{savedRevisionId ? <button className="btn-primary" onClick={() => { setOpen(false); setDraft(null); setAttempt(null); setSavedRevisionId(null); }}>Done</button> : review ? <><button className="btn-secondary" disabled={locked} onClick={() => setReview(false)}>Back</button><button className="btn-primary" disabled={busy || disabled || Boolean(freshCurrent)} onClick={() => void save()}>{busy ? "Saving…" : attempt ? "Retry same result" : draft.current ? "Save correction revision" : "Save step outcome"}</button></> : <button className="btn-primary" disabled={locked} onClick={reviewDraft}>Review step outcome</button>}</footer>
        {error && definitiveRejection && !everAmbiguous && <button className="btn-secondary" disabled={busy} onClick={() => void refreshRejected()}>Refresh rejected result without discarding entries</button>}
        {error && savedRevisionId && <button className="btn-secondary" onClick={() => { void onChanged().then(() => setError(null)).catch(() => setError("The saved revision remains recorded. The displayed summary still could not be refreshed.")); }}>Refresh saved outcomes</button>}
        <p className="text-muted" style={{ fontSize: 12 }}>Unsaved drafts and retry receipts remain only while this page is open. Save or confirm the response before leaving.</p>
      </>}
    </Modal>
  </section>;
}
