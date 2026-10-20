"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { ModularWorkspace } from "@/components/ui/ModularWorkspace";
import { IconButton } from "@/components/ui/IconButton";
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
    <div>
      <h1 style={{ marginBottom: 2 }}>{project.name}</h1>
      <ProjectCaseKey projectId={projectId} canEdit={canEdit} />
      {canEdit && (
        <button
          className="btn-secondary"
          onClick={() => setPopulationOpen(true)}
        >
          Add sources
        </button>
      )}
      {canEdit && (
        <IconButton
          icon="settings"
          label="Customize testing workflow"
          aria-haspopup="dialog"
          style={{ marginLeft: 8, marginTop: 8 }}
          onClick={() => setExperienceOpen(true)}
        />
      )}
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
      <ModularWorkspace scope={userId ? `${userId}:${projectId}` : null} name="Project overview" panels={[
      { id: "inventory", title: "Testing at a glance", content: <>
        <p>
          {project.qualityProfile.objective ||
            "Define your project’s objective, then connect requirements, tests and release evidence."}
        </p>
        {testCasesQuery.isLoading ? (
          <p>Loading test inventory…</p>
        ) : testCaseCount ? (
          <>
            <p className="text-muted">{testCaseCount} cases · Inventory, not release readiness</p>
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

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 16,
          marginBottom: 32,
        }}
      >
        <a
          href={`/projects/${projectId}/test-cases`}
          className="panel"
          style={{ display: "block" }}
        >
          <div className="eyebrow">Test Cases</div>
          <div style={{ fontSize: 28, fontFamily: "Fraunces, serif" }}>
            {testCaseCount}
          </div>
        </a>
        <a
          href={`/projects/${projectId}/test-plans`}
          className="panel"
          style={{ display: "block" }}
        >
          <div className="eyebrow">Test Plans</div>
          <div style={{ fontSize: 28, fontFamily: "Fraunces, serif" }}>
            {testPlanCount}
          </div>
        </a>
        <a
          href={`/projects/${projectId}/requirements`}
          className="panel"
          style={{ display: "block" }}
        >
          <div className="eyebrow">Requirements</div>
          <div style={{ fontSize: 28, fontFamily: "Fraunces, serif" }}>
            {requirementCount}
          </div>
        </a>
        <a
          href={`/projects/${projectId}/test-cases/review`}
          className="panel"
          style={{
            display: "block",
            borderColor: pendingReviewCount ? "var(--ember)" : undefined,
          }}
        >
          <div className="eyebrow">Pending Review</div>
          <div
            style={{
              fontSize: 28,
              fontFamily: "Fraunces, serif",
              color: pendingReviewCount ? "var(--ember)" : undefined,
            }}
          >
            {pendingReviewCount ?? "Verifying…"}
          </div>
        </a>
      </div>

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
