"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { useProjectPermissions } from "@/lib/use-project-permissions";

const TARGET_FIELDS = ["title", "given", "when", "then", "priority", "tags"] as const;
type TargetField = (typeof TARGET_FIELDS)[number];

const FIELD_LABELS: Record<TargetField, string> = {
  title: "Title",
  given: "Given (preconditions)",
  when: "When (steps)",
  then: "Then (expected result)",
  priority: "Priority",
  tags: "Tags",
};

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
        const result = await trpc.testRuns.ingestJUnit.mutate({
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

export default function ImportPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { canEdit, loaded } = useProjectPermissions(projectId);

  const [fileName, setFileName] = useState("");
  const [csvText, setCsvText] = useState("");
  const [preview, setPreview] = useState<RouterOutputs["importJobs"]["previewCsv"] | null>(null);
  const [mapping, setMapping] = useState<Partial<Record<TargetField, string>>>({});
  const [previewRows, setPreviewRows] = useState<RouterOutputs["importJobs"]["previewWithMapping"]["previewRows"]>([]);
  const [previewSkipped, setPreviewSkipped] = useState<RouterOutputs["importJobs"]["previewWithMapping"]["previewSkipped"]>([]);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [committed, setCommitted] = useState<RouterOutputs["importJobs"]["commitCsv"] | null>(null);

  const [jobs, setJobs] = useState<RouterOutputs["importJobs"]["list"]>([]);
  const [defaultBranch, setDefaultBranch] = useState("main");

  function loadJobs() {
    trpc.importJobs.list.query({ projectId }).then(setJobs).catch(() => undefined);
  }
  useEffect(loadJobs, [projectId]);

  useEffect(() => {
    trpc.project.byId
      .query({ id: projectId })
      .then((p) => setDefaultBranch(p.defaultBranch))
      .catch(() => undefined);
  }, [projectId]);

  async function loadFile(file: File) {
    setError(null);
    setCommitted(null);
    setFileName(file.name);
    const text = await readFileAsText(file);
    setCsvText(text);
    setLoadingPreview(true);
    try {
      const res = await trpc.importJobs.previewCsv.query({ projectId, csvText: text });
      setPreview(res);
      setMapping(res.suggestedMapping as Partial<Record<TargetField, string>>);
      setPreviewRows(res.previewRows);
      setPreviewSkipped(res.previewSkipped);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingPreview(false);
    }
  }

  async function updateMapping(field: TargetField, column: string) {
    const next = { ...mapping, [field]: column || undefined };
    setMapping(next);
    if (!next.title) {
      setPreviewRows([]);
      setPreviewSkipped([]);
      return;
    }
    setLoadingPreview(true);
    setError(null);
    try {
      const res = await trpc.importJobs.previewWithMapping.query({ projectId, csvText, mapping: next as Record<TargetField, string> });
      setPreviewRows(res.previewRows);
      setPreviewSkipped(res.previewSkipped);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingPreview(false);
    }
  }

  async function commit() {
    if (!mapping.title) return;
    setCommitting(true);
    setError(null);
    try {
      const res = await trpc.importJobs.commitCsv.mutate({
        projectId,
        csvText,
        mapping: mapping as Record<TargetField, string>,
        sourceLabel: fileName || undefined,
      });
      setCommitted(res);
      setPreview(null);
      setCsvText("");
      setFileName("");
      loadJobs();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCommitting(false);
    }
  }

  return (
    <div style={{ maxWidth: 900 }}>
      <h1>Import test cases</h1>
      <p className="text-muted">
        Upload a CSV of any shape - map its columns to Vaettir&apos;s fields below, preview exactly what will be
        created, then confirm. Nothing is written until you commit.
      </p>

      {!canEdit && <p>{loaded ? "A full-seat Owner, Admin or Editor can import cases and CI results. Ask your team owner for access." : "Checking project access…"}</p>}
      {canEdit && <BackfillSection projectId={projectId} defaultBranch={defaultBranch} />}

      {canEdit && !preview && (
        <div style={{ margin: "16px 0" }}>
          <input
            type="file"
            accept=".csv"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void loadFile(file);
              e.target.value = "";
            }}
          />
        </div>
      )}

      {loadingPreview && !preview && <p className="text-muted">Reading CSV…</p>}

      {canEdit && preview && (
        <div className="panel" style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <h2 style={{ marginTop: 0 }}>Map columns — {fileName}</h2>
            <button
              className="btn-secondary"
              style={{ fontSize: 12 }}
              onClick={() => {
                setPreview(null);
                setCsvText("");
                setFileName("");
                setPreviewRows([]);
                setPreviewSkipped([]);
              }}
            >
              Choose a different file
            </button>
          </div>
          <p className="text-muted" style={{ fontSize: 13 }}>
            {preview.rowCount} data row(s) found. &quot;Title&quot; is required; leave any other field unmapped to skip it.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, maxWidth: 500 }}>
            {TARGET_FIELDS.map((field) => (
              <label key={field} style={{ fontSize: 13 }}>
                {FIELD_LABELS[field]}
                {field === "title" && <span style={{ color: "var(--ember)" }}> *</span>}
                <select value={mapping[field] ?? ""} onChange={(e) => void updateMapping(field, e.target.value)} style={{ width: "100%" }}>
                  <option value="">— not mapped —</option>
                  {preview.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          <h3 style={{ marginTop: 20 }}>Preview (first {previewRows.length} row(s))</h3>
          {!mapping.title && <p style={{ color: "var(--ember)" }}>Map a column to Title to see a preview.</p>}
          {previewRows.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left" }}>Row</th>
                    <th style={{ textAlign: "left" }}>Title</th>
                    <th style={{ textAlign: "left" }}>Given</th>
                    <th style={{ textAlign: "left" }}>When</th>
                    <th style={{ textAlign: "left" }}>Then</th>
                    <th style={{ textAlign: "left" }}>Priority</th>
                    <th style={{ textAlign: "left" }}>Tags</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((r) => (
                    <tr key={r.rowNumber} style={{ borderTop: "1px solid var(--line)" }}>
                      <td className="text-muted">{r.rowNumber}</td>
                      <td>{r.title}</td>
                      <td>{r.given.join(" | ")}</td>
                      <td>{r.when.join(" | ")}</td>
                      <td>{r.then.join(" | ")}</td>
                      <td>{r.priority}</td>
                      <td>{r.tags.join(", ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {previewSkipped.length > 0 && (
            <p className="text-muted" style={{ fontSize: 12 }}>
              {previewSkipped.length} row(s) would be skipped (missing title), e.g. row {previewSkipped[0]!.rowNumber}.
            </p>
          )}

          <button onClick={commit} disabled={committing || !mapping.title} style={{ marginTop: 16 }}>
            {committing ? "Importing…" : `Import ${preview.rowCount} row(s)`}
          </button>
        </div>
      )}

      {committed && (
        <p style={{ color: "var(--frost)" }}>
          Imported {committed.createdCount} test case(s)
          {committed.skipped.length > 0 && `, skipped ${committed.skipped.length} row(s)`}.
        </p>
      )}

      {error && <p style={{ color: "var(--ember)" }}>{error}</p>}

      {jobs.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <h2>Import history</h2>
          <ul style={{ listStyle: "none", padding: 0 }}>
            {jobs.map((j) => (
              <li key={j.id} style={{ borderBottom: "1px solid var(--line)", padding: "6px 0", fontSize: 13 }}>
                <strong>{j.status}</strong> — {j.source} {j.sourceLabel && `(${j.sourceLabel})`} — {j.createdCount} created
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
