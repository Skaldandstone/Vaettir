"use client";

import { Fragment, useState } from "react";
import { useParams } from "next/navigation";
import { trpcReact } from "@/lib/trpcReact";
import { Drawer } from "@/components/Drawer";
import { useProjectPermissions } from "@/lib/use-project-permissions";

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
  const candidatesQuery = trpcReact.testCases.list.useQuery({ projectId }, { enabled: picking });
  const candidates = candidatesQuery.data ?? [];
  const [selected, setSelected] = useState("");
  const [error, setError] = useState<string | null>(null);

  const linkMutation = trpcReact.testRuns.linkResultToTestCase.useMutation({
    onSuccess: () => {
      setPicking(false);
      setSelected("");
      onLinked();
    },
    onError: (e) => setError(e.message),
  });

  function link() {
    if (!selected) return;
    setError(null);
    linkMutation.mutate({ testResultId, testCaseId: selected });
  }

  if (!picking) {
    return (
      <button className="btn-secondary" style={{ fontSize: 11 }} onClick={() => setPicking(true)}>
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
      <button className="btn-secondary" style={{ fontSize: 11 }} onClick={link} disabled={linkMutation.isPending || !selected}>
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
function HealingSuggestionPanel({ testResultId, canEdit }: { testResultId: string; canEdit: boolean }) {
  const utils = trpcReact.useUtils();
  const suggestionQuery = trpcReact.healingSuggestions.byTestResult.useQuery({ testResultId });
  const suggestion = suggestionQuery.data ?? null;
  const [error, setError] = useState<string | null>(null);

  // Both mutations return the fresh suggestion row, so write it straight into
  // the query cache (what the original page did with setSuggestion) rather
  // than refetching.
  const classifyMutation = trpcReact.healingSuggestions.classify.useMutation({
    onSuccess: (result) => {
      if (result.ok) utils.healingSuggestions.byTestResult.setData({ testResultId }, result.suggestion);
      else setError(result.reason);
    },
    onError: (e) => setError(e.message),
  });
  const reviewMutation = trpcReact.healingSuggestions.review.useMutation({
    onSuccess: (updated) => utils.healingSuggestions.byTestResult.setData({ testResultId }, updated),
    onError: (e) => setError(e.message),
  });

  function classify() {
    setError(null);
    classifyMutation.mutate({ testResultId });
  }

  function review(status: "APPROVED" | "REJECTED") {
    if (!suggestion) return;
    reviewMutation.mutate({ id: suggestion.id, status });
  }

  if (suggestionQuery.isLoading) return null;

  if (!suggestion) {
    return (
      <div style={{ marginTop: 4 }}>
        {canEdit && <button className="btn-secondary" style={{ fontSize: 11 }} onClick={classify} disabled={classifyMutation.isPending}>
          {classifyMutation.isPending ? "Classifying…" : "Classify failure"}
        </button>}
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
      {canEdit && suggestion.status === "PENDING" && (
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

function TestRunDetail({ id, canEdit }: { id: string; canEdit: boolean }) {
  const utils = trpcReact.useUtils();
  const runQuery = trpcReact.testRuns.byId.useQuery({ id });
  const run = runQuery.data;

  if (runQuery.error) return <p style={{ color: "var(--ember)" }}>{runQuery.error.message}</p>;
  if (!run) return <p>Loading…</p>;

  const reload = () => void utils.testRuns.byId.invalidate({ id });

  return (
    <div>
      <h1 style={{ marginBottom: 2 }}>{run.ciProvider === "manual" ? "Manual test run" : `${run.ciProvider} run`}</h1>
      <p className="text-muted" style={{ fontSize: 13 }}>
        {run.ciProvider === "manual" ? (
          <>{run.startedByEmail ?? "Unknown tester"}</>
        ) : (
          <>
            {run.branch} @ <code>{run.commitSha.slice(0, 12)}</code>
          </>
        )}
        {" — "}
        {new Date(run.startedAt).toLocaleString()}
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
                      {canEdit && <LinkResultPicker testResultId={r.id} projectId={run.projectId} onLinked={reload} />}
                    </div>
                  )}
                </td>
                <td style={{ padding: "6px 8px", fontSize: 12 }}>{r.durationMs !== null ? `${r.durationMs}ms` : "—"}</td>
                <td style={{ padding: "6px 8px", fontSize: 12, color: r.errorMessage ? "var(--ember)" : "inherit" }}>
                  {r.errorMessage ?? r.note ?? ""}
                </td>
              </tr>
              {r.status === "FAIL" && r.testCaseId && (
                <tr style={{ borderBottom: "1px solid var(--line)" }}>
                  <td colSpan={4} style={{ padding: "0 8px 8px" }}>
                    <HealingSuggestionPanel testResultId={r.id} canEdit={canEdit} />
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
  const reportsQuery = trpcReact.coverage.list.useQuery({ projectId });
  const reports = reportsQuery.data ?? [];

  if (reportsQuery.isLoading || reports.length === 0) return null;

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
  const signalQuery = trpcReact.healingSuggestions.aggregateSignal.useQuery({ projectId });
  const signal = signalQuery.data;

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

// P1-15
export default function TestRunsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { canEdit } = useProjectPermissions(projectId);
  const runsQuery = trpcReact.testRuns.list.useQuery({ projectId });
  const runs = runsQuery.data ?? [];
  const loading = runsQuery.isLoading;
  const error = runsQuery.error?.message ?? null;
  const [openRunId, setOpenRunId] = useState<string | null>(null);

  return (
    <div style={{ maxWidth: 900 }}>
      <h1 style={{ marginBottom: 4 }}>Test Runs</h1>
      <p className="text-muted" style={{ marginBottom: 20 }}>
        Results ingested from CI (JUnit XML) or recorded through manual execution. Most recent first.
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
              <th style={{ padding: "6px 8px", fontSize: 12 }}></th>
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
                {r.ciProvider === "manual" ? (
                  <td colSpan={2} style={{ padding: "6px 8px", fontSize: 13 }}>
                    {r.startedByEmail ?? "Unknown tester"}
                  </td>
                ) : (
                  <>
                    <td style={{ padding: "6px 8px", fontSize: 13 }}>{r.branch}</td>
                    <td style={{ padding: "6px 8px", fontSize: 12 }}>
                      <code>{r.commitSha.slice(0, 10)}</code>
                    </td>
                  </>
                )}
                <td style={{ padding: "6px 8px", fontSize: 13 }}>{r.resultCount}</td>
                <td style={{ padding: "6px 8px", fontSize: 12, color: "var(--text-muted, #57606a)" }}>
                  {new Date(r.startedAt).toLocaleString()}
                </td>
                <td style={{ padding: "6px 8px", fontSize: 12 }}>
                  {canEdit && r.ciProvider === "manual" && r.status === "RUNNING" && (
                    <a href={`/projects/${projectId}/test-runs/manual/${r.id}`} onClick={(e) => e.stopPropagation()}>
                      Resume
                    </a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <Drawer open={openRunId !== null} onClose={() => setOpenRunId(null)}>
        {openRunId && <TestRunDetail id={openRunId} canEdit={canEdit} />}
      </Drawer>

      <CoverageSection projectId={projectId} />
      <HealingSignalSection projectId={projectId} />
    </div>
  );
}
