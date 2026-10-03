"use client";
import { useState } from "react";
import Link from "next/link";
import { Modal } from "./Modal";
import { trpcReact } from "@/lib/trpcReact";
import { readableMetric } from "@/lib/frozen-report";
import { retainAnalysisRequest } from "@/lib/analysis-request-recovery";
type Action = "RISK" | "TYPE_DESIGN";
type Props = {
  projectId: string;
  selectedIds: string[];
  onCompleted: () => void;
};
export function DurableCaseAnalysis(props: Props) {
  return <Analysis key={props.projectId} {...props} />;
}
function Analysis({ projectId, selectedIds, onCompleted }: Props) {
  const [open, setOpen] = useState(false),
    [action, setAction] = useState<Action>("RISK"),
    [jobId, setJobId] = useState<string | null>(null),
    [offset, setOffset] = useState(0);
  const [reviewRequest, setReviewRequest] = useState<{
    projectId: string;
    action: Action;
    ids: string[];
    requestId: string;
  } | null>(null);
  const [approvalRequest, setApprovalRequest] = useState<{
    projectId: string;
    id: string;
    scopeHash: string;
    maximumCredits: number;
    approved: true;
    allowCaseProcessing: true;
  } | null>(null);
  const [consent, setConsent] = useState(false),
    [scopeExpanded, setScopeExpanded] = useState(false),
    [reason, setReason] = useState(""),
    [message, setMessage] = useState("");
  const review = trpcReact.caseAnalysisQueue.review.useMutation(),
    approve = trpcReact.caseAnalysisQueue.approve.useMutation(),
    cancel = trpcReact.caseAnalysisQueue.cancel.useMutation(),
    request = trpcReact.caseAnalysisQueue.requestAdmin.useMutation();
  const history = trpcReact.caseAnalysisQueue.mine.useQuery(
    { projectId },
    { enabled: open, staleTime: 0 },
  );
  const state = trpcReact.caseAnalysisQueue.byId.useQuery(
    { projectId, id: jobId ?? "", offset },
    {
      enabled: open && Boolean(jobId),
      staleTime: 0,
      refetchInterval: (query) =>
        open &&
        jobId &&
        ["QUEUED", "RUNNING"].includes(query.state.data?.status ?? "")
          ? 5000
          : false,
    },
  );
  const fresh =
    open &&
    !state.error &&
    !state.isFetching &&
    !state.isPaused &&
    state.data?.id === jobId &&
    state.data.projectId === projectId;
  const saved = fresh ? state.data : null;
  const busy =
    review.isPending ||
    approve.isPending ||
    cancel.isPending ||
    request.isPending;
  const canApprove = Boolean(
    saved &&
    saved.status === "REVIEW" &&
    saved.canSpend &&
    saved.balance >= saved.maximumCredits &&
    consent &&
    !busy,
  );
  const historyFresh =
    !history.error && !history.isFetching && !history.isPaused;
  async function prepare() {
    const input = reviewRequest ?? {
      projectId,
      action,
      ids: [...selectedIds],
      requestId: crypto.randomUUID(),
    };
    setReviewRequest(input);
    setMessage("");
    try {
      const result = await review.mutateAsync(input);
      setJobId(result.id);
      setOffset(0);
      setReviewRequest(null);
      setConsent(false);
      await history.refetch();
    } catch (error) {
      const retain = retainAnalysisRequest(Boolean(reviewRequest), error);
      if (!retain) setReviewRequest(null);
      setMessage(
        retain
          ? "Could not confirm the saved scope. Retry the same request to recover it without creating duplicate work."
          : "This scope was not accepted. Check current access and selection, then review again.",
      );
    }
  }
  async function authorize() {
    if (!saved || !saved.canSpend) return;
    if (!approvalRequest && !canApprove) return;
    const input = approvalRequest ?? {
      projectId,
      id: saved!.id,
      scopeHash: saved!.scopeHash,
      maximumCredits: saved!.maximumCredits,
      approved: true as const,
      allowCaseProcessing: true as const,
    };
    setApprovalRequest(input);
    setMessage("");
    try {
      await approve.mutateAsync(input);
      setApprovalRequest(null);
      setConsent(false);
      onCompleted();
      await state.refetch();
      await history.refetch();
    } catch (error) {
      const retain = retainAnalysisRequest(Boolean(approvalRequest), error);
      if (!retain) {
        setApprovalRequest(null);
        setConsent(false);
      }
      setMessage(
        retain
          ? "Approval outcome is unconfirmed. Retry the identical approval; the saved job cannot be queued or charged twice."
          : "Approval was refused before acceptance. Refresh this saved scope or go back and review the updated cases.",
      );
    }
  }
  function selectJob(id: string) {
    setJobId(id);
    setOffset(0);
    setConsent(false);
    setMessage("");
  }
  return (
    <>
      <button
        type="button"
        className="btn-secondary"
        onClick={() => setOpen(true)}
      >
        Analyze cases
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Analyze cases"
        size="wide"
      >
        <p>
          Review a saved selection, approve its maximum, then follow each case.
          Work continues when this module is closed.
        </p>
        {message && <p role="alert">{message}</p>}
        {!jobId && (
          <>
            <label style={{ display: "grid", gap: 6 }}>
              Analysis
              <select
                value={action}
                disabled={busy || Boolean(reviewRequest)}
                onChange={(e) => setAction(e.target.value as Action)}
              >
                <option value="RISK">Risk assessment</option>
                <option value="TYPE_DESIGN">
                  Test type and design improvements
                </option>
              </select>
            </label>
            <p>
              {reviewRequest?.ids.length ?? selectedIds.length} selected cases.
              Maximum 1,000 per reviewed queue. Saved reviews and existing risk
              assessments are preserved.
            </p>
            {selectedIds.length > 1000 && (
              <p role="alert">
                Select at most 1,000 cases. Nothing has been truncated or
                queued.
              </p>
            )}
            <button
              type="button"
              className="btn-primary"
              disabled={
                busy ||
                (!reviewRequest &&
                  (!selectedIds.length || selectedIds.length > 1000))
              }
              onClick={() => void prepare()}
            >
              {reviewRequest
                ? "Retry saved scope"
                : "Review selection and cost"}
            </button>
          </>
        )}
        {jobId && (
          <>
            {state.isFetching && (
              <p role="status">Checking saved scope and current access…</p>
            )}
            {state.isPaused && (
              <p role="status">
                Waiting for a connection. Cached credit or permission
                information cannot authorize spending.
              </p>
            )}
            {state.error && (
              <div role="alert">
                <p>
                  Could not load this saved analysis. No cached scope can
                  authorize spending.
                </p>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => void state.refetch()}
                >
                  Retry saved analysis
                </button>
              </div>
            )}
            {saved && (
              <>
                <h3>
                  {saved.action === "RISK"
                    ? "Risk assessment"
                    : "Type and design improvements"}
                </h3>
                <p role="status">
                  {readableMetric(saved.status)} · {saved.caseCount} cases
                </p>
                {saved.status === "COMPLETE" && (
                  <p>
                    Processing finished. Failed or unavailable cases still need
                    attention; these recommendations are not executed test
                    results.
                  </p>
                )}
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={busy}
                  onClick={() => void state.refetch()}
                >
                  Refresh saved analysis
                </button>
                <dl
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))",
                    gap: 12,
                  }}
                >
                  <div>
                    <dt>Maximum approved spend</dt>
                    <dd style={{ margin: 0 }}>
                      {saved.maximumCredits} credits
                    </dd>
                  </div>
                  <div>
                    <dt>Current balance</dt>
                    <dd style={{ margin: 0 }}>{saved.balance} credits</dd>
                  </div>
                </dl>
                <details>
                  <summary>Billing and processing details</summary>
                  <p>
                    Each new risk review is capped at 2 credits; each
                    type/design review at 12. Lower measured usage is refunded
                    once. Usage above the cap is recorded but not charged to
                    you. No repository files are read.
                  </p>
                </details>
                {saved.reason && <p>{saved.reason}</p>}
                <p>
                  {Object.entries(saved.counts)
                    .map(
                      ([status, count]) =>
                        `${count} ${readableMetric(status).toLowerCase()}`,
                    )
                    .join(" · ")}
                </p>
                {approvalRequest && saved.canSpend && (
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={busy}
                    onClick={() => void authorize()}
                  >
                    Retry identical approval
                  </button>
                )}
                {saved.status === "REVIEW" && !approvalRequest && (
                  <>
                    {saved.canSpend ? (
                      <>
                        <label
                          style={{
                            display: "flex",
                            gap: 10,
                            alignItems: "flex-start",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={consent}
                            disabled={busy || Boolean(approvalRequest)}
                            onChange={(e) => setConsent(e.target.checked)}
                          />
                          <span>
                            I authorize processing the listed test-case text
                            with the AI provider and approve at most{" "}
                            {saved.maximumCredits} credits for this exact saved
                            scope.
                          </span>
                        </label>
                        {saved.balance < saved.maximumCredits && (
                          <p role="alert">
                            The balance cannot cover this maximum. Request help
                            from your workspace administrator.
                          </p>
                        )}
                        <button
                          type="button"
                          className="btn-primary"
                          disabled={busy || !canApprove}
                          onClick={() => void authorize()}
                        >
                          Approve and queue
                        </button>
                      </>
                    ) : (
                      <p>
                        A full editor seat is required to spend credits. Ask
                        your workspace administrator below.
                      </p>
                    )}
                    {(!saved.canSpend ||
                      saved.balance < saved.maximumCredits) && (
                      <div style={{ display: "grid", gap: 8 }}>
                        <label style={{ display: "grid", gap: 6, minWidth: 0 }}>
                          Request reason
                          <textarea
                            style={{
                              width: "100%",
                              boxSizing: "border-box",
                              minWidth: 0,
                            }}
                            value={reason}
                            maxLength={500}
                            onChange={(e) => setReason(e.target.value)}
                          />
                        </label>
                        <button
                          type="button"
                          className="btn-secondary"
                          disabled={
                            busy || !reason.trim() || !saved.counts.QUEUED
                          }
                          onClick={() => {
                            void request
                              .mutateAsync({ projectId, id: saved.id, reason })
                              .then(() =>
                                setMessage(
                                  "Request recorded in the workspace administrator inbox. This does not grant a seat, credits or start work.",
                                ),
                              )
                              .catch(() =>
                                setMessage(
                                  "Could not confirm the request. Retry to recover the same administrator request.",
                                ),
                              );
                          }}
                        >
                          Make a request
                        </button>
                      </div>
                    )}
                  </>
                )}
                <details
                  open={scopeExpanded}
                  onToggle={(event) =>
                    setScopeExpanded(event.currentTarget.open)
                  }
                >
                  <summary>Case scope and outcomes</summary>
                  <ol start={saved.offset + 1} style={{ paddingLeft: 22 }}>
                    {saved.items.map((item) => (
                      <li key={item.position} style={{ marginBottom: 12 }}>
                        <span>
                          {item.caseId ? (
                            <Link
                              href={`/projects/${encodeURIComponent(projectId)}/test-cases/${encodeURIComponent(item.caseId)}`}
                            >
                              {item.displayId}
                            </Link>
                          ) : (
                            `${item.displayId} (unavailable)`
                          )}{" "}
                          · {readableMetric(item.status)} · maximum{" "}
                          {item.maximumCredits} credits
                          {item.charged ? " · charged receipt retained" : ""}
                        </span>
                        {item.reason && <p>{item.reason}</p>}
                        {item.meteredAt && (
                          <small>
                            Measured {item.actualCredits} · refunded{" "}
                            {item.refund} · excess not charged{" "}
                            {item.excessNotCharged}
                          </small>
                        )}
                      </li>
                    ))}
                  </ol>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={busy || offset === 0}
                      onClick={() => setOffset(Math.max(0, offset - 50))}
                    >
                      Previous cases
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={busy || !saved.hasMore}
                      onClick={() => setOffset(offset + 50)}
                    >
                      Next cases
                    </button>
                  </div>
                </details>
                {["REVIEW", "QUEUED", "RUNNING", "STOPPED"].includes(
                  saved.status,
                ) && (
                  <>
                    <p>
                      Cancellation stops subsequent spending. Already charged
                      work may finish and is not refunded by cancellation.
                    </p>
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={busy || Boolean(approvalRequest)}
                      onClick={() => {
                        void cancel
                          .mutateAsync({ projectId, id: saved.id })
                          .then(() => state.refetch())
                          .catch(() =>
                            setMessage(
                              "Could not confirm cancellation. Retry cancellation; do not assume work stopped.",
                            ),
                          );
                      }}
                    >
                      Cancel remaining work
                    </button>
                  </>
                )}
              </>
            )}
            {approvalRequest && !saved && (
              <p>
                The exact approval request is retained. Restore current access
                and the saved scope before retrying.
              </p>
            )}
            <button
              type="button"
              className="btn-secondary"
              disabled={
                busy || Boolean(approvalRequest) || Boolean(reviewRequest)
              }
              onClick={() => {
                setJobId(null);
                setConsent(false);
                setOffset(0);
                setMessage("");
              }}
            >
              Back to selections
            </button>
          </>
        )}
        <details>
          <summary>Saved analysis queues</summary>
          {history.error && (
            <div role="alert">
              <p>Could not load saved queues.</p>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => void history.refetch()}
              >
                Retry queue history
              </button>
            </div>
          )}
          {historyFresh &&
            history.data?.map((job) => (
              <p key={job.id}>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={
                    busy || Boolean(approvalRequest) || Boolean(reviewRequest)
                  }
                  onClick={() => selectJob(job.id)}
                >
                  {job.action === "RISK" ? "Risk" : "Type/design"} ·{" "}
                  {job.caseCount} cases · {readableMetric(job.status)}
                </button>
              </p>
            ))}
          {historyFresh && history.data?.length === 0 && (
            <p>No saved analysis queues yet.</p>
          )}
        </details>
      </Modal>
    </>
  );
}
