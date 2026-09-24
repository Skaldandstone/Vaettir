"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { trpcReact } from "../../lib/trpcReact";
import { ReadinessBadge } from "../../components/ReadinessBadge";
import { DistributionBar, ScoreRing } from "../../components/MetricVisuals";
import {
  EmptyState,
  Icon,
  PageHeading,
  StatusPill,
} from "../../components/ui/Workspace";

// P1-15
export default function OrgDashboardPage() {
  const router = useRouter();
  const orgsQuery = trpcReact.organization.mine.useQuery();
  const orgId = orgsQuery.data?.[0]?.id;
  const orgName = orgsQuery.data?.[0]?.name ?? "";

  const overviewQuery = trpcReact.releases.orgOverview.useQuery(
    { organizationId: orgId! },
    { enabled: !!orgId },
  );

  useEffect(() => {
    if (orgsQuery.data && orgsQuery.data.length === 0)
      router.push("/onboarding");
  }, [orgsQuery.data, router]);

  const loading = orgsQuery.isLoading || (!!orgId && overviewQuery.isLoading);
  const error =
    orgsQuery.error?.message ?? overviewQuery.error?.message ?? null;
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
        <div>
          <strong>Readiness could not be loaded</strong>
          <p>{error}</p>
        </div>
      </div>
    );
  if (!overview)
    return (
      <div className="workspace-loading" role="status">
        <p>
          Preparing your workspace. If you are not redirected, continue to{" "}
          <Link href="/onboarding">onboarding</Link>.
        </p>
      </div>
    );

  const { projects, summary } = overview;
  const activeReleaseCount = summary.ready + summary.atRisk + summary.blocked;
  const readyPercent =
    activeReleaseCount > 0 ? (summary.ready / activeReleaseCount) * 100 : 0;
  const readinessDistribution = [
    { label: "Ready", value: summary.ready, tone: "success" as const },
    { label: "At risk", value: summary.atRisk, tone: "warning" as const },
    { label: "Blocked", value: summary.blocked, tone: "danger" as const },
    {
      label: "No release",
      value: summary.noActiveRelease,
      tone: "neutral" as const,
    },
  ];

  return (
    <div className="quality-workspace">
      <PageHeading
        eyebrow={`WORKSPACE / ${orgName.toUpperCase()}`}
        title="Release readiness"
        description="The latest in-flight release across every project, with blockers kept visible."
        actions={
          <Link className="btn-primary" href="/projects">
            View projects <Icon name="arrow" size={16} />
          </Link>
        }
      />

      {projects.length === 0 ? (
        <section className="workspace-panel">
          <EmptyState
            title="No projects yet"
            action={
              <Link className="btn-primary" href="/projects">
                Create a project
              </Link>
            }
          >
            Add a project to start connecting cases, execution evidence, and
            release decisions.
          </EmptyState>
        </section>
      ) : (
        <>
          <section
            className="workspace-panel readiness-command"
            aria-labelledby="readiness-command-title"
          >
            <div className="readiness-command-score">
              {activeReleaseCount > 0 ? (
                <ScoreRing value={readyPercent} label="Active releases ready" />
              ) : (
                <div
                  className="readiness-unmeasured"
                  role="img"
                  aria-label="Readiness is not measured because no releases are active"
                >
                  <strong>—</strong>
                  <span>not measured</span>
                </div>
              )}
              <div>
                <p className="section-label">WORKSPACE SIGNAL</p>
                <h2 id="readiness-command-title">
                  {activeReleaseCount === 0
                    ? "No release decision is being tracked"
                    : summary.blocked > 0
                      ? `${summary.blocked} release${summary.blocked === 1 ? " is" : "s are"} blocked`
                      : summary.atRisk > 0
                        ? `${summary.atRisk} release${summary.atRisk === 1 ? " needs" : "s need"} attention`
                        : "Every active release is ready"}
                </h2>
                <p>
                  {activeReleaseCount === 0
                    ? "Create a release for a project to turn test evidence, acceptance criteria, and risk flags into a go/no-go signal."
                    : `${summary.ready} of ${activeReleaseCount} active releases are currently ready to ship.`}
                </p>
              </div>
            </div>
            <div className="readiness-command-chart">
              <DistributionBar
                segments={readinessDistribution}
                label="Workspace release readiness distribution"
              />
            </div>
          </section>

          <section
            className="project-health-board"
            aria-labelledby="project-health-title"
          >
            <div className="panel-heading project-health-heading">
              <div>
                <h2 id="project-health-title">Project health</h2>
                <p className="panel-description">
                  The current release decision for every project
                </p>
              </div>
              <span className="quiet-label">
                {projects.length}{" "}
                {projects.length === 1 ? "project" : "projects"}
              </span>
            </div>
            <div className="project-health-grid">
              {projects.map((project) => (
                <article
                  key={project.projectId}
                  className={`project-health-card${project.release ? "" : " is-untracked"}`}
                >
                  <div className="project-health-title">
                    <span className="project-symbol">
                      <Icon name="folder" size={20} />
                    </span>
                    <div>
                      <Link href={`/projects/${project.projectId}`}>
                        {project.projectName}
                      </Link>
                      <small>
                        {project.release
                          ? project.release.name
                          : "No active release"}
                      </small>
                    </div>
                  </div>
                  {project.release ? (
                    <>
                      <div className="project-health-status">
                        <StatusPill
                          tone={
                            project.release.readiness.label === "READY"
                              ? "success"
                              : project.release.readiness.label === "BLOCKED"
                                ? "danger"
                                : "warning"
                          }
                        >
                          {project.release.status.replaceAll("_", " ")}
                        </StatusPill>
                        <ReadinessBadge
                          score={project.release.readiness.score}
                          label={project.release.readiness.label}
                        />
                      </div>
                      <Link
                        className="text-button"
                        href={`/projects/${project.projectId}/releases/${project.release.id}`}
                      >
                        Review release <Icon name="arrow" size={14} />
                      </Link>
                    </>
                  ) : (
                    <div className="project-health-empty">
                      <div
                        className="project-health-empty-mark"
                        aria-hidden="true"
                      >
                        <Icon name="release" size={22} />
                      </div>
                      <p>
                        Readiness is invisible until this project has a release
                        target.
                      </p>
                      <Link
                        className="btn-primary"
                        href={`/projects/${project.projectId}/releases`}
                      >
                        Set up release <Icon name="arrow" size={14} />
                      </Link>
                    </div>
                  )}
                </article>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
