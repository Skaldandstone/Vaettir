"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { trpcReact, type RouterOutputs } from "@/lib/trpcReact";

type ExecutionCase = RouterOutputs["manualExecution"]["getForExecution"]["cases"][number];

const STATUS_COLORS: Record<string, string> = {
  PASS: "var(--frost)",
  FAIL: "var(--ember)",
  BLOCKED: "var(--ember)",
  SKIP: "var(--muted)",
};

function CaseRow({
  testCase,
  stepFieldLabels,
  onRecord,
}: {
  testCase: ExecutionCase;
  stepFieldLabels: Record<string, string>;
  onRecord: (testCaseId: string, status: "PASS" | "FAIL" | "BLOCKED" | "SKIP", note: string) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [note, setNote] = useState(testCase.currentResult?.note ?? "");
  const [busy, setBusy] = useState(false);

  async function record(status: "PASS" | "FAIL" | "BLOCKED" | "SKIP") {
    setBusy(true);
    try {
      await onRecord(testCase.testCaseId, status, note);
    } finally {
      setBusy(false);
    }
  }

  const currentStatus = testCase.currentResult?.status ?? null;

  return (
    <div className="panel" style={{ marginBottom: 10, padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <button
          onClick={() => setExpanded((v) => !v)}
          style={{ background: "none", border: "none", cursor: "pointer", textAlign: "left", fontWeight: 600, padding: 0 }}
        >
          {expanded ? "▾" : "▸"} {testCase.title}
        </button>
        {currentStatus && (
          <span style={{ color: STATUS_COLORS[currentStatus] ?? "var(--muted)", fontSize: 12, fontWeight: 700 }}>
            {currentStatus}
          </span>
        )}
      </div>

      {expanded && (
        <div style={{ marginTop: 10, fontSize: 13 }}>
          {testCase.given.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div className="eyebrow" style={{ fontSize: 11 }}>Given</div>
              {testCase.given.map((l, i) => <div key={i}>{l}</div>)}
              <div className="eyebrow" style={{ fontSize: 11, marginTop: 4 }}>When</div>
              {testCase.when.map((l, i) => <div key={i}>{l}</div>)}
              <div className="eyebrow" style={{ fontSize: 11, marginTop: 4 }}>Then</div>
              {testCase.then.map((l, i) => <div key={i}>{l}</div>)}
            </div>
          )}
          {testCase.steps.length > 0 && (
            <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 8 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", fontSize: 11 }}>#</th>
                  <th style={{ textAlign: "left", fontSize: 11 }}>{stepFieldLabels.action ?? "Step"}</th>
                  <th style={{ textAlign: "left", fontSize: 11 }}>{stepFieldLabels.expectedActionOrData ?? "Expected action/data"}</th>
                  <th style={{ textAlign: "left", fontSize: 11 }}>{stepFieldLabels.expectedResult ?? "Expected result"}</th>
                </tr>
              </thead>
              <tbody>
                {testCase.steps.map((s) => (
                  <tr key={s.order}>
                    <td>{s.order}</td>
                    <td>{s.action}</td>
                    <td>{s.expectedActionOrData ?? "—"}</td>
                    <td>{s.expectedResult ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What actually happened (optional)…"
            style={{ width: "100%", marginBottom: 8 }}
          />
        </div>
      )}

      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        <button className="btn-secondary" onClick={() => record("PASS")} disabled={busy}>Pass</button>
        <button className="btn-secondary" onClick={() => record("FAIL")} disabled={busy}>Fail</button>
        <button className="btn-secondary" onClick={() => record("BLOCKED")} disabled={busy}>Blocked</button>
        <button className="btn-secondary" onClick={() => record("SKIP")} disabled={busy}>Skip</button>
      </div>
    </div>
  );
}

// P1-15
export default function ManualExecutionPage() {
  const { projectId, testRunId } = useParams<{ projectId: string; testRunId: string }>();
  const router = useRouter();
  const utils = trpcReact.useUtils();
  const dataQuery = trpcReact.manualExecution.getForExecution.useQuery({ testRunId });
  const [error, setError] = useState<string | null>(null);

  const recordMutation = trpcReact.manualExecution.recordResult.useMutation();
  const completeMutation = trpcReact.manualExecution.complete.useMutation({
    onSuccess: () => router.push(`/projects/${projectId}/test-runs`),
    onError: (e) => setError(e.message),
  });

  async function handleRecord(caseId: string, status: "PASS" | "FAIL" | "BLOCKED" | "SKIP", note: string) {
    await recordMutation.mutateAsync({ testRunId, testCaseId: caseId, status, note: note || undefined });
    await utils.manualExecution.getForExecution.invalidate({ testRunId });
  }

  const data = dataQuery.data;
  const pageError = error ?? dataQuery.error?.message ?? null;

  if (pageError) return <p style={{ color: "var(--ember)" }}>{pageError}</p>;
  if (!data) return <p>Loading…</p>;

  const recordedCount = data.cases.filter((c) => c.currentResult).length;

  return (
    <div style={{ maxWidth: 800 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Manual test run</h1>
        <button className="btn-primary" onClick={() => completeMutation.mutate({ testRunId })} disabled={completeMutation.isPending}>
          {completeMutation.isPending ? "Completing…" : "Complete run"}
        </button>
      </div>
      <p className="text-muted" style={{ fontSize: 13 }}>
        {recordedCount} / {data.cases.length} recorded · status: {data.status}
      </p>

      {data.cases.map((tc) => (
        <CaseRow key={tc.testCaseId} testCase={tc} stepFieldLabels={data.stepFieldLabels} onRecord={handleRecord} />
      ))}
    </div>
  );
}
