"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { Drawer } from "@/components/Drawer";
import { TestCaseDetailContent } from "@/components/TestCaseDetailContent";

export default function ReviewQueuePage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [queue, setQueue] = useState<RouterOutputs["testCases"]["pendingReview"]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openCaseId, setOpenCaseId] = useState<string | null>(null);

  function load() {
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

  return (
    <div style={{ maxWidth: 720 }}>
      <a href={`/projects/${projectId}/test-cases`}>&larr; Test cases</a>
      <h1>Review queue</h1>
      <p style={{ color: "var(--muted)" }}>
        AI-reverse-engineered test cases awaiting approval, lowest confidence first.
      </p>
      {loading && <p>Loading…</p>}
      {error && <p style={{ color: "var(--ember)" }}>{error}</p>}
      {!loading && queue.length === 0 && <p style={{ color: "var(--muted)" }}>Nothing pending review.</p>}
      <ul style={{ listStyle: "none", padding: 0 }}>
        {queue.map((tc) => (
          <li key={tc.id} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 12, marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <a
                href={`/projects/${projectId}/test-cases/${tc.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  setOpenCaseId(tc.id);
                }}
              >
                <strong>{tc.title}</strong>
              </a>
              {tc.confidence != null && (
                <span style={{ color: tc.confidence < 0.6 ? "var(--ember)" : "var(--muted-dim)" }}>
                  {(tc.confidence * 100).toFixed(0)}% confidence
                </span>
              )}
            </div>
            {tc.sourceFilePath && <div style={{ color: "var(--muted-dim)", fontSize: 13 }}>{tc.sourceFilePath}</div>}
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

      <Drawer open={openCaseId !== null} onClose={() => setOpenCaseId(null)}>
        {openCaseId && <TestCaseDetailContent id={openCaseId} projectId={projectId} onChanged={load} />}
      </Drawer>
    </div>
  );
}
