"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { trpc, type RouterOutputs } from "../../lib/trpc";

function RiskAnalysisPageInner() {
  const searchParams = useSearchParams();
  const [projectId, setProjectId] = useState(searchParams.get("projectId") ?? "");
  const [repoUrl, setRepoUrl] = useState("");
  const [baseRef, setBaseRef] = useState("main");
  const [headRef, setHeadRef] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<RouterOutputs["riskAnalysis"]["recommendForChange"] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [runs, setRuns] = useState<RouterOutputs["riskAnalysis"]["listRuns"]>([]);
  const [bulkAssessing, setBulkAssessing] = useState(false);
  const [bulkResult, setBulkResult] = useState<RouterOutputs["testCases"]["assessProjectRisk"] | null>(null);

  const [releases, setReleases] = useState<RouterOutputs["releases"]["list"]>([]);
  const [releaseId, setReleaseId] = useState("");
  const [newReleaseName, setNewReleaseName] = useState("");
  const [creatingRelease, setCreatingRelease] = useState(false);
  const [riskFlags, setRiskFlags] = useState<RouterOutputs["releases"]["listRiskFlags"]>([]);

  function loadRuns() {
    if (!projectId) return;
    trpc.riskAnalysis.listRuns.query({ projectId }).then(setRuns).catch(() => undefined);
  }
  function loadReleases() {
    if (!projectId) return;
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
    if (!projectId || !newReleaseName) return;
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
      <h1>Change impact &amp; risk analysis</h1>
      <label>
        Project ID:{" "}
        <input value={projectId} onChange={(e) => setProjectId(e.target.value)} placeholder="paste a project id" />
      </label>

      <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 16, margin: "16px 0" }}>
        <h2 style={{ marginTop: 0 }}>Bulk-assess risk</h2>
        <p style={{ color: "var(--muted)", margin: "0 0 8px" }}>
          AI-assess severity/risk for every test case in this project that hasn&apos;t been assessed yet (up to 20 at a time).
        </p>
        <button onClick={bulkAssess} disabled={bulkAssessing || !projectId}>
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
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
              <input
                value={newReleaseName}
                onChange={(e) => setNewReleaseName(e.target.value)}
                placeholder="New release name"
                style={{ flex: 1 }}
              />
              <button onClick={createRelease} disabled={creatingRelease || !newReleaseName || !projectId}>
                + New release
              </button>
            </div>
          </label>
          <button onClick={analyze} disabled={analyzing || !projectId || !headRef}>
            {analyzing ? "Diffing + analyzing…" : "Analyze change"}
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
                  <a href={`/test-cases/${r.testCaseId}`}>{r.title}</a>{" "}
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
      </div>

      {releaseId && (
        <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 16, margin: "16px 0" }}>
          <h2 style={{ marginTop: 0 }}>Risk flags on this release</h2>
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
                <code>{r.baseRef}</code> → <code>{r.headRef}</code> — {r.changedFiles.length} file(s) changed,{" "}
                {r.recommendedCount} test case(s) recommended{" "}
                <span style={{ color: "var(--muted-dim)" }}>({new Date(r.createdAt).toLocaleString()})</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function RiskAnalysisPage() {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <RiskAnalysisPageInner />
    </Suspense>
  );
}
