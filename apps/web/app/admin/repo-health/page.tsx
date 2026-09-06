"use client";

import { useState } from "react";
import Link from "next/link";
import { trpcReact, type RouterOutputs } from "../../../lib/trpcReact";

type Snapshot = RouterOutputs["admin"]["repoHealthSnapshot"];

// Staff-only, on-demand port of the old quality_dashboard CLI: GitHub
// Actions pass-rate/flakiness plus a git-churn risk footprint for ANY
// repo, not just a Vaettir customer with onboarded test-case data. No
// persistence here by design (see admin.ts's repoHealthSnapshot comment) -
// this page just runs the query and shows what came back.
// P1-15: "Run" stays an imperative one-shot fetch (utils.<>.fetch()) rather
// than a rendered useQuery - this is a manually-triggered action, not data
// the page should keep live/cached across renders.
export default function RepoHealthSnapshotPage() {
  const utils = trpcReact.useUtils();
  const [repo, setRepo] = useState("");
  const [workflowFile, setWorkflowFile] = useState("ci.yml");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (!repo.trim()) return;
    setLoading(true);
    setError(null);
    setSnapshot(null);
    try {
      const result = await utils.admin.repoHealthSnapshot.fetch({ repo: repo.trim(), workflowFile: workflowFile.trim() || "ci.yml" });
      setSnapshot(result);
    } catch (e) {
      if (e instanceof Error && e.message.includes("Staff access required")) {
        setForbidden(true);
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setLoading(false);
    }
  }

  if (forbidden) return <p>Staff access required. This account isn&apos;t recognized as Skald &amp; Stone staff.</p>;

  return (
    <div style={{ maxWidth: 900 }}>
      <p>
        <Link href="/admin">← Admin</Link>
      </p>
      <h1>Repo Health Snapshot</h1>
      <p style={{ color: "var(--muted, #999)" }}>
        CI pass rate, flakiness, and git-churn risk footprint for any repo, computed on demand - not persisted anywhere.
        Requires <code>STAFF_GITHUB_TOKEN</code> to be configured on the API.
      </p>
      <div style={{ display: "flex", gap: 8, margin: "12px 0" }}>
        <input
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && run()}
          placeholder="owner/name (e.g. skaldandstone/Kall)"
          style={{ flex: 2 }}
        />
        <input
          value={workflowFile}
          onChange={(e) => setWorkflowFile(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && run()}
          placeholder="workflow file (default ci.yml)"
          style={{ flex: 1 }}
        />
        <button onClick={run} disabled={loading || !repo.trim()}>
          {loading ? "Running…" : "Run"}
        </button>
      </div>
      {error && <p style={{ color: "var(--ember)" }}>{error}</p>}

      {snapshot && (
        <>
          <h2>Jobs</h2>
          <p>
            Days since every job was last green:{" "}
            {snapshot.daysSinceLastGreen === null ? "unknown" : snapshot.daysSinceLastGreen.toFixed(1)}
          </p>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left" }}>
                <th>Job</th>
                <th>Pass rate</th>
                <th>Δ vs prior window</th>
                <th>Flakiness</th>
                <th>Last run</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.jobs.map((job) => (
                <tr key={job.jobName} style={{ borderTop: "1px solid var(--border, #333)" }}>
                  <td>{job.jobName}</td>
                  <td>
                    {(job.passRate * 100).toFixed(0)}% ({job.totalRuns} runs)
                  </td>
                  <td>{job.passRateDelta === null ? "—" : `${job.passRateDelta >= 0 ? "+" : ""}${(job.passRateDelta * 100).toFixed(0)}pp`}</td>
                  <td>{(job.flakinessScore * 100).toFixed(0)}%</td>
                  <td>{job.lastRunAt ? new Date(job.lastRunAt).toLocaleString() : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {snapshot.jobs.length === 0 && <p>No completed runs found for that workflow file.</p>}

          <h2>Risk footprint (git churn, {snapshot.riskFootprint.length} files)</h2>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left" }}>
                <th>File</th>
                <th>Changes</th>
                <th>Test confidence</th>
                <th>Risk score</th>
                <th>Matched test</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.riskFootprint.map((entry) => (
                <tr key={entry.path} style={{ borderTop: "1px solid var(--border, #333)" }}>
                  <td>{entry.path}</td>
                  <td>{entry.changeCount}</td>
                  <td>{(entry.testConfidence * 100).toFixed(0)}%</td>
                  <td>{entry.riskScore.toFixed(2)}</td>
                  <td>{entry.matchedTest ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {snapshot.riskFootprint.length === 0 && <p>No source-file churn found in the lookback window.</p>}
        </>
      )}
    </div>
  );
}
