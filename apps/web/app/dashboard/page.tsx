"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { trpcReact } from "../../lib/trpcReact";
import { ReadinessBadge } from "../../components/ReadinessBadge";

// P1-15
export default function OrgDashboardPage() {
  const router = useRouter();
  const orgsQuery = trpcReact.organization.mine.useQuery();
  const orgId = orgsQuery.data?.[0]?.id;
  const orgName = orgsQuery.data?.[0]?.name ?? "";

  const overviewQuery = trpcReact.releases.orgOverview.useQuery({ organizationId: orgId! }, { enabled: !!orgId });

  useEffect(() => {
    if (orgsQuery.data && orgsQuery.data.length === 0) router.push("/onboarding");
  }, [orgsQuery.data, router]);

  const loading = orgsQuery.isLoading || (!!orgId && overviewQuery.isLoading);
  const error = orgsQuery.error?.message ?? overviewQuery.error?.message ?? null;
  const overview = overviewQuery.data;

  if (loading) return <p>Loading…</p>;
  if (error) return <p style={{ color: "var(--ember)" }}>{error}</p>;
  if (!overview)
    return (
      <p>
        You don&apos;t belong to an organization yet. Redirecting to <a href="/onboarding">onboarding</a>…
      </p>
    );

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
