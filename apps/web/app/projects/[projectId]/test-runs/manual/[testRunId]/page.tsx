"use client";

import { Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { resolveQualityExperience } from "@vaettir/core";
import { trpcReact, type RouterOutputs } from "@/lib/trpcReact";
import { useManualExecutionAccess } from "@/lib/use-manual-execution-access";
import { manualExecutionReadMatches } from "@/lib/manual-execution-read-policy";
import { manualExecutionReadRequestKey } from "@vaettir/api/src/services/manualExecutionReadScopeSchema";
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
}) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const heading = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (navigationTarget && navigationRevision > 0) {
      setExpanded(true);
      heading.current?.focus({ preventScroll: true });
      heading.current?.scrollIntoView({ block: "nearest" });
    }
  }, [navigationTarget, navigationRevision]);
  useEffect(() => {
    if (selectedFromHistory) setExpanded(true);
  }, [selectedFromHistory]);
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
    if (!frame.readable || frame.disabled || frame.hidden || frame.stepMode ||
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
              {testCase.displayId ?? "Case ID unavailable"} · {testCase.title}
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
                    {displayId ?? "Case ID unavailable"}
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
                  <p>
                    Review an observation below. Notes and optional laboratory
                    context stay in one retained editor, with raw measurement
                    buffers and an explicit review before saving.
                  </p>
                </>
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
          active={stepMode}
          disabled={disabled || wholeCasePending}
          blockedBy={blockedBy}
          onModeActive={() => setStepModeChosen(true)}
          onChanged={onStepsChanged}
          onUnconfirmedChange={onUnconfirmedStep}
        />
        <ManualCaseResultHistory
          key={`${projectId}:${testRunId}:${testCase.testCaseId}`}
          projectId={projectId}
          testRunId={testRunId}
          testCaseId={testCase.testCaseId}
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
  const utils = trpcReact.useUtils();
  const readInput = {
    testRunId,
    projectId,
    originalOrganizationId: access.origin?.organizationId,
    expectedClerkActorId: access.origin?.clerkActorId,
  };
  const dataQuery = trpcReact.manualExecution.getForExecution.useQuery(
    readInput,
    { enabled: access.ready, staleTime: 0, retry: false },
  );
  const readable = manualExecutionReadMatches(
    {
      projectId,
      testRunId,
      organizationId: access.origin?.organizationId,
      clerkActorId: access.origin?.clerkActorId,
      requestKey: manualExecutionReadRequestKey(readInput),
      ready: access.ready,
      error: !!dataQuery.error,
      fetching: dataQuery.isFetching,
      paused: dataQuery.isPaused,
    },
    dataQuery.data,
  );
  const canEdit =
    readable && access.canWrite && dataQuery.data?.canWrite === true;
  const accessNow = useRef({ readable, canEdit, ready: access.ready });
  const [caseSearch, setCaseSearch] = useState("");
  const [caseFilter, setCaseFilter] = useState<ManualRunCaseFilter>("ALL");
  const [navigation, setNavigation] = useState<{
    id: string | null;
    revision: number;
  }>({ id: null, revision: 0 });
  const [navigationNotice, setNavigationNotice] = useState("");
  useLayoutEffect(() => {
    accessNow.current = { readable, canEdit, ready: access.ready };
  }, [readable, canEdit, access.ready]);
  const [error, setError] = useState<string | null>(null);
  const [unconfirmedStepCases, setUnconfirmedStepCases] = useState<Set<string>>(
    () => new Set(),
  );
  const [unconfirmedWholeCases, setUnconfirmedWholeCases] = useState<
    Set<string>
  >(() => new Set());
  const [retainedRetestCases, setRetainedRetestCases] = useState<Set<string>>(
    () => new Set(),
  );
  useEffect(() => {
    if (!readable || !dataQuery.data) return;
    const qualifying = dataQuery.data.cases
      .filter(
        (tc) =>
          tc.currentResult?.status === "FAIL" ||
          tc.currentResult?.status === "BLOCKED" ||
          dataQuery.data?.executionContext?.retest?.sourceCaseId ===
            tc.testCaseId,
      )
      .map((tc) => tc.testCaseId);
    setRetainedRetestCases((current) => {
      if (qualifying.every((id) => current.has(id))) return current;
      return new Set([...current, ...qualifying]);
    });
  }, [readable, dataQuery.data]);

  const completeMutation = trpcReact.manualExecution.complete.useMutation({
    onSuccess: () => {
      if (accessNow.current.readable)
        router.push(`/projects/${projectId}/test-runs`);
    },
    onError: (e) => setError(e.message),
  });

  // React state preserves the mounted native rows/drafts through denied or
  // paused reads. A guarded same-component adjustment cannot publish an
  // uncommitted ref value; factual row rendering remains gated by readable.
  const [retainedNativeData, setRetainedNativeData] = useState<
    RouterOutputs["manualExecution"]["getForExecution"] | undefined
  >(undefined);
  if (readable && dataQuery.data && retainedNativeData !== dataQuery.data)
    setRetainedNativeData(dataQuery.data);
  const data = readable ? dataQuery.data : retainedNativeData;
  const pageError = error ?? dataQuery.error?.message ?? null;
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
    if (selectedHistoryAnchor)
      document
        .getElementById(selectedHistoryAnchor)
        ?.scrollIntoView({ block: "start" });
  }, [selectedHistoryAnchor]);

  async function recheckAccess() {
    await access.refresh();
    if (accessNow.current.ready) await dataQuery.refetch();
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
  const plannedScope = admittedManualRunProgress(data);
  const loadedCases = data.cases;
  const matchingCases = data.cases.filter((testCase) =>
    manualRunCaseMatches(testCase, caseSearch, caseFilter),
  );
  function navigateToCase(id: string, resetFilters = false) {
    if (
      !accessNow.current.readable ||
      !loadedCases.some((testCase) => testCase.testCaseId === id)
    )
      return;
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
        <section role={access.denied || !!dataQuery.error ? "alert" : "status"}>
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
                  setError(null);
                  void dataQuery.refetch();
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
                if (!accessNow.current.canEdit) return;
                if (!plannedScope || plannedScope.unavailableCaseIds.length > 0) return;
                if (
                  recordedCount === plannedScope.plannedCount ||
                  confirm(
                    "Some cases have no result. Finish as an incomplete run?",
                  )
                )
                  completeMutation.mutate({ testRunId });
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
            canExport={() => accessNow.current.readable}
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
                  onChange={(event) => setCaseSearch(event.target.value)}
                  placeholder="Search case ID or title"
                />
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                Show
                <select
                  value={caseFilter}
                  onChange={(event) =>
                    setCaseFilter(event.target.value as ManualRunCaseFilter)
                  }
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
                  const id = nextUntestedManualCase(
                    data.cases,
                    navigation.id ??
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

      {data.cases
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
          >
            {readable && (
              <h2 style={{ fontSize: 16 }}>
                Retest relationships · {tc.displayId ?? tc.title}
              </h2>
            )}
            <ManualRetestActions
              key={`${projectId}:${testRunId}:${tc.testCaseId}`}
              projectId={projectId}
              sourceRunId={testRunId}
              testCaseId={tc.testCaseId}
              active={readable}
              canRetest={
                canEdit &&
                (tc.currentResult?.status === "FAIL" ||
                  tc.currentResult?.status === "BLOCKED")
              }
            />
          </section>
        ))}

      {data.cases.map((tc) => (
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
          hidden={!manualRunCaseMatches(tc, caseSearch, caseFilter)}
          navigationTarget={navigation.id === tc.testCaseId}
          navigationRevision={navigation.revision}
          onOpenCase={(id) => setNavigation((current) => ({ ...current, id }))}
          selectedFromHistory={
            historySelection.kind === "SELECTED" &&
            historySelection.caseId === tc.testCaseId
          }
          readable={readable}
          readScope={readInput}
          onStepsChanged={() =>
            utils.manualExecution.getForExecution.invalidate({ testRunId })
          }
          onUnconfirmedStep={(pending) =>
            setUnconfirmedStepCases((current) => {
              const next = new Set(current);
              if (pending) next.add(tc.testCaseId);
              else next.delete(tc.testCaseId);
              return next;
            })
          }
          onUnconfirmedWholeCase={(pending) =>
            setUnconfirmedWholeCases((current) => {
              if (current.has(tc.testCaseId) === pending) return current;
              const next = new Set(current);
              if (pending) next.add(tc.testCaseId);
              else next.delete(tc.testCaseId);
              return next;
            })
          }
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
              return `${prerequisite?.displayId ?? "Case ID unavailable"} · ${prerequisite?.title ?? "Unavailable case"}`;
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
