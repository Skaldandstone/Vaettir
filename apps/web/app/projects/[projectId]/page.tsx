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
  const [connectRepoUrl, setConnectRepoUrl] = useState("");
  const [connecting, setConnecting] = useState(false);

  function load() {
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
  }

  useEffect(load, [projectId]);

  async function connectRepo() {
    if (!project || !connectRepoUrl.trim()) return;
    setConnecting(true);
    setError(null);
    try {
      await trpc.project.update.mutate({
        id: project.id,
        name: project.name,
        repoUrl: connectRepoUrl.trim(),
        defaultBranch: project.defaultBranch,
      });
      setConnectRepoUrl("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setConnecting(false);
    }
  }

  if (error) return <p style={{ color: "var(--ember)" }}>{error}</p>;
  if (!project) return <p>Loading…</p>;

  return (
    <div>
      <h1 style={{ marginBottom: 2 }}>{project.name}</h1>
      <p className="text-muted" style={{ marginBottom: project.repoUrl ? 24 : 8 }}>
        {project.repoUrl ?? "No repo connected"} {project.repoUrl && <>· branch {project.defaultBranch}</>}
      </p>

      {!project.repoUrl && (
        <div className="panel" style={{ marginBottom: 24, borderColor: "var(--frost)" }}>
          <strong>Connect a GitHub repo</strong>
          <p className="text-muted" style={{ fontSize: 13, margin: "4px 0 10px" }}>
            Lets you scan the repo to reverse-engineer test cases, run PR scanning, and link test cases back to real
            source files.
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={connectRepoUrl}
              onChange={(e) => setConnectRepoUrl(e.target.value)}
              placeholder="https://github.com/org/repo"
              style={{ flex: 1 }}
            />
            <button className="btn-primary" onClick={connectRepo} disabled={connecting || !connectRepoUrl.trim()}>
              {connecting ? "Connecting…" : "Connect"}
            </button>
          </div>
        </div>
      )}

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
              Connect a repo above and scan it, or{" "}
              <a href={`/projects/${projectId}/test-cases/new`}>author a test case manually</a>.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
