"use client";

import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent } from "react";
import { useParams } from "next/navigation";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { Modal } from "@/components/Modal";
import { useProjectPermissions } from "@/lib/use-project-permissions";

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

type DraftRequirement = { title: string; description: string; sourceFile: string | null };

// Shared review list: both the markdown-paste and repo-scan extraction
// paths land drafts here for the same checkbox-and-create review flow
// GenerateTestCasesModal above already established.
function DraftRequirementReview({
  drafts,
  projectId,
  onClose,
  onCreated,
}: {
  drafts: DraftRequirement[];
  projectId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set(drafts.map((_, i) => i)));
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(i: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  async function createSelected() {
    setCreating(true);
    setError(null);
    try {
      for (const i of selected) {
        const d = drafts[i]!;
        await trpc.requirements.create.mutate({
          projectId,
          title: d.title,
          description: d.sourceFile ? `${d.description}\n\n(extracted from ${d.sourceFile})` : d.description,
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
    <div style={{ maxHeight: 500, overflowY: "auto" }}>
      {error && <p style={{ color: "var(--ember)" }}>{error}</p>}
      {drafts.map((d, i) => (
        <div key={i} className="panel" style={{ marginBottom: 10, padding: 10 }}>
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <input type="checkbox" checked={selected.has(i)} onChange={() => toggle(i)} style={{ marginTop: 4 }} />
            <div style={{ flex: 1 }}>
              <strong>{d.title}</strong>{" "}
              {d.sourceFile && (
                <span className="text-muted" style={{ fontSize: 12 }}>
                  ({d.sourceFile})
                </span>
              )}
              <p style={{ fontSize: 13, margin: "4px 0 0" }}>{d.description}</p>
            </div>
          </label>
        </div>
      ))}
      {drafts.length === 0 && <p className="text-muted">No requirements found in the source.</p>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 10 }}>
        <button className="btn-secondary" onClick={onClose}>
          Cancel
        </button>
        <button className="btn-primary" onClick={createSelected} disabled={creating || selected.size === 0}>
          {creating ? "Creating…" : `Create ${selected.size} selected`}
        </button>
      </div>
    </div>
  );
}

// 2026-08-28: paste/upload a markdown spec doc, extract candidate
// requirements from it. Two-step: paste content, then Extract fires the
// real AI call and swaps into the same review list every extraction path
// uses.
function ExtractFromMarkdownModal({ projectId, onClose, onCreated }: { projectId: string; onClose: () => void; onCreated: () => void }) {
  const [fileName, setFileName] = useState("requirements.md");
  const [content, setContent] = useState("");
  const [drafts, setDrafts] = useState<DraftRequirement[] | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setContent(await file.text());
  }

  async function extract() {
    if (!content.trim()) return;
    setExtracting(true);
    setError(null);
    try {
      const result = await trpc.requirements.extractFromMarkdown.mutate({ projectId, fileName, markdownContent: content });
      setDrafts(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExtracting(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Extract requirements from a markdown file">
      {!drafts && (
        <div style={{ display: "grid", gap: 10 }}>
          <input type="file" accept=".md,.mdx,text/markdown" onChange={handleFile} />
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Paste markdown content here, or choose a file above…"
            rows={10}
            style={{ width: "100%", fontFamily: "monospace", fontSize: 12 }}
          />
          {error && <p style={{ color: "var(--ember)" }}>{error}</p>}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button className="btn-primary" onClick={extract} disabled={extracting || !content.trim()}>
              {extracting ? "Extracting…" : "Extract"}
            </button>
          </div>
        </div>
      )}
      {drafts && <DraftRequirementReview drafts={drafts} projectId={projectId} onClose={onClose} onCreated={onCreated} />}
    </Modal>
  );
}

// 2026-08-28: scans the project's connected repo for likely requirements/
// spec docs (README + docs/spec/requirements-hinted paths) and extracts
// from each - fires immediately on open since the repo URL is already
// known from the project.
function ExtractFromRepoModal({
  projectId,
  repoUrl,
  onClose,
  onCreated,
}: {
  projectId: string;
  repoUrl: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [drafts, setDrafts] = useState<DraftRequirement[] | null>(null);
  const [scanning, setScanning] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    trpc.requirements.extractFromRepo
      .mutate({ projectId, repoUrl })
      .then(setDrafts)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setScanning(false));
  }, [projectId, repoUrl]);

  return (
    <Modal open onClose={onClose} title={`Extract requirements from ${repoUrl}`}>
      {scanning && <p>Scanning repo for requirements/spec docs…</p>}
      {error && <p style={{ color: "var(--ember)" }}>{error}</p>}
      {drafts && <DraftRequirementReview drafts={drafts} projectId={projectId} onClose={onClose} onCreated={onCreated} />}
    </Modal>
  );
}

export default function RequirementsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { canEdit } = useProjectPermissions(projectId);
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
  const [repoUrl, setRepoUrl] = useState<string | null>(null);
  const [markdownModalOpen, setMarkdownModalOpen] = useState(false);
  const [repoModalOpen, setRepoModalOpen] = useState(false);

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
  useEffect(() => {
    trpc.project.byId.query({ id: projectId }).then((p) => setRepoUrl(p.repoUrl));
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

      {canEdit && <div style={{ display: "flex", gap: 8, margin: "8px 0 16px" }}>
        <button className="btn-secondary" onClick={() => setMarkdownModalOpen(true)}>
          Extract from markdown file
        </button>
        <button className="btn-secondary" onClick={() => setRepoModalOpen(true)} disabled={!repoUrl} title={repoUrl ?? "Connect a repo first"}>
          Extract from repo {repoUrl ? "" : "(no repo connected)"}
        </button>
      </div>}

      {canEdit && <div style={{ display: "grid", gap: 8, margin: "16px 0", maxWidth: 420 }}>
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
      </div>}

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
            {canEdit && <><button onClick={() => startEdit(r)} style={{ marginRight: 8 }}>
              Edit
            </button>
            <button onClick={() => remove(r.id)} style={{ marginRight: 8 }}>
              Delete
            </button>
            <button onClick={() => setGeneratingForId(r.id)}>Generate test cases with AI</button></>}
          </li>
        ))}
        {!loading && requirements.length === 0 && <p style={{ color: "var(--muted)" }}>No requirements yet.</p>}
        {!loading && requirements.length > 0 && visibleRequirements.length === 0 && (
          <p style={{ color: "var(--muted)" }}>No requirements match.</p>
        )}
      </ul>

      {canEdit && generatingForId && (
        <GenerateTestCasesModal
          requirementId={generatingForId}
          projectId={projectId}
          onClose={() => setGeneratingForId(null)}
          onCreated={load}
        />
      )}
      {canEdit && markdownModalOpen && (
        <ExtractFromMarkdownModal projectId={projectId} onClose={() => setMarkdownModalOpen(false)} onCreated={load} />
      )}
      {canEdit && repoModalOpen && repoUrl && (
        <ExtractFromRepoModal projectId={projectId} repoUrl={repoUrl} onClose={() => setRepoModalOpen(false)} onCreated={load} />
      )}
    </div>
  );
}
