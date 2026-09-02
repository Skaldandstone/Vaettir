"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { trpc, type RouterOutputs } from "../../lib/trpc";
import { ReadinessBadge } from "../../components/ReadinessBadge";
import { RecoveryMessage } from "../../components/RecoveryMessage";
import {
  EmptyState,
  Icon,
  MetricCard,
  PageHeading,
} from "../../components/ui/Workspace";

export default function OrgDashboardPage() {
  const router = useRouter();
  const [orgName, setOrgName] = useState("");
  const [overview, setOverview] = useState<
    RouterOutputs["releases"]["orgOverview"] | null
  >(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    trpc.organization.mine
      .query()
      .then(async (orgs) => {
        if (!active) return;
        const org = orgs[0];
        if (!org) {
          router.push("/onboarding");
          return;
        }
        setOrgName(org.name);
        const result = await trpc.releases.orgOverview.query({
          organizationId: org.id,
        });
        if (active) setOverview(result);
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [router, attempt]);

  if (loading)
    return (
      <div className="workspace-loading" role="status">
        <h2>Loading your quality overview</h2>
        <p>Checking your workspace and its current releases.</p>
      </div>
    );
  if (error)
    return (
      <div className="workspace-panel review-workspace">
        <h1>Your workspace couldn’t be loaded</h1>
        <RecoveryMessage
          error={error}
          onRetry={() => setAttempt((value) => value + 1)}
        />
      </div>
    );
  if (!overview)
    return (
      <EmptyState
        title="Let’s find your workspace"
        action={
          <Link href="/onboarding" className="btn-primary">
            Continue to onboarding <Icon name="arrow" size={16} />
          </Link>
        }
      >
        You don’t belong to an organization yet. Continue with your beta
        invitation to get started.
      </EmptyState>
    );

  const { projects, summary } = overview;
  return (
    <div className="quality-workspace">
      <PageHeading
        eyebrow={`WORKSPACE / ${orgName}`}
        title="Release overview"
        description="Every project’s most recent in-flight release, with evidence behind the decision."
        actions={
          <Link className="btn-primary" href="/projects">
            Open projects <Icon name="arrow" size={16} />
          </Link>
        }
      />
      <div className="metric-grid">
        <MetricCard
          icon="check"
          label="Ready"
          value={summary.ready}
          note="Release gates satisfied"
          tone="success"
        />
        <MetricCard
          icon="alert"
          label="At risk"
          value={summary.atRisk}
          note="Review before sign-off"
          tone="warning"
        />
        <MetricCard
          icon="release"
          label="Blocked"
          value={summary.blocked}
          note="Resolve the outstanding gates"
          tone="danger"
        />
        <MetricCard
          icon="clock"
          label="No active release"
          value={summary.noActiveRelease}
          note="Projects without an in-flight release"
        />
      </div>
      <section
        className="workspace-panel case-library"
        aria-labelledby="project-readiness-title"
      >
        <div className="panel-heading">
          <div>
            <h2 id="project-readiness-title">Project readiness</h2>
            <p className="panel-description">
              Live project data from {orgName}. Select a release to inspect its
              gates.
            </p>
          </div>
          <span className="quiet-label">{projects.length} projects</span>
        </div>
        {projects.length ? (
          <div className="table-scroll">
            <table className="workspace-table">
              <caption className="sr-only">
                Project releases and readiness scores
              </caption>
              <thead>
                <tr>
                  <th scope="col">Project</th>
                  <th scope="col">Current release</th>
                  <th scope="col">Release status</th>
                  <th scope="col">Readiness</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((project) => (
                  <tr key={project.projectId}>
                    <td>
                      <Link
                        className="project-name-link"
                        href={`/projects/${project.projectId}`}
                      >
                        <Icon name="folder" size={17} />
                        {project.projectName}
                      </Link>
                    </td>
                    <td>
                      {project.release ? (
                        <Link
                          href={`/projects/${project.projectId}/releases/${project.release.id}`}
                        >
                          {project.release.name}
                        </Link>
                      ) : (
                        <span className="text-muted">No in-flight release</span>
                      )}
                    </td>
                    <td>
                      <span className="quiet-label">
                        {project.release?.status.replaceAll("_", " ") ??
                          "Not scheduled"}
                      </span>
                    </td>
                    <td>
                      {project.release ? (
                        <ReadinessBadge
                          score={project.release.readiness.score}
                          label={project.release.readiness.label}
                        />
                      ) : (
                        <span className="text-muted">Not evaluated</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="Your quality workspace starts with a project"
            action={
              <Link href="/projects" className="btn-primary">
                Go to projects <Icon name="arrow" size={16} />
              </Link>
            }
          >
            Create a project or ask a workspace editor to add one. Its release
            readiness will appear here.
          </EmptyState>
        )}
        <div className="table-footer">
          <span>
            Readiness scores are calculated from recorded project evidence.
          </span>
          <Link href="/beta-guide">How to get started</Link>
        </div>
      </section>
    </div>
  );
}
