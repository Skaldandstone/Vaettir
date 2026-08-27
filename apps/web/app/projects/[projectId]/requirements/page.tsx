"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { Modal } from "@/components/Modal";

// 2026-08-27 competitor parity audit: draft-and-review, same shape as
// P4-02's strategy generation - nothing here creates a real TestCase
// until the user explicitly picks which drafts to keep.
function GenerateTestCasesModal({
  requirementId,
  projectId,
  onClose,
  onCreated,
}: {
  requirementId: string;
  projectId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [drafts, setDrafts] = useState<RouterOutputs["requirements"]["generateTestCases"] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [generating, setGenerating] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    trpc.requirements.generateTestCases
      .mutate({ requirementId })
      .then((result) => {
        setDrafts(result);
        setSelected(new Set(result.map((_, i) => i)));
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setGenerating(false));
  }, [requirementId]);

  function toggle(i: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  async function createSelected() {
    if (!drafts) return;
    setCreating(true);
    setError(null);
    try {
      for (const i of selected) {
        const d = drafts[i]!;
        await trpc.testCases.create.mutate({
          projectId,
          title: d.title,
          given: d.given,
          when: d.when,
          then: d.then,
          testType: "FUNCTIONAL",
          priority: d.priority as "CRITICAL" | "HIGH" | "MEDIUM" | "LOW",
        });
      }
      onCreated();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Generate test cases with AI">
      {generating && <p>Drafting…</p>}
      {error && <p style={{ color: "var(--ember)" }}>{error}</p>}
      {drafts && (
        <div style={{ maxHeight: 500, overflowY: "auto" }}>
          {drafts.map((d, i) => (
            <div key={i} className="panel" style={{ marginBottom: 10, padding: 10 }}>
              <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <input type="checkbox" checked={selected.has(i)} onChange={() => toggle(i)} style={{ marginTop: 4 }} />
                <div style={{ flex: 1 }}>
                  <strong>{d.title}</strong>{" "}
                  <span className="text-muted" style={{ fontSize: 12 }}>
                    ({d.priority})
                  </span>
                  <div style={{ fontSize: 13, marginTop: 4 }}>
                    <div>
                      <em>Given</em> {d.given.join("; ")}
                    </div>
                    <div>
                      <em>When</em> {d.when.join("; ")}
                    </div>
                    <div>
                      <em>Then</em> {d.then.join("; ")}
                    </div>
                  </div>
                </div>
              </label>
            </div>
          ))}
          {drafts.length === 0 && <p className="text-muted">No draft cases produced.</p>}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 10 }}>
            <button className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button className="btn-primary" onClick={createSelected} disabled={creating || selected.size === 0}>
              {creating ? "Creating…" : `Create ${selected.size} selected`}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

export default function RequirementsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [requirements, setRequirements] = useState<RouterOutputs["requirements"]["list"]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [externalRef, setExternalRef] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [generatingForId, setGeneratingForId] = useState<string | null>(null);

  function load() {
    setLoading(true);
    setError(null);
    trpc.requirements.list
      .query({ projectId })
      .then(setRequirements)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }

  useEffect(load, [projectId]);

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
    if (!title) return;
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
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    await trpc.requirements.delete.mutate({ id });
    if (editingId === id) resetForm();
    load();
  }

  const visibleRequirements = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return requirements;
    return requirements.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        r.description?.toLowerCase().includes(q) ||
        r.externalRef?.toLowerCase().includes(q),
    );
  }, [requirements, search]);

  return (
    <div style={{ maxWidth: 640 }}>
      <h1>Requirements</h1>

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

      {loading && <p>Loading…</p>}
      {error && <p style={{ color: "var(--ember)" }}>{error}</p>}

      {requirements.length > 0 && (
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search requirements…"
          style={{ maxWidth: 300, marginBottom: 10 }}
        />
      )}

      <ul style={{ listStyle: "none", padding: 0 }}>
        {visibleRequirements.map((r) => (
          <li key={r.id} style={{ marginBottom: 10, borderBottom: "1px solid var(--line)", paddingBottom: 8 }}>
            <strong>{r.title}</strong> {r.externalRef && <span style={{ color: "var(--muted-dim)" }}>[{r.externalRef}]</span>}
            <div style={{ color: "var(--muted)", fontSize: 13 }}>{r.description}</div>
            <div style={{ fontSize: 12, color: "var(--muted-dim)" }}>{r.acceptanceCriteriaCount} linked acceptance criteria</div>
            <button onClick={() => startEdit(r)} style={{ marginRight: 8 }}>
              Edit
            </button>
            <button onClick={() => remove(r.id)} style={{ marginRight: 8 }}>
              Delete
            </button>
            <button onClick={() => setGeneratingForId(r.id)}>Generate test cases with AI</button>
          </li>
        ))}
        {!loading && requirements.length === 0 && <p style={{ color: "var(--muted)" }}>No requirements yet.</p>}
        {!loading && requirements.length > 0 && visibleRequirements.length === 0 && (
          <p style={{ color: "var(--muted)" }}>No requirements match.</p>
        )}
      </ul>

      {generatingForId && (
        <GenerateTestCasesModal
          requirementId={generatingForId}
          projectId={projectId}
          onClose={() => setGeneratingForId(null)}
          onCreated={load}
        />
      )}
    </div>
  );
}
