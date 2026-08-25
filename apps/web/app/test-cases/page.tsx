"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { trpc, type RouterOutputs } from "../../lib/trpc";

function TestCasesPageInner() {
  const searchParams = useSearchParams();
  const [projectId, setProjectId] = useState(searchParams.get("projectId") ?? "");
  const [project, setProject] = useState<RouterOutputs["project"]["byId"] | null>(null);
  const [cases, setCases] = useState<RouterOutputs["testCases"]["list"]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) {
      setProject(null);
      return;
    }
    setLoading(true);
    setError(null);
    Promise.all([trpc.project.byId.query({ id: projectId }), trpc.testCases.list.query({ projectId })])
      .then(([proj, list]) => {
        setProject(proj);
        setCases(list);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [projectId]);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ marginBottom: 2 }}>{project ? `${project.name} — Test Cases` : "Test Cases"}</h1>
          {project && (
            <p className="text-muted" style={{ margin: 0, fontSize: 13 }}>
              {project.repoUrl ?? "No repo connected"}
            </p>
          )}
        </div>
        <div style={{ display: "flex", gap: 16 }}>
          {projectId && <a href={`/test-cases/review?projectId=${projectId}`}>Review queue</a>}
          <a href="/test-cases/new">+ New test case</a>
        </div>
      </div>

      {!projectId && (
        <label>
          Project ID:{" "}
          <input value={projectId} onChange={(e) => setProjectId(e.target.value)} placeholder="paste a project id" />
        </label>
      )}
      {projectId && (
        <p className="text-muted-dim" style={{ fontSize: 12 }}>
          <a href="/projects">&larr; All projects</a>
        </p>
      )}

      {loading && <p>Loading…</p>}
      {error && <p style={{ color: "var(--ember)" }}>{error}</p>}

      {!loading && !error && projectId && cases.length === 0 && (
        <div className="panel">
          <p style={{ marginBottom: project?.repoUrl ? 12 : 0 }}>No test cases tracked for this project yet.</p>
          {project?.repoUrl ? (
            <>
              <p className="text-muted" style={{ fontSize: 13 }}>
                Connecting a repo doesn&apos;t scan it automatically — reverse-engineer its test files to populate this
                list.
              </p>
              <a className="btn-primary" href={`/reverse-engineer?projectId=${projectId}`}>
                Scan {project.repoUrl}
              </a>
            </>
          ) : (
            <p className="text-muted" style={{ fontSize: 13 }}>
              Connect a repo on the <a href="/projects">project settings</a> page and scan it, or{" "}
              <a href="/test-cases/new">author a test case manually</a>.
            </p>
          )}
        </div>
      )}

      <ul>
        {cases.map((tc) => (
          <li key={tc.id}>
            <a href={`/test-cases/${tc.id}`}>{tc.title}</a>{" "}
            <small>
              [{tc.testType}] {tc.origin === "AI_REVERSE_ENGINEERED" ? "🤖 AI-reversed" : ""}
              {tc.reviewStatus === "PENDING_REVIEW" && " ⏳ pending review"}
              {tc.reviewStatus === "REJECTED" && " ❌ rejected"}
            </small>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function TestCasesPage() {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <TestCasesPageInner />
    </Suspense>
  );
}
