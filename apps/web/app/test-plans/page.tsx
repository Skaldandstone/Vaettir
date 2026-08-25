"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { trpc, type RouterOutputs } from "../../lib/trpc";

function TestPlansPageInner() {
  const searchParams = useSearchParams();
  const [projectId, setProjectId] = useState(searchParams.get("projectId") ?? "");
  const [plans, setPlans] = useState<RouterOutputs["testPlans"]["list"]>([]);
  const [types, setTypes] = useState<RouterOutputs["testPlans"]["types"]>([]);
  const [name, setName] = useState("");
  const [testPlanTypeId, setTestPlanTypeId] = useState("");
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    trpc.testPlans.types.query().then((t) => {
      setTypes(t);
      if (t[0]) setTestPlanTypeId(t[0].id);
    });
  }, []);

  function loadPlans(id: string) {
    setLoading(true);
    setError(null);
    trpc.testPlans.list
      .query({ projectId: id })
      .then(setPlans)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (!projectId) return;
    loadPlans(projectId);
  }, [projectId]);

  async function submit() {
    if (!projectId || !testPlanTypeId) return;
    setCreating(true);
    setError(null);
    try {
      await trpc.testPlans.create.mutate({ projectId, testPlanTypeId, name });
      setName("");
      loadPlans(projectId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      <h1>Test Plans</h1>
      <label>
        Project ID:{" "}
        <input value={projectId} onChange={(e) => setProjectId(e.target.value)} placeholder="paste a project id" />
      </label>

      {projectId && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "16px 0" }}>
          <select value={testPlanTypeId} onChange={(e) => setTestPlanTypeId(e.target.value)}>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Plan name" />
          <button onClick={submit} disabled={creating || !name}>
            {creating ? "Creating…" : "+ New test plan"}
          </button>
        </div>
      )}

      {loading && <p>Loading…</p>}
      {error && <p style={{ color: "var(--ember)" }}>{error}</p>}
      <ul>
        {plans.map((p) => (
          <li key={p.id}>
            <a href={`/test-plans/${p.id}`}>{p.name}</a>{" "}
            <small>
              [{p.testPlanType.name}] {p.status} — {p.acceptanceCriteria.length} acceptance criteria
            </small>
          </li>
        ))}
        {projectId && !loading && plans.length === 0 && <p style={{ color: "var(--muted)" }}>No test plans yet.</p>}
      </ul>
    </div>
  );
}

export default function TestPlansPage() {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <TestPlansPageInner />
    </Suspense>
  );
}
