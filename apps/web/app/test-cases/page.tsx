"use client";

import { useEffect, useState } from "react";
import { trpc, type RouterOutputs } from "../../lib/trpc";

export default function TestCasesPage() {
  const [projectId, setProjectId] = useState("");
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
      <h1>Test Cases</h1>
      <label>
        Project ID:{" "}
        <input value={projectId} onChange={(e) => setProjectId(e.target.value)} placeholder="paste a project id" />
      </label>
      {loading && <p>Loading…</p>}
      {error && <p style={{ color: "crimson" }}>{error}</p>}
      <ul>
        {cases.map((tc) => (
          <li key={tc.id}>
            <a href={`/test-cases/${tc.id}`}>{tc.title}</a>{" "}
            <small>
              [{tc.testType}] {tc.origin === "AI_REVERSE_ENGINEERED" ? "🤖 AI-reversed" : ""}
            </small>
          </li>
        ))}
      </ul>
    </div>
  );
}
