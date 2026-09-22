"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { trpcReact } from "../../lib/trpcReact";
import { Modal } from "../../components/Modal";
import { ConfirmAction } from "../../components/ConfirmAction";
import { EmptyState, Icon, PageHeading } from "../../components/ui/Workspace";
import { canAdministerOrganization, canEditProject } from "../../lib/membership";

// P1-15
export default function ProjectsPage() {
  const router = useRouter();
  const utils = trpcReact.useUtils();

  const orgsQuery = trpcReact.organization.mine.useQuery();
  const orgId = orgsQuery.data?.[0]?.id;
  const orgName = orgsQuery.data?.[0]?.name ?? "";
  const membership = orgsQuery.data?.[0];
  const canEdit = canEditProject(membership);
  const canDelete = canAdministerOrganization(membership);

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
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

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
    onSuccess: () => {
      setDeleteTarget(null);
      void utils.project.list.invalidate();
    },
    onError: (e) => setDeleteError(e.message),
  });

  function submit() {
    if (!orgId || !canEdit) return;
    setCreateError(null);
    createMutation.mutate({ organizationId: orgId, name, repoUrl: repoUrl || undefined });
  }

  async function startEdit(p: { id: string; name: string; repoUrl: string | null }) {
    if (!canEdit) return;
    setEditingId(p.id);
    setEditName(p.name);
    setEditRepoUrl(p.repoUrl ?? "");
    const full = await utils.project.byId.fetch({ id: p.id });
    setEditDefaultBranch(full.defaultBranch);
  }

  function saveEdit() {
    if (!editingId || !canEdit) return;
    setEditError(null);
    updateMutation.mutate({ id: editingId, name: editName, repoUrl: editRepoUrl || undefined, defaultBranch: editDefaultBranch });
  }

  function removeProject() {
    if (!deleteTarget || !canDelete) return;
    setDeleteError(null);
    deleteMutation.mutate({ id: deleteTarget.id });
  }

  const loading = orgsQuery.isLoading || (!!orgId && projectsQuery.isLoading);
  const pageError = orgsQuery.error?.message ?? projectsQuery.error?.message ?? null;

  if (loading)
    return (
      <div className="workspace-loading" role="status">
        <span className="loading-indicator" aria-hidden="true" />
        <p>Loading your projects…</p>
      </div>
    );
  if (pageError)
    return (
      <div className="workspace-alert workspace-alert-error" role="alert">
        <Icon name="alert" />
        <div>
          <strong>Projects could not be loaded</strong>
          <p>{pageError}</p>
        </div>
      </div>
    );
  if (!orgId)
    return (
      <div className="workspace-loading" role="status">
        <p>
          Preparing your workspace. If you are not redirected, continue to <Link href="/onboarding">onboarding</Link>.
        </p>
      </div>
    );

  return (
    <div className="quality-workspace">
      <PageHeading
        eyebrow={`WORKSPACE / ${orgName.toUpperCase()}`}
        title="Projects"
        description="Move from test design to release evidence in one traceable workspace."
        actions={canEdit ? (
          <button className="btn-primary" onClick={() => setCreateOpen(true)}>
            <Icon name="folder" size={16} /> New project
          </button>
        ) : undefined}
      />

      {deleteError && (
        <p className="text-error" role="alert">
          {deleteError}
        </p>
      )}

      <ul className="project-grid">
        {projects.map((p) => (
          <li key={p.id} className="project-card">
            <div className="project-card-heading">
              <span className="project-symbol"><Icon name="folder" size={21} /></span>
              <Link className="text-button" href={`/projects/${p.id}`}>
                Open <Icon name="arrow" size={14} />
              </Link>
            </div>
            <h2><Link href={`/projects/${p.id}`}>{p.name}</Link></h2>
            <p className="project-repository">
              <Icon name="branch" size={14} />
              {p.repoUrl || "No repository connected"}
            </p>
            <nav className="project-card-links" aria-label={`${p.name} sections`}>
              <Link href={`/projects/${p.id}/test-cases`}>Test cases</Link>
              <Link href={`/projects/${p.id}/test-plans`}>Test plans</Link>
              <Link href={`/projects/${p.id}/requirements`}>Requirements</Link>
            </nav>
            {(canEdit || canDelete) && (
              <div className="project-card-admin">
                {canEdit && (
                  <button className="btn-secondary" onClick={() => void startEdit(p)}>
                    Edit
                  </button>
                )}
                {canDelete && (
                  <button className="btn-secondary" onClick={() => setDeleteTarget({ id: p.id, name: p.name })}>
                    Delete
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      {projects.length === 0 && (
        <section className="workspace-panel">
          <EmptyState
            title={canEdit ? "Create your first project" : "No projects are available yet"}
            action={canEdit ? <button className="btn-primary" onClick={() => setCreateOpen(true)}>New project</button> : undefined}
          >
            {canEdit
              ? "Projects keep cases, CI evidence, reviews, and release decisions connected."
              : "An organization owner, admin, or editor can create the first project."}
          </EmptyState>
        </section>
      )}

      <Modal open={canEdit && createOpen} onClose={() => setCreateOpen(false)} title="New project">
        <div className="form-stack">
          <label>
            Project name
            <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </label>
          <label>
            Repo URL <span style={{ color: "var(--muted-dim)" }}>(optional)</span>
            <input value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} placeholder="https://github.com/organization/repository" />
          </label>
          <div className="form-actions">
            <button className="btn-secondary" onClick={() => setCreateOpen(false)}>
              Cancel
            </button>
            <button className="btn-primary" onClick={submit} disabled={createMutation.isPending || !name}>
              {createMutation.isPending ? "Creating…" : "Create project"}
            </button>
          </div>
          {createError && <p className="text-error" role="alert">{createError}</p>}
        </div>
      </Modal>

      <Modal open={canEdit && editingId !== null} onClose={() => setEditingId(null)} title="Edit project">
        <div className="form-stack">
          <label>
            Project name
            <input value={editName} onChange={(e) => setEditName(e.target.value)} />
          </label>
          <label>
            Repo URL
            <input value={editRepoUrl} onChange={(e) => setEditRepoUrl(e.target.value)} />
          </label>
          <label>
            Default branch
            <input value={editDefaultBranch} onChange={(e) => setEditDefaultBranch(e.target.value)} />
          </label>
          <div className="form-actions">
            <button className="btn-secondary" onClick={() => setEditingId(null)}>
              Cancel
            </button>
            <button className="btn-primary" onClick={saveEdit} disabled={updateMutation.isPending || !editName}>
              {updateMutation.isPending ? "Saving…" : "Save"}
            </button>
          </div>
          {editError && <p className="text-error" role="alert">{editError}</p>}
        </div>
      </Modal>

      {canDelete && deleteTarget && (
        <ConfirmAction
          title={`Delete ${deleteTarget.name}?`}
          requiredText={deleteTarget.name}
          confirmLabel="Delete project"
          busy={deleteMutation.isPending}
          error={deleteError}
          onClose={() => {
            if (!deleteMutation.isPending) setDeleteTarget(null);
          }}
          onConfirm={removeProject}
        >
          <p>This permanently removes the project and its Vaettir records. This action cannot be undone.</p>
        </ConfirmAction>
      )}
    </div>
  );
}
