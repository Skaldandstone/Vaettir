"use client";
import { useId, useState, type ReactNode } from "react";
import { trpcReact, type RouterInputs } from "@/lib/trpcReact";
import { describeRetainedPlanValue, finitePlanNumber } from "@/lib/plan-custom-fields";
import { governedPlanFields, emptyPlanMetadataDraft, leavePlanMetadataUnchanged, planMetadataDraftValue, planMetadataObject, planMetadataListRendererChanges, projectedPlanMetadataValues, removePlanMetadataValue, replacePlanMetadataChange, reviewedPlanMetadataChanges, setPlanMetadataNumber, type PlanMetadataDraft, type PlanMetadataValue } from "@/lib/plan-change-draft";
import { editStrategyRow, removeStrategyRow, sameStrategyRowValues, strategyRows } from "@/lib/qa-strategy-fields";
import { usePlanChangeEditor } from "@/lib/use-plan-change-editor";
import { Modal } from "./Modal";
type Input = RouterInputs["testPlanGovernance"]["editPlanCustomFields"];
const fieldLabel = { display: "grid", gap: 4, minWidth: 0 } as const;
const fieldControl = { width: "100%", minWidth: 0, boxSizing: "border-box" } as const;
function MetadataStringRows({ label, values, onChange }: { label: string; values: string[]; onChange: (values: string[]) => void }) {
  const prefix = useId(), snapshot = (generation: number) => { let nextId = 0; const rows = strategyRows(values, () => `${prefix}:${generation}:${nextId++}`); return { rows, generation, nextId }; };
  const [state, setState] = useState(() => snapshot(0)), rows = state.rows;
  if (!sameStrategyRowValues(rows, values)) setState(snapshot(state.generation + 1));
  const change = (next: typeof rows, nextId = state.nextId) => { setState({ ...state, rows: next, nextId }); onChange(next.map(row => row.value)); };
  return <fieldset style={{ minWidth: 0 }}><legend>{label}</legend><p>Each row is one exact item. Empty text, commas, multiline content, order and duplicates are preserved.</p>
    {!rows.length && <p>Empty list (zero rows).</p>}
    {rows.map((row, index) => <div key={row.id} style={{ display: "flex", alignItems: "start", gap: 8, marginBottom: 8 }}><label style={{ ...fieldLabel, flex: 1 }}>Item {index + 1}<textarea style={fieldControl} rows={2} maxLength={10000} value={row.value} onChange={event => change(editStrategyRow(rows, row.id, event.target.value))} /></label><button type="button" className="btn-secondary" style={{ alignSelf: "start", marginTop: 22 }} aria-label={`Remove ${label} row ${index + 1}`} onClick={() => change(removeStrategyRow(rows, row.id))}>Remove row</button></div>)}
    <button type="button" disabled={rows.length >= 500} onClick={() => change([...rows, { id: `${prefix}:${state.generation}:${state.nextId}`, value: "" }], state.nextId + 1)}>Add {label} row</button>
  </fieldset>;
}
export function PlanCustomFieldsEditor({ projectId, testPlanId, organizationId, readOnly = false, onChanged, renderFields }: { projectId: string; testPlanId: string; organizationId: string; readOnly?: boolean; onChanged: () => void; renderFields?: (values: Record<string, unknown>, onChange: (values: Record<string, unknown>) => void, context: { active: boolean; projectId: string; testPlanId: string }) => ReactNode }) {
  const mutation = trpcReact.testPlanGovernance.editPlanCustomFields.useMutation();
  const editor = usePlanChangeEditor<PlanMetadataDraft, Input>({ projectId, testPlanId, organizationId, readOnly, operation: "EDIT_PLAN_CUSTOM_FIELDS", mutation, onChanged,
    initialize: () => emptyPlanMetadataDraft(),
    canChange: preview => preview.metadataSchema.canEdit && preview.metadataSchema.supported && !!preview.metadataSchema.fieldSchemaHash,
    validate: (draft, current) => { if (draft.baseline.planRevision !== current.planRevision || draft.baseline.metadataSchema.fieldSchemaHash !== current.metadataSchema.fieldSchemaHash) return "The complete plan or native field schema changed. Your draft remains retained; load and review the current metadata before a new save."; if (!draft.baseline.metadataSchema.supported || !draft.baseline.metadataSchema.fieldSchemaHash) return "No supported bounded native field schema was reviewed."; try { return reviewedPlanMetadataChanges(draft.baseline.metadataSchema.fieldSchema, draft.baseline.snapshot.customFields, draft.values).length ? null : "Choose at least one supported SET or REMOVE change. Unchanged values are not submitted."; } catch (cause) { return cause instanceof Error ? cause.message : "Review supported declared metadata changes."; } },
    makeInput: (draft, base) => ({ ...base, expectedFieldSchemaHash: draft.baseline.metadataSchema.fieldSchemaHash!, changes: reviewedPlanMetadataChanges(draft.baseline.metadataSchema.fieldSchema, draft.baseline.snapshot.customFields, draft.values) }),
    savedNotice: "Selected metadata changes saved with governed version and history. Unselected and retained values, status, header, procedures and criteria remain unchanged." });
  const fields = editor.draft ? governedPlanFields(editor.draft.baseline.metadataSchema.fieldSchema, editor.draft.baseline.snapshot.customFields) : [];
  let reviewedChanges: ReturnType<typeof reviewedPlanMetadataChanges> | null = null;
  if (editor.draft) { try { reviewedChanges = reviewedPlanMetadataChanges(editor.draft.baseline.metadataSchema.fieldSchema, editor.draft.baseline.snapshot.customFields, editor.draft.values); } catch { /* Invalid buffers refuse review/save; no old finite patch is previewed. */ } }
  const fieldsActive = editor.open && editor.readable && !editor.pending && !editor.busy && !!editor.reads.fresh?.metadataSchema.canEdit;
  function setValue(key: string, value: PlanMetadataValue) { if (editor.draftRef.current) editor.change({ values: replacePlanMetadataChange(editor.draftRef.current.values, { operation: "SET", key, value }) }); }
  function rendererChange(proposed: Record<string, unknown>) {
    const current = editor.draftRef.current; if (!current || !editor.canHandleDraft()) return;
    try { const values = planMetadataListRendererChanges(current.baseline.metadataSchema.fieldSchema, current.baseline.snapshot.customFields, current.values, proposed); editor.change({ values }); }
    catch (cause) { editor.change({ values: { ...current.values, rendererError: cause instanceof Error ? cause.message : "The specialized field change was refused; native values remain unchanged." } }); }
  }
  return <>
    {(!readOnly || editor.pending) && <button type="button" className="btn-secondary" onClick={editor.show}>{editor.pending ? "Reconcile plan metadata request" : "Edit plan metadata"}</button>}
    <Modal open={editor.open} onClose={editor.close} title="Review selected plan metadata" keepMounted size="wide">
      {!editor.readable ? <p>Restore the original project, plan and native signed-in reader with current full-editor access. Retained drafts and uncertain requests stay mounted but private.</p> : <div style={{ display: "grid", gap: 12 }}>
        <p>Only explicit SET/REMOVE operations for supported declared keys are submitted. Unknown keys, native NULL, incompatible values and unsupported schemas remain read-only and are never replaced by an empty object.</p>
        {editor.reads.fresh?.metadataSchema.blockedReason && <p role="alert">{editor.reads.fresh.metadataSchema.blockedReason}</p>}
        {editor.pending ? <><p>Retained original request. Retry exact UUID, operations, schema hash, reason and complete-plan revision; do not send a replacement record.</p><details><summary>Exact reviewed metadata request</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(editor.pending.input, null, 2)}</pre></details><button type="button" disabled={editor.busy} onClick={() => void editor.commit()}>Retry identical metadata request</button></> : <>
          <button type="button" disabled={editor.busy || !editor.reads.fresh?.metadataSchema.canEdit} onClick={editor.review}>{editor.draft ? "Load current metadata (replaces unsaved metadata draft)" : "Load current metadata for review"}</button>
          {!planMetadataObject(editor.reads.fresh?.snapshot.customFields) && <section><h3>Retained native metadata root</h3><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{describeRetainedPlanValue(editor.reads.fresh?.snapshot.customFields, true)}</pre></section>}
          {editor.draft && <fieldset disabled={editor.busy || !editor.reads.fresh?.metadataSchema.canEdit} style={{ border: 0, padding: 0, display: "grid", gap: 12, minWidth: 0 }}>
            {!renderFields && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(260px, 100%), 1fr))", gap: 12 }}>{fields.map(field => {
              const value = planMetadataDraftValue(field, editor.draft!.values), changed = editor.draft!.values.changes.some(change => change.key === field.key) || Object.hasOwn(editor.draft!.values.numberBuffers, field.key), numericText = Object.hasOwn(editor.draft!.values.numberBuffers, field.key) ? editor.draft!.values.numberBuffers[field.key]! : value.present ? String(value.value) : "";
              return <section key={field.key} className="panel" style={{ minWidth: 0, display: "grid", alignContent: "start", gap: 8, gridColumn: field.kind === "string-array" ? "1 / -1" : undefined }}><h3 style={{ margin: 0 }}>{field.label}</h3><code>{field.key}</code>{field.description && <p>{field.description}</p>}
                {field.kind === "retained" ? <><p>{field.reason}</p><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{describeRetainedPlanValue(field.value, field.present)}</pre></> : <>
                  {!value.present && <p>Not set. No default or native value is created by opening this editor.</p>}
                  {field.kind === "string" && <label style={fieldLabel}>{field.label}<textarea style={fieldControl} rows={3} maxLength={40000} value={value.present ? value.value as string : ""} onChange={event => setValue(field.key, event.target.value)} /></label>}
                  {field.kind === "number" && <label style={fieldLabel}>{field.label}<input style={fieldControl} type="text" inputMode="decimal" maxLength={40000} value={numericText} aria-invalid={Object.hasOwn(editor.draft!.values.numberBuffers, field.key) && finitePlanNumber(numericText) === null} onChange={event => { if (editor.draftRef.current) editor.change({ values: setPlanMetadataNumber(editor.draftRef.current.values, field.key, event.target.value) }); }} /></label>}
                  {field.kind === "boolean" && <label style={fieldLabel}>{field.label}<select style={fieldControl} value={value.present ? value.value === false ? "FALSE" : "TRUE" : "ABSENT"} onChange={event => { if (event.target.value !== "ABSENT") setValue(field.key, event.target.value === "TRUE"); }}><option value="ABSENT" disabled>Not set (no default)</option><option value="FALSE">False</option><option value="TRUE">True</option></select></label>}
                  {field.kind === "string-array" && <MetadataStringRows label={field.label} values={value.present ? value.value as string[] : []} onChange={next => setValue(field.key, next)} />}
                  {!value.present && (field.kind === "string" || field.kind === "string-array") && <button type="button" onClick={() => setValue(field.key, field.kind === "string" ? "" : [])}>Set empty {field.kind === "string" ? "text" : "list"} explicitly</button>}
                  {field.present && <button type="button" className="btn-secondary" style={{ justifySelf: "start" }} onClick={() => { if (editor.draftRef.current) editor.change({ values: removePlanMetadataValue(editor.draftRef.current.values, field.key) }); }}>Remove saved value for {field.label}</button>}
                  {changed && <button type="button" onClick={() => { if (editor.draftRef.current) editor.change({ values: leavePlanMetadataUnchanged(editor.draftRef.current.values, field.key) }); }}>Leave {field.label} unchanged</button>}
                </>}
              </section>;
            })}</div>}
            {editor.draft.values.rendererError && <><p role="alert">{editor.draft.values.rendererError}</p><button type="button" onClick={() => { const current = editor.draftRef.current; if (!current) return; const { rendererError: _error, ...values } = current.values; editor.change({ values }); }}>Discard refused specialized edit attempt</button></>}
            {editor.problem && <p role="alert">{editor.problem}</p>}
            <details><summary>Reviewed before / after operations</summary>{reviewedChanges ? <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(reviewedChanges.map(change => ({ key: change.key, before: { present: Object.hasOwn(editor.draft!.baseline.snapshot.customFields as object, change.key), value: (editor.draft!.baseline.snapshot.customFields as Record<string, unknown>)[change.key] }, after: change.operation === "REMOVE" ? { present: false } : { present: true, value: change.value }, operation: change.operation })), null, 2)}</pre> : <p>Fix the invalid draft before reviewing any submitted operations. No prior finite value is being prepared for save.</p>}</details>
            <label style={fieldLabel}>Reason<textarea style={fieldControl} rows={2} maxLength={1000} value={editor.draft.reason} onChange={event => editor.change({ reason: event.target.value })} /></label>
            <label><input type="checkbox" checked={editor.draft.confirmed} onChange={event => editor.change({ confirmed: event.target.checked })} /> I reviewed these exact declared key changes; all other native metadata and plan content remain unchanged.</label>
            <button type="button" disabled={!editor.canSave} onClick={() => void editor.commit()}>Save reviewed metadata changes</button>
          </fieldset>}
        </>}
        {editor.notice && <p role="status">{editor.notice}</p>}
      </div>}
      {editor.draft && renderFields && <div hidden={!fieldsActive} ref={node => { if (node) node.inert = !fieldsActive; }}>
        <fieldset disabled={!fieldsActive} style={{ border: 0, padding: 0, minWidth: 0 }}>
          {renderFields(projectedPlanMetadataValues(editor.draft.baseline.snapshot.customFields, editor.draft.values), rendererChange, { active: fieldsActive, projectId: editor.draft.origin.projectId, testPlanId: editor.draft.baseline.snapshot.id })}
        </fieldset>
      </div>}
    </Modal>
  </>;
}
