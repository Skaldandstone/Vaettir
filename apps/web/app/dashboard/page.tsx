"use client";

import { useEffect, useState } from "react";
import { trpc, type RouterOutputs } from "../../lib/trpc";
import { ReadinessBadge } from "../../components/ReadinessBadge";

export default function OrgDashboardPage() {
  const [orgName, setOrgName] = useState("");
  const [overview, setOverview] = useState<RouterOutputs["releases"]["orgOverview"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    trpc.organization.mine
      .query()
      .then(async (orgs) => {
        const org = orgs[0];
        if (!org) return;
        setOrgName(org.name);
        const result = await trpc.releases.orgOverview.query({ organizationId: org.id });
        setOverview(result);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p>Loading…</p>;
  if (error) return <p style={{ color: "var(--ember)" }}>{error}</p>;
  if (!overview) return <p>You don&apos;t belong to an organization yet. Go to onboarding first.</p>;

  const { projects, summary } = overview;

  return (
    <div style={{ maxWidth: 900 }}>
      <h1 style={{ marginBottom: 4 }}>{orgName} readiness</h1>
      <p className="text-muted" style={{ marginBottom: 20 }}>
        Every project&apos;s most recent in-flight release, at a glance.
      </p>

      <div style={{ display: "flex", gap: 16, marginBottom: 24 }}>
        <SummaryStat label="Ready" value={summary.ready} color="var(--frost)" />
        <SummaryStat label="At risk" value={summary.atRisk} color="var(--ember)" />
        <SummaryStat label="Blocked" value={summary.blocked} color="var(--ember)" />
        <SummaryStat label="No active release" value={summary.noActiveRelease} color="var(--muted)" />
      </div>

      <div className="panel">
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={cellStyle}>Project</th>
              <th style={cellStyle}>Release</th>
              <th style={cellStyle}>Status</th>
              <th style={cellStyle}>Readiness</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.projectId}>
                <td style={cellStyle}>
                  <a href={`/projects/${p.projectId}`}>{p.projectName}</a>
                </td>
                <td style={cellStyle}>
                  {p.release ? (
                    <a href={`/projects/${p.projectId}/releases/${p.release.id}`}>{p.release.name}</a>
                  ) : (
                    <span className="text-muted">no in-flight release</span>
                  )}
                </td>
                <td style={cellStyle}>{p.release?.status ?? "—"}</td>
                <td style={cellStyle}>
                  {p.release ? <ReadinessBadge score={p.release.readiness.score} label={p.release.readiness.label} /> : "—"}
                </td>
              </tr>
            ))}
            {projects.length === 0 && (
              <tr>
                <td colSpan={4} style={cellStyle} className="text-muted">
                  No projects yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SummaryStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="panel" style={{ flex: 1, textAlign: "center" }}>
      <div style={{ fontSize: 28, fontWeight: 700, color }}>{value}</div>
      <div className="text-muted" style={{ fontSize: 12 }}>
        {label}
      </div>
    </div>
  );
}

const cellStyle = { border: "1px solid var(--line)", padding: "6px 10px", textAlign: "left" as const };
