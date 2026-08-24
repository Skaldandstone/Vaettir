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

  if (loading) return <p>Loading…</p>;
  if (error) return <p style={{ color: "crimson" }}>{error}</p>;
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
          Repo URL <span style={{ color: "#888" }}>(optional)</span>
          <input value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} style={{ width: "100%" }} />
        </label>
        <button onClick={submit} disabled={creating || !name}>
          {creating ? "Creating…" : "+ New project"}
        </button>
      </div>

      <ul>
        {projects.map((p) => (
          <li key={p.id}>
            <strong>{p.name}</strong> <span style={{ color: "#888" }}>({p.id})</span>
            {p.repoUrl && <> — {p.repoUrl}</>}
            <div>
              <a href={`/test-cases?projectId=${p.id}`}>Test cases</a>
            </div>
          </li>
        ))}
        {projects.length === 0 && <p style={{ color: "#666" }}>No projects yet — create one above.</p>}
      </ul>
    </div>
  );
}
