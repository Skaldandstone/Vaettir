"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { trpc, type RouterOutputs } from "../../lib/trpc";

function RequirementsPageInner() {
  const searchParams = useSearchParams();
  const [projectId, setProjectId] = useState(searchParams.get("projectId") ?? "");
  const [requirements, setRequirements] = useState<RouterOutputs["requirements"]["list"]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [externalRef, setExternalRef] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load(id: string) {
    setLoading(true);
    setError(null);
    trpc.requirements.list
      .query({ projectId: id })
      .then(setRequirements)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (!projectId) return;
    load(projectId);
  }, [projectId]);

  function resetForm() {
    setTitle("");
    setDescription("");
    setExternalRef("");
    setEditingId(null);
  }

  function startEdit(r: { id: string; title: string; description: string | null; externalRef: string | null }) {
    setEditingId(r.id);
    setTitle(r.title);
    setDescription(r.description ?? "");
    setExternalRef(r.externalRef ?? "");
  }

  async function submit() {
    if (!projectId || !title) return;
    setSaving(true);
    setError(null);
    try {
      if (editingId) {
        await trpc.requirements.update.mutate({
          id: editingId,
          title,
          description: description || undefined,
          externalRef: externalRef || undefined,
        });
      } else {
        await trpc.requirements.create.mutate({
          projectId,
          title,
          description: description || undefined,
          externalRef: externalRef || undefined,
        });
      }
      resetForm();
      load(projectId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    await trpc.requirements.delete.mutate({ id });
    if (editingId === id) resetForm();
    load(projectId);
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <h1>Requirements</h1>
      <label>
        Project ID:{" "}
        <input value={projectId} onChange={(e) => setProjectId(e.target.value)} placeholder="paste a project id" />
      </label>

      {projectId && (
        <div style={{ display: "grid", gap: 8, margin: "16px 0", maxWidth: 420 }}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)"
            rows={2}
          />
          <input
            value={externalRef}
            onChange={(e) => setExternalRef(e.target.value)}
            placeholder="External ref, e.g. JIRA-123 (optional)"
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={submit} disabled={saving || !title}>
              {saving ? "Saving…" : editingId ? "Save changes" : "+ New requirement"}
            </button>
            {editingId && <button onClick={resetForm}>Cancel</button>}
          </div>
        </div>
      )}

      {loading && <p>Loading…</p>}
      {error && <p style={{ color: "var(--ember)" }}>{error}</p>}
      <ul style={{ listStyle: "none", padding: 0 }}>
        {requirements.map((r) => (
          <li key={r.id} style={{ marginBottom: 10, borderBottom: "1px solid var(--line)", paddingBottom: 8 }}>
            <strong>{r.title}</strong> {r.externalRef && <span style={{ color: "var(--muted-dim)" }}>[{r.externalRef}]</span>}
            <div style={{ color: "var(--muted)", fontSize: 13 }}>{r.description}</div>
            <div style={{ fontSize: 12, color: "var(--muted-dim)" }}>{r.acceptanceCriteriaCount} linked acceptance criteria</div>
            <button onClick={() => startEdit(r)} style={{ marginRight: 8 }}>
              Edit
            </button>
            <button onClick={() => remove(r.id)}>Delete</button>
          </li>
        ))}
        {projectId && !loading && requirements.length === 0 && <p style={{ color: "var(--muted)" }}>No requirements yet.</p>}
      </ul>
    </div>
  );
}

export default function RequirementsPage() {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <RequirementsPageInner />
    </Suspense>
  );
}
