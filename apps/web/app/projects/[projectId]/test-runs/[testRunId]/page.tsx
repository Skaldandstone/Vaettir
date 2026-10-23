"use client";

import { useParams } from "next/navigation";
import { trpcReact } from "@/lib/trpcReact";

export default function TestRunDetailPage() {
  const { projectId, testRunId } = useParams<{ projectId: string; testRunId: string }>();
  const query = trpcReact.testRuns.byId.useQuery({ id: testRunId });
  if (query.isLoading) return <main style={{ padding: 24 }}>Loading test run…</main>;
  if (query.error || !query.data) return <main style={{ padding: 24 }} role="alert">Unable to load this test run.</main>;
  const run = query.data;
  if (run.projectId !== projectId) return <main style={{ padding: 24 }} role="alert">This run belongs to a different project.</main>;
  return <main style={{ maxWidth: 900, margin: "0 auto", padding: 24 }}>
    <p><a href={`/projects/${projectId}/test-runs`}>← Test runs</a></p>
    <h1>Test run</h1>
    <p><strong>Status:</strong> {run.status} · <strong>Source:</strong> {run.ciProvider} · {new Date(run.startedAt).toLocaleString()}</p>
    <p><strong>Revision:</strong> {run.commitSha} ({run.branch})</p>
    <ul>{run.results.map((result) => <li key={result.id} style={{ marginBottom: 12 }}>
      <strong>{result.status}</strong>: {result.testCaseTitle ?? result.externalTestId ?? "Unmatched result"}
      {result.errorMessage && <p>{result.errorMessage}</p>}
      {result.testCaseId && <a href={`/projects/${projectId}/test-cases/${result.testCaseId}`}>Open test case</a>}
    </li>)}</ul>
  </main>;
}
