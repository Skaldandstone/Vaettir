"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { trpcReact } from "@/lib/trpcReact";
import { Drawer } from "@/components/Drawer";
import { TestCaseDetailContent } from "@/components/TestCaseDetailContent";
import { useProjectPermissions } from "@/lib/use-project-permissions";
import { reviewQueuePage } from "@/lib/case-review";

// P1-15
export default function ReviewQueuePage() {
  const { projectId } = useParams<{ projectId: string }>();
  return <ReviewQueueSession key={projectId} projectId={projectId} />;
}
function ReviewQueueSession({ projectId }: { projectId: string }) {
  const { canEdit } = useProjectPermissions(projectId);
  const utils = trpcReact.useUtils();
  const queueQuery = trpcReact.testCases.pendingReview.useQuery({ projectId });
  const queue = queueQuery.data ?? [];
  const readable = queueQuery.isSuccess && !queueQuery.error && !queueQuery.isFetching && !queueQuery.isPaused;
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openCaseId, setOpenCaseId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"confidence" | "case-id" | "title">("confidence");
  const [page, setPage] = useState(0);
  const visible = reviewQueuePage(readable ? queue : [], search, sort, page);

  const invalidate = async () => { await Promise.all([utils.testCases.pendingReview.invalidate({ projectId }), utils.testCases.list.invalidate({ projectId })]); };
  const approveMutation = trpcReact.testCases.approve.useMutation({ onSuccess: invalidate, onError: (e) => setError(e.message), onSettled: () => setBusyId(null) });
  const rejectMutation = trpcReact.testCases.reject.useMutation({ onSuccess: invalidate, onError: (e) => setError(e.message), onSettled: () => setBusyId(null) });

  function decide(id: string, decision: "approve" | "reject") {
    if (!canEdit || busyId || !readable) return;
    setBusyId(id);
    setError(null);
    (decision === "approve" ? approveMutation : rejectMutation).mutate({ id });
  }

  const loading = queueQuery.isLoading;
  const pageError = error ?? queueQuery.error?.message ?? null;

  return (
    <div style={{ maxWidth: 960 }}>
      <a className="btn-secondary" style={{ fontSize: 13 }} href={`/projects/${projectId}/test-cases`}>
        &larr; Test cases
      </a>
      <h1>Review queue</h1>
      <p style={{ color: "var(--muted)" }}>
        Active cases awaiting a review decision. Approved cases belong in the repository; rejected and archived cases remain retained outside this queue.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
        <label style={{ flex: "1 1 260px" }}>Search pending cases
          <input type="search" value={search} onChange={event => { setSearch(event.target.value); setPage(0); }} placeholder="Case ID, title or source file" style={{ width: "100%" }} />
        </label>
        <label>Sort pending cases
          <select value={sort} onChange={event => { setSort(event.target.value as typeof sort); setPage(0); }}>
            <option value="confidence">Lowest known confidence</option><option value="case-id">Case ID</option><option value="title">Title</option>
          </select>
        </label>
      </div>
      {loading && <p>Loading…</p>}
      {!loading && !readable && !queueQuery.error && <p role="status">Refreshing current pending cases. Cached queue details are withheld until the read completes.</p>}
      {pageError && <p role="alert" style={{ color: "var(--ember)" }}>{pageError} <button type="button" onClick={() => void queueQuery.refetch()}>Refresh queue</button></p>}
      {readable && queue.length === 0 && <p style={{ color: "var(--muted)" }}>Nothing pending review.</p>}
      {readable && queue.length > 0 && <p role="status">{visible.total} matching of {queue.length} pending cases · Page {visible.page + 1} of {visible.pageCount}</p>}
      {readable && queue.length > 0 && visible.total === 0 && <p>No pending cases match this search. <button type="button" onClick={() => { setSearch(""); setPage(0); }}>Clear search</button></p>}
      <ul style={{ listStyle: "none", padding: 0 }}>
        {visible.items.map((tc) => (
          <li key={tc.id} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 12, marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <a
                href={`/projects/${projectId}/test-cases/${tc.id}`}
                onClick={(event) => {
                  if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
                  event.preventDefault();
                  setOpenCaseId(tc.id);
                }}
              >
                <code style={{ display: "inline-block", marginRight: 10, padding: "2px 6px", border: "1px solid var(--line)", borderRadius: 4 }}>{tc.displayId}</code>
                <strong>{tc.title}</strong>
              </a>
              {tc.confidence != null && (
                <span style={{ color: tc.confidence < 0.6 ? "var(--ember)" : "var(--muted-dim)" }}>
                  {(tc.confidence * 100).toFixed(0)}% confidence
                </span>
              )}
              {tc.confidence === null && <span className="text-muted">Confidence not supplied</span>}
            </div>
            {tc.sourceFilePath && <div style={{ color: "var(--muted-dim)", fontSize: 13 }}>{tc.sourceFilePath}</div>}
            {canEdit && <div style={{ marginTop: 8 }}>
              <button onClick={() => decide(tc.id, "approve")} disabled={!!busyId || queueQuery.isFetching || !!queueQuery.error} style={{ marginRight: 8 }}>
                Approve
              </button>
              <button onClick={() => decide(tc.id, "reject")} disabled={!!busyId || queueQuery.isFetching || !!queueQuery.error}>
                Reject
              </button>
            </div>}
          </li>
        ))}
      </ul>
      {visible.pageCount > 1 && <nav aria-label="Review queue pages" style={{ display: "flex", gap: 12 }}>
        <button type="button" disabled={visible.page === 0} onClick={() => setPage(visible.page - 1)}>Previous</button>
        <button type="button" disabled={visible.page + 1 >= visible.pageCount} onClick={() => setPage(visible.page + 1)}>Next</button>
      </nav>}

      <Drawer open={openCaseId !== null} onClose={() => setOpenCaseId(null)}>
        {openCaseId && <TestCaseDetailContent id={openCaseId} projectId={projectId} readOnly={!canEdit} onChanged={() => void invalidate()} />}
      </Drawer>
    </div>
  );
}
