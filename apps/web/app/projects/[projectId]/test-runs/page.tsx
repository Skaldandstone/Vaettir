"use client";

import { useEffect, useState } from "react";
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

function TestRunDetail({ id }: { id: string }) {
  const [run, setRun] = useState<RouterOutputs["testRuns"]["byId"] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    trpc.testRuns.byId
      .query({ id })
      .then(setRun)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [id]);

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
            <tr key={r.id} style={{ borderBottom: "1px solid var(--line)" }}>
              <td style={{ padding: "6px 8px", fontSize: 12, color: RESULT_COLORS[r.status] ?? "inherit", fontWeight: 600 }}>
                {r.status}
              </td>
              <td style={{ padding: "6px 8px", fontSize: 13 }}>
                {r.testCaseTitle ?? <span className="text-muted">{r.externalTestId ?? "(unknown)"} — unmatched</span>}
              </td>
              <td style={{ padding: "6px 8px", fontSize: 12 }}>{r.durationMs !== null ? `${r.durationMs}ms` : "—"}</td>
              <td style={{ padding: "6px 8px", fontSize: 12, color: "var(--ember)" }}>{r.errorMessage ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
    </div>
  );
}
