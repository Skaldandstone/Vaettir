"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { trpcReact, type RouterOutputs } from "@/lib/trpcReact";
import { MigrationWizard } from "@/components/MigrationWizard";

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsText(file);
  });
}

interface BackfillFile {
  fileName: string;
  junitXml: string;
  date: string; // yyyy-mm-dd, from an <input type="date">
  commitSha: string;
  status: "pending" | "importing" | "done" | "error";
  result?: RouterOutputs["testRuns"]["ingestJUnit"];
  error?: string;
}

// P11-08: the actual gap left after this session's earlier fix to
// testRuns.ingestJUnit (startedAt/finishedAt used to be hardcoded to "now",
// silently skewing every trend chart/flaky-detection window/mean-time-to-green
// calculation for backfilled history) - there was still no UI to point at a
// pile of old JUnit XML reports and give each one its real historical date.
// This is that UI: one shared ciProvider/branch, one real date per file (CI
// history rarely comes pre-labeled with a commit sha, so that's optional and
// defaults to a clearly-synthetic placeholder rather than a fabricated hash).
function BackfillSection({ projectId, defaultBranch }: { projectId: string; defaultBranch: string }) {
  const [ciProvider, setCiProvider] = useState("backfill");
  const [branch, setBranch] = useState(defaultBranch);
  const [files, setFiles] = useState<BackfillFile[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ingestMutation = trpcReact.testRuns.ingestJUnit.useMutation();

  useEffect(() => setBranch(defaultBranch), [defaultBranch]);

  async function addFiles(fileList: FileList) {
    setError(null);
    const added = await Promise.all(
      Array.from(fileList).map(async (file, i) => ({
        fileName: file.name,
        junitXml: await readFileAsText(file),
        date: new Date().toISOString().slice(0, 10),
        commitSha: `backfill-${Date.now()}-${i}`,
        status: "pending" as const,
      })),
    );
    setFiles((prev) => [...prev, ...added]);
  }

  function updateFile(index: number, patch: Partial<BackfillFile>) {
    setFiles((prev) => prev.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function runBackfill() {
    setRunning(true);
    setError(null);
    for (let i = 0; i < files.length; i++) {
      const f = files[i]!;
      if (f.status === "done") continue;
      updateFile(i, { status: "importing" });
      try {
        const startedAt = new Date(`${f.date}T12:00:00Z`);
        const result = await ingestMutation.mutateAsync({
          projectId,
          ciProvider: ciProvider.trim() || "backfill",
          commitSha: f.commitSha.trim() || `backfill-${i}`,
          branch: branch.trim() || "main",
          junitXml: f.junitXml,
          startedAt,
          finishedAt: startedAt,
        });
        updateFile(i, { status: "done", result });
      } catch (e) {
        updateFile(i, { status: "error", error: e instanceof Error ? e.message : String(e) });
      }
    }
    setRunning(false);
  }

  const doneCount = files.filter((f) => f.status === "done").length;

  return (
    <div className="panel" style={{ marginBottom: 20 }}>
      <h2 style={{ marginTop: 0 }}>Backfill historical test run results</h2>
      <p className="text-muted" style={{ fontSize: 13 }}>
        Import past JUnit XML reports with their real original dates - not the date you import them - so pass-rate
        trends, flaky-test detection, and release-to-release charts have real history instead of starting empty.
      </p>

      <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
        <label style={{ fontSize: 13 }}>
          CI provider
          <input value={ciProvider} onChange={(e) => setCiProvider(e.target.value)} style={{ display: "block" }} />
        </label>
        <label style={{ fontSize: 13 }}>
          Branch
          <input value={branch} onChange={(e) => setBranch(e.target.value)} style={{ display: "block" }} />
        </label>
      </div>

      <input
        type="file"
        accept=".xml"
        multiple
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) void addFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {files.length > 0 && (
        <div style={{ overflowX: "auto", marginTop: 12 }}>
          <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>File</th>
                <th style={{ textAlign: "left" }}>Real run date</th>
                <th style={{ textAlign: "left" }}>Commit SHA (optional)</th>
                <th style={{ textAlign: "left" }}>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {files.map((f, i) => (
                <tr key={i} style={{ borderTop: "1px solid var(--line)" }}>
                  <td>{f.fileName}</td>
                  <td>
                    <input
                      type="date"
                      value={f.date}
                      onChange={(e) => updateFile(i, { date: e.target.value })}
                      disabled={f.status !== "pending"}
                    />
                  </td>
                  <td>
                    <input
                      value={f.commitSha}
                      onChange={(e) => updateFile(i, { commitSha: e.target.value })}
                      disabled={f.status !== "pending"}
                      style={{ fontSize: 12, width: 160 }}
                    />
                  </td>
                  <td>
                    {f.status === "pending" && <span className="text-muted">Pending</span>}
                    {f.status === "importing" && "Importing…"}
                    {f.status === "done" && f.result && (
                      <span style={{ color: "var(--frost)" }}>
                        {f.result.passCount} pass, {f.result.failCount} fail, {f.result.skipCount} skip
                      </span>
                    )}
                    {f.status === "error" && <span style={{ color: "var(--ember)" }}>{f.error}</span>}
                  </td>
                  <td>
                    {f.status === "pending" && (
                      <button className="btn-secondary" style={{ fontSize: 11 }} onClick={() => removeFile(i)}>
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {error && <p style={{ color: "var(--ember)" }}>{error}</p>}

      {files.length > 0 && (
        <button onClick={runBackfill} disabled={running || files.every((f) => f.status === "done")} style={{ marginTop: 16 }}>
          {running ? "Importing…" : `Backfill ${files.length - doneCount} run(s)`}
        </button>
      )}
      {doneCount > 0 && doneCount === files.length && (
        <p style={{ color: "var(--frost)", marginTop: 8 }}>All {doneCount} run(s) imported with their real historical dates.</p>
      )}
    </div>
  );
}

// P11-10: the three previously-disconnected import panels (Xray, TestRail,
// CSV-with-mapping) are now one guided flow in <MigrationWizard> - see that
// component for why. Backfill (run *history*, not test cases) and the
// Import history list stay their own concerns here.
export default function ImportPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const utils = trpcReact.useUtils();

  const jobsQuery = trpcReact.importJobs.list.useQuery({ projectId });
  const jobs = jobsQuery.data ?? [];
  const projectQuery = trpcReact.project.byId.useQuery({ id: projectId });
  const defaultBranch = projectQuery.data?.defaultBranch ?? "main";

  return (
    <div style={{ maxWidth: 900 }}>
      <h1>Import test cases</h1>
      <p className="text-muted">
        Pick where your data is coming from, preview exactly what will be created, then confirm. Nothing is written
        until you commit.
      </p>

      <MigrationWizard projectId={projectId} onCommitted={() => void utils.importJobs.list.invalidate({ projectId })} />

      <BackfillSection projectId={projectId} defaultBranch={defaultBranch} />

      {jobs.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <h2>Import history</h2>
          <ul style={{ listStyle: "none", padding: 0 }}>
            {jobs.map((j) => (
              <li key={j.id} style={{ borderBottom: "1px solid var(--line)", padding: "6px 0", fontSize: 13 }}>
                <strong>{j.status}</strong> — {j.source} {j.sourceLabel && `(${j.sourceLabel})`} — {j.createdCount} created
                {j.updatedCount > 0 && `, ${j.updatedCount} updated`}
                {j.skippedCount > 0 && `, ${j.skippedCount} skipped`}
                <span className="text-muted"> · {j.createdByName ?? "unknown"} · {new Date(j.createdAt).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
