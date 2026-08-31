"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { Drawer } from "@/components/Drawer";
import { useProjectPermissions } from "@/lib/use-project-permissions";

function PastRunDetail({ id }: { id: string }) {
  const [run, setRun] = useState<RouterOutputs["riskAnalysis"]["runById"] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    trpc.riskAnalysis.runById.query({ id }).then(setRun).catch((e) => setError(String(e)));
  }, [id]);

  if (error) return <p style={{ color: "var(--ember)" }}>{error}</p>;
  if (!run) return <p>Loading…</p>;

  return (
    <div>
      <h1 style={{ marginBottom: 4 }}>
        <code>{run.baseRef}</code> → <code>{run.headRef}</code>
      </h1>
      <p className="text-muted" style={{ fontSize: 13 }}>
        {new Date(run.createdAt).toLocaleString()} — {run.changedFiles.length} file(s) changed
      </p>

      <h3>Changed files</h3>
      <ul style={{ fontSize: 13 }}>
        {run.changedFiles.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>

      <h3>Recommended test cases ({run.recommendations.length})</h3>
      <ul style={{ listStyle: "none", padding: 0 }}>
        {run.recommendations.map((r) => (
          <li key={r.testCaseId} style={{ borderBottom: "1px solid var(--line)", padding: "6px 0" }}>
            <strong>{r.testCaseTitle}</strong>{" "}
            <span style={{ color: "var(--muted-dim)" }}>[{r.riskScoreSnapshot ?? "—"}/100]</span>
            <div style={{ color: "var(--muted)", fontSize: 12 }}>{r.matchReason}</div>
          </li>
        ))}
        {run.recommendations.length === 0 && <p className="text-muted">No test cases were recommended for this run.</p>}
      </ul>
    </div>
  );
}

// P6-06: which branches a scan should consider, path-based severity
// weighting for coverage gaps, and comment vs. silent-flag-only mode.
// Loads lazily-created defaults (main/COMMENT/no rules) for a project
// that's never configured this -- there's no required setup step.
function PrScanPolicySection({ projectId }: { projectId: string }) {
  const { canAdmin } = useProjectPermissions(projectId);
  const [policy, setPolicy] = useState<RouterOutputs["riskAnalysis"]["getPrScanPolicy"] | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    trpc.riskAnalysis.getPrScanPolicy.query({ projectId }).then(setPolicy).catch(() => undefined);
  }, [projectId]);

  async function save() {
    if (!policy) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await trpc.riskAnalysis.savePrScanPolicy.mutate({
        projectId,
        triggerBranches: policy.triggerBranches,
        commentMode: policy.commentMode as never,
        pathSeverityRules: policy.pathSeverityRules.map((r) => ({ pattern: r.pattern, severity: r.severity as never })),
      });
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (!policy) return null;

  return (
    <fieldset disabled={!canAdmin} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 16, margin: "16px 0" }}>
      <h2 style={{ marginTop: 0 }}>PR scan policy</h2>
      <label>
        Trigger branches <span className="text-muted" style={{ fontSize: 12 }}>(comma-separated)</span>
        <input
          value={policy.triggerBranches.join(", ")}
          onChange={(e) => setPolicy({ ...policy, triggerBranches: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
          style={{ width: "100%" }}
        />
      </label>
      <label style={{ display: "block", marginTop: 8 }}>
        Comment mode
        <select
          value={policy.commentMode}
          onChange={(e) => setPolicy({ ...policy, commentMode: e.target.value })}
          style={{ width: "100%" }}
        >
          <option value="COMMENT">Comment on the PR</option>
          <option value="SILENT_FLAG_ONLY">Silent - flag only, no comment</option>
        </select>
      </label>

      <div style={{ marginTop: 8 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Path severity rules</div>
        <p className="text-muted" style={{ fontSize: 12, marginTop: 0 }}>
          A coverage gap in a matching path gets this severity instead of the default (HIGH). Checked in order,
          first match wins.
        </p>
        {policy.pathSeverityRules.map((r, i) => (
          <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
            <input
              value={r.pattern}
              onChange={(e) =>
                setPolicy({
                  ...policy,
                  pathSeverityRules: policy.pathSeverityRules.map((rr, j) => (j === i ? { ...rr, pattern: e.target.value } : rr)),
                })
              }
              placeholder="e.g. apps/api/src/payments/**"
              style={{ flex: 1 }}
            />
            <select
              value={r.severity}
              onChange={(e) =>
                setPolicy({
                  ...policy,
                  pathSeverityRules: policy.pathSeverityRules.map((rr, j) => (j === i ? { ...rr, severity: e.target.value } : rr)),
                })
              }
            >
              <option value="CRITICAL">CRITICAL</option>
              <option value="HIGH">HIGH</option>
              <option value="MEDIUM">MEDIUM</option>
              <option value="LOW">LOW</option>
            </select>
            <button
              className="btn-secondary"
              onClick={() => setPolicy({ ...policy, pathSeverityRules: policy.pathSeverityRules.filter((_, j) => j !== i) })}
            >
              Remove
            </button>
          </div>
        ))}
        <button
          className="btn-secondary"
          style={{ fontSize: 12 }}
          onClick={() => setPolicy({ ...policy, pathSeverityRules: [...policy.pathSeverityRules, { pattern: "", severity: "HIGH" }] })}
        >
          + Add rule
        </button>
      </div>

      <div style={{ marginTop: 12 }}>
        <button onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save policy"}
        </button>
        {saved && <span style={{ color: "var(--frost)", marginLeft: 8 }}>Saved.</span>}
        {error && <span style={{ color: "var(--ember)", marginLeft: 8 }}>{error}</span>}
      </div>
    </fieldset>
  );
}

export default function TestStrategyPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { canEdit } = useProjectPermissions(projectId);
  const [openRunId, setOpenRunId] = useState<string | null>(null);
  const [repoUrl, setRepoUrl] = useState("");
  const [baseRef, setBaseRef] = useState("main");
  const [headRef, setHeadRef] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<RouterOutputs["riskAnalysis"]["recommendForChange"] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [aiResult, setAiResult] = useState<RouterOutputs["riskAnalysis"]["recommendTestPlansForDiff"] | null>(null);

  const [runs, setRuns] = useState<RouterOutputs["riskAnalysis"]["listRuns"]>([]);
  const [bulkAssessing, setBulkAssessing] = useState(false);
  const [bulkResult, setBulkResult] = useState<RouterOutputs["testCases"]["assessProjectRisk"] | null>(null);

  const [releases, setReleases] = useState<RouterOutputs["releases"]["list"]>([]);
  const [releaseId, setReleaseId] = useState("");
  const [newReleaseName, setNewReleaseName] = useState("");
  const [creatingRelease, setCreatingRelease] = useState(false);
  const [riskFlags, setRiskFlags] = useState<RouterOutputs["releases"]["listRiskFlags"]>([]);

  function loadRuns() {
    trpc.riskAnalysis.listRuns.query({ projectId }).then(setRuns).catch(() => undefined);
  }
  function loadReleases() {
    trpc.releases.list.query({ projectId }).then(setReleases).catch(() => undefined);
  }
  useEffect(loadRuns, [projectId]);
  useEffect(loadReleases, [projectId]);

  function loadRiskFlags() {
    if (!releaseId) {
      setRiskFlags([]);
      return;
    }
    trpc.releases.listRiskFlags.query({ releaseId }).then(setRiskFlags).catch(() => undefined);
  }
  useEffect(loadRiskFlags, [releaseId]);

  async function createRelease() {
    if (!newReleaseName) return;
    setCreatingRelease(true);
    setError(null);
    try {
      const r = await trpc.releases.create.mutate({ projectId, name: newReleaseName });
      setNewReleaseName("");
      loadReleases();
      setReleaseId(r.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreatingRelease(false);
    }
  }

  async function analyze() {
    setAnalyzing(true);
    setError(null);
    setResult(null);
    try {
      const res = await trpc.riskAnalysis.recommendForChange.mutate({
        projectId,
        repoUrl: repoUrl || undefined,
        baseRef,
        headRef,
        releaseId: releaseId || undefined,
      });
      setResult(res);
      loadRuns();
      loadRiskFlags();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAnalyzing(false);
    }
  }

  async function analyzeWithAi() {
    setAiAnalyzing(true);
    setError(null);
    setAiResult(null);
    try {
      const res = await trpc.riskAnalysis.recommendTestPlansForDiff.mutate({
        projectId,
        repoUrl: repoUrl || undefined,
        baseRef,
        headRef,
      });
      setAiResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAiAnalyzing(false);
    }
  }

  async function bulkAssess() {
    setBulkAssessing(true);
    setError(null);
    setBulkResult(null);
    try {
      const res = await trpc.testCases.assessProjectRisk.mutate({ projectId });
      setBulkResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBulkAssessing(false);
    }
  }

  return (
    <div style={{ maxWidth: 800 }}>
      <h1>Test strategy</h1>
      <p className="text-muted" style={{ margin: "-8px 0 16px" }}>
        Risk, mitigations, and coverage before you run anything —{" "}
        <a href={`/projects/${projectId}/releases`}>Release Readiness</a> shows how it held up after.
      </p>

      <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 16, margin: "16px 0" }}>
        <h2 style={{ marginTop: 0 }}>Bulk-assess risk</h2>
        <p style={{ color: "var(--muted)", margin: "0 0 8px" }}>
          AI-assess severity/risk for every test case in this project that hasn&apos;t been assessed yet (up to 20 at a time).
        </p>
        <button onClick={bulkAssess} disabled={!canEdit || bulkAssessing}>
          {bulkAssessing ? "Assessing…" : "Assess unrated test cases"}
        </button>
        {bulkResult && (
          <p style={{ color: "var(--frost)" }}>
            Assessed {bulkResult.assessedCount}, {bulkResult.failedCount} failed.
          </p>
        )}
      </div>

      <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 16, margin: "16px 0" }}>
        <h2 style={{ marginTop: 0 }}>What should run for this change?</h2>
        <div style={{ display: "grid", gap: 8, maxWidth: 500 }}>
          <label>
            Repo URL <span style={{ color: "var(--muted-dim)" }}>(https only; falls back to the project&apos;s repo URL if blank)</span>
            <input value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} style={{ width: "100%" }} />
          </label>
          <div style={{ display: "flex", gap: 12 }}>
            <label>
              Base ref
              <input value={baseRef} onChange={(e) => setBaseRef(e.target.value)} style={{ width: 160 }} />
            </label>
            <label>
              Head ref / branch / PR branch
              <input value={headRef} onChange={(e) => setHeadRef(e.target.value)} style={{ width: 260 }} />
            </label>
          </div>
          <label>
            Release <span style={{ color: "var(--muted-dim)" }}>(optional — coverage gaps become persistent risk flags on this release)</span>
            <div style={{ display: "flex", gap: 8 }}>
              <select value={releaseId} onChange={(e) => setReleaseId(e.target.value)} style={{ flex: 1 }}>
                <option value="">(none — ad-hoc check, no flags created)</option>
                {releases.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} [{r.status}]
                  </option>
                ))}
              </select>
              {releaseId && (
                <a href={`/projects/${projectId}/releases/${releaseId}`} style={{ whiteSpace: "nowrap", alignSelf: "center" }}>
                  View readiness →
                </a>
              )}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
              <input
                value={newReleaseName}
                onChange={(e) => setNewReleaseName(e.target.value)}
                placeholder="New release name"
                style={{ flex: 1 }}
              />
              <button onClick={createRelease} disabled={!canEdit || creatingRelease || !newReleaseName}>
                + New release
              </button>
            </div>
          </label>
          <button onClick={analyze} disabled={!canEdit || analyzing || !headRef}>
            {analyzing ? "Diffing + analyzing…" : "Analyze change"}
          </button>
          <button className="btn-secondary" onClick={analyzeWithAi} disabled={!canEdit || aiAnalyzing || !headRef} style={{ marginLeft: 8 }}>
            {aiAnalyzing ? "Reading the diff…" : "Also check with AI"}
          </button>
        </div>

        {error && <p style={{ color: "var(--ember)" }}>{error}</p>}

        {result && (
          <div style={{ marginTop: 16 }}>
            <p>
              {result.changedFiles.length} file(s) changed between <code>{baseRef}</code> and <code>{headRef}</code>.
              {releaseId && ` ${result.riskFlagsCreated} new risk flag(s) created on the selected release.`}
            </p>

            <h3>Must run ({result.mustRun.length})</h3>
            {result.mustRun.length === 0 && <p style={{ color: "var(--muted)" }}>No tracked test case covers any changed file.</p>}
            <ul style={{ listStyle: "none", padding: 0 }}>
              {result.mustRun.map((r) => (
                <li key={r.testCaseId} style={{ borderBottom: "1px solid var(--line)", padding: "6px 0" }}>
                  <a href={`/projects/${projectId}/test-cases/${r.testCaseId}`}>{r.title}</a>{" "}
                  <span style={{ color: r.riskScore && r.riskScore >= 70 ? "var(--ember)" : "var(--muted-dim)" }}>
                    [{r.riskScore ?? "—"}/100{r.riskSeverity ? ` ${r.riskSeverity}` : ""}]
                  </span>
                  <div style={{ color: "var(--muted-dim)", fontSize: 12 }}>{r.matchReason}</div>
                </li>
              ))}
            </ul>

            {result.coverageGaps.length > 0 && (
              <>
                <h3 style={{ color: "var(--ember)" }}>Coverage gaps ({result.coverageGaps.length})</h3>
                <p style={{ color: "var(--muted)" }}>Changed files with no tracked test case covering them:</p>
                <ul>
                  {result.coverageGaps.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}

        {aiResult && (
          <div style={{ marginTop: 16, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
            <h3>AI read of the diff</h3>
            <p className="text-muted" style={{ fontSize: 13 }}>{aiResult.rationale}</p>
            {aiResult.relevantTestPlans.length > 0 && (
              <>
                <div style={{ fontWeight: 600, fontSize: 13, marginTop: 8 }}>Relevant test plans</div>
                <ul style={{ fontSize: 13 }}>
                  {aiResult.relevantTestPlans.map((p) => (
                    <li key={p.id}>
                      <a href={`/projects/${projectId}/test-plans/${p.id}`}>{p.name}</a>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {aiResult.suggestedNewTestCases.length > 0 && (
              <>
                <div style={{ fontWeight: 600, fontSize: 13, marginTop: 8, color: "var(--ember)" }}>
                  Possible new coverage gaps
                </div>
                <ul style={{ fontSize: 13 }}>
                  {aiResult.suggestedNewTestCases.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </>
            )}
            {aiResult.relevantTestPlans.length === 0 && aiResult.suggestedNewTestCases.length === 0 && (
              <p className="text-muted" style={{ fontSize: 13 }}>
                No relevant existing plans and no obvious new coverage gaps identified.
              </p>
            )}
          </div>
        )}
      </div>

      <PrScanPolicySection projectId={projectId} />

      {releaseId && (
        <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 16, margin: "16px 0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <h2 style={{ marginTop: 0 }}>Risk flags on this release</h2>
            <a className="btn-secondary" style={{ fontSize: 13 }} href={`/projects/${projectId}/releases/${releaseId}`}>
              Full readiness view →
            </a>
          </div>
          {riskFlags.length === 0 && <p style={{ color: "var(--muted)" }}>None yet.</p>}
          <ul style={{ listStyle: "none", padding: 0 }}>
            {riskFlags.map((f) => (
              <li
                key={f.id}
                style={{
                  borderBottom: "1px solid var(--line)",
                  padding: "6px 0",
                  opacity: f.resolvedAt ? 0.5 : 1,
                }}
              >
                <strong style={{ color: f.severity === "CRITICAL" || f.severity === "HIGH" ? "var(--ember)" : "var(--fg)" }}>
                  {f.severity}
                </strong>{" "}
                [{f.source}] {f.description}
                {f.resolvedAt && <span style={{ color: "var(--frost)" }}> — resolved</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {runs.length > 0 && (
        <div>
          <h2>Past runs</h2>
          <ul style={{ listStyle: "none", padding: 0 }}>
            {runs.map((r) => (
              <li key={r.id} style={{ borderBottom: "1px solid var(--line)", padding: "6px 0" }}>
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    setOpenRunId(r.id);
                  }}
                >
                  <code>{r.baseRef}</code> → <code>{r.headRef}</code>
                </a>{" "}
                — {r.changedFiles.length} file(s) changed, {r.recommendedCount} test case(s) recommended{" "}
                <span style={{ color: "var(--muted-dim)" }}>({new Date(r.createdAt).toLocaleString()})</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Drawer open={openRunId !== null} onClose={() => setOpenRunId(null)}>
        {openRunId && <PastRunDetail id={openRunId} />}
      </Drawer>
    </div>
  );
}
