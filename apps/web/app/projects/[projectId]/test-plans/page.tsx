"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { trpc, type RouterOutputs } from "@/lib/trpc";

export default function TestPlansPage() {
  const { projectId } = useParams<{ projectId: string }>();
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

  function loadPlans() {
    setLoading(true);
    setError(null);
    trpc.testPlans.list
      .query({ projectId })
      .then(setPlans)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }

  useEffect(loadPlans, [projectId]);

  async function submit() {
    if (!testPlanTypeId) return;
    setCreating(true);
    setError(null);
    try {
      await trpc.testPlans.create.mutate({ projectId, testPlanTypeId, name });
      setName("");
      loadPlans();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      <h1>Test Plans</h1>

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

      {loading && <p>Loading…</p>}
      {error && <p style={{ color: "var(--ember)" }}>{error}</p>}
      <ul>
        {plans.map((p) => (
          <li key={p.id}>
            <a href={`/projects/${projectId}/test-plans/${p.id}`}>{p.name}</a>{" "}
            <small>
              [{p.testPlanType.name}] {p.status} — {p.acceptanceCriteria.length} acceptance criteria
            </small>
          </li>
        ))}
        {!loading && plans.length === 0 && <p style={{ color: "var(--muted)" }}>No test plans yet.</p>}
      </ul>
    </div>
  );
}
