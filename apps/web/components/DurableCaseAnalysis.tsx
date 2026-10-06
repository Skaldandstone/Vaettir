"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { Modal } from "./Modal";
import {
  trpcReact,
  type RouterInputs,
  type RouterOutputs,
} from "@/lib/trpcReact";
import { readableMetric } from "@/lib/frozen-report";
import { retainAnalysisRequest } from "@/lib/analysis-request-recovery";
type Action = "RISK" | "TYPE_DESIGN";
type Origin = {
  projectId: string;
  originalOrganizationId: string;
  expectedClerkActorId: string;
};
type Queue = RouterOutputs["caseAnalysisQueue"]["byId"];
type ReviewInput = RouterInputs["caseAnalysisQueue"]["review"] & Origin;
type ReviewEvent = {
  input: ReviewInput;
  inFlight: boolean;
  unknown: boolean;
  consumed: boolean;
};
type ApprovalInput = RouterInputs["caseAnalysisQueue"]["approve"] & Origin;
type ApprovalEvent = {
  input: ApprovalInput;
  inFlight: boolean;
  unknown: boolean;
  consumed: boolean;
  attempt: number;
};
function sameOrigin(a: Origin | null, b: Origin | null) {
  return (
    !!a &&
    !!b &&
    a.projectId === b.projectId &&
    a.originalOrganizationId === b.originalOrganizationId &&
    a.expectedClerkActorId === b.expectedClerkActorId
  );
}
function scopeMatches(value: { scope?: Queue["scope"] }, origin: Origin) {
  return (
    value.scope?.projectId === origin.projectId &&
    value.scope.organizationId === origin.originalOrganizationId &&
    value.scope.actorClerkUserId === origin.expectedClerkActorId &&
    !!value.scope.actorId
  );
}
function queueMatches(
  value: Queue,
  origin: Origin,
  id?: string,
  requestId?: string,
) {
  return (
    scopeMatches(value, origin) &&
    value.projectId === origin.projectId &&
    (!id || value.id === id) &&
    (!requestId || value.requestId === requestId)
  );
}
type Props = {
  projectId: string;
  selectedIds: string[];
  onCompleted: () => void;
  buttonLabel?: string;
};
export function DurableCaseAnalysis(props: Props) {
  return <Analysis key={props.projectId} {...props} />;
}
function Analysis({ projectId, selectedIds, onCompleted, buttonLabel = "Analyze cases" }: Props) {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const [origin, setOrigin] = useState<Origin | null>(null);
  const [open, setOpen] = useState(false),
    [action, setAction] = useState<Action>("RISK"),
    [jobId, setJobId] = useState<string | null>(null),
    [offset, setOffset] = useState(0);
  const [reviewRequest, setReviewRequest] = useState<
    (RouterInputs["caseAnalysisQueue"]["review"] & Origin) | null
  >(null);
  const [approvalRequest, setApprovalRequest] = useState<
    (RouterInputs["caseAnalysisQueue"]["approve"] & Origin) | null
  >(null);
  const [cancelRequest, setCancelRequest] = useState<
    (RouterInputs["caseAnalysisQueue"]["cancel"] & Origin) | null
  >(null);
  const [adminRequest, setAdminRequest] = useState<
    (RouterInputs["caseAnalysisQueue"]["requestAdmin"] & Origin) | null
  >(null);
  const [refreshNotice, setRefreshNotice] = useState("");
  const [consent, setConsent] = useState(false),
    [scopeExpanded, setScopeExpanded] = useState(false),
    [reason, setReason] = useState(""),
    [message, setMessage] = useState("");
  const review = trpcReact.caseAnalysisQueue.review.useMutation(),
    approve = trpcReact.caseAnalysisQueue.approve.useMutation(),
    cancel = trpcReact.caseAnalysisQueue.cancel.useMutation(),
    request = trpcReact.caseAnalysisQueue.requestAdmin.useMutation();
  const project = trpcReact.project.byId.useQuery(
    { id: projectId },
    { enabled: open && isLoaded && isSignedIn, staleTime: 0, retry: false },
  );
  const organizations = trpcReact.organization.mine.useQuery(undefined, {
    enabled: open && isLoaded && isSignedIn,
    staleTime: 0,
    retry: false,
  });
  const projectReady =
    !project.error &&
    !project.isFetching &&
    !project.isPaused &&
    project.data?.id === projectId;
  const memberReady =
    !organizations.error &&
    !organizations.isFetching &&
    !organizations.isPaused;
  const member = memberReady
    ? organizations.data?.find((row) => row.id === project.data?.organizationId)
    : null;
  const readable =
    !!member &&
    ["OWNER", "ADMIN", "EDITOR", "VIEWER", "COMPLIANCE_AUDITOR"].includes(
      member.role,
    ) &&
    ["FULL", "READ_ONLY"].includes(member.seatType);
  const current = useMemo(
    () =>
      open && isLoaded && isSignedIn && userId && projectReady && readable
        ? {
            projectId,
            originalOrganizationId: project.data!.organizationId,
            expectedClerkActorId: userId,
          }
        : null,
    [
      open,
      isLoaded,
      isSignedIn,
      userId,
      projectReady,
      readable,
      projectId,
      project.data,
    ],
  );
  useEffect(() => {
    if (!origin && current) setOrigin(current);
  }, [origin, current]);
  const ready = sameOrigin(origin, current);
  const editor =
    ready &&
    member?.seatType === "FULL" &&
    ["OWNER", "ADMIN", "EDITOR"].includes(member.role);
  const accessNow = useRef({ ready, origin, open, epoch: 0 });
  useLayoutEffect(() => {
    const previous = accessNow.current;
    const changed = previous.ready !== ready || previous.open !== open ||
      (previous.origin !== origin && !sameOrigin(previous.origin, origin));
    accessNow.current = { ready, origin, open, epoch: previous.epoch + (changed ? 1 : 0) };
    return () => {
      const current = accessNow.current;
      accessNow.current = { ...current, ready: false, open: false, epoch: current.epoch + 1 };
    };
  }, [ready, origin, open]);
  const readScope = origin ?? {
    projectId,
    originalOrganizationId: "pending",
    expectedClerkActorId: "pending",
  };
  const history = trpcReact.caseAnalysisQueue.mine.useQuery(readScope, {
    enabled: ready,
    staleTime: 0,
    retry: false,
  });
  const state = trpcReact.caseAnalysisQueue.byId.useQuery(
    { ...readScope, id: jobId ?? "", offset },
    {
      enabled: ready && Boolean(jobId),
      staleTime: 0,
      refetchInterval: (query) =>
        ready &&
        jobId &&
        ["QUEUED", "RUNNING"].includes(query.state.data?.status ?? "")
          ? 5000
          : false,
    },
  );
  const fresh =
    ready &&
    origin &&
    !state.error &&
    !state.isFetching &&
    !state.isPaused &&
    state.data?.id === jobId &&
    state.data.projectId === projectId &&
    state.data.offset === offset &&
    queueMatches(state.data, origin, jobId ?? undefined);
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
    editor &&
    saved.balance >= saved.maximumCredits &&
    consent &&
    !cancelRequest &&
    !adminRequest &&
    !reviewRequest &&
    !busy,
  );
  const historyFresh =
    ready &&
    origin &&
    !history.error &&
    !history.isFetching &&
    !history.isPaused &&
    history.data &&
    !Array.isArray(history.data) &&
    scopeMatches(history.data, origin);
  const historyRows =
    historyFresh && history.data && !Array.isArray(history.data)
      ? history.data.items
      : [];
  const retained = !!(
    reviewRequest ||
    approvalRequest ||
    cancelRequest ||
    adminRequest
  );
  const [reviewGeneration, setReviewGeneration] = useState(0);
  const reviewOwner = useRef<{ generation: number; event: ReviewEvent | null }>({ generation: 0, event: null });
  const [approvalGeneration, setApprovalGeneration] = useState(0);
  const approvalOwner = useRef<{ generation: number; event: ApprovalEvent | null }>({ generation: 0, event: null });
  // This ref follows only the component's explicit job transitions below.
  // Updating it synchronously prevents captured pre-commit navigation races.
  const approvalJob = useRef(jobId);
  const canSpendNow = !!saved?.canSpend && editor;
  async function refreshConfirmed(
    input: Origin,
    label: string,
    changed = false,
    owned?: () => boolean,
  ) {
    // ACK has already been independently verified and consumed. Read/callback
    // failure can never reclassify it as an unknown write or resubmit work.
    if (owned && !owned()) return;
    if (
      !accessNow.current.ready ||
      !accessNow.current.open ||
      !sameOrigin(accessNow.current.origin, input)
    ) {
      setRefreshNotice(
        `${label} confirmed for the original account. Restore original access to refresh; no write will be retried.`,
      );
      return;
    }
    try {
      if (changed) await onCompleted();
      if (owned && !owned()) return;
      const [s, h] = await Promise.all([
        jobId ? state.refetch() : Promise.resolve(null),
        history.refetch(),
      ]);
      if (
        s?.error ||
        s?.isPaused ||
        s?.isFetching ||
        h.error ||
        h.isPaused ||
        h.isFetching
      )
        throw Error("Read refresh failed");
      if (owned && !owned()) return;
      setRefreshNotice("");
    } catch {
      if (owned && !owned()) return;
      setRefreshNotice(
        `${label} confirmed, but the current view could not be refreshed. Refresh reads only; do not resubmit the accepted write.`,
      );
    }
  }
  async function prepare() {
    if (!ready || !origin || busy) return;
    if (approvalOwner.current.generation !== approvalGeneration || approvalOwner.current.event?.inFlight ||
      (approvalOwner.current.event && !approvalOwner.current.event.consumed)) return;
    const owner = reviewOwner.current, live = accessNow.current;
    if (owner.generation !== reviewGeneration || !live.ready || !live.open || !sameOrigin(live.origin, origin)) return;
    if (owner.event && (owner.event.inFlight || owner.event.consumed || reviewRequest !== owner.event.input)) return;
    if (!owner.event && (approvalRequest || cancelRequest || adminRequest)) return;
    const input = reviewRequest ?? {
      ...origin,
      action,
      ids: [...selectedIds],
      requestId: crypto.randomUUID(),
    };
    if (!sameOrigin(input, origin)) return;
    const event = owner.event ?? { input, inFlight: false, unknown: Boolean(reviewRequest), consumed: false };
    owner.event = event;
    event.inFlight = true;
    const accessEpoch = live.epoch;
    setReviewRequest(input);
    setMessage("");
    try {
      const result = await review.mutateAsync(input);
      if (!queueMatches(result, input, undefined, input.requestId))
        throw Error(
          "Saved scope acknowledgement did not match the original request.",
        );
      if (reviewOwner.current !== owner || owner.event !== event || owner.generation !== reviewGeneration) return;
      const currentAccess = accessNow.current;
      if (!currentAccess.ready || !currentAccess.open || !sameOrigin(currentAccess.origin, input) || currentAccess.epoch !== accessEpoch) {
        // The original ACK is known, but this old view cannot publish it. Keep
        // its exact UUID/body for explicit receipt recovery after restoration.
        event.unknown = true;
        setMessage("Saved scope acknowledged for the original account. Reopen under original access and retry this same request to display it; no new scope was created.");
        return;
      }
      event.consumed = true;
      approvalJob.current = result.id;
      setJobId(result.id);
      setOffset(0);
      setReviewRequest(null);
      setConsent(false);
      setMessage(
        "Saved scope confirmed for the original account. Approval remains separate.",
      );
      await refreshConfirmed(input, "Saved scope");
    } catch (error) {
      if (reviewOwner.current !== owner || owner.event !== event || event.consumed) return;
      const retain = retainAnalysisRequest(event.unknown || Boolean(reviewRequest), error);
      event.unknown = retain;
      if (!retain) {
        owner.event = null;
        owner.generation++;
        setReviewGeneration(owner.generation);
        setReviewRequest(null);
      }
      setMessage(
        retain
          ? "Could not confirm the saved scope. Retry the same request to recover it without creating duplicate work."
          : "This scope was not accepted. Check current access and selection, then review again.",
      );
    } finally {
      event.inFlight = false;
    }
  }
  function backToSelections() {
    const owner = reviewOwner.current, live = accessNow.current;
    const approval = approvalOwner.current;
    if (approval.generation !== approvalGeneration || approval.event?.inFlight || (approval.event && !approval.event.consumed)) return;
    if (!ready || !origin || busy || retained || owner.generation !== reviewGeneration ||
      !live.ready || !live.open || !sameOrigin(live.origin, origin) ||
      owner.event?.inFlight || (owner.event && !owner.event.consumed)) return;
    owner.generation++;
    owner.event = null;
    setReviewGeneration(owner.generation);
    approval.generation++;
    approval.event = null;
    setApprovalGeneration(approval.generation);
    approvalJob.current = null;
    setJobId(null);
    setConsent(false);
    setOffset(0);
    setMessage("");
  }
  async function authorize() {
    if (!saved || !canSpendNow || !origin || !ready || busy) return;
    const owner = approvalOwner.current, live = accessNow.current;
    if (owner.generation !== approvalGeneration || !live.ready || !live.open || !sameOrigin(live.origin, origin) || approvalJob.current !== saved.id) return;
    if (owner.event && (owner.event.inFlight || owner.event.consumed || approvalRequest !== owner.event.input)) return;
    if (!approvalRequest && !canApprove) return;
    const input = approvalRequest ?? {
      ...origin,
      id: saved!.id,
      scopeHash: saved!.scopeHash,
      maximumCredits: saved!.maximumCredits,
      approved: true as const,
      allowCaseProcessing: true as const,
    };
    if (!sameOrigin(input, origin)) return;
    if (input.id !== approvalJob.current) return;
    Object.freeze(input);
    const event = owner.event ?? { input, inFlight: false, unknown: Boolean(approvalRequest), consumed: false, attempt: 0 };
    owner.event = event;
    event.inFlight = true;
    const attempt = ++event.attempt, accessEpoch = live.epoch;
    const ownsOriginalView = () => {
      const current = accessNow.current;
      return approvalOwner.current === owner && owner.event === event && owner.generation === approvalGeneration &&
        event.attempt === attempt && approvalJob.current === input.id && current.ready && current.open &&
        current.epoch === accessEpoch && sameOrigin(current.origin, input);
    };
    setApprovalRequest(input);
    setMessage("");
    try {
      const ack = await approve.mutateAsync(input);
      if (
        !queueMatches(ack, input, input.id) ||
        ack.scopeHash !== input.scopeHash ||
        ack.maximumCredits !== input.maximumCredits ||
        !ack.approvedAt
      )
        throw Error(
          "Approval acknowledgement did not match the original reviewed scope.",
        );
      if (approvalOwner.current !== owner || owner.event !== event || owner.generation !== approvalGeneration || event.attempt !== attempt) return;
      if (!ownsOriginalView()) {
        event.unknown = true;
        setMessage("Approval acknowledged for the original saved job. Restore its original view and access, then retry this same approval to display it; no replacement approval was created.");
        return;
      }
      event.consumed = true;
      setApprovalRequest(null);
      setConsent(false);
      setMessage(
        "Approval confirmed. The saved job will not be queued or charged twice.",
      );
      await refreshConfirmed(input, "Approval", true, ownsOriginalView);
    } catch (error) {
      if (approvalOwner.current !== owner || owner.event !== event || event.consumed || event.attempt !== attempt) return;
      const retain = retainAnalysisRequest(event.unknown || Boolean(approvalRequest), error);
      event.unknown = retain;
      if (!retain) {
        owner.event = null;
        owner.generation++;
        setApprovalGeneration(owner.generation);
        setApprovalRequest(null);
        setConsent(false);
      }
      setMessage(
        retain
          ? "Approval outcome is unconfirmed. Retry the identical approval; the saved job cannot be queued or charged twice."
          : "Approval was refused before acceptance. Refresh this saved scope or go back and review the updated cases.",
      );
    } finally {
      if (event.attempt === attempt) event.inFlight = false;
    }
  }
  function selectJob(id: string) {
    if (!ready || busy || retained) return;
    const owner = reviewOwner.current;
    if (owner.generation !== reviewGeneration || owner.event?.inFlight || (owner.event && !owner.event.consumed)) return;
    const approval = approvalOwner.current;
    if (approval.generation !== approvalGeneration || approval.event?.inFlight || (approval.event && !approval.event.consumed)) return;
    approval.generation++;
    approval.event = null;
    setApprovalGeneration(approval.generation);
    approvalJob.current = id;
    setJobId(id);
    setOffset(0);
    setConsent(false);
    setMessage("");
  }
  async function requestHelp() {
    if (!saved || !origin || !ready || busy) return;
    if (approvalOwner.current.generation !== approvalGeneration || approvalOwner.current.event?.inFlight ||
      (approvalOwner.current.event && !approvalOwner.current.event.consumed)) return;
    const input = adminRequest ?? { ...origin, id: saved.id, reason };
    if (!sameOrigin(input, origin)) return;
    setAdminRequest(input);
    setMessage("");
    try {
      const ack = await request.mutateAsync(input);
      if (
        !("scope" in ack) ||
        !scopeMatches(ack, input) ||
        ack.queueId !== input.id ||
        ack.scopeHash !== saved.scopeHash ||
        ack.maximumCredits !== saved.maximumCredits ||
        !ack.id
      )
        throw Error(
          "Administrator acknowledgement did not match the original account and scope.",
        );
      setAdminRequest(null);
      setMessage(
        "Request confirmed in the original workspace administrator inbox. This grants no seat, credits or job start.",
      );
      await refreshConfirmed(input, "Administrator request");
    } catch (error) {
      const retain = retainAnalysisRequest(Boolean(adminRequest), error);
      if (!retain) setAdminRequest(null);
      setMessage(
        retain
          ? "Could not confirm administrator request. Its original reason and account remain retained; retry the identical request after restoring access."
          : "Administrator request was refused before acceptance. Its human reason is preserved; check current access before requesting again.",
      );
    }
  }
  async function cancelWork() {
    if (!saved || !origin || !ready || busy || approvalRequest) return;
    if (approvalOwner.current.generation !== approvalGeneration || approvalOwner.current.event?.inFlight ||
      (approvalOwner.current.event && !approvalOwner.current.event.consumed)) return;
    const input = cancelRequest ?? { ...origin, id: saved.id };
    if (!sameOrigin(input, origin)) return;
    setCancelRequest(input);
    setMessage("");
    try {
      const ack = await cancel.mutateAsync(input);
      if (
        !queueMatches(ack, input, input.id) ||
        (!ack.cancelledAt && ack.status !== "COMPLETE")
      )
        throw Error(
          "Cancellation acknowledgement did not match original saved work.",
        );
      setCancelRequest(null);
      setMessage(
        "Cancellation confirmed. Already claimed work may finish; no cancellation refund was invented.",
      );
      await refreshConfirmed(input, "Cancellation");
    } catch (error) {
      const retain = retainAnalysisRequest(Boolean(cancelRequest), error);
      if (!retain) setCancelRequest(null);
      setMessage(
        retain
          ? "Cancellation outcome unconfirmed. Keep the exact original request; do not assume work stopped."
          : "Cancellation was refused before acceptance. Work has not been confirmed stopped; check current access before trying again.",
      );
    }
  }
  return (
    <>
      <button
        type="button"
        className="btn-secondary"
        onClick={() => setOpen(true)}
      >
        {buttonLabel}
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
        {!ready ? (
          <p role="status">
            Current original account and workspace access must be verified.
            Private saved scopes, balances and controls are hidden; local drafts
            and exact unknown requests remain retained.
            <button
              type="button"
              onClick={() => {
                void project.refetch();
                void organizations.refetch();
              }}
            >
              Recheck original access
            </button>
          </p>
        ) : (
          <>
            {message && <p role="alert">{message}</p>}
            {refreshNotice && <p role="alert">{refreshNotice}</p>}
            {!jobId && (
              <>
                <label style={{ display: "grid", gap: 6 }}>
                  Analysis
                  <select
                    value={action}
                    disabled={busy || retained}
                    onChange={(e) => setAction(e.target.value as Action)}
                  >
                    <option value="RISK">Risk assessment</option>
                    <option value="TYPE_DESIGN">
                      Test type and design improvements
                    </option>
                  </select>
                </label>
                <p>
                  {reviewRequest?.ids.length ?? selectedIds.length} selected
                  cases. Maximum 1,000 per reviewed queue. Saved reviews and
                  existing risk assessments are preserved.
                </p>
                {!reviewRequest && selectedIds.length > 1000 && (
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
                    Boolean(approvalRequest || cancelRequest || adminRequest) ||
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
                        Processing finished. Failed or unavailable cases still
                        need attention; these recommendations are not executed
                        test results.
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
                        gridTemplateColumns:
                          "repeat(auto-fit,minmax(150px,1fr))",
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
                        type/design review at 12. Lower measured usage is
                        refunded once. Usage above the cap is recorded but not
                        charged to you. No repository files are read.
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
                    {approvalRequest && canSpendNow && (
                      <button
                        type="button"
                        className="btn-primary"
                        disabled={busy}
                        onClick={() => void authorize()}
                      >
                        Retry identical approval
                      </button>
                    )}
                    {adminRequest && (
                      <button
                        type="button"
                        disabled={
                          busy ||
                          Boolean(
                            approvalRequest || cancelRequest || reviewRequest,
                          )
                        }
                        onClick={() => void requestHelp()}
                      >
                        Retry identical administrator request
                      </button>
                    )}
                    {cancelRequest && (
                      <button
                        type="button"
                        disabled={
                          busy ||
                          Boolean(
                            approvalRequest || adminRequest || reviewRequest,
                          )
                        }
                        onClick={() => void cancelWork()}
                      >
                        Retry identical cancellation
                      </button>
                    )}
                    {saved.status === "REVIEW" && !approvalRequest && (
                      <>
                        {canSpendNow ? (
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
                                {saved.maximumCredits} credits for this exact
                                saved scope.
                              </span>
                            </label>
                            {saved.balance < saved.maximumCredits && (
                              <p role="alert">
                                The balance cannot cover this maximum. Request
                                help from your workspace administrator.
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
                        {(!canSpendNow ||
                          saved.balance < saved.maximumCredits) && (
                          <div style={{ display: "grid", gap: 8 }}>
                            <label
                              style={{ display: "grid", gap: 6, minWidth: 0 }}
                            >
                              Request reason
                              <textarea
                                style={{
                                  width: "100%",
                                  boxSizing: "border-box",
                                  minWidth: 0,
                                }}
                                value={reason}
                                maxLength={500}
                                disabled={busy || retained}
                                onChange={(e) => setReason(e.target.value)}
                              />
                            </label>
                            <button
                              type="button"
                              className="btn-secondary"
                              disabled={
                                busy ||
                                Boolean(
                                  adminRequest ||
                                  approvalRequest ||
                                  cancelRequest ||
                                  reviewRequest,
                                ) ||
                                !reason.trim() ||
                                !saved.counts.QUEUED
                              }
                              onClick={() => void requestHelp()}
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
                              {item.charged
                                ? " · charged receipt retained"
                                : ""}
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
                      <div
                        style={{ display: "flex", flexWrap: "wrap", gap: 8 }}
                      >
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
                          Cancellation stops subsequent spending. Already
                          charged work may finish and is not refunded by
                          cancellation.
                        </p>
                        <button
                          type="button"
                          className="btn-secondary"
                          disabled={
                            busy ||
                            Boolean(
                              cancelRequest ||
                              approvalRequest ||
                              adminRequest ||
                              reviewRequest,
                            )
                          }
                          onClick={() => void cancelWork()}
                        >
                          Cancel remaining work
                        </button>
                      </>
                    )}
                  </>
                )}
                {approvalRequest && !saved && (
                  <p>
                    The exact approval request is retained. Restore current
                    access and the saved scope before retrying.
                  </p>
                )}
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={busy || retained}
                  onClick={backToSelections}
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
                historyRows.map((job) => (
                  <p key={job.id}>
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={busy || retained}
                      onClick={() => selectJob(job.id)}
                    >
                      {job.action === "RISK" ? "Risk" : "Type/design"} ·{" "}
                      {job.caseCount} cases · {readableMetric(job.status)}
                    </button>
                  </p>
                ))}
              {historyFresh && historyRows.length === 0 && (
                <p>No saved analysis queues yet.</p>
              )}
            </details>
            <p>
              <small>
                Unconfirmed local requests are retained while this module stays
                mounted. Reloading or leaving the project may lose an
                unsubmitted local draft; saved server jobs remain in the
                original account.
              </small>
            </p>
          </>
        )}
      </Modal>
    </>
  );
}
