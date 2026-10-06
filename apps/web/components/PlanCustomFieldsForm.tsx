"use client";
import { useEffect, useId, useRef, useState } from "react";
import { describeRetainedPlanValue, finitePlanNumber, planCustomFields, removePlanField, replacePlanField } from "@/lib/plan-custom-fields";
import { editStrategyRow, removeStrategyRow, sameStrategyRowValues, strategyRows } from "@/lib/qa-strategy-fields";

export function PlanStringListField({ label, hint, placeholder = "", values, onChange }: { label: string; hint: string; placeholder?: string; values: string[]; onChange: (values: string[]) => void }) {
  const prefix = useId(), nextId = useRef(0);
  const newId = () => `${prefix}:${nextId.current++}`;
  const [rows, setRows] = useState(() => strategyRows(values, newId));
  // Keep local identity for exact same-value echoes. A changed external snapshot
  // gets new identities rather than guessing how duplicate rows were moved.
  if (!sameStrategyRowValues(rows, values)) setRows(strategyRows(values, newId));
  const change = (next: typeof rows) => { setRows(next); onChange(next.map(row => row.value)); };
  return <fieldset style={{ minWidth: 0 }}><legend>{label}</legend><p className="text-muted">{hint} Each row is one exact item. Empty rows, commas, line breaks and repeated text are preserved.</p>
    {!rows.length && <p className="text-muted">Empty list (zero rows).</p>}
    {rows.map((row, index) => <div key={row.id} style={{ display: "flex", gap: 6, marginBottom: 8, alignItems: "start" }}>
      <label style={{ flex: 1, minWidth: 0 }}>{label} {index + 1}<textarea rows={2} value={row.value} placeholder={placeholder} style={{ width: "100%" }} onChange={event => change(editStrategyRow(rows, row.id, event.target.value))} /></label>
      <button type="button" className="btn-secondary" aria-label={`Remove ${label} row ${index + 1}`} onClick={() => change(removeStrategyRow(rows, row.id))}>Remove</button>
    </div>)}
    <button type="button" className="btn-secondary" onClick={() => change([...rows, { id: newId(), value: "" }])}>Add {label} row</button>
  </fieldset>;
}
function FiniteNumberField({ label, value, onChange }: { label: string; value: number | undefined; onChange: (value: number) => void }) {
  const [text, setText] = useState(value === undefined ? "" : String(value)), [error, setError] = useState(false);
  useEffect(() => { setText(value === undefined ? "" : String(value)); setError(false); }, [value]);
  return <label>{label}<input type="text" inputMode="decimal" value={text} aria-invalid={error} onChange={event => { setText(event.target.value); const next = finitePlanNumber(event.target.value); setError(next === null); if (next !== null) onChange(next); }} />
    {error && <span role="alert" style={{ display: "block" }}>This is not a finite number and has not been applied. The last saved/draft finite value is retained. Use Remove value to unset this field.</span>}
  </label>;
}
export function PlanCustomFieldsForm({ schema, values, onChange }: { schema: unknown; values: Record<string, unknown>; onChange: (values: Record<string, unknown>) => void }) {
  const fields = planCustomFields(schema, values);
  return <div style={{ display: "grid", gap: 14 }}>{fields.map(field => <section key={field.key} className="panel" style={{ minWidth: 0 }}>
    {field.kind === "retained" ? <><h3>{field.label}</h3><p>{field.reason}</p><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{describeRetainedPlanValue(field.value, field.present)}</pre></> : <>
      {field.description && <p className="text-muted">{field.description}</p>}
      {!field.present && <p className="text-muted">Not set. No value will be added until you edit or explicitly initialize this field.</p>}
      {field.kind === "string" && <label>{field.label}<textarea rows={3} style={{ width: "100%" }} value={field.present ? field.value as string : ""} onChange={event => onChange(replacePlanField(values, field.key, event.target.value))} /></label>}
      {field.kind === "number" && <FiniteNumberField label={field.label} value={field.present ? field.value as number : undefined} onChange={value => onChange(replacePlanField(values, field.key, value))} />}
      {field.kind === "boolean" && <div><label><input type="checkbox" checked={field.present ? field.value as boolean : false} onChange={event => onChange(replacePlanField(values, field.key, event.target.checked))} /> {field.label}</label>{!field.present && <button type="button" className="btn-secondary" onClick={() => onChange(replacePlanField(values, field.key, false))}>Set false explicitly</button>}</div>}
      {field.kind === "string-array" && <PlanStringListField label={field.label} hint="Keep the exact list order." values={field.present ? field.value as string[] : []} onChange={value => onChange(replacePlanField(values, field.key, value))} />}
      {!field.present && (field.kind === "string" || field.kind === "string-array") && <button type="button" className="btn-secondary" onClick={() => onChange(replacePlanField(values, field.key, field.kind === "string" ? "" : []))}>Set empty {field.kind === "string" ? "text" : "list"} explicitly</button>}
      {field.present && <button type="button" className="btn-secondary" onClick={() => onChange(removePlanField(values, field.key))}>Remove value for {field.label}</button>}
    </>}
  </section>)}</div>;
}
