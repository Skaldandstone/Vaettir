"use client";

import { useEffect, useState } from "react";
import { trpc, type RouterOutputs } from "../../lib/trpc";

export default function ProjectsPage() {
  const [orgId, setOrgId] = useState<string | null>(null);
  const [orgName, setOrgName] = useState("");
  const [projects, setProjects] = useState<RouterOutputs["project"]["list"]>([]);
  const [name, setName] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editRepoUrl, setEditRepoUrl] = useState("");
  const [editDefaultBranch, setEditDefaultBranch] = useState("main");
  const [savingEdit, setSavingEdit] = useState(false);

  async function loadProjects(organizationId: string) {
    const list = await trpc.project.list.query({ organizationId });
    setProjects(list);
  }

  useEffect(() => {
    trpc.organization.mine
      .query()
      .then(async (orgs) => {
        const org = orgs[0];
        if (!org) return;
        setOrgId(org.id);
        setOrgName(org.name);
        await loadProjects(org.id);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  async function submit() {
    if (!orgId) return;
    setCreating(true);
    setError(null);
    try {
      await trpc.project.create.mutate({ organizationId: orgId, name, repoUrl: repoUrl || undefined });
      setName("");
      setRepoUrl("");
      await loadProjects(orgId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  function startEdit(p: { id: string; name: string; repoUrl: string | null }) {
    setEditingId(p.id);
    setEditName(p.name);
    setEditRepoUrl(p.repoUrl ?? "");
    trpc.project.byId.query({ id: p.id }).then((full) => setEditDefaultBranch(full.defaultBranch));
  }

  async function saveEdit() {
    if (!editingId || !orgId) return;
    setSavingEdit(true);
    setError(null);
    try {
      await trpc.project.update.mutate({
        id: editingId,
        name: editName,
        repoUrl: editRepoUrl || undefined,
        defaultBranch: editDefaultBranch,
      });
      setEditingId(null);
      await loadProjects(orgId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingEdit(false);
    }
  }

  async function removeProject(id: string) {
    if (!orgId) return;
    setError(null);
    try {
      await trpc.project.delete.mutate({ id });
      await loadProjects(orgId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (loading) return <p>Loading…</p>;
  if (error) return <p style={{ color: "var(--ember)" }}>{error}</p>;
  if (!orgId) return <p>You don't belong to an organization yet. Go to onboarding first.</p>;

  return (
    <div style={{ maxWidth: 640 }}>
      <h1>{orgName} projects</h1>

      <div style={{ display: "grid", gap: 8, marginBottom: 24 }}>
        <label>
          Project name
          <input value={name} onChange={(e) => setName(e.target.value)} style={{ width: "100%" }} />
        </label>
        <label>
          Repo URL <span style={{ color: "var(--muted-dim)" }}>(optional)</span>
          <input value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} style={{ width: "100%" }} />
        </label>
        <button onClick={submit} disabled={creating || !name}>
          {creating ? "Creating…" : "+ New project"}
        </button>
      </div>

      <ul style={{ listStyle: "none", padding: 0 }}>
        {projects.map((p) => (
          <li key={p.id} style={{ marginBottom: 12, borderBottom: "1px solid var(--line)", paddingBottom: 10 }}>
            {editingId === p.id ? (
              <div style={{ display: "grid", gap: 6, maxWidth: 360 }}>
                <input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Name" />
                <input value={editRepoUrl} onChange={(e) => setEditRepoUrl(e.target.value)} placeholder="Repo URL" />
                <input
                  value={editDefaultBranch}
                  onChange={(e) => setEditDefaultBranch(e.target.value)}
                  placeholder="Default branch"
                />
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={saveEdit} disabled={savingEdit || !editName}>
                    {savingEdit ? "Saving…" : "Save"}
                  </button>
                  <button onClick={() => setEditingId(null)}>Cancel</button>
                </div>
              </div>
            ) : (
              <>
                <strong>{p.name}</strong> <span style={{ color: "var(--muted-dim)" }}>({p.id})</span>
                {p.repoUrl && <> — {p.repoUrl}</>}
                <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
                  <a href={`/test-cases?projectId=${p.id}`}>Test cases</a>
                  <a href={`/test-plans?projectId=${p.id}`}>Test plans</a>
                  <a href={`/requirements?projectId=${p.id}`}>Requirements</a>
                  <button onClick={() => startEdit(p)}>Edit</button>
                  <button onClick={() => removeProject(p.id)}>Delete</button>
                </div>
              </>
            )}
          </li>
        ))}
        {projects.length === 0 && <p style={{ color: "var(--muted)" }}>No projects yet — create one above.</p>}
      </ul>
    </div>
  );
}
