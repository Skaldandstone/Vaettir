"use client";
import { useId, useState, type ReactNode } from "react";
import { Modal } from "./Modal";
import { StepObservationResources } from "./StepObservationResources";
import { useStepExecutionReviewController } from "@/lib/use-step-execution-review-controller";
import { stepObservationBuffer, stepObservationEvidence } from "@/lib/step-observation-buffer";
import type { StepReviewBuffer, StepReviewOrigin } from "@/lib/step-execution-review-draft";
import type { ManualRunCurrentOrigin } from "@/lib/manual-run-current-reader";
function currentStepParent(callback: (() => boolean) | null | undefined, activation?: string) {
  try { return callback === undefined || typeof callback === "function" && typeof activation === "string" && activation.length > 0 && activation.length <= 200 && callback() === true; } catch { return false; }
}

function exactStepText(value: unknown, supplied: boolean): ReactNode {
  return !supplied ? <em>Unset</em> : value === null ? <em>NULL (retained)</em> : value === "" ? <em>Empty text</em> : typeof value === "string" ? value : <em>Unsupported value; see exact disclosure</em>;
}
/** Stored coordinate and technical descriptor stay aligned, never live fallback. */
export function StepFrozenObservation({ definition, stepIndex, labels = {} }: { definition: unknown; stepIndex: number; labels?: Record<string, string> }) {
  const record = definition && typeof definition === "object" && !Array.isArray(definition) ? definition as Record<string, unknown> : null;
  const steps = record?.steps;
  const raw = Array.isArray(steps) ? steps[stepIndex] : null;
  const step = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
  const supported = step?.order === stepIndex && typeof step.action === "string";
  return <section aria-label="Current frozen step procedure">
    <h4>Frozen step {stepIndex + 1}</h4>
    {supported && step ? <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,240px),1fr))", gap: 16 }}>
      {([["action", "Tester action"], ["expectedActionOrData", "Technical behavior / data"], ["expectedResult", "Expected result"], ["expectedResponse", "Expected response"]] as const).map(([key, label]) => <div key={key}><dt>{stepIndex + 1}. {labels[key] || label}</dt><dd style={{ margin: "6px 0", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{exactStepText(step[key], Object.hasOwn(step, key))}</dd></div>)}
    </dl> : <p>Friendly step view is unsupported for this saved representation. No current case or default procedure was substituted.</p>}
    <p className="text-muted">Procedure saved with this run. Preconditions remain separate from its numbered steps.</p>
    <details><summary>Exact frozen case procedure, including unknown fields and media references</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(definition, null, 2)}</pre></details>
  </section>;
}

/** Controlled prose stays prose; decimal buffers remain strings until review. */
export function StepObservationFields({ buffer, editingEnabled, correction, physical = false, onChange }: {
  buffer: Readonly<StepReviewBuffer>; editingEnabled: boolean; correction: boolean; physical?: boolean; onChange: (buffer: StepReviewBuffer) => boolean;
}) {
  const prefix = useId();
  const change = (value: Partial<StepReviewBuffer>) => onChange({ ...buffer, ...value });
  return <fieldset disabled={!editingEnabled} style={{ border: 0, padding: 0, minWidth: 0 }}>
    <label htmlFor={`${prefix}-status`}>Observed outcome</label>
    <select id={`${prefix}-status`} value={buffer.status} onChange={event => change({ status: event.target.value as StepReviewBuffer["status"] })} style={{ display: "block", width: "100%", margin: "6px 0 12px" }}>
      <option value="">Choose observed outcome</option>{(["PASS", "FAIL", "BLOCKED", "SKIP"] as const).map(status => <option key={status} value={status}>{status === "PASS" ? "Pass" : status === "FAIL" ? "Fail" : status === "BLOCKED" ? "Blocked" : "Skip"}</option>)}
    </select>
    <label htmlFor={`${prefix}-note`}>What actually happened</label>
    <textarea id={`${prefix}-note`} value={buffer.note ?? ""} rows={4} maxLength={10000} onChange={event => change({ note: event.target.value })} style={{ display: "block", width: "100%", boxSizing: "border-box", margin: "6px 0" }} />
    <p>{buffer.note === null ? "NULL note retained. Typing explicitly changes it to text." : buffer.note === "" ? "Empty text note, distinct from NULL." : "Exact entered whitespace and line breaks are retained."}</p>
    <button type="button" className="btn-secondary" disabled={buffer.note === null} onClick={() => change({ note: null })}>Use NULL note</button>
    {correction && <div style={{ marginTop: 12 }}><label htmlFor={`${prefix}-reason`}>Why is this observation being corrected?</label><textarea id={`${prefix}-reason`} value={buffer.correctionReason ?? ""} rows={3} maxLength={2000} onChange={event => change({ correctionReason: event.target.value })} style={{ display: "block", width: "100%", boxSizing: "border-box" }} /><p>A new reason is required. A previous revision&apos;s reason does not approve this correction.</p></div>}
    <details open={physical || undefined} style={{ marginTop: 12 }}><summary>{physical ? "Measurements and controlled context" : "Optional measured evidence"}</summary>
      <p>Operator-entered observations only. No instrument or device is controlled here.</p>
      {([["specimen", "Device / lot / controlled sample"], ["hardwareRevision", "Hardware revision"], ["firmwareVersion", "Firmware / software version"], ["environment", "Observed environment"]] as const).map(([key, label]) => <label key={key} style={{ display: "block", marginTop: 10 }}>{label}<input value={buffer.context[key]} maxLength={key === "specimen" ? 300 : key === "environment" ? 1000 : 200} onChange={event => change({ context: { ...buffer.context, [key]: event.target.value } })} style={{ display: "block", width: "100%", boxSizing: "border-box" }} /></label>)}
      {buffer.readings.map((reading, index) => <fieldset key={index} style={{ marginTop: 12, minWidth: 0 }}><legend>Measurement {index + 1}</legend>
        {([["name", "Measurement"], ["value", "Measured decimal"], ["unit", "Unit"], ["lowerLimit", "Approved lower limit (optional)"], ["upperLimit", "Approved upper limit (optional)"], ["instrument", "Instrument / calibration reference"]] as const).map(([key, label]) => <label key={key} style={{ display: "block", marginTop: 8 }}>{label}<input value={reading[key]} maxLength={key === "unit" ? 40 : 200} onChange={event => change({ readings: buffer.readings.map((value, at) => at === index ? { ...value, [key]: event.target.value } : value) })} style={{ display: "block", width: "100%", boxSizing: "border-box" }} /></label>)}
        <button type="button" className="btn-secondary" onClick={() => change({ readings: buffer.readings.filter((_, at) => at !== index) })}>Remove measurement {index + 1}</button>
      </fieldset>)}
      <button type="button" className="btn-secondary" disabled={buffer.readings.length >= 100} onClick={() => change({ readings: [...buffer.readings, { name: "", value: "", unit: "", lowerLimit: "", upperLimit: "", instrument: "" }] })}>Add measurement</button>
    </details>
    <p>{buffer.evidenceAttachmentIds.length} retained evidence references. Search and history do not remove unavailable selections.</p>
  </fieldset>;
}

export type StepObservationResourceProps = {
  origin: StepReviewOrigin | null; expectedProcedureHash: string | null; active: boolean;
  selectedEvidenceIds: readonly string[]; selectedEvidenceNames: Readonly<Record<string, string>>;
  editingEnabled: boolean; onEvidenceToggle: (id: string, selected: boolean) => boolean;
};
/** Additive actual editor. Parent must keep it mounted through row collapse and
 * modal close. Central step-panel cutover/file opening remain separate work. */
export function ReviewedStepObservation({ projectId, testRunId, testCaseId, stepIndex, active, disabled, physical = false, initiallyOpen = false, stepFieldLabels, onChanged, onUnconfirmedChange, renderResources, parentRunScope, parentCurrent, parentActivation }: {
  projectId: string; testRunId: string; testCaseId: string; stepIndex: number; active: boolean; disabled: boolean; physical?: boolean;
  initiallyOpen?: boolean; stepFieldLabels?: Record<string, string>; onChanged?: () => Promise<unknown>; onUnconfirmedChange?: (pending: boolean) => void;
  renderResources?: (props: StepObservationResourceProps) => ReactNode;
  parentRunScope?: ManualRunCurrentOrigin | null;
  parentCurrent?: (() => boolean) | null; parentActivation?: string;
}) {
  const [original] = useState({ projectId, testRunId, testCaseId, stepIndex });
  const same = original.projectId === projectId && original.testRunId === testRunId && original.testCaseId === testCaseId && original.stepIndex === stepIndex;
  const [open, setOpen] = useState(initiallyOpen);
  const parentReadable = parentRunScope !== null && currentStepParent(parentCurrent, parentActivation);
  const workflow = useStepExecutionReviewController(original, original.stepIndex, active && same && open, disabled, async () => {
    if (!currentStepParent(parentCurrent, parentActivation)) return;
    onUnconfirmedChange?.(false); if (currentStepParent(parentCurrent, parentActivation)) await onChanged?.();
  }, onUnconfirmedChange, parentRunScope, parentCurrent, parentActivation);
  const { reads, view } = workflow;
  const fresh = reads.fresh;
  const buffer = view.draft?.buffer;
  const origin = reads.origin;
  const resources = renderResources ?? ((props: StepObservationResourceProps) => <StepObservationResources {...props} />);
  const evidenceNames = Object.fromEntries(parentReadable && view.readable ? fresh?.current?.evidenceAttachments.map(file => [file.id, file.fileName]) ?? [] : []);
  const toggle = (id: string, selected: boolean) => {
    if (!buffer || !view.canEdit) return false;
    try { return workflow.change(stepObservationEvidence(buffer, id, selected)); } catch { return false; }
  };
  return <section aria-label={`Reviewed observation for step ${original.stepIndex + 1}`}>
    <button type="button" className="btn-secondary" disabled={!active || !same || !parentReadable} onClick={() => { if (currentStepParent(parentCurrent, parentActivation)) setOpen(true); }}>Open / resume step {original.stepIndex + 1} observation</button>
    <Modal size="wide" keepMounted open={open && active && same && parentReadable} title={`Review step ${original.stepIndex + 1} observation`} onClose={() => setOpen(false)} dismissible={!view.busy}>
      <p>Closing retains entries and identical uncertain requests on this page. Reload/route-away recovery is not supported.</p>
      <button type="button" className="btn-secondary" disabled={view.busy} onClick={reads.refresh}>Refresh current native step</button>
      {reads.error && <p role="alert">{reads.error}</p>}
      {!view.authorityReadable && <p role="status">Current original-reader access is not verified. Private fields are withheld; retained entries and requests were not rebound.</p>}
      {parentReadable && view.notice && <p role="status">{view.notice}</p>}
      {parentReadable && view.readable && fresh ? <>
        <StepFrozenObservation definition={fresh.frozenDefinition} stepIndex={original.stepIndex} labels={stepFieldLabels} />
        {fresh.current && <section><h4>Current saved observation</h4><p>{fresh.current.status} · {fresh.current.actorName} · {fresh.current.recordedAt}</p><p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>Actual: {exactStepText(fresh.current.note, true)}</p><p>Historical correction reason: {exactStepText(fresh.current.correctionReason, true)}</p><details><summary>Exact current observation and retained metadata</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(fresh.rawCurrent, null, 2)}</pre></details></section>}
        {view.baselineChanged && !view.acknowledgement && <p role="alert">The current native baseline changed. Your entered buffer is retained. Explicitly review it against the current frozen procedure before a new request.</p>}
        {!buffer && view.canEdit && <button type="button" className="btn-primary" onClick={() => { if (fresh) workflow.change(stepObservationBuffer(fresh)); }}>Start a draft from this current step</button>}
        {buffer && <><StepObservationFields buffer={buffer} correction={view.draft?.expectedRevisionId !== null} physical={physical} editingEnabled={view.canEdit} onChange={workflow.change} />
          <details><summary>Exact retained entered buffer</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(buffer, null, 2)}</pre></details>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
            <button type="button" className="btn-secondary" disabled={!view.canReview} onClick={workflow.reviewCurrent}>Review against current procedure</button>
            <button type="button" className="btn-secondary" disabled={!view.canEdit} onClick={workflow.discardUnsaved}>Discard unsaved draft</button>
          </div>
        </>}
      </> : parentReadable && view.authorityReadable && <p>This stored representation is unsupported for editing. No procedure, observation or number was normalized into a new draft.</p>}
      {resources({ origin, expectedProcedureHash: parentReadable && view.readable ? fresh?.procedureHash ?? null : null, active: open && active && same && parentReadable && view.readable, selectedEvidenceIds: buffer?.evidenceAttachmentIds ?? [], selectedEvidenceNames: evidenceNames, editingEnabled: parentReadable && view.canEdit && !!buffer, onEvidenceToggle: toggle })}
      {parentReadable && view.authorityReadable && <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
        <button type="button" className="btn-primary" disabled={!view.canSave} onClick={() => void workflow.save()}>{view.hasPending ? "Retry identical reviewed request" : "Record reviewed step"}</button>
        {view.hasPending && <p>An uncertain submitted request stays frozen under its original UUID/body/hash. No replacement or duplicate request is created.</p>}
        {view.acknowledgement && <><p>Exact request acknowledged. This does not certify a fix, execution completeness or release.</p><button type="button" className="btn-secondary" disabled={view.busy || !view.readable} onClick={() => void workflow.synchronizeAcknowledged()}>Refresh acknowledged views only</button><button type="button" className="btn-secondary" disabled={view.busy || !view.readable} onClick={workflow.finishAcknowledged}>Release acknowledged draft</button></>}
      </div>}
    </Modal>
  </section>;
}
