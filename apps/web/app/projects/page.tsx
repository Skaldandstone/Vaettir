"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { trpc, type RouterOutputs } from "../../lib/trpc";
import { Modal } from "../../components/Modal";
import { RecoveryMessage } from "../../components/RecoveryMessage";
import {
  canEditProject,
  canAdministerOrganization,
} from "../../lib/membership";
import { EmptyState, Icon, PageHeading } from "../../components/ui/Workspace";
import Link from "next/link";
import { ConfirmAction } from "../../components/ConfirmAction";

export default function ProjectsPage() {
  const router = useRouter();
  const [orgId, setOrgId] = useState<string | null>(null);
  const [orgName, setOrgName] = useState("");
  const [projects, setProjects] = useState<RouterOutputs["project"]["list"]>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [organizations, setOrganizations] = useState<
    RouterOutputs["organization"]["mine"]
  >([]);
  const [attempt, setAttempt] = useState(0);
  const [search, setSearch] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    name: string;
    organizationId: string;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const member = organizations.find((org) => org.id === orgId);
  const canEdit = canEditProject(member);
  const canDelete = canAdministerOrganization(member);

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [creating, setCreating] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editRepoUrl, setEditRepoUrl] = useState("");
  const [editDefaultBranch, setEditDefaultBranch] = useState("main");
  const [editLoadedId, setEditLoadedId] = useState<string | null>(null);
  const [editLoadError, setEditLoadError] = useState<string | null>(null);
  const [editAttempt, setEditAttempt] = useState(0);
  const [savingEdit, setSavingEdit] = useState(false);

  useEffect(() => {
    if (!editingId) return;
    let active = true;
    setEditLoadedId(null);
    setEditLoadError(null);
    trpc.project.byId
      .query({ id: editingId })
      .then((full) => {
        if (!active) return;
        setEditDefaultBranch(full.defaultBranch);
        setEditLoadedId(editingId);
      })
      .catch((e) => {
        if (active)
          setEditLoadError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      active = false;
    };
  }, [editingId, editAttempt]);

  async function loadProjects(organizationId: string) {
    const list = await trpc.project.list.query({ organizationId });
    setProjects(list);
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    trpc.organization.mine
      .query()
      .then(async (orgs) => {
        if (!active) return;
        setOrganizations(orgs);
        const org = orgs[0];
        if (!org) {
          router.push("/onboarding");
          return;
        }
        setOrgId(org.id);
        setOrgName(org.name);
        const list = await trpc.project.list.query({ organizationId: org.id });
        if (active) setProjects(list);
      })
      .catch((e) => {
        if (active) {
          setProjects([]);
          setOrganizations([]);
          setError(e instanceof Error ? e.message : String(e));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [router, attempt]);

  async function switchOrganization(id: string) {
    setOrgId(id);
    setOrgName(organizations.find((org) => org.id === id)?.name ?? "");
    setProjects([]);
    setCreateOpen(false);
    setEditingId(null);
    setDeleteTarget(null);
    setSearch("");
    setLoading(true);
    setError(null);
    try {
      await loadProjects(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function submit() {
    if (!orgId || !canEdit || creating || !name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      await trpc.project.create.mutate({
        organizationId: orgId,
        name,
        repoUrl: repoUrl || undefined,
      });
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
    setEditLoadedId(null);
    setEditLoadError(null);
    setError(null);
    setEditingId(p.id);
    setEditName(p.name);
    setEditRepoUrl(p.repoUrl ?? "");
    setEditDefaultBranch("");
  }

  async function saveEdit() {
    if (
      !editingId ||
      !orgId ||
      !canEdit ||
      savingEdit ||
      editLoadedId !== editingId ||
      !editName.trim()
    )
      return;
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

  async function removeProject() {
    if (
      !orgId ||
      !canDelete ||
      !deleteTarget ||
      deleteTarget.organizationId !== orgId ||
      deleting
    )
      return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await trpc.project.delete.mutate({ id: deleteTarget.id });
      setDeleteTarget(null);
      try {
        await loadProjects(orgId);
      } catch {
        setError(
          "The project was deleted, but the list could not be refreshed. Try again to reload your projects.",
        );
      }
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  }

  if (loading)
    return (
      <div className="workspace-loading" role="status">
        <h2>Loading your projects</h2>
        <p>Finding the projects available to your workspace.</p>
      </div>
    );
  if (error && !createOpen && !editingId)
    return (
      <RecoveryMessage
        error={error}
        onRetry={() => setAttempt((value) => value + 1)}
      />
    );
  if (!orgId)
    return (
      <p>
        You don&apos;t belong to an organization yet. Redirecting to{" "}
        <a href="/onboarding">onboarding</a>…
      </p>
    );

  return (
    <div className="quality-workspace">
      {organizations.length > 1 && (
        <label>
          Organization{" "}
          <select
            value={orgId}
            onChange={(event) => void switchOrganization(event.target.value)}
          >
            {organizations.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <PageHeading
        eyebrow={`WORKSPACE / ${orgName}`}
        title="Projects"
        description="A clear home for your test cases, execution history, and release evidence."
        actions={
          canEdit && (
            <button className="btn-primary" onClick={() => setCreateOpen(true)}>
              + New project
            </button>
          )
        }
      />
      <div className="project-toolbar">
        <label className="search-field">
          <Icon name="search" size={17} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="Search projects"
            placeholder="Search your projects…"
          />
        </label>
        <span className="quiet-label">{projects.length} projects</span>
      </div>
      <ul className="project-grid">
        {projects
          .filter((project) =>
            project.name.toLowerCase().includes(search.trim().toLowerCase()),
          )
          .map((p) => (
            <li key={p.id} className="project-card">
              <div className="project-card-heading">
                <span className="project-symbol">
                  <Icon name="folder" size={22} />
                </span>
                <Link href={`/projects/${p.id}`} aria-label={`Open ${p.name}`}>
                  <Icon name="arrow" size={18} />
                </Link>
              </div>
              <h2>
                <Link href={`/projects/${p.id}`}>{p.name}</Link>
              </h2>
              <p className="project-repository">
                <Icon name="branch" size={14} />
                {p.repoUrl || "Repository not connected"}
              </p>
              <div className="project-card-links">
                <Link href={`/projects/${p.id}/test-cases`}>Test cases</Link>
                <Link href={`/projects/${p.id}/test-plans`}>Test plans</Link>
                <Link href={`/projects/${p.id}/requirements`}>
                  Requirements
                </Link>
              </div>
              <div className="project-card-admin">
                {canEdit && (
                  <button
                    className="btn-secondary"
                    onClick={() => startEdit(p)}
                  >
                    Edit
                  </button>
                )}
                {canDelete && (
                  <button
                    className="btn-secondary"
                    onClick={() => {
                      setDeleteError(null);
                      setDeleteTarget({
                        id: p.id,
                        name: p.name,
                        organizationId: orgId,
                      });
                    }}
                  >
                    Delete
                  </button>
                )}
              </div>
            </li>
          ))}
      </ul>
      {projects.length === 0 && (
        <div className="workspace-panel">
          <EmptyState title="Make room for your next release">
            {canEdit
              ? "Create your first project to start organizing tests and evidence."
              : "Ask your team owner or an editor to create your first project."}
          </EmptyState>
        </div>
      )}
      {projects.length > 0 &&
        !projects.some((project) =>
          project.name.toLowerCase().includes(search.trim().toLowerCase()),
        ) && (
          <EmptyState
            title="No matching projects"
            action={
              <button className="btn-secondary" onClick={() => setSearch("")}>
                Clear search
              </button>
            }
          >
            Try a different project name.
          </EmptyState>
        )}

      {deleteTarget && (
        <ConfirmAction
          key={deleteTarget.id}
          title="Delete project?"
          requiredText={deleteTarget.name}
          confirmLabel="Delete project"
          busy={deleting}
          error={deleteError}
          onClose={() => setDeleteTarget(null)}
          onConfirm={() => void removeProject()}
        >
          <p>
            This permanently deletes <strong>{deleteTarget.name}</strong> and
            its project data. There is no undo in the app.
          </p>
          <p>Cancel if you need to keep or export any project records first.</p>
        </ConfirmAction>
      )}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New project"
        dismissible={!creating}
      >
        <div style={{ display: "grid", gap: 10 }}>
          <label>
            Project name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{ width: "100%" }}
            />
          </label>
          <label>
            Repo URL{" "}
            <span style={{ color: "var(--muted-dim)" }}>(optional)</span>
            <input
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              style={{ width: "100%" }}
            />
          </label>
          <div
            style={{
              display: "flex",
              gap: 8,
              justifyContent: "flex-end",
              marginTop: 8,
            }}
          >
            <button
              className="btn-secondary"
              onClick={() => setCreateOpen(false)}
              disabled={creating}
            >
              Cancel
            </button>
            <button
              className="btn-primary"
              onClick={submit}
              disabled={creating || !name.trim()}
            >
              {creating ? "Creating…" : "Create project"}
            </button>
          </div>
          {error && <RecoveryMessage error={error} />}
        </div>
      </Modal>

      <Modal
        open={editingId !== null}
        onClose={() => setEditingId(null)}
        title="Edit project"
        dismissible={!savingEdit}
      >
        <div style={{ display: "grid", gap: 10 }}>
          <label>
            Project name
            <input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              style={{ width: "100%" }}
            />
          </label>
          <label>
            Repo URL
            <input
              value={editRepoUrl}
              onChange={(e) => setEditRepoUrl(e.target.value)}
              style={{ width: "100%" }}
            />
          </label>
          <label>
            Default branch
            <input
              value={editDefaultBranch}
              disabled={editLoadedId !== editingId || savingEdit}
              onChange={(e) => setEditDefaultBranch(e.target.value)}
              style={{ width: "100%" }}
            />
          </label>
          {editLoadedId !== editingId && !editLoadError && (
            <p role="status">Loading project settings before you save…</p>
          )}
          {editLoadError && (
            <RecoveryMessage
              error={editLoadError}
              onRetry={() => setEditAttempt((value) => value + 1)}
            />
          )}
          <div
            style={{
              display: "flex",
              gap: 8,
              justifyContent: "flex-end",
              marginTop: 8,
            }}
          >
            <button
              className="btn-secondary"
              onClick={() => setEditingId(null)}
              disabled={savingEdit}
            >
              Cancel
            </button>
            <button
              className="btn-primary"
              onClick={saveEdit}
              disabled={
                savingEdit || editLoadedId !== editingId || !editName.trim()
              }
            >
              {savingEdit ? "Saving…" : "Save"}
            </button>
          </div>
          {error && <RecoveryMessage error={error} />}
        </div>
      </Modal>
    </div>
  );
}
