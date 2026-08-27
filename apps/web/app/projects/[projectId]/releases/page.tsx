"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { Modal } from "@/components/Modal";
import { ReadinessBadge } from "@/components/ReadinessBadge";
import { TrendChart } from "@/components/TrendChart";

export default function ReleasesPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [releases, setReleases] = useState<RouterOutputs["releases"]["list"]>([]);
  const [trend, setTrend] = useState<RouterOutputs["releases"]["trend"]>([]);
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

  useEffect(() => {
    trpc.releases.trend.query({ projectId }).then(setTrend).catch(() => undefined);
  }, [projectId]);

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

      {trend.length > 1 && (
        <div className="panel" style={{ marginBottom: 20, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          <div>
            <div className="eyebrow" style={{ marginBottom: 6 }}>
              Pass rate
            </div>
            <TrendChart
              points={trend.map((t) => ({ label: t.name, value: t.passRate === null ? null : t.passRate * 100 }))}
              formatValue={(v) => `${v.toFixed(0)}%`}
              color="var(--frost)"
            />
          </div>
          <div>
            <div className="eyebrow" style={{ marginBottom: 6 }}>
              Coverage
            </div>
            <TrendChart
              points={trend.map((t) => ({ label: t.name, value: t.coveragePct }))}
              formatValue={(v) => `${v.toFixed(0)}%`}
              color="var(--frost)"
            />
          </div>
          <div>
            <div className="eyebrow" style={{ marginBottom: 6 }}>
              Flaky results
            </div>
            <TrendChart
              points={trend.map((t) => ({ label: t.name, value: t.flakyCount }))}
              formatValue={(v) => `${v}`}
              color="var(--ember)"
            />
          </div>
          <div>
            <div className="eyebrow" style={{ marginBottom: 6 }}>
              Mean time-to-green
            </div>
            <TrendChart
              points={trend.map((t) => ({
                label: t.name,
                value: t.meanTimeToGreenMs === null ? null : t.meanTimeToGreenMs / 60000,
              }))}
              formatValue={(v) => `${v.toFixed(0)} min`}
              color="var(--ember)"
            />
          </div>
        </div>
      )}

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
