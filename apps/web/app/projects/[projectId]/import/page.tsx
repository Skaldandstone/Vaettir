"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { trpc, type RouterOutputs } from "@/lib/trpc";

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

export default function ImportPage() {
  const { projectId } = useParams<{ projectId: string }>();

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

  function loadJobs() {
    trpc.importJobs.list.query({ projectId }).then(setJobs).catch(() => undefined);
  }
  useEffect(loadJobs, [projectId]);

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

      {!preview && (
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

      {preview && (
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
