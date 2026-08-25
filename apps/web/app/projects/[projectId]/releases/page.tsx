"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { Modal } from "@/components/Modal";
import { ReadinessBadge } from "@/components/ReadinessBadge";

export default function ReleasesPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [releases, setReleases] = useState<RouterOutputs["releases"]["list"]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  function load() {
    setLoading(true);
    setError(null);
    trpc.releases.list
      .query({ projectId })
      .then(setReleases)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }

  useEffect(load, [projectId]);

  async function submit() {
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      await trpc.releases.create.mutate({ projectId, name: name.trim() });
      setName("");
      setCreateOpen(false);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div style={{ maxWidth: 800 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <h1 style={{ margin: 0 }}>Release readiness</h1>
        <button className="btn-primary" onClick={() => setCreateOpen(true)}>
          + New release
        </button>
      </div>
      <p className="text-muted" style={{ marginBottom: 20 }}>
        How well each release held up against its <a href={`/projects/${projectId}/test-strategy`}>test strategy</a>
        : acceptance criteria met, open risk flags, and overall readiness.
      </p>

      {loading && <p>Loading…</p>}
      {error && <p style={{ color: "var(--ember)" }}>{error}</p>}

      <ul style={{ listStyle: "none", padding: 0 }}>
        {releases.map((r) => (
          <li key={r.id} className="panel" style={{ display: "block", marginBottom: 12 }}>
            <a href={`/projects/${projectId}/releases/${r.id}`} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <div>
                <strong>{r.name}</strong>{" "}
                <span className="text-muted" style={{ fontSize: 13 }}>
                  [{r.status}]{r.targetDate && ` · target ${new Date(r.targetDate).toLocaleDateString()}`}
                </span>
                <div className="text-muted" style={{ fontSize: 12, marginTop: 2 }}>
                  {r.readiness.criteria.met}/{r.readiness.criteria.total} acceptance criteria met ·{" "}
                  {r.readiness.riskFlags.openTotal} open risk flag(s)
                </div>
              </div>
              <ReadinessBadge score={r.readiness.score} label={r.readiness.label} />
            </a>
          </li>
        ))}
        {!loading && releases.length === 0 && (
          <p className="text-muted">
            No releases yet — create one here, or from <a href={`/projects/${projectId}/test-strategy`}>Test Strategy</a>{" "}
            when analyzing a change.
          </p>
        )}
      </ul>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New release">
        <div style={{ display: "grid", gap: 10 }}>
          <label>
            Release name
            <input value={name} onChange={(e) => setName(e.target.value)} style={{ width: "100%" }} />
          </label>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
            <button className="btn-secondary" onClick={() => setCreateOpen(false)}>
              Cancel
            </button>
            <button className="btn-primary" onClick={submit} disabled={creating || !name.trim()}>
              {creating ? "Creating…" : "Create release"}
            </button>
          </div>
          {error && <p style={{ color: "var(--ember)" }}>{error}</p>}
        </div>
      </Modal>
    </div>
  );
}
