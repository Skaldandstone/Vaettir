"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { trpc, type RouterOutputs } from "../../../lib/trpc";

function ReviewQueueInner() {
  const searchParams = useSearchParams();
  const [projectId] = useState(searchParams.get("projectId") ?? "");
  const [queue, setQueue] = useState<RouterOutputs["testCases"]["pendingReview"]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function load() {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    trpc.testCases.pendingReview
      .query({ projectId })
      .then(setQueue)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }

  useEffect(load, [projectId]);

  async function decide(id: string, decision: "approve" | "reject") {
    setBusyId(id);
    setError(null);
    try {
      await trpc.testCases[decision].mutate({ id });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  if (!projectId) return <p>Missing project id.</p>;

  return (
    <div style={{ maxWidth: 720 }}>
      <a href={`/test-cases?projectId=${projectId}`}>&larr; Test cases</a>
      <h1>Review queue</h1>
      <p style={{ color: "#666" }}>
        AI-reverse-engineered test cases awaiting approval, lowest confidence first.
      </p>
      {loading && <p>Loading…</p>}
      {error && <p style={{ color: "crimson" }}>{error}</p>}
      {!loading && queue.length === 0 && <p style={{ color: "#666" }}>Nothing pending review.</p>}
      <ul style={{ listStyle: "none", padding: 0 }}>
        {queue.map((tc) => (
          <li key={tc.id} style={{ border: "1px solid #e5e5e5", borderRadius: 8, padding: 12, marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <a href={`/test-cases/${tc.id}`}>
                <strong>{tc.title}</strong>
              </a>
              {tc.confidence != null && (
                <span style={{ color: tc.confidence < 0.6 ? "crimson" : "#888" }}>
                  {(tc.confidence * 100).toFixed(0)}% confidence
                </span>
              )}
            </div>
            {tc.sourceFilePath && <div style={{ color: "#888", fontSize: 13 }}>{tc.sourceFilePath}</div>}
            <div style={{ marginTop: 8 }}>
              <button onClick={() => decide(tc.id, "approve")} disabled={busyId === tc.id} style={{ marginRight: 8 }}>
                Approve
              </button>
              <button onClick={() => decide(tc.id, "reject")} disabled={busyId === tc.id}>
                Reject
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function ReviewQueuePage() {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <ReviewQueueInner />
    </Suspense>
  );
}
