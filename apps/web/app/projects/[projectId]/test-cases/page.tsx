"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { TestCaseTree, filterCasesByPath } from "@/components/TestCaseTree";

export default function TestCasesPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [project, setProject] = useState<RouterOutputs["project"]["byId"] | null>(null);
  const [cases, setCases] = useState<RouterOutputs["testCases"]["list"]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
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

  const visibleCases = filterCasesByPath(cases, selectedPath);

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
          <a href={`/projects/${projectId}/test-cases/review`}>Review queue</a>
          <a href={`/projects/${projectId}/test-cases/new`}>+ New test case</a>
        </div>
      </div>

      {loading && <p>Loading…</p>}
      {error && <p style={{ color: "var(--ember)" }}>{error}</p>}

      {!loading && !error && cases.length === 0 && (
        <div className="panel">
          <p style={{ marginBottom: project?.repoUrl ? 12 : 0 }}>No test cases tracked for this project yet.</p>
          {project?.repoUrl ? (
            <>
              <p className="text-muted" style={{ fontSize: 13 }}>
                Connecting a repo doesn&apos;t scan it automatically — reverse-engineer its test files to populate this
                list.
              </p>
              <a className="btn-primary" href={`/projects/${projectId}/reverse-engineer`}>
                Scan {project.repoUrl}
              </a>
            </>
          ) : (
            <p className="text-muted" style={{ fontSize: 13 }}>
              Connect a repo on the <a href="/projects">project settings</a> page and scan it, or{" "}
              <a href={`/projects/${projectId}/test-cases/new`}>author a test case manually</a>.
            </p>
          )}
        </div>
      )}

      {!loading && !error && cases.length > 0 && (
        <div className="test-case-layout">
          <TestCaseTree cases={cases} selectedPath={selectedPath} onSelect={setSelectedPath} />
          <div className="test-case-list">
            <ul>
              {visibleCases.map((tc) => (
                <li key={tc.id}>
                  <a href={`/projects/${projectId}/test-cases/${tc.id}`}>{tc.title}</a>{" "}
                  <small>
                    [{tc.testType}] {tc.origin === "AI_REVERSE_ENGINEERED" ? "🤖 AI-reversed" : ""}
                    {tc.reviewStatus === "PENDING_REVIEW" && " ⏳ pending review"}
                    {tc.reviewStatus === "REJECTED" && " ❌ rejected"}
                  </small>
                </li>
              ))}
              {visibleCases.length === 0 && <p className="text-muted">No test cases in this folder.</p>}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
