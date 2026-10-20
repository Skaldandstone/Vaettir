"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { ModularWorkspace } from "@/components/ui/ModularWorkspace";
import { IconButton } from "@/components/ui/IconButton";
import { Icon } from "@/components/ui/Workspace";
import { useParams } from "next/navigation";
import { trpcReact } from "@/lib/trpcReact";
import { useProjectPermissions } from "@/lib/use-project-permissions";
import { useCaseReviewQueue } from "@/lib/use-case-review-queue";
import { RepositoryReleaseDiscovery } from "@/components/RepositoryReleaseDiscovery";
import { ProductionSignalChips } from "@/components/ProductionSignalChips";
import { ProjectPopulationModal } from "@/components/ProjectPopulationModal";
import { ProjectRepositorySummary } from "@/components/ProjectRepositorySummary";
import { ProjectCaseKey } from "@/components/ProjectCaseKey";
import { TestTypeDistribution } from "@/components/TestTypeDistribution";
import {
  QualityExperienceSummary,
  QualityExperienceWizard,
} from "@/components/QualityExperienceWizard";

// P1-15
export default function ProjectOverviewPage() {
  const { userId } = useAuth();
  const [populationOpen, setPopulationOpen] = useState(false);
  const [experienceOpen, setExperienceOpen] = useState(false);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("setup") !== "1")
      return;
    setPopulationOpen(true);
    window.history.replaceState(null, "", window.location.pathname);
  }, []);
  const { projectId } = useParams<{ projectId: string }>();
  const { canEdit } = useProjectPermissions(projectId);

  const projectQuery = trpcReact.project.byId.useQuery({ id: projectId });
  const testCasesQuery = trpcReact.testCases.list.useQuery({ projectId });
  const testPlansQuery = trpcReact.testPlans.list.useQuery({ projectId });
  const requirementsQuery = trpcReact.requirements.list.useQuery({ projectId });
  const pendingReviewQueue = useCaseReviewQueue(projectId);

  const project = projectQuery.data;
  const testCaseCount = testCasesQuery.data?.length ?? null;
  const testPlanCount = testPlansQuery.data?.length ?? null;
  const requirementCount = requirementsQuery.data?.length ?? null;
  const pendingReviewCount = pendingReviewQueue.fresh?.totalPending ?? null;
  const error =
    projectQuery.error?.message ?? testCasesQuery.error?.message ?? null;

  if (error) return <p style={{ color: "var(--ember)" }}>{error}</p>;
  if (!project) return <p>Loading…</p>;

  return (
    <div className="project-overview-workbench">
      <header className="overview-heading"><div><p className="workspace-eyebrow">Project overview</p><h1>{project.name}</h1>
      <ProjectCaseKey projectId={projectId} canEdit={canEdit} />
      </div><div className="workspace-toolbar">
      {canEdit && (
        <button
          className="btn-secondary"
          onClick={() => setPopulationOpen(true)}
        >
          <Icon name="plus" size={16} /> Add sources
        </button>
      )}
      {canEdit && (
        <IconButton
          icon="settings"
          label="Customize testing workflow"
          aria-haspopup="dialog"
          onClick={() => setExperienceOpen(true)}
        />
      )}
      </div></header>
      <QualityExperienceWizard
        key={projectId}
        projectId={projectId}
        open={experienceOpen}
        onClose={() => setExperienceOpen(false)}
      />
      {canEdit && populationOpen && (
        <ProjectPopulationModal
          projectId={projectId}
          onClose={() => setPopulationOpen(false)}
        />
      )}
      <nav className="overview-inventory" aria-label="Project inventory">
        {([
          ["cases", "Test cases", "test-cases", testCaseCount],
          ["check", "Plans", "test-plans", testPlanCount],
          ["book", "Requirements", "requirements", requirementCount],
          ["clock", "For review", "test-cases/review", pendingReviewCount],
        ] as const).map(([icon, label, path, count]) => <a key={path} href={`/projects/${projectId}/${path}`}>
          <Icon name={icon} /><span>{label}</span><strong>{count ?? "—"}</strong><Icon name="arrow" size={14} />
        </a>)}
      </nav>
      <ModularWorkspace scope={userId ? `${userId}:${projectId}` : null} name="Project overview" panels={[
      { id: "inventory", title: "Testing at a glance", content: <>
        {project.qualityProfile.objective && <p>{project.qualityProfile.objective}</p>}
        {testCasesQuery.isLoading ? (
          <p>Loading test inventory…</p>
        ) : testCaseCount ? (
          <>
            <TestTypeDistribution cases={testCasesQuery.data ?? []} />
          </>
        ) : (
          <p>
            No test inventory yet. Import existing cases or create the first
            case to begin.
          </p>
        )}
        <p>
          {pendingReviewCount == null
            ? "Review queue loading…"
            : pendingReviewCount > 0
              ? `${pendingReviewCount} drafted cases need human review before use.`
              : "No cases currently awaiting review."}
        </p>
        <a href={`/projects/${projectId}/releases`}>
          Release readiness →
        </a>
      </> },
      { id: "context", title: "Testing context", content: <QualityExperienceSummary projectId={projectId} /> },
      { id: "repositories", title: "Repositories", content: <ProjectRepositorySummary projectId={projectId} /> },
      { id: "signals", title: "Production signals", content: <div className="project-connection-chips" id="project-connections" aria-label="Production signal routing"><ProductionSignalChips projectId={projectId} /></div> },
      { id: "releases", title: "Repository releases", wide: true, content: <RepositoryReleaseDiscovery projectId={projectId} /> },
      ]} />

      {testCaseCount === 0 && (
        <div className="panel">
          <p style={{ marginBottom: project.repoUrl ? 12 : 0 }}>
            No test cases tracked yet.
          </p>
          {!canEdit ? (
            <p className="text-muted">
              Ask your team owner or an editor to add test cases.
            </p>
          ) : project.repoUrl ? (
            <a
              className="btn-primary"
              href={`/projects/${projectId}/reverse-engineer`}
            >
              Review legacy repository source
            </a>
          ) : (
            <p className="text-muted" style={{ fontSize: 13 }}>
              <a href={`/projects/${encodeURIComponent(projectId)}/settings/integrations`}>Connect a repository in project integrations</a>, then review its source scope, or{" "}
              <a href={`/projects/${projectId}/test-cases/new`}>
                author a test case manually
              </a>
              .
            </p>
          )}
        </div>
      )}
    </div>
  );
}
