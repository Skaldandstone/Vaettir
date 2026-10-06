"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { trpcReact, type RouterOutputs } from "@/lib/trpcReact";
import { PlanExecutionModal } from "./PlanExecutionModal";
import { CriterionDescriptionEditor } from "./CriterionDescriptionEditor";
import { CriterionVerdictEditor } from "./CriterionVerdictEditor";
import { PlanGovernanceHistory } from "./PlanGovernanceHistory";
import { GovernedCriterionCollection } from "./GovernedCriterionCollection";
import { PlanHeaderEditor } from "./PlanHeaderEditor";
import { PlanStatusEditor } from "./PlanStatusEditor";
import { PlanCustomFieldsEditor } from "./PlanCustomFieldsEditor";
import { describeRetainedPlanValue } from "@/lib/plan-custom-fields";
import { planMetadataChanges } from "@/lib/plan-root-metadata";
import { editStrategyRow, qaStrategyFingerprint, qaStrategyList, removeStrategyRow, sameStrategyRowValues, sameStrategySuggestionScope, strategyRows } from "@/lib/qa-strategy-fields";

type Plan = RouterOutputs["testPlans"]["byId"];

// P4-01: dedicated QA-strategy rows retain their exact string contents.
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
  const prefix = useId();
  const snapshot = (generation: number) => {
    let nextId = 0;
    const rows = strategyRows(values, () => `${prefix}:${generation}:${nextId++}`);
    return { rows, generation, nextId };
  };
  const [state, setState] = useState(() => snapshot(0)), rows = state.rows;
  // A genuinely changed external list is a new snapshot. Do not guess which
  // identical strings moved. A same-value echo keeps the opaque local row IDs.
  if (!sameStrategyRowValues(rows, values)) { setState(snapshot(state.generation + 1)); }
  const change = (next: typeof rows, nextId = state.nextId) => { setState({ ...state, rows: next, nextId }); onChange(next.map(row => row.value)); };
  return (
    <div>
      <div style={{ fontWeight: 600 }}>{label}</div>
      <p className="text-muted" style={{ fontSize: 12, marginTop: 2, marginBottom: 8 }}>
        {hint}
      </p>
      {rows.map((row, i) => (
        <div key={row.id} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
          <textarea
            rows={2}
            aria-label={`${label} ${i + 1}`}
            value={row.value}
            onChange={(e) => change(editStrategyRow(rows, row.id, e.target.value))}
            placeholder={placeholder}
            style={{ flex: 1 }}
          />
          <button type="button" className="btn-secondary" aria-label={`Remove ${label} row ${i + 1}`} onClick={() => change(removeStrategyRow(rows, row.id))}>
            Remove
          </button>
        </div>
      ))}
      <button type="button" className="btn-secondary" style={{ fontSize: 12 }} onClick={() => change([...rows, { id: `${prefix}:${state.generation}:${state.nextId}`, value: "" }], state.nextId + 1)}>
        + Add {label.toLowerCase().replace(/s$/, "")}
      </button>
    </div>
  );
}

// P4-01: the QA Strategy plan type's own guided form, in place of the
// generic PlanCustomFieldsForm, since this is the plan type the roadmap calls
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
  fingerprint,
  active = true,
}: {
  projectId: string;
  existing: string[];
  onAdd: (areas: string[]) => void;
  fingerprint: string;
  active?: boolean;
}) {
  const utils = trpcReact.useUtils();
  const auth = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef({ ready: false, fingerprint, actorId: auth.userId, sessionId: auth.sessionId, existing, onAdd, generation: 0 });
  const ready = active && !!auth.isLoaded && !!auth.isSignedIn;
  useLayoutEffect(() => {
    latest.current = { ready, fingerprint, actorId: auth.userId, sessionId: auth.sessionId, existing, onAdd, generation: latest.current.generation + 1 };
    // A transient loss/recovery must not reauthorize an earlier pending read.
    setLoading(false);
    return () => { latest.current = { ...latest.current, ready: false, generation: latest.current.generation + 1 }; };
  }, [ready, fingerprint, auth.userId, auth.sessionId, existing, onAdd]);

  async function suggest() {
    const original = latest.current;
    if (!original.ready || !original.actorId || !original.sessionId) return;
    setLoading(true);
    setError(null);
    try {
      const suggestions = await utils.testPlans.suggestRiskAreas.fetch({ projectId });
      if (!sameStrategySuggestionScope(original, latest.current)) {
        // Refuse silently rather than overwrite a newer generation's notice.
        // The persistent explanation below makes this refusal policy visible.
        return;
      }
      const newAreas = suggestions.map((s) => s.area).filter((a) => !latest.current.existing.includes(a));
      if (newAreas.length > 0) latest.current.onAdd(newAreas);
      else if (suggestions.length === 0) setError("No open risk flags, failing tests, or compliance gaps found to suggest from.");
    } catch (e) {
      if (latest.current.ready && latest.current.generation === original.generation) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (latest.current.ready && latest.current.generation === original.generation) setLoading(false);
    }
  }

  return (
    <div style={{ marginTop: 4 }}>
      <button type="button" className="btn-secondary" style={{ fontSize: 12 }} onClick={suggest} disabled={loading || !ready}>
        {loading ? "Checking…" : "Suggest from existing data"}
      </button>
      {error && <span className="text-muted" style={{ fontSize: 12, marginLeft: 8 }}>{error}</span>}
      <p className="text-muted" style={{ fontSize: 12 }}>Suggestions apply only while these exact strategy fields and the original signed-in session remain current. If that context changes, the earlier response is not added and cannot replace a newer notice. Retry with the retained current fields.</p>
    </div>
  );
}

function QaStrategyForm({
  projectId,
  values,
  onChange,
  active = true,
}: {
  projectId: string;
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
  active?: boolean;
}) {
  const fingerprint = qaStrategyFingerprint(projectId, values);
  const fields = [
    { key: "riskAreas", label: "Risk areas", hint: "Parts of the product most likely to break, or most costly if they do.", placeholder: "e.g. Checkout payment flow" },
    { key: "environments", label: "Environments", hint: "Where this strategy's testing actually runs.", placeholder: "e.g. Staging, iOS 17 physical device" },
    { key: "entryCriteria", label: "Entry criteria", hint: "What must be true before testing under this strategy can start.", placeholder: "e.g. Feature flag enabled in staging" },
    { key: "exitCriteria", label: "Exit criteria", hint: "What must be true to call this strategy's testing done.", placeholder: "e.g. Zero open Sev1 risk flags" },
  ];

  return (
    <div style={{ display: "grid", gap: 18 }}>
      {fields.map(field => {
        const list = qaStrategyList(values, field.key);
        return <section key={field.key}>
          {list.kind === "retained" ? <><h3>{field.label}</h3><p role="status">The complete native value is not a supported string list. It is retained read-only; no items were filtered or replaced.</p><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{describeRetainedPlanValue(list.raw, true)}</pre></> : <>
            {list.kind === "missing" && <p className="text-muted">Not set. Add a row deliberately to initialize this list.</p>}
            <StringListField label={field.label} hint={field.hint} placeholder={field.placeholder} values={list.items} onChange={items => onChange({ ...values, [field.key]: items })} />
            {field.key === "riskAreas" && <SuggestRiskAreasButton projectId={projectId} active={active} existing={list.items} fingerprint={fingerprint} onAdd={areas => onChange({ ...values, riskAreas: [...list.items, ...areas] })} />}
          </>}
        </section>;
      })}
    </div>
  );
}

// P4-05: full version history with a computed diff against the prior
// version, since "an update happened" (the AuditLog) isn't the same
// question as "what did the risk areas actually say two releases ago."
// Diffing happens client-side against the full snapshots the API already
// returns -- no need for the server to compute or store a diff.
function VersionHistorySection({ testPlanId }: { testPlanId: string }) {
  const historyQuery = trpcReact.testPlans.history.useQuery({ testPlanId });
  const versions = historyQuery.data ?? [];
  const loading = historyQuery.isPending;
  function executionSummary(value: unknown): string | null {
    if (!value || typeof value !== "object" || !("version" in value) || value.version !== 1 || !("testCaseIds" in value) || !Array.isArray(value.testCaseIds) || !("configurations" in value) || !Array.isArray(value.configurations) || value.testCaseIds.length > 500 || value.configurations.length > 20) return null;
    const names = value.configurations.map(item => item && typeof item === "object" && "name" in item && typeof item.name === "string" ? item.name.slice(0, 120) : "Unnamed configuration");
    return `${value.testCaseIds.length} execution cases; ${names.length} configurations${names.length ? `: ${names.join(", ")}` : ""}`;
  }

  function changesFrom(version: RouterOutputs["testPlans"]["history"][number], index: number): string[] {
    const prev = versions[index + 1]; // desc order -- the next array entry is the prior version
    if (!prev) return ["Initial version"];
    const changes: string[] = [];
    if (version.name !== prev.name) changes.push(`name: "${prev.name}" → "${version.name}"`);
    if (version.description !== prev.description) changes.push("description changed");
    if (version.status !== prev.status) changes.push(`status: ${prev.status} → ${version.status}`);
    if (JSON.stringify(version.executionTemplate) !== JSON.stringify(prev.executionTemplate)) changes.push("execution cases/configurations changed");
    changes.push(...planMetadataChanges(version.customFields, prev.customFields));
    return changes.length > 0 ? changes : ["No changes"];
  }

  return (
    <div style={{ marginBottom: 24 }}>
      <h2>History</h2>
      {historyQuery.error && <p role="alert">History could not be refreshed: {historyQuery.error.message}. No empty or complete history is inferred. <button type="button" onClick={() => void historyQuery.refetch()}>Retry history</button></p>}
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
              {executionSummary(v.executionTemplate) && <p className="text-muted" style={{ fontSize: 12, overflowWrap: "anywhere" }}>{executionSummary(v.executionTemplate)}</p>}
            </li>
          ))}
          {versions.length === 0 && !historyQuery.error && <p className="text-muted">No history yet.</p>}
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
  const signalsQuery = trpcReact.testPlans.strategySignals.useQuery({ projectId });
  const signals = signalsQuery.data ?? null;

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
  const [selected, setSelected] = useState("");
  const [saving, setSaving] = useState(false);

  const isStrategy = plan.testPlanType.category === "QUALITY_STRATEGY";

  const candidatesQuery = trpcReact.testPlans.strategiesInProject.useQuery(
    { projectId, excludeId: plan.id },
    { enabled: !isStrategy },
  );
  const candidates = candidatesQuery.data ?? [];
  const setLinkMutation = trpcReact.testPlans.setStrategyLink.useMutation();

  async function link() {
    if (!selected) return;
    setSaving(true);
    try {
      await setLinkMutation.mutateAsync({ testPlanId: plan.id, strategyId: selected });
      setSelected("");
      onChanged();
    } finally {
      setSaving(false);
    }
  }

  async function unlink() {
    setSaving(true);
    try {
      await setLinkMutation.mutateAsync({ testPlanId: plan.id, strategyId: null });
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
// 2026-09-02: Vaettir generates and reverse-engineers test cases, but had
// no way to critique existing ones -- this scans every case already in
// the plan for vague titles, unclear steps, missing expected results, and
// near-duplicate coverage between cases. Diagnostic only: it never edits a
// case itself, same "draft/flag, human decides" shape as every other AI
// feature here -- there's nothing to "accept," just findings to act on
// manually (or ignore).
function TestCaseQualityReviewSection({ testPlanId, projectId }: { testPlanId: string; projectId: string }) {
  const casesQuery = trpcReact.testCases.listForPlan.useQuery({ testPlanId });
  const caseCount = casesQuery.data ? casesQuery.data.length : null;
  const caseTitles: Record<string, string> = Object.fromEntries((casesQuery.data ?? []).map((c) => [c.id, c.title]));
  const reviewMutation = trpcReact.testCases.reviewPlanQuality.useMutation();
  const [reviewing, setReviewing] = useState(false);
  const [result, setResult] = useState<RouterOutputs["testCases"]["reviewPlanQuality"] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function review() {
    setReviewing(true);
    setError(null);
    try {
      const r = await reviewMutation.mutateAsync({ testPlanId });
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setReviewing(false);
    }
  }

  if (caseCount === 0) return null;

  return (
    <div style={{ marginBottom: 24 }}>
      <h2>Test case quality</h2>
      <p className="text-muted" style={{ fontSize: 13, marginTop: -8 }}>
        AI scan for vague titles, unclear steps, missing expected results, and near-duplicate coverage across
        this plan's {caseCount ?? "…"} test case{caseCount === 1 ? "" : "s"}. Diagnostic only -- nothing is edited
        automatically.
      </p>
      <button className="btn-secondary" onClick={review} disabled={reviewing || caseCount === null}>
        {reviewing ? "Reviewing…" : result ? "Review again" : "Review test case quality"}
      </button>
      {error && <p style={{ color: "var(--ember)" }}>{error}</p>}
      {result && (
        <div style={{ marginTop: 12 }}>
          {result.truncated && (
            <p className="text-muted" style={{ fontSize: 12 }}>
              Only the first {result.reviewedCount} cases were reviewed -- this plan has more than that.
            </p>
          )}
          {result.issues.length === 0 && result.duplicateGroups.length === 0 && (
            <p style={{ color: "var(--frost)" }}>No quality issues or duplicate coverage found.</p>
          )}
          {result.issues.length > 0 && (
            <>
              <h3 style={{ fontSize: 14, marginBottom: 6 }}>Issues</h3>
              <ul style={{ listStyle: "none", padding: 0 }}>
                {result.issues.map((issue, i) => (
                  <li key={i} style={{ borderBottom: "1px solid var(--line)", padding: "8px 0" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <a href={`/projects/${projectId}/test-cases/${issue.testCaseId}`} style={{ fontWeight: 600 }}>
                        {caseTitles[issue.testCaseId] ?? issue.testCaseId}
                      </a>
                      <span className="text-muted" style={{ fontSize: 11, whiteSpace: "nowrap" }}>
                        {issue.issueType.replace(/_/g, " ").toLowerCase()}
                      </span>
                    </div>
                    <p style={{ margin: "4px 0", fontSize: 13 }}>{issue.description}</p>
                    <p className="text-muted" style={{ margin: 0, fontSize: 13 }}>
                      Suggestion: {issue.suggestion}
                    </p>
                  </li>
                ))}
              </ul>
            </>
          )}
          {result.duplicateGroups.length > 0 && (
            <>
              <h3 style={{ fontSize: 14, marginTop: 16, marginBottom: 6 }}>Possible duplicate coverage</h3>
              <ul style={{ listStyle: "none", padding: 0 }}>
                {result.duplicateGroups.map((group, i) => (
                  <li key={i} style={{ borderBottom: "1px solid var(--line)", padding: "8px 0" }}>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {group.testCaseIds.map((id, j) => (
                        <span key={id}>
                          {j > 0 && <span className="text-muted"> · </span>}
                          <a href={`/projects/${projectId}/test-cases/${id}`}>{caseTitles[id] ?? id}</a>
                        </span>
                      ))}
                    </div>
                    <p className="text-muted" style={{ margin: "4px 0 0", fontSize: 13 }}>{group.reason}</p>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function TestPlanDetailContent({
  id,
  projectId: routeProjectId,
  onChanged,
  readOnly = false,
}: {
  id: string;
  projectId?: string;
  onChanged?: () => void;
  readOnly?: boolean;
}) {
  // Keep each reviewed controller mounted through unavailable parent reads.
  // Route/project metadata discovers scope only; native echoes authorize it.
  const utils = trpcReact.useUtils();
  const auth = useAuth();
  const planQuery = trpcReact.testPlans.byId.useQuery({ id });
  const scopeMismatch = !!routeProjectId && !!planQuery.data && planQuery.data.projectId !== routeProjectId;
  const plan: Plan | null = scopeMismatch ? null : planQuery.data ?? null;
  const [discovery, setDiscovery] = useState<{ id: string; projectId: string; typeKey: string } | null>(null);
  if (plan && discovery?.id !== id) setDiscovery({ id, projectId: plan.projectId, typeKey: plan.testPlanType.key });
  const controlProjectId = routeProjectId ?? (discovery?.id === id ? discovery.projectId : plan?.projectId);
  const projectDiscovery = trpcReact.project.byId.useQuery({ id: controlProjectId ?? "pending" }, { enabled: !!controlProjectId && auth.isLoaded && !!auth.isSignedIn, retry: false, staleTime: 0, refetchOnWindowFocus: false });
  const organizationId = projectDiscovery.data && projectDiscovery.data.id === controlProjectId ? projectDiscovery.data.organizationId : "";
  const description = plan?.description;
  const status = plan?.status;
  const [executionOpen, setExecutionOpen] = useState(false);

  function load() {
    void utils.testPlans.byId.invalidate({ id });
    void utils.testPlans.history.invalidate({ testPlanId: id });
  }

  const fieldsRenderer = (plan?.testPlanType.key ?? (discovery?.id === id ? discovery.typeKey : null)) === "qa-strategy" && controlProjectId
    ? (values: Record<string, unknown>, onChange: (values: Record<string, unknown>) => void, context: { active: boolean; projectId: string; testPlanId: string }) => <QaStrategyForm projectId={context.projectId} active={context.active} values={values} onChange={onChange} /> : undefined;
  const reviewedControls = controlProjectId ? <section key={`reviewed:${controlProjectId}:${id}`}>
    <PlanHeaderEditor key={`${controlProjectId}:${id}`} projectId={controlProjectId} testPlanId={id} readOnly={readOnly} onChanged={() => { load(); onChanged?.(); }} />
    <PlanStatusEditor key={`status:${controlProjectId}:${id}`} projectId={controlProjectId} testPlanId={id} organizationId={organizationId} readOnly={readOnly} onChanged={() => { load(); onChanged?.(); }} />
    <PlanCustomFieldsEditor key={`fields:${controlProjectId}:${id}`} projectId={controlProjectId} testPlanId={id} organizationId={organizationId} readOnly={readOnly} renderFields={fieldsRenderer} onChanged={() => { load(); onChanged?.(); }} />
  </section> : null;
  const loadError = scopeMismatch ? "This plan does not belong to the route’s selected project. No unrelated plan body is shown." : planQuery.error?.message ?? null;
  // Retain the same child owner through unavailable parent metadata. Closing
  // its visible dialog does not discard held draft/body/UUID state and grants
  // no new save/start authority to the legacy execution path.
  const executionControls = controlProjectId ? <PlanExecutionModal key={id}
    open={executionOpen && !!plan && auth.isLoaded && !!auth.isSignedIn && !readOnly && !loadError}
    onClose={() => setExecutionOpen(false)} id={id} projectId={controlProjectId}
    organizationId={organizationId || undefined}
    onSaved={() => { load(); onChanged?.(); }} /> : null;
  if (!plan) return <div>{executionControls}{reviewedControls}<p role={loadError ? "alert" : undefined}>{loadError ?? "Loading saved plan…"}</p></div>;

  return (
    <div>
      {executionControls}
      {loadError && <div role="alert" style={{ color: "var(--ember)", marginBottom: 12 }}>
        <p>{loadError}</p>
        <p>Your mounted drafts remain here. A failed response is not proof that a save was rejected.</p>
        <button type="button" className="btn-secondary" onClick={load}>Refresh saved plan without clearing drafts</button>
      </div>}
      <h1 style={{ marginBottom: 2 }}>{plan.name}</h1>
      <p style={{ color: "var(--muted)" }}>{plan.testPlanType.name} plan</p>

      {!readOnly && <button className="btn-secondary" style={{ marginBottom: 16 }} onClick={() => setExecutionOpen(true)}>Configure cases / repeat execution</button>}
      {reviewedControls}

      {readOnly && (
        <div style={{ display: "grid", gap: 6, marginBottom: 24 }}>
          {description && <p style={{ color: "var(--muted)" }}>{description}</p>}
          <p className="text-muted" style={{ fontSize: 13 }}>
            Status: {status} · You have read-only access to this organization — editing is hidden.
          </p>
        </div>
      )}
      <p>Status: <strong>{status}</strong>. This saved planning lifecycle does not prove passing evidence or release acceptance.</p>
      <details><summary>Saved native plan fields (read-only)</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{describeRetainedPlanValue(plan.customFields, true)}</pre></details>

      {plan.testPlanType.key === "qa-strategy" && <StrategySignalsSection projectId={plan.projectId} />}

      <StrategyLinkSection plan={plan} projectId={plan.projectId} onChanged={load} readOnly={readOnly} />

      <VersionHistorySection testPlanId={id} />

      <TestCaseQualityReviewSection testPlanId={id} projectId={plan.projectId} />

      <h2>Acceptance criteria</h2>
      <ul style={{ listStyle: "none", padding: 0 }}>
        {plan.acceptanceCriteria.map((c) => (
          <li key={c.id} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
            <div style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>
              <span style={{ whiteSpace: "pre-wrap" }}>{c.description}</span>{" "}
              <span hidden={readOnly}><CriterionDescriptionEditor projectId={plan.projectId} testPlanId={id} criterionId={c.id} onChanged={load} /></span>
            </div>
            <div hidden={readOnly}><CriterionVerdictEditor projectId={plan.projectId} testPlanId={id} criterionId={c.id} status={c.status} onChanged={load} /></div>
            {readOnly && (
              <span className="text-muted" style={{ fontSize: 12 }}>{c.status}</span>
            )}
          </li>
        ))}
        {plan.acceptanceCriteria.length === 0 && <p style={{ color: "var(--muted)" }}>No acceptance criteria yet.</p>}
      </ul>
      <GovernedCriterionCollection key={`${plan.projectId}:${id}`} projectId={plan.projectId} testPlanId={id} readOnly={readOnly} onChanged={load} />
      <PlanGovernanceHistory projectId={plan.projectId} testPlanId={id} />
    </div>
  );
}
