"use client";

import { Fragment, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { Drawer } from "@/components/Drawer";

const STATUS_COLORS: Record<string, string> = {
  PASSED: "#1a7f37",
  FAILED: "#cf222e",
  PARTIAL: "#9a6700",
  RUNNING: "#0969da",
};

const RESULT_COLORS: Record<string, string> = {
  PASS: "#1a7f37",
  FAIL: "#cf222e",
  SKIP: "#57606a",
  FLAKY: "#9a6700",
};

// P5-04: the manual half of matching -- an unmatched result gets a picker
// to link it to a real TestCase once. That link is remembered server-side
// (it sets TestCaseSource.externalTestId when unset), so this picker is a
// one-time cost per test, not a per-run chore.
function LinkResultPicker({
  testResultId,
  projectId,
  onLinked,
}: {
  testResultId: string;
  projectId: string;
  onLinked: () => void;
}) {
  const [picking, setPicking] = useState(false);
  const [candidates, setCandidates] = useState<RouterOutputs["testCases"]["list"]>([]);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openPicker() {
    setPicking(true);
    trpc.testCases.list.query({ projectId }).then(setCandidates);
  }

  async function link() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await trpc.testRuns.linkResultToTestCase.mutate({ testResultId, testCaseId: selected });
      setPicking(false);
      setSelected("");
      onLinked();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!picking) {
    return (
      <button className="btn-secondary" style={{ fontSize: 11 }} onClick={openPicker}>
        Link to test case
      </button>
    );
  }

  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <select value={selected} onChange={(e) => setSelected(e.target.value)} style={{ fontSize: 11 }}>
        <option value="">Pick a test case…</option>
        {candidates.map((tc) => (
          <option key={tc.id} value={tc.id}>
            {tc.title}
          </option>
        ))}
      </select>
      <button className="btn-secondary" style={{ fontSize: 11 }} onClick={link} disabled={busy || !selected}>
        Link
      </button>
      <button className="btn-secondary" style={{ fontSize: 11 }} onClick={() => setPicking(false)}>
        Cancel
      </button>
      {error && <span style={{ color: "var(--ember)", fontSize: 11 }}>{error}</span>}
    </div>
  );
}

const CLASSIFICATION_COLORS: Record<string, string> = {
  BRITTLE: "#9a6700",
  REAL_REGRESSION: "#cf222e",
  UNCERTAIN: "#57606a",
};

// P6.5-03: classify-on-demand + review UI for a single failing result.
// Never touches the repo -- approving a suggestion just marks it reviewed
// so it stops showing as needing attention; the suggested diff is right
// here to copy, not applied anywhere automatically.
function HealingSuggestionPanel({ testResultId }: { testResultId: string }) {
  const [suggestion, setSuggestion] = useState<RouterOutputs["healingSuggestions"]["byTestResult"]>(null);
  const [loading, setLoading] = useState(true);
  const [classifying, setClassifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    trpc.healingSuggestions.byTestResult
      .query({ testResultId })
      .then(setSuggestion)
      .finally(() => setLoading(false));
  }

  useEffect(load, [testResultId]);

  async function classify() {
    setClassifying(true);
    setError(null);
    try {
      const result = await trpc.healingSuggestions.classify.mutate({ testResultId });
      if (result.ok) setSuggestion(result.suggestion);
      else setError(result.reason);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setClassifying(false);
    }
  }

  async function review(status: "APPROVED" | "REJECTED") {
    if (!suggestion) return;
    try {
      setSuggestion(await trpc.healingSuggestions.review.mutate({ id: suggestion.id, status }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (loading) return null;

  if (!suggestion) {
    return (
      <div style={{ marginTop: 4 }}>
        <button className="btn-secondary" style={{ fontSize: 11 }} onClick={classify} disabled={classifying}>
          {classifying ? "Classifying…" : "Classify failure"}
        </button>
        {error && <div style={{ color: "var(--ember)", fontSize: 11, marginTop: 4 }}>{error}</div>}
      </div>
    );
  }

  return (
    <div style={{ marginTop: 6, padding: 8, border: "1px solid var(--line)", borderRadius: 4, fontSize: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontWeight: 600, color: CLASSIFICATION_COLORS[suggestion.classification] ?? "inherit" }}>
          {suggestion.classification.replace("_", " ")}
        </span>
        {suggestion.resolvedAt && <span style={{ color: "var(--frost)" }}>resolved</span>}
        {suggestion.status !== "PENDING" && !suggestion.resolvedAt && (
          <span className="text-muted">{suggestion.status.toLowerCase()}</span>
        )}
      </div>
      <p style={{ margin: "4px 0" }}>{suggestion.classificationRationale}</p>
      {suggestion.suggestedDiff && (
        <>
          <div className="text-muted" style={{ marginTop: 6 }}>
            Suggested fix:
          </div>
          <pre style={{ background: "var(--panel-bg, #1a1a1a)", padding: 6, borderRadius: 3, overflowX: "auto", margin: "4px 0" }}>
            {suggestion.suggestedDiff}
          </pre>
          {suggestion.suggestionRationale && <p className="text-muted" style={{ margin: 0 }}>{suggestion.suggestionRationale}</p>}
        </>
      )}
      {suggestion.status === "PENDING" && (
        <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
          <button className="btn-secondary" style={{ fontSize: 11 }} onClick={() => review("APPROVED")}>
            Approve
          </button>
          <button className="btn-secondary" style={{ fontSize: 11 }} onClick={() => review("REJECTED")}>
            Reject
          </button>
        </div>
      )}
      {error && <div style={{ color: "var(--ember)", fontSize: 11, marginTop: 4 }}>{error}</div>}
    </div>
  );
}

function TestRunDetail({ id }: { id: string }) {
  const [run, setRun] = useState<RouterOutputs["testRuns"]["byId"] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    trpc.testRuns.byId
      .query({ id })
      .then(setRun)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }

  useEffect(load, [id]);

  if (error) return <p style={{ color: "var(--ember)" }}>{error}</p>;
  if (!run) return <p>Loading…</p>;

  return (
    <div>
      <h1 style={{ marginBottom: 2 }}>{run.ciProvider} run</h1>
      <p className="text-muted" style={{ fontSize: 13 }}>
        {run.branch} @ <code>{run.commitSha.slice(0, 12)}</code> — {new Date(run.startedAt).toLocaleString()}
        {run.ciRunUrl && (
          <>
            {" · "}
            <a href={run.ciRunUrl} target="_blank" rel="noreferrer">
              View in CI
            </a>
          </>
        )}
      </p>
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 16 }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid var(--line)" }}>
            <th style={{ padding: "6px 8px", fontSize: 12 }}>Status</th>
            <th style={{ padding: "6px 8px", fontSize: 12 }}>Test</th>
            <th style={{ padding: "6px 8px", fontSize: 12 }}>Duration</th>
            <th style={{ padding: "6px 8px", fontSize: 12 }}>Error</th>
          </tr>
        </thead>
        <tbody>
          {run.results.map((r) => (
            <Fragment key={r.id}>
              <tr style={{ borderBottom: r.status === "FAIL" && r.testCaseId ? "none" : "1px solid var(--line)" }}>
                <td style={{ padding: "6px 8px", fontSize: 12, color: RESULT_COLORS[r.status] ?? "inherit", fontWeight: 600 }}>
                  {r.status}
                </td>
                <td style={{ padding: "6px 8px", fontSize: 13 }}>
                  {r.testCaseTitle ?? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <span className="text-muted">{r.externalTestId ?? "(unknown)"} — unmatched</span>
                      <LinkResultPicker testResultId={r.id} projectId={run.projectId} onLinked={load} />
                    </div>
                  )}
                </td>
                <td style={{ padding: "6px 8px", fontSize: 12 }}>{r.durationMs !== null ? `${r.durationMs}ms` : "—"}</td>
                <td style={{ padding: "6px 8px", fontSize: 12, color: "var(--ember)" }}>{r.errorMessage ?? ""}</td>
              </tr>
              {r.status === "FAIL" && r.testCaseId && (
                <tr style={{ borderBottom: "1px solid var(--line)" }}>
                  <td colSpan={4} style={{ padding: "0 8px 8px" }}>
                    <HealingSuggestionPanel testResultId={r.id} />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function coveragePct(covered: number, total: number): string {
  if (total === 0) return "—";
  return `${Math.round((covered / total) * 100)}%`;
}

// P5-06: a compact list of ingested coverage reports -- the deeper
// coverage-gap dashboard (which files are under-covered against defined
// thresholds) is Phase 7's job; this just makes the ingested data visible.
function CoverageSection({ projectId }: { projectId: string }) {
  const [reports, setReports] = useState<RouterOutputs["coverage"]["list"]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    trpc.coverage.list
      .query({ projectId })
      .then(setReports)
      .finally(() => setLoading(false));
  }, [projectId]);

  if (loading || reports.length === 0) return null;

  return (
    <div style={{ marginTop: 32 }}>
      <h2 style={{ marginBottom: 4 }}>Coverage</h2>
      <p className="text-muted" style={{ fontSize: 13, marginBottom: 12 }}>
        Ingested coverage reports (Istanbul/nyc, Cobertura, JaCoCo). Most recent first.
      </p>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid var(--line)" }}>
            <th style={{ padding: "6px 8px", fontSize: 12 }}>Tool</th>
            <th style={{ padding: "6px 8px", fontSize: 12 }}>Branch</th>
            <th style={{ padding: "6px 8px", fontSize: 12 }}>Commit</th>
            <th style={{ padding: "6px 8px", fontSize: 12 }}>Line coverage</th>
            <th style={{ padding: "6px 8px", fontSize: 12 }}>When</th>
          </tr>
        </thead>
        <tbody>
          {reports.map((r) => (
            <tr key={r.id} style={{ borderBottom: "1px solid var(--line)" }}>
              <td style={{ padding: "6px 8px", fontSize: 13 }}>{r.tool}</td>
              <td style={{ padding: "6px 8px", fontSize: 13 }}>{r.branch}</td>
              <td style={{ padding: "6px 8px", fontSize: 12 }}>
                <code>{r.commitSha.slice(0, 10)}</code>
              </td>
              <td style={{ padding: "6px 8px", fontSize: 13 }}>
                {coveragePct(r.linesCovered, r.linesTotal)} ({r.linesCovered}/{r.linesTotal})
              </td>
              <td style={{ padding: "6px 8px", fontSize: 12, color: "var(--text-muted, #57606a)" }}>
                {new Date(r.createdAt).toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// P6.5-05: aggregate brittle-vs-real signal for the project -- if a
// specific test keeps generating brittle-failure suggestions, that's a
// signal the test itself needs attention, not the app.
function HealingSignalSection({ projectId }: { projectId: string }) {
  const [signal, setSignal] = useState<RouterOutputs["healingSuggestions"]["aggregateSignal"] | null>(null);

  useEffect(() => {
    trpc.healingSuggestions.aggregateSignal.query({ projectId }).then(setSignal).catch(() => undefined);
  }, [projectId]);

  if (!signal || signal.totalCount === 0) return null;

  return (
    <div style={{ marginTop: 32 }}>
      <h2 style={{ marginBottom: 4 }}>Failure classification signal</h2>
      <p className="text-muted" style={{ fontSize: 13, marginBottom: 12 }}>
        {signal.brittleCount} brittle · {signal.realRegressionCount} real regressions · {signal.uncertainCount} uncertain ·{" "}
        {signal.resolvedCount} resolved (of {signal.totalCount} classified)
      </p>
      {signal.repeatOffenders.length > 0 && (
        <>
          <div className="eyebrow" style={{ marginBottom: 6 }}>
            Repeat brittle offenders
          </div>
          <ul style={{ paddingLeft: 18, margin: 0 }}>
            {signal.repeatOffenders.map((o) => (
              <li key={o.testCaseId} style={{ fontSize: 13 }}>
                {o.testCaseTitle} — {o.brittleCount} brittle failures
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export default function TestRunsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [runs, setRuns] = useState<RouterOutputs["testRuns"]["list"]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openRunId, setOpenRunId] = useState<string | null>(null);

  function load() {
    setLoading(true);
    setError(null);
    trpc.testRuns.list
      .query({ projectId })
      .then(setRuns)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }

  useEffect(load, [projectId]);

  return (
    <div style={{ maxWidth: 900 }}>
      <h1 style={{ marginBottom: 4 }}>Test Runs</h1>
      <p className="text-muted" style={{ marginBottom: 20 }}>
        Results ingested from CI (JUnit XML). Most recent first.
      </p>

      {loading && <p>Loading…</p>}
      {error && <p style={{ color: "var(--ember)" }}>{error}</p>}

      {!loading && !error && runs.length === 0 && (
        <p className="text-muted">
          No test runs ingested yet - post JUnit XML to <code>testRuns.ingestJUnit</code> with a project API key to see
          results here.
        </p>
      )}

      {!loading && runs.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid var(--line)" }}>
              <th style={{ padding: "6px 8px", fontSize: 12 }}>Status</th>
              <th style={{ padding: "6px 8px", fontSize: 12 }}>Provider</th>
              <th style={{ padding: "6px 8px", fontSize: 12 }}>Branch</th>
              <th style={{ padding: "6px 8px", fontSize: 12 }}>Commit</th>
              <th style={{ padding: "6px 8px", fontSize: 12 }}>Results</th>
              <th style={{ padding: "6px 8px", fontSize: 12 }}>When</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr
                key={r.id}
                style={{ borderBottom: "1px solid var(--line)", cursor: "pointer" }}
                onClick={() => setOpenRunId(r.id)}
              >
                <td style={{ padding: "6px 8px", fontSize: 12, color: STATUS_COLORS[r.status] ?? "inherit", fontWeight: 600 }}>
                  {r.status}
                </td>
                <td style={{ padding: "6px 8px", fontSize: 13 }}>{r.ciProvider}</td>
                <td style={{ padding: "6px 8px", fontSize: 13 }}>{r.branch}</td>
                <td style={{ padding: "6px 8px", fontSize: 12 }}>
                  <code>{r.commitSha.slice(0, 10)}</code>
                </td>
                <td style={{ padding: "6px 8px", fontSize: 13 }}>{r.resultCount}</td>
                <td style={{ padding: "6px 8px", fontSize: 12, color: "var(--text-muted, #57606a)" }}>
                  {new Date(r.startedAt).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <Drawer open={openRunId !== null} onClose={() => setOpenRunId(null)}>
        {openRunId && <TestRunDetail id={openRunId} />}
      </Drawer>

      <CoverageSection projectId={projectId} />
      <HealingSignalSection projectId={projectId} />
    </div>
  );
}
