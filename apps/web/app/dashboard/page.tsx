"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { trpcReact } from "../../lib/trpcReact";
import { ReadinessBadge } from "../../components/ReadinessBadge";
import { EmptyState, Icon, MetricCard, PageHeading } from "../../components/ui/Workspace";

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

  if (loading)
    return (
      <div className="workspace-loading" role="status">
        <span className="loading-indicator" aria-hidden="true" />
        <p>Loading release readiness…</p>
      </div>
    );
  if (error)
    return (
      <div className="workspace-alert workspace-alert-error" role="alert">
        <Icon name="alert" />
        <div><strong>Readiness could not be loaded</strong><p>{error}</p></div>
      </div>
    );
  if (!overview)
    return (
      <div className="workspace-loading" role="status">
        <p>Preparing your workspace. If you are not redirected, continue to <Link href="/onboarding">onboarding</Link>.</p>
      </div>
    );

  const { projects, summary } = overview;

  return (
    <div className="quality-workspace">
      <PageHeading
        eyebrow={`WORKSPACE / ${orgName.toUpperCase()}`}
        title="Release readiness"
        description="The latest in-flight release across every project, with blockers kept visible."
        actions={<Link className="btn-primary" href="/projects">View projects <Icon name="arrow" size={16} /></Link>}
      />

      <div className="metric-grid">
        <MetricCard icon="check" label="Ready" value={summary.ready} note="Clear to release" tone="success" />
        <MetricCard icon="alert" label="At risk" value={summary.atRisk} note="Needs attention" tone="warning" />
        <MetricCard icon="alert" label="Blocked" value={summary.blocked} note="Cannot release" tone="danger" />
        <MetricCard icon="release" label="No active release" value={summary.noActiveRelease} note="No decision pending" />
      </div>

      {projects.length === 0 ? (
        <section className="workspace-panel">
          <EmptyState title="No projects yet" action={<Link className="btn-primary" href="/projects">Create a project</Link>}>
            Add a project to start connecting cases, execution evidence, and release decisions.
          </EmptyState>
        </section>
      ) : (
        <section className="workspace-panel readiness-table" aria-labelledby="readiness-table-title">
          <div className="panel-heading readiness-table-heading">
            <div><h2 id="readiness-table-title">Project readiness</h2><p className="panel-description">Most recent in-flight releases</p></div>
            <span className="quiet-label">{projects.length} {projects.length === 1 ? "project" : "projects"}</span>
          </div>
          <div className="table-scroll">
          <table className="workspace-table">
            <caption className="sr-only">Current release readiness by project</caption>
          <thead>
            <tr>
              <th scope="col">Project</th>
              <th scope="col">Release</th>
              <th scope="col">Status</th>
              <th scope="col">Readiness</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.projectId}>
                <td>
                  <Link className="project-name-link" href={`/projects/${p.projectId}`}><Icon name="folder" size={16} />{p.projectName}</Link>
                </td>
                <td>
                  {p.release ? (
                    <Link href={`/projects/${p.projectId}/releases/${p.release.id}`}>{p.release.name}</Link>
                  ) : (
                    <span className="text-muted">no in-flight release</span>
                  )}
                </td>
                <td>{p.release?.status ?? "—"}</td>
                <td>
                  {p.release ? <ReadinessBadge score={p.release.readiness.score} label={p.release.readiness.label} /> : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
          </div>
        </section>
      )}
    </div>
  );
}
