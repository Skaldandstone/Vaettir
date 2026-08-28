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
// P4-03: rule-based suggestions (open risk flags, high-failure-rate test
// cases, uncovered compliance controls) alongside the manual/AI-generated
// (P4-02) paths -- these are facts the platform already has structured
// data for, not an inference, so surfacing them is a lookup, not a click
// into another LLM call.
function SuggestRiskAreasButton({
  projectId,
  existing,
  onAdd,
}: {
  projectId: string;
  existing: string[];
  onAdd: (areas: string[]) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function suggest() {
    setLoading(true);
    setError(null);
    try {
      const suggestions = await trpc.testPlans.suggestRiskAreas.query({ projectId });
      const newAreas = suggestions.map((s) => s.area).filter((a) => !existing.includes(a));
      if (newAreas.length > 0) onAdd(newAreas);
      else if (suggestions.length === 0) setError("No open risk flags, failing tests, or compliance gaps found to suggest from.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ marginTop: 4 }}>
      <button className="btn-secondary" style={{ fontSize: 12 }} onClick={suggest} disabled={loading}>
        {loading ? "Checking…" : "Suggest from existing data"}
      </button>
      {error && <span className="text-muted" style={{ fontSize: 12, marginLeft: 8 }}>{error}</span>}
    </div>
  );
}

function QaStrategyForm({
  projectId,
  values,
  onChange,
}: {
  projectId: string;
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
      <div>
        <StringListField
          label="Risk areas"
          hint="Parts of the product most likely to break, or most costly if they do."
          placeholder="e.g. Checkout payment flow"
          values={riskAreas}
          onChange={(v) => onChange({ ...values, riskAreas: v })}
        />
        <SuggestRiskAreasButton
          projectId={projectId}
          existing={riskAreas}
          onAdd={(areas) => onChange({ ...values, riskAreas: [...riskAreas, ...areas] })}
        />
      </div>
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

// P4-05: full version history with a computed diff against the prior
// version, since "an update happened" (the AuditLog) isn't the same
// question as "what did the risk areas actually say two releases ago."
// Diffing happens client-side against the full snapshots the API already
// returns -- no need for the server to compute or store a diff.
function VersionHistorySection({ testPlanId, refreshKey }: { testPlanId: string; refreshKey: number }) {
  const [versions, setVersions] = useState<RouterOutputs["testPlans"]["history"]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    trpc.testPlans.history
      .query({ testPlanId })
      .then(setVersions)
      .finally(() => setLoading(false));
  }, [testPlanId, refreshKey]);

  function changesFrom(version: RouterOutputs["testPlans"]["history"][number], index: number): string[] {
    const prev = versions[index + 1]; // desc order -- the next array entry is the prior version
    if (!prev) return ["Initial version"];
    const changes: string[] = [];
    if (version.name !== prev.name) changes.push(`name: "${prev.name}" → "${version.name}"`);
    if (version.description !== prev.description) changes.push("description changed");
    if (version.status !== prev.status) changes.push(`status: ${prev.status} → ${version.status}`);
    const allKeys = new Set([...Object.keys(version.customFields), ...Object.keys(prev.customFields)]);
    for (const k of allKeys) {
      if (JSON.stringify(version.customFields[k]) !== JSON.stringify(prev.customFields[k])) {
        changes.push(`${k} changed`);
      }
    }
    return changes.length > 0 ? changes : ["No changes"];
  }

  return (
    <div style={{ marginBottom: 24 }}>
      <h2>History</h2>
      {loading && <p>Loading…</p>}
      {!loading && (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {versions.map((v, i) => (
            <li key={v.versionNumber} style={{ borderBottom: "1px solid var(--line)", padding: "8px 0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <strong>v{v.versionNumber}</strong>
                <span className="text-muted" style={{ fontSize: 12 }}>
                  {new Date(v.createdAt).toLocaleString()}
                  {v.createdBy && ` by ${v.createdBy.name ?? v.createdBy.email}`}
                </span>
              </div>
              <ul style={{ margin: "4px 0 0 16px", fontSize: 13, color: "var(--muted)" }}>
                {changesFrom(v, i).map((c, j) => (
                  <li key={j}>{c}</li>
                ))}
              </ul>
            </li>
          ))}
          {versions.length === 0 && <p className="text-muted">No history yet.</p>}
        </ul>
      )}
    </div>
  );
}

// P4-04: turns a QUALITY_STRATEGY plan into a real coordination hub rather
// than just a document. A strategy plan shows every concrete plan pointing
// back at it (read-only here -- the link is set from the child plan's own
// side); any other plan gets a picker to set/clear which strategy it
// supports.
// P4-06: a preview of the Phase 7 dashboard, scoped to one strategy. Exit
// criteria are free text, so this deliberately doesn't try to auto-grade
// each one MET/NOT_MET (the same problem P7-02 punts on) -- it surfaces
// the real current signals a human needs to eyeball their own exit
// criteria against.
function StrategySignalsSection({ projectId }: { projectId: string }) {
  const [signals, setSignals] = useState<RouterOutputs["testPlans"]["strategySignals"] | null>(null);

  useEffect(() => {
    trpc.testPlans.strategySignals.query({ projectId }).then(setSignals);
  }, [projectId]);

  if (!signals) return null;

  const { passRate, latestCoverage, openRiskFlags, flakyTestCount } = signals;
  const passPct = passRate.total > 0 ? Math.round((passRate.passed / passRate.total) * 100) : null;
  const coveragePct =
    latestCoverage && latestCoverage.linesTotal > 0
      ? Math.round((latestCoverage.linesCovered / latestCoverage.linesTotal) * 100)
      : null;
  const totalOpenFlags = openRiskFlags.critical + openRiskFlags.high + openRiskFlags.medium + openRiskFlags.low;

  return (
    <div style={{ marginBottom: 24 }}>
      <h2>Current signals</h2>
      <p className="text-muted" style={{ fontSize: 13, marginTop: -4 }}>
        Real project-wide data to check your exit criteria against - not an automatic verdict on any one criterion.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
        <div className="panel">
          <div className="text-muted" style={{ fontSize: 12 }}>Recent pass rate</div>
          <div style={{ fontSize: 20, fontWeight: 600 }}>{passPct !== null ? `${passPct}%` : "—"}</div>
          <div className="text-muted" style={{ fontSize: 11 }}>
            {passRate.total > 0
              ? `${passRate.passed}/${passRate.total} of last ${passRate.total} results`
              : "No test results yet"}
          </div>
        </div>
        <div className="panel">
          <div className="text-muted" style={{ fontSize: 12 }}>Latest coverage</div>
          <div style={{ fontSize: 20, fontWeight: 600 }}>{coveragePct !== null ? `${coveragePct}%` : "—"}</div>
          <div className="text-muted" style={{ fontSize: 11 }}>
            {latestCoverage ? new Date(latestCoverage.createdAt).toLocaleDateString() : "No coverage reports yet"}
          </div>
        </div>
        <div className="panel">
          <div className="text-muted" style={{ fontSize: 12 }}>Open risk flags</div>
          <div style={{ fontSize: 20, fontWeight: 600, color: totalOpenFlags > 0 ? "var(--ember)" : undefined }}>
            {totalOpenFlags}
          </div>
          <div className="text-muted" style={{ fontSize: 11 }}>
            {openRiskFlags.critical} critical, {openRiskFlags.high} high, {openRiskFlags.medium} medium, {openRiskFlags.low} low
          </div>
        </div>
        <div className="panel">
          <div className="text-muted" style={{ fontSize: 12 }}>Flaky tests</div>
          <div style={{ fontSize: 20, fontWeight: 600, color: flakyTestCount > 0 ? "var(--ember)" : undefined }}>
            {flakyTestCount}
          </div>
          <div className="text-muted" style={{ fontSize: 11 }}>Currently flagged (P5-05)</div>
        </div>
      </div>
    </div>
  );
}

function StrategyLinkSection({
  plan,
  projectId,
  onChanged,
  readOnly = false,
}: {
  plan: Plan;
  projectId: string;
  onChanged: () => void;
  readOnly?: boolean;
}) {
  const [candidates, setCandidates] = useState<RouterOutputs["testPlans"]["strategiesInProject"]>([]);
  const [selected, setSelected] = useState("");
  const [saving, setSaving] = useState(false);

  const isStrategy = plan.testPlanType.category === "QUALITY_STRATEGY";

  useEffect(() => {
    if (isStrategy) return;
    trpc.testPlans.strategiesInProject.query({ projectId, excludeId: plan.id }).then(setCandidates);
  }, [isStrategy, projectId, plan.id]);

  async function link() {
    if (!selected) return;
    setSaving(true);
    try {
      await trpc.testPlans.setStrategyLink.mutate({ testPlanId: plan.id, strategyId: selected });
      setSelected("");
      onChanged();
    } finally {
      setSaving(false);
    }
  }

  async function unlink() {
    setSaving(true);
    try {
      await trpc.testPlans.setStrategyLink.mutate({ testPlanId: plan.id, strategyId: null });
      onChanged();
    } finally {
      setSaving(false);
    }
  }

  if (isStrategy) {
    return (
      <div style={{ marginBottom: 24 }}>
        <h2>Plans supporting this strategy</h2>
        <ul style={{ listStyle: "none", padding: 0 }}>
          {plan.linkedPlans.map((p) => (
            <li key={p.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--line)" }}>
              <span>{p.name}</span>
              <span className="text-muted" style={{ fontSize: 12 }}>{p.status}</span>
            </li>
          ))}
          {plan.linkedPlans.length === 0 && (
            <p className="text-muted">No plans link to this strategy yet - set it from a concrete plan's own page.</p>
          )}
        </ul>
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 24 }}>
      <h2>Supports strategy</h2>
      {plan.strategyName ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span>{plan.strategyName}</span>
          {!readOnly && (
            <button className="btn-secondary" style={{ fontSize: 12 }} onClick={unlink} disabled={saving}>
              Unlink
            </button>
          )}
        </div>
      ) : readOnly ? (
        <p className="text-muted">Not linked to a strategy.</p>
      ) : candidates.length === 0 ? (
        <p className="text-muted">No QA strategy plans exist in this project yet.</p>
      ) : (
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select value={selected} onChange={(e) => setSelected(e.target.value)}>
            <option value="">Pick a strategy…</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button className="btn-secondary" style={{ fontSize: 12 }} onClick={link} disabled={saving || !selected}>
            Link
          </button>
        </div>
      )}
    </div>
  );
}

// Shared between the full detail page (/test-plans/[id], for deep links)
// and the drawer opened from the list -- same pop-out-module split as
// TestCaseDetailContent.
export function TestPlanDetailContent({
  id,
  onChanged,
  readOnly = false,
}: {
  id: string;
  onChanged?: () => void;
  readOnly?: boolean;
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
  const [historyVersion, setHistoryVersion] = useState(0);

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
      setHistoryVersion((v) => v + 1);
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

      {readOnly ? (
        <div style={{ display: "grid", gap: 6, marginBottom: 24 }}>
          {description && <p style={{ color: "var(--muted)" }}>{description}</p>}
          <p className="text-muted" style={{ fontSize: 13 }}>
            Status: {status} · You have read-only access to this organization — editing is hidden.
          </p>
        </div>
      ) : (
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
            <QaStrategyForm projectId={plan.projectId} values={customFields} onChange={setCustomFields} />
          ) : (
            <CustomFieldsForm schema={plan.testPlanType.fieldSchema as FieldSchema} values={customFields} onChange={setCustomFields} />
          )}

          <button onClick={save} disabled={saving || !name}>
            {saving ? "Saving…" : "Save"}
          </button>
          {saved && <p style={{ color: "var(--frost)" }}>Saved.</p>}
        </div>
      )}

      {plan.testPlanType.key === "qa-strategy" && <StrategySignalsSection projectId={plan.projectId} />}

      <StrategyLinkSection plan={plan} projectId={plan.projectId} onChanged={load} readOnly={readOnly} />

      <VersionHistorySection testPlanId={id} refreshKey={historyVersion} />

      <h2>Acceptance criteria</h2>
      <ul style={{ listStyle: "none", padding: 0 }}>
        {plan.acceptanceCriteria.map((c) => (
          <li key={c.id} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
            <span style={{ flex: 1 }}>{c.description}</span>
            {readOnly ? (
              <span className="text-muted" style={{ fontSize: 12 }}>{c.status}</span>
            ) : (
              <>
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
              </>
            )}
          </li>
        ))}
        {plan.acceptanceCriteria.length === 0 && <p style={{ color: "var(--muted)" }}>No acceptance criteria yet.</p>}
      </ul>

      {!readOnly && (
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
      )}
    </div>
  );
}
