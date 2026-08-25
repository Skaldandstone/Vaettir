"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { trpc, type RouterOutputs } from "../../lib/trpc";

function TestCasesPageInner() {
  const searchParams = useSearchParams();
  const [projectId, setProjectId] = useState(searchParams.get("projectId") ?? "");
  const [cases, setCases] = useState<RouterOutputs["testCases"]["list"]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    trpc.testCases.list
      .query({ projectId })
      .then(setCases)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [projectId]);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h1>Test Cases</h1>
        <div style={{ display: "flex", gap: 16 }}>
          {projectId && <a href={`/test-cases/review?projectId=${projectId}`}>Review queue</a>}
          <a href="/test-cases/new">+ New test case</a>
        </div>
      </div>
      <label>
        Project ID:{" "}
        <input value={projectId} onChange={(e) => setProjectId(e.target.value)} placeholder="paste a project id" />
      </label>
      {loading && <p>Loading…</p>}
      {error && <p style={{ color: "var(--ember)" }}>{error}</p>}
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
