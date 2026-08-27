"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { trpc, type RouterOutputs } from "../../lib/trpc";
import { Modal } from "../../components/Modal";

export default function ProjectsPage() {
  const router = useRouter();
  const [orgId, setOrgId] = useState<string | null>(null);
  const [orgName, setOrgName] = useState("");
  const [projects, setProjects] = useState<RouterOutputs["project"]["list"]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [creating, setCreating] = useState(false);

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
        if (!org) {
          router.push("/onboarding");
          return;
        }
        setOrgId(org.id);
        setOrgName(org.name);
        await loadProjects(org.id);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [router]);

  async function submit() {
    if (!orgId) return;
    setCreating(true);
    setError(null);
    try {
      await trpc.project.create.mutate({ organizationId: orgId, name, repoUrl: repoUrl || undefined });
      setName("");
      setRepoUrl("");
      setCreateOpen(false);
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
  if (!orgId)
    return (
      <p>
        You don't belong to an organization yet. Redirecting to <a href="/onboarding">onboarding</a>…
      </p>
    );

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <h1 style={{ margin: 0 }}>{orgName} projects</h1>
        <button className="btn-primary" onClick={() => setCreateOpen(true)}>
          + New project
        </button>
      </div>

      <ul style={{ listStyle: "none", padding: 0 }}>
        {projects.map((p) => (
          <li key={p.id} style={{ marginBottom: 12, borderBottom: "1px solid var(--line)", paddingBottom: 10 }}>
            <a href={`/projects/${p.id}`}>
              <strong>{p.name}</strong>
            </a>
            {p.repoUrl && <> — {p.repoUrl}</>}
            <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
              <a href={`/projects/${p.id}/test-cases`}>Test cases</a>
              <a href={`/projects/${p.id}/test-plans`}>Test plans</a>
              <a href={`/projects/${p.id}/requirements`}>Requirements</a>
              <button className="btn-secondary" onClick={() => startEdit(p)}>
                Edit
              </button>
              <button className="btn-secondary" onClick={() => removeProject(p.id)}>
                Delete
              </button>
            </div>
          </li>
        ))}
        {projects.length === 0 && <p style={{ color: "var(--muted)" }}>No projects yet — create one above.</p>}
      </ul>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New project">
        <div style={{ display: "grid", gap: 10 }}>
          <label>
            Project name
            <input value={name} onChange={(e) => setName(e.target.value)} style={{ width: "100%" }} />
          </label>
          <label>
            Repo URL <span style={{ color: "var(--muted-dim)" }}>(optional)</span>
            <input value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} style={{ width: "100%" }} />
          </label>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
            <button className="btn-secondary" onClick={() => setCreateOpen(false)}>
              Cancel
            </button>
            <button className="btn-primary" onClick={submit} disabled={creating || !name}>
              {creating ? "Creating…" : "Create project"}
            </button>
          </div>
          {error && <p style={{ color: "var(--ember)" }}>{error}</p>}
        </div>
      </Modal>

      <Modal open={editingId !== null} onClose={() => setEditingId(null)} title="Edit project">
        <div style={{ display: "grid", gap: 10 }}>
          <label>
            Project name
            <input value={editName} onChange={(e) => setEditName(e.target.value)} style={{ width: "100%" }} />
          </label>
          <label>
            Repo URL
            <input value={editRepoUrl} onChange={(e) => setEditRepoUrl(e.target.value)} style={{ width: "100%" }} />
          </label>
          <label>
            Default branch
            <input value={editDefaultBranch} onChange={(e) => setEditDefaultBranch(e.target.value)} style={{ width: "100%" }} />
          </label>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
            <button className="btn-secondary" onClick={() => setEditingId(null)}>
              Cancel
            </button>
            <button className="btn-primary" onClick={saveEdit} disabled={savingEdit || !editName}>
              {savingEdit ? "Saving…" : "Save"}
            </button>
          </div>
          {error && <p style={{ color: "var(--ember)" }}>{error}</p>}
        </div>
      </Modal>
    </div>
  );
}
