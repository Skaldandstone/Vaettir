"use client";

import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { resolveQualityExperience } from "@vaettir/core";
import { trpcReact, type RouterOutputs } from "@/lib/trpcReact";
import { useManualExecutionAccess } from "@/lib/use-manual-execution-access";
import { useManualRunCurrentReader } from "@/lib/use-manual-run-current-reader";
import { useRetainedManualRunRows } from "@/lib/use-retained-manual-run-rows";
import { ManualRunCurrentRenderGuard, type ManualRunCurrentOrigin, type ManualRunCurrentSnapshot } from "@/lib/manual-run-current-reader";
import { StepExecutionPanel } from "@/components/StepExecutionPanel";
import { ManualRetestActions } from "@/components/ManualRetestWizard";
import { manualProcedurePhases } from "@/lib/manual-procedure-phases";
import { ManualCaseResultHistory, type WholeCaseReviewIntent } from "@/components/ManualCaseResultHistory";
import { currentSessionScope } from "@/lib/auth-query-cache";
import { RunExecutionSummary } from "@/components/RunExecutionSummary";
import { admittedManualRunProgress } from "@/lib/manual-run-scope-availability";
import {
  manualCaseHistoryAnchor,
  manualCaseHistorySelection,
} from "@/lib/case-observation-history-entry";
import {
  manualRunCaseMatches,
  nextUntestedManualCase,
  type ManualRunCaseFilter,
} from "@/lib/manual-run-navigator";

type ExecutionCase =
  RouterOutputs["manualExecution"]["getForExecution"]["cases"][number];
const STATUS_COLORS: Record<string, string> = {
  PASS: "var(--frost)",
  FAIL: "var(--ember)",
  BLOCKED: "var(--ember)",
  SKIP: "var(--muted)",
};

function CaseRow({
  projectId,
  testCase,
  stepFieldLabels,
  disabled,
  runClosed,
  prerequisites,
  blockedBy,
  testRunId,
  onStepsChanged,
  onUnconfirmedStep,
  onUnconfirmedWholeCase,
  selectedFromHistory,
  readable,
  readScope,
  initiallyExpanded,
  hidden,
  navigationTarget,
  navigationRevision,
  onOpenCase,
  parentCurrent,
  parentActivation,
  parentRunScope,
}: {
  projectId: string;
  testCase: ExecutionCase;
  stepFieldLabels: Record<string, string>;
  disabled: boolean;
  runClosed: boolean;
  prerequisites: {
    id: string;
    displayId: string | null;
    title: string;
    status: string | null;
  }[];
  blockedBy: string[];
  testRunId: string;
  onStepsChanged: () => Promise<unknown>;
  onUnconfirmedStep: (pending: boolean) => void;
  onUnconfirmedWholeCase: (pending: boolean) => void;
  selectedFromHistory: boolean;
  readable: boolean;
  readScope: {
    projectId: string;
    originalOrganizationId?: string;
    expectedClerkActorId?: string;
  };
  initiallyExpanded: boolean;
  hidden: boolean;
  navigationTarget: boolean;
  navigationRevision: number;
  onOpenCase: (id: string) => void;
  parentCurrent: () => boolean;
  parentActivation: string;
  parentRunScope: ManualRunCurrentOrigin | null;
}) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const heading = useRef<HTMLButtonElement | null>(null);
  const focusedRevision = useRef(0);
  useEffect(() => {
    if (parentCurrent() && navigationTarget && navigationRevision > focusedRevision.current) {
      focusedRevision.current = navigationRevision;
      setExpanded(true);
      heading.current?.focus({ preventScroll: true });
      heading.current?.scrollIntoView({ block: "nearest" });
    }
  }, [navigationTarget, navigationRevision, parentCurrent]);
  useEffect(() => {
    if (parentCurrent() && selectedFromHistory) setExpanded(true);
  }, [selectedFromHistory, parentCurrent]);
  const [stepModeChosen, setStepModeChosen] = useState(false);
  const [wholeCasePending, setWholeCasePending] = useState(false);
  const [reviewIntent, setReviewIntent] = useState<WholeCaseReviewIntent | null>(null);
  const stepMode =
    stepModeChosen || testCase.stepResults.some((step) => step.current);
  const rowFrame = useRef({ readable, disabled: disabled || runClosed, hidden, stepMode, wholeCasePending });
  useLayoutEffect(() => {
    rowFrame.current = { readable, disabled: disabled || runClosed, hidden, stepMode, wholeCasePending };
  }, [readable, disabled, runClosed, hidden, stepMode, wholeCasePending]);
  function reviewOutcome(status: "PASS" | "FAIL" | "BLOCKED" | "SKIP") {
    const frame = rowFrame.current;
    const session = currentSessionScope(window.Clerk?.loaded ? window.Clerk.session : null);
    if (!parentCurrent() || !frame.readable || frame.disabled || frame.hidden || frame.stepMode ||
      frame.wholeCasePending || testCase.currentResult ||
      !session || session.userId !== readScope.expectedClerkActorId ||
      ((status === "PASS" || status === "FAIL") && blockedBy.length > 0)) return;
    // Intent only: one retained editor owns note/context/raw measurements and
    // reviews the current native frozen baseline before any UUID-bound write.
    setExpanded(true);
    setReviewIntent({ seedId: crypto.randomUUID(), status, note: null });
  }

  const currentStatus = testCase.currentResult?.status ?? null;

  return (
    <div
      id={manualCaseHistoryAnchor(testCase.testCaseId) ?? undefined}
      className="panel"
      hidden={hidden}
      style={{
        marginBottom: 10,
        padding: 12,
        display: hidden ? "none" : undefined,
      }}
    >
      {readable && (
        <>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <button
              ref={heading}
              aria-expanded={expanded}
              onClick={() => {
                if (!parentCurrent()) return;
                if (!expanded) onOpenCase(testCase.testCaseId);
                setExpanded((v) => !v);
              }}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                textAlign: "left",
                fontWeight: 600,
                padding: 0,
                color: "var(--fg)",
              }}
            >
              {expanded ? "▾" : "▸"}{" "}
              <span title={testCase.displayId ? "Case ID" : "Stable case record ID"}>{testCase.displayId ?? testCase.testCaseId}</span> · {testCase.title}
            </button>
            {currentStatus && (
              <span
                style={{
                  color: STATUS_COLORS[currentStatus] ?? "var(--muted)",
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                {currentStatus}
              </span>
            )}
          </div>

          {prerequisites.length > 0 && (
            <p className="text-muted" style={{ fontSize: 12, marginTop: 6 }}>
              Prerequisite cases in this run:{" "}
              {prerequisites.map(({ id, displayId, title, status }) => (
                <span
                  key={id}
                  style={{
                    display: "inline-flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    gap: 6,
                    marginRight: 10,
                    marginBlock: 4,
                  }}
                >
                  <a
                    onClick={event => { if (!parentCurrent()) event.preventDefault(); }}
                    href={`/projects/${encodeURIComponent(projectId)}/test-cases/${encodeURIComponent(id)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={`${title}. Opens the current case in a new tab, not this run's frozen procedure.`}
                    style={{
                      border: "1px solid var(--line)",
                      borderRadius: 999,
                      padding: "2px 8px",
                    }}
                  >
                    {displayId ?? id}
                  </a>
                  <span>
                    {title} ({status ?? "not run"})
                  </span>
                </span>
              ))}
            </p>
          )}
          {blockedBy.length > 0 && (
            <p
              role="status"
              style={{ color: "var(--warning)", fontSize: 12, marginTop: 4 }}
            >
              Complete {blockedBy.join(", ")} with Pass before recording Pass or
              Fail here. Blocked and Skip remain available.
            </p>
          )}

          {expanded && (
            <div style={{ marginTop: 10, fontSize: 13 }}>
              {testCase.background && (
                <p style={{ whiteSpace: "pre-wrap" }}>{testCase.background}</p>
              )}
              <p>
                <strong>{testCase.validationDomain.replace(/_/g, " ")}</strong>
              </p>
              {(
                [
                  ["setup", "Fixture and setup"],
                  ["safety", "Safety and stop conditions"],
                  ["instruments", "Instruments and calibration"],
                  ["acceptanceCriteria", "Measurement acceptance criteria"],
                ] as const
              ).map(
                ([key, label]) =>
                  testCase.verificationProfile[key] && (
                    <div key={key}>
                      <strong>{label}</strong>
                      <p style={{ whiteSpace: "pre-wrap" }}>
                        {testCase.verificationProfile[key]}
                      </p>
                    </div>
                  ),
              )}
              {!stepMode && (
                <>
                  {manualProcedurePhases(testCase).map(
                    (phase) =>
                      phase.steps.length > 0 && (
                        <div key={phase.label} style={{ marginBottom: 8 }}>
                          <div className="eyebrow" style={{ fontSize: 11 }}>
                            {phase.label}
                          </div>
                          {phase.steps.map((line, index) => (
                            <div
                              key={index}
                              style={{
                                whiteSpace: "pre-wrap",
                                overflowWrap: "anywhere",
                              }}
                            >
                              {line === "" ? <em>Empty step text</em> : line}
                            </div>
                          ))}
                        </div>
                      ),
                  )}
                </>
              )}
                  {testCase.steps.length > 0 && (
                    <div
                      role="region"
                      aria-label="Complete stored procedure steps"
                      tabIndex={0}
                      style={{ overflowX: "auto", maxWidth: "100%" }}
                    >
                      <table
                        style={{
                          width: "100%",
                          minWidth: 720,
                          borderCollapse: "collapse",
                          marginBottom: 8,
                        }}
                      >
                        <caption>
                          Stored step order and all expected columns are
                          retained. Media IDs are references, not fetched or
                          verified files.
                        </caption>
                        <thead>
                          <tr>
                            <th style={{ textAlign: "left", fontSize: 11 }}>
                              Stored order
                            </th>
                            <th style={{ textAlign: "left", fontSize: 11 }}>
                              {stepFieldLabels.action ?? "Step"}
                            </th>
                            <th style={{ textAlign: "left", fontSize: 11 }}>
                              {stepFieldLabels.expectedActionOrData ??
                                "Expected action/data"}
                            </th>
                            <th style={{ textAlign: "left", fontSize: 11 }}>
                              {stepFieldLabels.expectedResult ??
                                "Expected result"}
                            </th>
                            <th style={{ textAlign: "left", fontSize: 11 }}>
                              {stepFieldLabels.expectedResponse ??
                                "Expected response"}
                            </th>
                            <th style={{ textAlign: "left", fontSize: 11 }}>
                              Media references
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {testCase.steps.map((s) => (
                            <tr key={s.order}>
                              <td>{s.order}</td>
                              {(
                                [
                                  "action",
                                  "expectedActionOrData",
                                  "expectedResult",
                                  "expectedResponse",
                                ] as const
                              ).map((field) => (
                                <td
                                  key={field}
                                  style={{
                                    whiteSpace: "pre-wrap",
                                    overflowWrap: "anywhere",
                                    verticalAlign: "top",
                                  }}
                                >
                                  {s[field] === null ? (
                                    "Not supplied"
                                  ) : s[field] === "" ? (
                                    <em>Empty text</em>
                                  ) : (
                                    s[field]
                                  )}
                                </td>
                              ))}
                              <td>
                                {s.mediaAttachmentIds.length ? (
                                  <ul>
                                    {s.mediaAttachmentIds.map((id, index) => (
                                      <li
                                        key={index}
                                        style={{ overflowWrap: "anywhere" }}
                                      >
                                        {id}
                                      </li>
                                    ))}
                                  </ul>
                                ) : (
                                  "None"
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
              {!stepMode && (
                  <p>
                    Review an observation below. Notes and optional laboratory
                    context stay in one retained editor, with raw measurement
                    buffers and an explicit review before saving.
                  </p>
              )}
            </div>
          )}
        </>
      )}
      <div hidden={!expanded || !readable}>
        <StepExecutionPanel
          testRunId={testRunId}
          testCase={testCase}
          stepFieldLabels={stepFieldLabels}
          readable={readable && expanded && !hidden}
          readScope={readScope}
          parentRunScope={parentRunScope}
          parentCurrent={parentCurrent}
          parentActivation={parentActivation}
          active={stepMode}
          disabled={disabled || wholeCasePending}
          blockedBy={blockedBy}
          onModeActive={() => { if (parentCurrent()) setStepModeChosen(true); }}
          onChanged={onStepsChanged}
          onUnconfirmedChange={onUnconfirmedStep}
        />
        <ManualCaseResultHistory
          key={`${projectId}:${testRunId}:${testCase.testCaseId}`}
          projectId={projectId}
          testRunId={testRunId}
          testCaseId={testCase.testCaseId}
          parentRunScope={parentRunScope}
          parentCurrent={parentCurrent}
          parentActivation={parentActivation}
          active={readable && expanded && !hidden && !stepMode}
          disabled={disabled}
          reviewIntent={reviewIntent}
          onChanged={onStepsChanged}
          onUnconfirmedChange={(pending) => {
            setWholeCasePending(pending);
            onUnconfirmedWholeCase(pending);
          }}
        />
      </div>

      {readable && !stepMode && (
        <div
          style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}
        >
          <p style={{ flexBasis: "100%" }}>
            Choose an initial observed outcome to open its reviewed editor. This
            does not save a result. Existing observations use reasoned immutable
            corrections in the history above, not unversioned overwrites.
          </p>
          <button
            className="btn-secondary"
            onClick={() => reviewOutcome("PASS")}
            disabled={
              disabled ||
              runClosed ||
              wholeCasePending ||
              !!testCase.currentResult ||
              blockedBy.length > 0
            }
          >
            Pass
          </button>
          <button
            className="btn-secondary"
            onClick={() => reviewOutcome("FAIL")}
            disabled={
              disabled ||
              runClosed ||
              wholeCasePending ||
              !!testCase.currentResult ||
              blockedBy.length > 0
            }
          >
            Fail
          </button>
          <button
            className="btn-secondary"
            onClick={() => reviewOutcome("BLOCKED")}
            disabled={
              disabled || runClosed || wholeCasePending || !!testCase.currentResult
            }
          >
            Blocked
          </button>
          <button
            className="btn-secondary"
            onClick={() => reviewOutcome("SKIP")}
            disabled={
              disabled || runClosed || wholeCasePending || !!testCase.currentResult
            }
          >
            Skip
          </button>
        </div>
      )}
    </div>
  );
}

// P1-15
function ManualExecutionContent() {
  const { projectId, testRunId } = useParams<{
    projectId: string;
    testRunId: string;
  }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const access = useManualExecutionAccess(projectId);
  const reader = useManualRunCurrentReader(projectId, testRunId, access.origin?.organizationId, { ready: access.ready });
  const rows = useRetainedManualRunRows(reader.snapshot);
  const snapshot = rows.current === reader.snapshot ? rows.current : null;
  const fresh = snapshot?.data.view;
  const original = snapshot?.origin ?? rows.retained?.origin;
  const readInput = {
    testRunId,
    projectId,
    originalOrganizationId: original?.organizationId,
    expectedClerkActorId: original?.clerkActorId,
  };
  const [caseSearch, setCaseSearch] = useState("");
  const [caseFilter, setCaseFilter] = useState<ManualRunCaseFilter>("ALL");
  const [navigation, setNavigation] = useState<{
    id: string | null;
    revision: number;
  }>({ id: null, revision: 0 });
  const [navigationNotice, setNavigationNotice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [unconfirmedStepCases, setUnconfirmedStepCases] = useState<Set<string>>(
    () => new Set(),
  );
  const [unconfirmedWholeCases, setUnconfirmedWholeCases] = useState<
    Set<string>
  >(() => new Set());
  // Private event-owned completion interlock, never read authority.
  // Reporting one's pending state must not revoke its own already reviewed
  // native request immediately before dispatch or its matching ACK callback.
  const [pendingCompletion] = useState(() => ({ step: new Set<string>(), whole: new Set<string>() }));
  const [retainedRetestCases, setRetainedRetestCases] = useState<Set<string>>(
    () => new Set(),
  );
  const completeMutation = trpcReact.manualExecution.complete.useMutation();
  const [pageGuard] = useState(() => new ManualRunCurrentRenderGuard());
  const frame = useMemo(() => ({ snapshot, caseSearch, caseFilter, navigation, error, completePending: completeMutation.isPending }),
    [snapshot, caseSearch, caseFilter, navigation, error, completeMutation.isPending]);
  const stamp = pageGuard.observe(frame, snapshot);
  const postedStamp = useRef<typeof stamp | null>(null);
  const [committedStamp, setCommittedStamp] = useState<typeof stamp | null>(null);
  useLayoutEffect(() => {
    if (!pageGuard.matchesRender(stamp)) return;
    postedStamp.current = stamp;
    setCommittedStamp(stamp);
    return () => { if (postedStamp.current === stamp) postedStamp.current = null; };
  }, [pageGuard, stamp]);
  const readable = !!snapshot && committedStamp === stamp;
  const canEdit = readable && access.canWrite && fresh?.canWrite === true;
  function currentFrame() {
    return !!snapshot && postedStamp.current === stamp && pageGuard.matchesRender(stamp) && reader.current() === snapshot;
  }
  function currentCase(id: string) {
    return currentFrame() && snapshot!.data.view.cases.some(testCase => testCase.testCaseId === id);
  }
  const parentActivation = `${snapshot?.data.readContext.requestId ?? "private"}:${stamp.renderGeneration}`;
  useEffect(() => {
    if (!readable || !fresh || !currentFrame()) return;
    const qualifying = fresh.cases
      .filter(
        (tc) =>
          tc.currentResult?.status === "FAIL" ||
          tc.currentResult?.status === "BLOCKED" ||
          fresh.executionContext?.retest?.sourceCaseId ===
            tc.testCaseId,
      )
      .map((tc) => tc.testCaseId);
    setRetainedRetestCases((current) => {
      if (qualifying.every((id) => current.has(id))) return current;
      return new Set([...current, ...qualifying]);
    });
  }, [readable, fresh, snapshot, stamp]);

  // React state preserves the mounted native rows/drafts through denied or
  // paused reads. A guarded same-component adjustment cannot publish an
  // uncommitted ref value; factual row rendering remains gated by readable.
  const [retainedNativeData, setRetainedNativeData] = useState<
    ManualRunCurrentSnapshot["data"]["view"] | undefined
  >(undefined);
  if (fresh && retainedNativeData !== fresh) setRetainedNativeData(fresh);
  const data = readable ? fresh : retainedNativeData;
  const pageError = error ?? reader.error ?? (rows.reason && rows.reason !== "NO_CURRENT_READ" ? "The whole current run cannot be published without changing original scope or exceeding private retention bounds. Entries remain retained." : null);
  const historySelection = manualCaseHistorySelection({
    requestedCaseIds: searchParams.getAll("caseId"),
    projectId,
    testRunId,
    fresh: readable,
    response: data,
  });
  const selectedHistoryAnchor =
    historySelection.kind === "SELECTED" ? historySelection.anchor : null;
  useEffect(() => {
    if (currentFrame() && selectedHistoryAnchor)
      document
        .getElementById(selectedHistoryAnchor)
        ?.scrollIntoView({ block: "start" });
  }, [selectedHistoryAnchor, snapshot, stamp]);

  function recheckAccess() {
    // Discovery retry and native intent are separate explicit actions. Never
    // adopt a newer actor/frame after awaiting metadata discovery.
    if (!access.ready) { void access.refresh(); return; }
    reader.refresh();
  }
  if (!data)
    return (
      <section role={access.denied || pageError ? "alert" : "status"}>
        <p>
          {access.denied
            ? "Original workspace and signed-in actor access could not be verified."
            : pageError
              ? "The exact saved run could not be loaded."
              : "Verifying current original workspace and saved-run access…"}
        </p>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => void recheckAccess()}
        >
          Recheck original run access
        </button>
      </section>
    );

  const recordedCount = data.cases.filter((c) => c.currentResult).length;
  const plannedScope = readable ? admittedManualRunProgress(data) : null;
  const loadedCases = data.cases;
  const matchingCases = data.cases.filter((testCase) =>
    manualRunCaseMatches(testCase, caseSearch, caseFilter),
  );
  function navigateToCase(id: string, resetFilters = false) {
    if (
      !currentFrame() ||
      !loadedCases.some((testCase) => testCase.testCaseId === id)
    )
      return;
    pageGuard.revokeActions();
    if (resetFilters) {
      setCaseSearch("");
      setCaseFilter("ALL");
    }
    setNavigation((current) => ({ id, revision: current.revision + 1 }));
    setNavigationNotice(
      resetFilters
        ? "Opened the next untested case. Display filters were reset; no result was recorded."
        : "Opened the matching case. No result was recorded.",
    );
  }

  return (
    <div style={{ maxWidth: 800 }}>
      {!readable && (
        <section role={access.denied || !!pageError ? "alert" : "status"}>
          <p>
            Current original actor, workspace and exact saved run must be
            verified. Private cached procedures and observations are hidden;
            mounted drafts and identical requests remain retained.
          </p>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void recheckAccess()}
          >
            Recheck original run access
          </button>
        </section>
      )}
      {readable && (
        <>
          {historySelection.kind === "UNAVAILABLE" && (
            <p role="alert">
              The exact requested case is not uniquely present in this run's
              supported saved procedure. No other case was selected, and the
              current case definition was not substituted.
            </p>
          )}
          {historySelection.kind === "WAITING" && (
            <p role="status">
              Verifying the exact saved run before selecting its requested case.
              This link does not record any result.
            </p>
          )}
          {pageError && (
            <div>
              <p role="alert" style={{ color: "var(--ember)" }}>
                {pageError} Displayed evidence and open drafts are retained.
              </p>
              <button
                className="btn-secondary"
                onClick={() => {
                  if (!currentFrame()) return;
                  setError(null);
                  reader.refresh();
                }}
              >
                Refresh run without discarding drafts
              </button>
            </div>
          )}
          {unconfirmedStepCases.size > 0 && (
            <p role="status">
              Confirm pending step responses before completing this run. Retry
              receipts and entered evidence remain retained.
            </p>
          )}
          {unconfirmedWholeCases.size > 0 && (
            <p role="status">
              Confirm pending whole-case observation responses before completing
              this run. Reopen the original case to retry its exact retained
              request.
            </p>
          )}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <h1>Manual test run</h1>
            <button
              className="btn-primary"
              onClick={() => {
                if (!currentFrame() || !canEdit || completeMutation.isPending || pendingCompletion.step.size || pendingCompletion.whole.size || data.status !== "RUNNING") return;
                if (!plannedScope || plannedScope.unavailableCaseIds.length > 0) return;
                if (
                  recordedCount === plannedScope.plannedCount ||
                  confirm(
                    "Some cases have no result. Finish as an incomplete run?",
                  )
                ) {
                  if (!currentFrame() || pendingCompletion.step.size || pendingCompletion.whole.size) return;
                  // Legacy completion is NOT a reviewed UUID/CAS recovery path.
                  // Keep its response presentation tied to this exact native read.
                  const submittedSnapshot = snapshot;
                  completeMutation.mutate({ testRunId }, {
                    onSuccess: () => { if (submittedSnapshot && reader.current() === submittedSnapshot) router.push(`/projects/${projectId}/test-runs`); },
                    onError: () => { if (submittedSnapshot && reader.current() === submittedSnapshot) setError("Run completion could not be confirmed. Retain evidence and recheck original run access; this is not a recovered completion receipt."); },
                  });
                }
              }}
              disabled={
                !canEdit ||
                !plannedScope ||
                plannedScope.unavailableCaseIds.length > 0 ||
                completeMutation.isPending ||
                unconfirmedStepCases.size > 0 ||
                unconfirmedWholeCases.size > 0 ||
                data.status !== "RUNNING"
              }
            >
              {completeMutation.isPending ? "Completing…" : "Complete run"}
            </button>
          </div>
          <p className="text-muted" style={{ fontSize: 13 }}>
            {recordedCount} / {plannedScope ? plannedScope.plannedCount : "unavailable planned scope"} recorded · status:{" "}
            {data.status}
          </p>
          {!plannedScope && <p role="alert">The complete saved planned identity scope could not be admitted. Progress, completion and exports are unavailable; no smaller available-case denominator was substituted.</p>}
          {plannedScope && plannedScope.unavailableCaseIds.length > 0 && <section className="panel" aria-label="Unavailable planned procedures"><h2>Unavailable planned procedures</h2><p>These saved planned identities remain left to test. No current or frozen procedure was available; completion and whole-run exports are blocked without inventing instructions.</p><ul>{plannedScope.unavailableCaseIds.map(id => <li key={id}><code>{id}</code> · Procedure unavailable, read-only retained identity</li>)}</ul></section>}
          {plannedScope && <RunExecutionSummary
            cases={data.cases}
            runId={testRunId}
            projectId={projectId}
            status={data.status}
            executionContext={data.executionContext}
            stepFieldLabels={data.stepFieldLabels}
            canExport={currentFrame}
            plannedScope={plannedScope}
          />}
          <section
            className="panel"
            aria-label="Run case navigator"
            style={{ position: "sticky", top: 8, zIndex: 20, marginBottom: 12 }}
          >
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                alignItems: "end",
              }}
            >
              <label style={{ display: "grid", gap: 4, flex: "1 1 230px" }}>
                Find a run case
                <input
                  value={caseSearch}
                  onChange={(event) => { if (currentFrame()) { pageGuard.revokeActions(); setCaseSearch(event.target.value); } }}
                  placeholder="Search case ID or title"
                />
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                Show
                <select
                  value={caseFilter}
                  onChange={(event) => {
                    if (!currentFrame()) return;
                    pageGuard.revokeActions();
                    setCaseFilter(event.target.value as ManualRunCaseFilter);
                  }}
                >
                  <option value="ALL">All outcomes</option>
                  <option value="UNTESTED">Untested</option>
                  <option value="FAILED">Failed</option>
                  <option value="BLOCKED">Blocked</option>
                  <option value="RECORDED">Recorded</option>
                </select>
              </label>
              <button
                type="button"
                className="btn-secondary"
                disabled={!matchingCases.length}
                onClick={() => {
                  if (matchingCases[0])
                    navigateToCase(matchingCases[0].testCaseId);
                }}
              >
                Open first match
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={
                  !data.cases.some((testCase) => !testCase.currentResult)
                }
                onClick={() => {
                  if (!currentFrame()) return;
                  const id = nextUntestedManualCase(
                    data.cases,
                    navigation.id ??
                      (historySelection.kind === "SELECTED"
                        ? historySelection.caseId
                        : null) ??
                      (
                        data.cases.find(
                          (testCase) => !testCase.currentResult,
                        ) ?? data.cases[0]
                      )?.testCaseId ??
                      null,
                  );
                  if (id) navigateToCase(id, true);
                }}
              >
                Next untested case
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  if (!currentFrame()) return;
                  pageGuard.revokeActions();
                  setCaseSearch("");
                  setCaseFilter("ALL");
                  setNavigationNotice("");
                }}
              >
                Show all cases
              </button>
            </div>
            <p className="text-muted">
              {matchingCases.length} shown of {data.cases.length} cases in this
              run. Hidden cases keep their entered drafts and pending requests.
              Navigation never records an outcome.
            </p>
            {navigationNotice && <p role="status">{navigationNotice}</p>}
            {!matchingCases.length && (
              <p role="status">
                No cases match these display filters. Show all cases to return
                to the run.
              </p>
            )}
          </section>
          {data.executionContext?.datasetExecution && (
            <section
              style={{
                border: "1px solid var(--line)",
                padding: 12,
                marginBottom: 16,
              }}
            >
              <h2 style={{ fontSize: 18 }}>
                Dataset row{" "}
                {data.executionContext.datasetExecution.rowIndex + 1}:{" "}
                {data.executionContext.datasetExecution.rowName}
              </h2>
              <p>
                {data.executionContext.datasetExecution.sourceDisplayId} · one
                independently recorded row run. Prerequisites must pass within
                this run, not in a sibling row or another configuration.
              </p>
              <details>
                <summary>Frozen parameter values</summary>
                <dl>
                  {Object.entries(
                    data.executionContext.datasetExecution.values,
                  ).map(([key, value]) => (
                    <div key={key}>
                      <dt>{key}</dt>
                      <dd
                        style={{
                          marginLeft: 0,
                          whiteSpace: "pre-wrap",
                          overflowWrap: "anywhere",
                        }}
                      >
                        {value || "(empty text)"}
                      </dd>
                    </div>
                  ))}
                </dl>
              </details>
              <details>
                <summary>Other rows in this reviewed batch</summary>
                <ul>
                  {data.datasetBatchRuns.map((row) => (
                    <li key={row.testRunId}>
                      {row.testRunId === testRunId ? (
                        <strong>Current row: {row.rowName}</strong>
                      ) : (
                        <a
                          onClick={event => { if (!currentFrame()) event.preventDefault(); }}
                          href={`/projects/${projectId}/test-runs/manual/${row.testRunId}`}
                        >
                          Row {row.rowIndex + 1}: {row.rowName}
                        </a>
                      )}{" "}
                      <span className="text-muted">
                        ({row.status.toLowerCase()})
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            </section>
          )}
          {data.executionContext ? (
            <details style={{ marginBottom: 16 }}>
              <summary>
                Saved execution context
                {data.executionContext.experience
                  ? `: ${resolveQualityExperience(data.executionContext.experience).title}`
                  : ""}
              </summary>
              <p>
                These case definitions and configuration were saved when this
                run started. Later profile or case edits do not rewrite this
                run. Recorded results remain separate evidence; this context
                does not certify safety or compliance.
              </p>
              {data.executionContext.plan && (
                <section style={{ marginBottom: 12 }}>
                  <h2 style={{ fontSize: 16 }}>Frozen plan definition</h2>
                  <dl>
                    <dt>Plan</dt>
                    <dd style={{ marginLeft: 0 }}>
                      <a
                        onClick={event => { if (!currentFrame()) event.preventDefault(); }}
                        href={`/projects/${projectId}/test-plans/${data.executionContext.plan.testPlanId}`}
                      >
                        {data.executionContext.plan.name}
                      </a>{" "}
                      <span className="text-muted">
                        (link opens the current plan)
                      </span>
                    </dd>
                    <dt>Saved configuration</dt>
                    <dd style={{ marginLeft: 0 }}>
                      {data.executionContext.plan.template.configurations.find(
                        (configuration) =>
                          configuration.id ===
                          data.executionContext!.plan!.configurationId,
                      )?.name ?? data.executionContext.plan.configurationId}
                    </dd>
                    <dt>Definition fingerprint</dt>
                    <dd style={{ marginLeft: 0, overflowWrap: "anywhere" }}>
                      <code>{data.executionContext.plan.templateHash}</code>
                    </dd>
                  </dl>
                  <p className="text-muted">
                    This execution retains the reviewed plan and preset. Editing
                    the current plan does not change this record; repeating it
                    creates a separate run.
                  </p>
                </section>
              )}
              <dl>
                {Object.entries(data.executionContext.configuration)
                  .filter(([, value]) => value)
                  .map(([key, value]) => (
                    <div key={key} style={{ marginBottom: 8 }}>
                      <dt>{key.replace(/([A-Z])/g, " $1")}</dt>
                      <dd
                        style={{
                          margin: 0,
                          whiteSpace: "pre-wrap",
                          overflowWrap: "anywhere",
                        }}
                      >
                        {value}
                      </dd>
                    </div>
                  ))}
              </dl>
              {data.executionContext.experience && (
                <ul>
                  {resolveQualityExperience(
                    data.executionContext.experience,
                  ).runGuidance.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              )}
            </details>
          ) : (
            <p className="text-muted">
              Legacy run: no saved profile/configuration snapshot. The displayed
              procedure may reflect later case edits.
            </p>
          )}
        </>
      )}

      {(rows.retained?.rows ?? [])
        .filter(
          (tc) =>
            retainedRetestCases.has(tc.testCaseId) ||
            tc.currentResult?.status === "FAIL" ||
            tc.currentResult?.status === "BLOCKED" ||
            data.executionContext?.retest?.sourceCaseId === tc.testCaseId,
        )
        .map((tc) => (
          <section
            key={`retest:${tc.testCaseId}`}
            style={{
              border: "1px solid var(--line)",
              padding: 12,
              marginBottom: 12,
              minWidth: 0,
            }}
            hidden={!readable || !fresh?.cases.some(current => current.testCaseId === tc.testCaseId)}
          >
            {readable && fresh?.cases.some(current => current.testCaseId === tc.testCaseId) && (
              <h2 style={{ fontSize: 16 }}>
                Retest relationships · {tc.displayId ?? tc.title}
              </h2>
            )}
            <ManualRetestActions
              key={`${projectId}:${testRunId}:${tc.testCaseId}`}
              projectId={projectId}
              sourceRunId={testRunId}
              testCaseId={tc.testCaseId}
              active={readable && !!fresh?.cases.some(current => current.testCaseId === tc.testCaseId)}
              canRetest={
                canEdit && !!fresh?.cases.some(current => current.testCaseId === tc.testCaseId) &&
                (tc.currentResult?.status === "FAIL" ||
                  tc.currentResult?.status === "BLOCKED")
              }
            />
          </section>
        ))}

      {(rows.retained?.rows ?? []).map((tc) => (
        <CaseRow
          key={`${projectId}:${testRunId}:${tc.testCaseId}`}
          projectId={projectId}
          testCase={tc}
          testRunId={testRunId}
          initiallyExpanded={
            tc.testCaseId ===
            (
              data.cases.find((testCase) => !testCase.currentResult) ??
              data.cases[0]
            )?.testCaseId
          }
          hidden={!readable || !fresh?.cases.some(current => current.testCaseId === tc.testCaseId) || !manualRunCaseMatches(tc, caseSearch, caseFilter)}
          navigationTarget={navigation.id === tc.testCaseId}
          navigationRevision={navigation.revision}
          onOpenCase={(id) => { if (currentCase(id)) { pageGuard.revokeActions(); setNavigation((current) => ({ ...current, id })); } }}
          selectedFromHistory={
            historySelection.kind === "SELECTED" &&
            historySelection.caseId === tc.testCaseId
          }
          readable={readable && !!fresh?.cases.some(current => current.testCaseId === tc.testCaseId)}
          readScope={readInput}
          parentRunScope={snapshot?.origin ?? null}
          parentCurrent={() => currentCase(tc.testCaseId)}
          parentActivation={parentActivation}
          onStepsChanged={async () => { if (currentCase(tc.testCaseId)) reader.refresh(); }}
          onUnconfirmedStep={(pending) => {
            if (pending) pendingCompletion.step.add(tc.testCaseId);
            else pendingCompletion.step.delete(tc.testCaseId);
            setUnconfirmedStepCases((current) => {
              if (current.has(tc.testCaseId) === pending) return current;
              const next = new Set(current);
              if (pending) next.add(tc.testCaseId);
              else next.delete(tc.testCaseId);
              return next;
            });
          }}
          onUnconfirmedWholeCase={(pending) => {
            if (pending) pendingCompletion.whole.add(tc.testCaseId);
            else pendingCompletion.whole.delete(tc.testCaseId);
            setUnconfirmedWholeCases((current) => {
              if (current.has(tc.testCaseId) === pending) return current;
              const next = new Set(current);
              if (pending) next.add(tc.testCaseId);
              else next.delete(tc.testCaseId);
              return next;
            });
          }}
          prerequisites={tc.prerequisiteIds.map((id) => {
            const prerequisite = data.cases.find(
              (candidate) => candidate.testCaseId === id,
            );
            return {
              id,
              displayId: prerequisite?.displayId ?? null,
              title: prerequisite?.title ?? "Unavailable case",
              status: prerequisite?.currentResult?.status ?? null,
            };
          })}
          blockedBy={tc.prerequisiteIds
            .filter(
              (id) =>
                data.cases.find((candidate) => candidate.testCaseId === id)
                  ?.currentResult?.status !== "PASS",
            )
            .map((id) => {
              const prerequisite = data.cases.find(
                (candidate) => candidate.testCaseId === id,
              );
              return `${prerequisite?.displayId ?? id} · ${prerequisite?.title ?? "Unavailable case"}`;
            })}
          stepFieldLabels={data.stepFieldLabels}
          runClosed={data.status !== "RUNNING"}
          disabled={
            !canEdit || completeMutation.isPending
          }
        />
      ))}
    </div>
  );
}

export default function ManualExecutionPage() {
  const { projectId, testRunId } = useParams<{
    projectId: string;
    testRunId: string;
  }>();
  return (
    <Suspense fallback={<p role="status">Loading saved run selection…</p>}>
      <ManualExecutionContent key={`${projectId}:${testRunId}`} />
    </Suspense>
  );
}
