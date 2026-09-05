"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { trpcReact } from "../../lib/trpcReact";
import { Modal } from "../../components/Modal";

// P1-15
export default function ProjectsPage() {
  const router = useRouter();
  const utils = trpcReact.useUtils();

  const orgsQuery = trpcReact.organization.mine.useQuery();
  const orgId = orgsQuery.data?.[0]?.id;
  const orgName = orgsQuery.data?.[0]?.name ?? "";

  const projectsQuery = trpcReact.project.list.useQuery({ organizationId: orgId! }, { enabled: !!orgId });
  const projects = projectsQuery.data ?? [];

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editRepoUrl, setEditRepoUrl] = useState("");
  const [editDefaultBranch, setEditDefaultBranch] = useState("main");
  const [editError, setEditError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (orgsQuery.data && orgsQuery.data.length === 0) router.push("/onboarding");
  }, [orgsQuery.data, router]);

  const createMutation = trpcReact.project.create.useMutation({
    onSuccess: () => {
      setName("");
      setRepoUrl("");
      setCreateOpen(false);
      void utils.project.list.invalidate();
    },
    onError: (e) => setCreateError(e.message),
  });

  const updateMutation = trpcReact.project.update.useMutation({
    onSuccess: () => {
      setEditingId(null);
      void utils.project.list.invalidate();
    },
    onError: (e) => setEditError(e.message),
  });

  const deleteMutation = trpcReact.project.delete.useMutation({
    onSuccess: () => void utils.project.list.invalidate(),
    onError: (e) => setDeleteError(e.message),
  });

  function submit() {
    if (!orgId) return;
    setCreateError(null);
    createMutation.mutate({ organizationId: orgId, name, repoUrl: repoUrl || undefined });
  }

  async function startEdit(p: { id: string; name: string; repoUrl: string | null }) {
    setEditingId(p.id);
    setEditName(p.name);
    setEditRepoUrl(p.repoUrl ?? "");
    const full = await utils.project.byId.fetch({ id: p.id });
    setEditDefaultBranch(full.defaultBranch);
  }

  function saveEdit() {
    if (!editingId) return;
    setEditError(null);
    updateMutation.mutate({ id: editingId, name: editName, repoUrl: editRepoUrl || undefined, defaultBranch: editDefaultBranch });
  }

  function removeProject(id: string) {
    setDeleteError(null);
    deleteMutation.mutate({ id });
  }

  const loading = orgsQuery.isLoading || (!!orgId && projectsQuery.isLoading);
  const pageError = orgsQuery.error?.message ?? projectsQuery.error?.message ?? null;

  if (loading) return <p>Loading…</p>;
  if (pageError) return <p style={{ color: "var(--ember)" }}>{pageError}</p>;
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

      {deleteError && <p style={{ color: "var(--ember)" }}>{deleteError}</p>}

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
              <button className="btn-secondary" onClick={() => void startEdit(p)}>
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
            <button className="btn-primary" onClick={submit} disabled={createMutation.isPending || !name}>
              {createMutation.isPending ? "Creating…" : "Create project"}
            </button>
          </div>
          {createError && <p style={{ color: "var(--ember)" }}>{createError}</p>}
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
            <button className="btn-primary" onClick={saveEdit} disabled={updateMutation.isPending || !editName}>
              {updateMutation.isPending ? "Saving…" : "Save"}
            </button>
          </div>
          {editError && <p style={{ color: "var(--ember)" }}>{editError}</p>}
        </div>
      </Modal>
    </div>
  );
}
