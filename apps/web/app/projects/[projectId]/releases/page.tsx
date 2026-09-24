"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { trpcReact } from "@/lib/trpcReact";
import { Modal } from "@/components/Modal";
import { ReadinessBadge } from "@/components/ReadinessBadge";
import { TrendChart } from "@/components/TrendChart";
import { DistributionBar, ScoreRing } from "@/components/MetricVisuals";
import { useProjectPermissions } from "@/lib/use-project-permissions";

// P1-15
export default function ReleasesPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { canEdit } = useProjectPermissions(projectId);
  const utils = trpcReact.useUtils();

  const releasesQuery = trpcReact.releases.list.useQuery({ projectId });
  const trendQuery = trpcReact.releases.trend.useQuery({ projectId });
  const releases = releasesQuery.data ?? [];
  const trend = trendQuery.data ?? [];

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  const createMutation = trpcReact.releases.create.useMutation({
    onSuccess: () => {
      setName("");
      setCreateOpen(false);
      void utils.releases.list.invalidate({ projectId });
      void utils.releases.trend.invalidate({ projectId });
    },
    onError: (e) => setCreateError(e.message),
  });

  function submit() {
    if (!canEdit || !name.trim()) return;
    setCreateError(null);
    createMutation.mutate({ projectId, name: name.trim() });
  }

  const loading = releasesQuery.isLoading;
  const error = createError ?? releasesQuery.error?.message ?? null;

  return (
    <div style={{ maxWidth: 800 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 4,
        }}
      >
        <h1 style={{ margin: 0 }}>Release readiness</h1>
        {canEdit && (
          <button className="btn-primary" onClick={() => setCreateOpen(true)}>
            + New release
          </button>
        )}
      </div>
      <p className="text-muted" style={{ marginBottom: 20 }}>
        How well each release held up against its{" "}
        <a href={`/projects/${projectId}/test-strategy`}>test strategy</a>:
        acceptance criteria met, open risk flags, and overall readiness.
      </p>

      {loading && <p>Loading…</p>}
      {error && <p style={{ color: "var(--ember)" }}>{error}</p>}

      {trend.length > 1 && (
        <div
          className="panel"
          style={{
            marginBottom: 20,
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 20,
          }}
        >
          <div>
            <div className="eyebrow" style={{ marginBottom: 6 }}>
              Pass rate
            </div>
            <TrendChart
              points={trend.map((t) => ({
                label: t.name,
                value: t.passRate === null ? null : t.passRate * 100,
              }))}
              formatValue={(v) => `${v.toFixed(0)}%`}
              color="var(--frost)"
            />
          </div>
          <div>
            <div className="eyebrow" style={{ marginBottom: 6 }}>
              Coverage
            </div>
            <TrendChart
              points={trend.map((t) => ({
                label: t.name,
                value: t.coveragePct,
              }))}
              formatValue={(v) => `${v.toFixed(0)}%`}
              color="var(--frost)"
            />
          </div>
          <div>
            <div className="eyebrow" style={{ marginBottom: 6 }}>
              Flaky results
            </div>
            <TrendChart
              points={trend.map((t) => ({
                label: t.name,
                value: t.flakyCount,
              }))}
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
                value:
                  t.meanTimeToGreenMs === null
                    ? null
                    : t.meanTimeToGreenMs / 60000,
              }))}
              formatValue={(v) => `${v.toFixed(0)} min`}
              color="var(--ember)"
            />
          </div>
        </div>
      )}

      <ul style={{ listStyle: "none", padding: 0 }}>
        {releases.map((r) => (
          <li key={r.id} className="panel release-readiness-card">
            <a
              href={`/projects/${projectId}/releases/${r.id}`}
              className="release-readiness-link"
            >
              <ScoreRing
                value={r.readiness.score}
                label={`${r.name} readiness`}
                size="compact"
              />
              <div className="release-readiness-copy">
                <strong>{r.name}</strong>{" "}
                <span className="text-muted" style={{ fontSize: 13 }}>
                  [{r.status}]
                  {r.targetDate &&
                    ` · target ${new Date(r.targetDate).toLocaleDateString()}`}
                </span>
                <div className="release-readiness-visuals">
                  <div>
                    <span>Acceptance criteria</span>
                    <DistributionBar
                      compact
                      label={`${r.name} acceptance criteria`}
                      segments={[
                        {
                          label: "Met",
                          value: r.readiness.criteria.met,
                          tone: "success",
                        },
                        {
                          label: "At risk",
                          value: r.readiness.criteria.atRisk,
                          tone: "warning",
                        },
                        {
                          label: "Not met",
                          value: r.readiness.criteria.notMet,
                          tone: "danger",
                        },
                        {
                          label: "Pending",
                          value: r.readiness.criteria.pending,
                          tone: "neutral",
                        },
                      ]}
                    />
                    <small>
                      {r.readiness.criteria.met}/{r.readiness.criteria.total}{" "}
                      met
                    </small>
                  </div>
                  <div
                    className={
                      r.readiness.riskFlags.openTotal > 0
                        ? "release-risk-open"
                        : "release-risk-clear"
                    }
                  >
                    <span>Open risk flags</span>
                    <strong>{r.readiness.riskFlags.openTotal}</strong>
                    <small>
                      {r.readiness.riskFlags.critical} critical ·{" "}
                      {r.readiness.riskFlags.high} high
                    </small>
                  </div>
                </div>
              </div>
              <ReadinessBadge
                score={r.readiness.score}
                label={r.readiness.label}
              />
            </a>
          </li>
        ))}
        {!loading && releases.length === 0 && (
          <p className="text-muted">
            No releases yet — create one here, or from{" "}
            <a href={`/projects/${projectId}/test-strategy`}>Test Strategy</a>{" "}
            when analyzing a change.
          </p>
        )}
      </ul>

      <Modal
        open={canEdit && createOpen}
        onClose={() => setCreateOpen(false)}
        title="New release"
      >
        <div style={{ display: "grid", gap: 10 }}>
          <label>
            Release name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
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
            >
              Cancel
            </button>
            <button
              className="btn-primary"
              onClick={submit}
              disabled={createMutation.isPending || !name.trim()}
            >
              {createMutation.isPending ? "Creating…" : "Create release"}
            </button>
          </div>
          {error && <p style={{ color: "var(--ember)" }}>{error}</p>}
        </div>
      </Modal>
    </div>
  );
}
