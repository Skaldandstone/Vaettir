"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { trpc, type RouterOutputs } from "@/lib/trpc";

export default function ProjectOverviewPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [project, setProject] = useState<RouterOutputs["project"]["byId"] | null>(null);
  const [testCaseCount, setTestCaseCount] = useState<number | null>(null);
  const [testPlanCount, setTestPlanCount] = useState<number | null>(null);
  const [requirementCount, setRequirementCount] = useState<number | null>(null);
  const [pendingReviewCount, setPendingReviewCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    Promise.all([
      trpc.project.byId.query({ id: projectId }),
      trpc.testCases.list.query({ projectId }),
      trpc.testPlans.list.query({ projectId }),
      trpc.requirements.list.query({ projectId }),
      trpc.testCases.pendingReview.query({ projectId }),
    ])
      .then(([proj, cases, plans, reqs, pending]) => {
        setProject(proj);
        setTestCaseCount(cases.length);
        setTestPlanCount(plans.length);
        setRequirementCount(reqs.length);
        setPendingReviewCount(pending.length);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [projectId]);

  if (error) return <p style={{ color: "var(--ember)" }}>{error}</p>;
  if (!project) return <p>Loading…</p>;

  return (
    <div>
      <h1 style={{ marginBottom: 2 }}>{project.name}</h1>
      <p className="text-muted" style={{ marginBottom: 24 }}>
        {project.repoUrl ?? "No repo connected"} {project.repoUrl && <>· branch {project.defaultBranch}</>}
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 16, marginBottom: 32 }}>
        <a href={`/projects/${projectId}/test-cases`} className="panel" style={{ display: "block" }}>
          <div className="eyebrow">Test Cases</div>
          <div style={{ fontSize: 28, fontFamily: "Fraunces, serif" }}>{testCaseCount}</div>
        </a>
        <a href={`/projects/${projectId}/test-plans`} className="panel" style={{ display: "block" }}>
          <div className="eyebrow">Test Plans</div>
          <div style={{ fontSize: 28, fontFamily: "Fraunces, serif" }}>{testPlanCount}</div>
        </a>
        <a href={`/projects/${projectId}/requirements`} className="panel" style={{ display: "block" }}>
          <div className="eyebrow">Requirements</div>
          <div style={{ fontSize: 28, fontFamily: "Fraunces, serif" }}>{requirementCount}</div>
        </a>
        <a
          href={`/projects/${projectId}/test-cases/review`}
          className="panel"
          style={{ display: "block", borderColor: pendingReviewCount ? "var(--ember)" : undefined }}
        >
          <div className="eyebrow">Pending Review</div>
          <div style={{ fontSize: 28, fontFamily: "Fraunces, serif", color: pendingReviewCount ? "var(--ember)" : undefined }}>
            {pendingReviewCount}
          </div>
        </a>
      </div>

      {testCaseCount === 0 && (
        <div className="panel">
          <p style={{ marginBottom: project.repoUrl ? 12 : 0 }}>No test cases tracked yet.</p>
          {project.repoUrl ? (
            <a className="btn-primary" href={`/projects/${projectId}/reverse-engineer`}>
              Scan {project.repoUrl}
            </a>
          ) : (
            <p className="text-muted" style={{ fontSize: 13 }}>
              Connect a repo on <a href="/projects">the projects page</a> and scan it, or author a test case manually.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
