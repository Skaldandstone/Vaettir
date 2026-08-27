"use client";

import { useEffect, useState } from "react";
import { trpc, type RouterOutputs } from "@/lib/trpc";

type Plan = RouterOutputs["testPlans"]["byId"];
type FieldSchema = { type?: string; properties?: Record<string, { type?: string; items?: { type?: string } }> };

const STATUSES = ["DRAFT", "ACTIVE", "IN_REVIEW", "APPROVED"];
const CRITERION_STATUSES = ["PENDING", "MET", "NOT_MET", "AT_RISK"];

// Renders one input per property in the plan type's fieldSchema (a small
// subset of JSON Schema: string/number/boolean, and array-of-string as a
// comma-separated field). Good enough for the seeded built-in plan types;
// extend if a custom plan type needs a richer property type.
function CustomFieldsForm({
  schema,
  values,
  onChange,
}: {
  schema: FieldSchema;
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
}) {
  const properties = schema.properties ?? {};
  const keys = Object.keys(properties);
  if (keys.length === 0) return null;

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {keys.map((key) => {
        const prop = properties[key];
        const value = values[key];
        if (prop?.type === "array") {
          const arr = Array.isArray(value) ? (value as string[]) : [];
          return (
            <label key={key}>
              {key} <span style={{ color: "var(--muted-dim)" }}>(comma-separated)</span>
              <input
                value={arr.join(", ")}
                onChange={(e) =>
                  onChange({
                    ...values,
                    [key]: e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
                style={{ width: "100%" }}
              />
            </label>
          );
        }
        if (prop?.type === "number") {
          return (
            <label key={key}>
              {key}
              <input
                type="number"
                value={typeof value === "number" ? value : ""}
                onChange={(e) => onChange({ ...values, [key]: e.target.value === "" ? undefined : Number(e.target.value) })}
                style={{ width: "100%" }}
              />
            </label>
          );
        }
        return (
          <label key={key}>
            {key}
            <input
              value={typeof value === "string" ? value : ""}
              onChange={(e) => onChange({ ...values, [key]: e.target.value })}
              style={{ width: "100%" }}
            />
          </label>
        );
      })}
    </div>
  );
}

// P4-01: a repeatable-row editor for one array-of-string field -- one row
// per item, add/remove buttons, rather than the generic CustomFieldsForm's
// single comma-separated text input for the same data. Comma-separated is
// fine for a quick built-in type nobody's staring at for long; a QA
// strategy's risk areas/entry/exit criteria are exactly the fields someone
// is meant to sit down and think through one at a time.
function StringListField({
  label,
  hint,
  placeholder,
  values,
  onChange,
}: {
  label: string;
  hint: string;
  placeholder: string;
  values: string[];
  onChange: (values: string[]) => void;
}) {
  return (
    <div>
      <div style={{ fontWeight: 600 }}>{label}</div>
      <p className="text-muted" style={{ fontSize: 12, marginTop: 2, marginBottom: 8 }}>
        {hint}
      </p>
      {values.map((v, i) => (
        <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
          <input
            value={v}
            onChange={(e) => onChange(values.map((vv, j) => (j === i ? e.target.value : vv)))}
            placeholder={placeholder}
            style={{ flex: 1 }}
          />
          <button className="btn-secondary" onClick={() => onChange(values.filter((_, j) => j !== i))}>
            Remove
          </button>
        </div>
      ))}
      <button className="btn-secondary" style={{ fontSize: 12 }} onClick={() => onChange([...values, ""])}>
        + Add {label.toLowerCase().replace(/s$/, "")}
      </button>
    </div>
  );
}

// P4-01: the QA Strategy plan type's own guided form, in place of the
// generic CustomFieldsForm, since this is the plan type the roadmap calls
// out by name for a "structured, guided form rather than raw JSON." Every
// other plan type (built-in or custom, per P3-09) still gets the generic
// renderer -- this one earns a dedicated form because its four fields are
// exactly the fields a QA lead is meant to sit down and actually think
// through, not just fill in.
function QaStrategyForm({
  values,
  onChange,
}: {
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
}) {
  const asStringArray = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const riskAreas = asStringArray(values.riskAreas);
  const environments = asStringArray(values.environments);
  const entryCriteria = asStringArray(values.entryCriteria);
  const exitCriteria = asStringArray(values.exitCriteria);

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <StringListField
        label="Risk areas"
        hint="Parts of the product most likely to break, or most costly if they do."
        placeholder="e.g. Checkout payment flow"
        values={riskAreas}
        onChange={(v) => onChange({ ...values, riskAreas: v })}
      />
      <StringListField
        label="Environments"
        hint="Where this strategy's testing actually runs."
        placeholder="e.g. Staging, iOS 17 physical device"
        values={environments}
        onChange={(v) => onChange({ ...values, environments: v })}
      />
      <StringListField
        label="Entry criteria"
        hint="What must be true before testing under this strategy can start."
        placeholder="e.g. Feature flag enabled in staging"
        values={entryCriteria}
        onChange={(v) => onChange({ ...values, entryCriteria: v })}
      />
      <StringListField
        label="Exit criteria"
        hint="What must be true to call this strategy's testing done."
        placeholder="e.g. Zero open Sev1 risk flags"
        values={exitCriteria}
        onChange={(v) => onChange({ ...values, exitCriteria: v })}
      />
    </div>
  );
}

// Shared between the full detail page (/test-plans/[id], for deep links)
// and the drawer opened from the list -- same pop-out-module split as
// TestCaseDetailContent.
export function TestPlanDetailContent({
  id,
  onChanged,
}: {
  id: string;
  onChanged?: () => void;
}) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [requirements, setRequirements] = useState<RouterOutputs["requirements"]["list"]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("DRAFT");
  const [customFields, setCustomFields] = useState<Record<string, unknown>>({});

  const [newCriterion, setNewCriterion] = useState("");
  const [newCriterionRequirementId, setNewCriterionRequirementId] = useState("");

  function load() {
    trpc.testPlans.byId
      .query({ id })
      .then((p) => {
        setPlan(p);
        setName(p.name);
        setDescription(p.description ?? "");
        setStatus(p.status);
        setCustomFields(p.customFields);
        return trpc.requirements.list.query({ projectId: p.projectId });
      })
      .then(setRequirements)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }

  useEffect(load, [id]);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await trpc.testPlans.update.mutate({ id, name, description: description || undefined, status: status as never, customFields });
      setSaved(true);
      load();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function addCriterion() {
    if (!newCriterion) return;
    try {
      await trpc.testPlans.addAcceptanceCriterion.mutate({
        testPlanId: id,
        description: newCriterion,
        requirementId: newCriterionRequirementId || undefined,
      });
      setNewCriterion("");
      setNewCriterionRequirementId("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function updateCriterionStatus(criterionId: string, description: string, requirementId: string | null, statusValue: string) {
    await trpc.testPlans.updateAcceptanceCriterion.mutate({ id: criterionId, description, status: statusValue as never, requirementId });
    load();
  }

  async function removeCriterion(criterionId: string) {
    await trpc.testPlans.deleteAcceptanceCriterion.mutate({ id: criterionId });
    load();
  }

  if (error) return <p style={{ color: "var(--ember)" }}>{error}</p>;
  if (!plan) return <p>Loading…</p>;

  return (
    <div>
      <h1 style={{ marginBottom: 2 }}>{plan.name}</h1>
      <p style={{ color: "var(--muted)" }}>{plan.testPlanType.name} plan</p>

      <div style={{ display: "grid", gap: 10, marginBottom: 24 }}>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} style={{ width: "100%" }} />
        </label>
        <label>
          Description
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} style={{ width: "100%" }} rows={3} />
        </label>
        <label>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        {plan.testPlanType.key === "qa-strategy" ? (
          <QaStrategyForm values={customFields} onChange={setCustomFields} />
        ) : (
          <CustomFieldsForm schema={plan.testPlanType.fieldSchema as FieldSchema} values={customFields} onChange={setCustomFields} />
        )}

        <button onClick={save} disabled={saving || !name}>
          {saving ? "Saving…" : "Save"}
        </button>
        {saved && <p style={{ color: "var(--frost)" }}>Saved.</p>}
      </div>

      <h2>Acceptance criteria</h2>
      <ul style={{ listStyle: "none", padding: 0 }}>
        {plan.acceptanceCriteria.map((c) => (
          <li key={c.id} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
            <span style={{ flex: 1 }}>{c.description}</span>
            <select
              value={c.status}
              onChange={(e) => updateCriterionStatus(c.id, c.description, c.requirementId, e.target.value)}
            >
              {CRITERION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <button onClick={() => removeCriterion(c.id)}>Remove</button>
          </li>
        ))}
        {plan.acceptanceCriteria.length === 0 && <p style={{ color: "var(--muted)" }}>No acceptance criteria yet.</p>}
      </ul>

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <input
          value={newCriterion}
          onChange={(e) => setNewCriterion(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addCriterion()}
          placeholder="New acceptance criterion, press Enter…"
          style={{ flex: 1 }}
        />
        <select value={newCriterionRequirementId} onChange={(e) => setNewCriterionRequirementId(e.target.value)}>
          <option value="">(no linked requirement)</option>
          {requirements.map((r) => (
            <option key={r.id} value={r.id}>
              {r.title}
            </option>
          ))}
        </select>
        <button onClick={addCriterion} disabled={!newCriterion}>
          + Add
        </button>
      </div>
    </div>
  );
}
