"use client";

import { Fragment, useRef, useState, useSyncExternalStore } from "react";
import { useParams } from "next/navigation";
import { useRouter } from "next/navigation";
import { trpcReact } from "@/lib/trpcReact";
import { Drawer } from "@/components/Drawer";
import { Modal } from "@/components/Modal";
import { useProjectPermissions } from "@/lib/use-project-permissions";
import { inspectorLabel } from "@/lib/case-inspector";
import { currentSessionScope, sameAuthScope } from "@/lib/auth-query-cache";
import { RunHistoryDashboard } from "@/components/RunHistoryDashboard";
import { RunAllPagesDashboard } from "@/components/RunAllPagesDashboard";
import { manualStartDefinitivelyRejected, assertManualStartAcknowledgement } from "@/lib/manual-run-start";
import { applyRunBulkSelection, type RunBulkSelectionMode } from "@/lib/run-bulk-selection";
import { useManualExecutionAccess } from "@/lib/use-manual-execution-access";

const subscribeRunHash = (notify: () => void) => {
  window.addEventListener("hashchange", notify);
  return () => window.removeEventListener("hashchange", notify);
};
const readRunHash = () => {
  const match = window.location.hash.match(/^#run-([a-zA-Z0-9_-]+)$/);
  return match?.[1] ?? null;
};

const RESULT_COLORS: Record<string, string> = {
  PASS: "#1a7f37",
  FAIL: "#cf222e",
  SKIP: "#57606a",
  FLAKY: "#9a6700",
};

// P5-04: the manual half of matching -- an unmatched result gets a picker
// to link it to a real TestCase once. That link is remembered server-side
// (it sets TestCaseSource.externalTestId when unset), so this picker is a
// one-time cost per test, not a per-run chore.
function LinkResultPicker({
  testResultId,
  projectId,
  onLinked,
}: {
  testResultId: string;
  projectId: string;
  onLinked: () => void;
}) {
  const [picking, setPicking] = useState(false);
  const candidatesQuery = trpcReact.testCases.list.useQuery(
    { projectId },
    { enabled: picking },
  );
  const candidates = candidatesQuery.data ?? [];
  const [selected, setSelected] = useState("");
  const [error, setError] = useState<string | null>(null);

  const linkMutation = trpcReact.testRuns.linkResultToTestCase.useMutation({
    onSuccess: () => {
      setPicking(false);
      setSelected("");
      onLinked();
    },
    onError: (e) => setError(e.message),
  });

  function link() {
    if (!selected) return;
    setError(null);
    linkMutation.mutate({ testResultId, testCaseId: selected });
  }

  if (!picking) {
    return (
      <button
        className="btn-secondary"
        style={{ fontSize: 11 }}
        onClick={() => setPicking(true)}
      >
        Link to test case
      </button>
    );
  }

  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <select
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        style={{ fontSize: 11 }}
      >
        <option value="">Pick a test case…</option>
        {candidates.map((tc) => (
          <option key={tc.id} value={tc.id}>
            {tc.title}
          </option>
        ))}
      </select>
      <button
        className="btn-secondary"
        style={{ fontSize: 11 }}
        onClick={link}
        disabled={linkMutation.isPending || !selected}
      >
        Link
      </button>
      <button
        className="btn-secondary"
        style={{ fontSize: 11 }}
        onClick={() => setPicking(false)}
      >
        Cancel
      </button>
      {error && (
        <span style={{ color: "var(--ember)", fontSize: 11 }}>{error}</span>
      )}
    </div>
  );
}

const CLASSIFICATION_COLORS: Record<string, string> = {
  BRITTLE: "#9a6700",
  REAL_REGRESSION: "#cf222e",
  UNCERTAIN: "#57606a",
};

// P6.5-03: classify-on-demand + review UI for a single failing result.
// Never touches the repo -- approving a suggestion just marks it reviewed
// so it stops showing as needing attention; the suggested diff is right
// here to copy, not applied anywhere automatically.
function HealingSuggestionPanel({
  testResultId,
  canEdit,
}: {
  testResultId: string;
  canEdit: boolean;
}) {
  const utils = trpcReact.useUtils();
  const suggestionQuery = trpcReact.healingSuggestions.byTestResult.useQuery({
    testResultId,
  });
  const suggestion = suggestionQuery.data ?? null;
  const [error, setError] = useState<string | null>(null);

  // A pending mutation's onSuccess may be replaced on an account switch.
  // Preserve its initiating identity; never place an old ACK in a new cache.
  const initiatingScope = () =>
    currentSessionScope(window.Clerk?.loaded ? window.Clerk.session : null);
  const classifyMutation = trpcReact.healingSuggestions.classify.useMutation({
    onMutate: initiatingScope,
    onSuccess: (result, _input, originalScope) => {
      if (!sameAuthScope(originalScope ?? null, initiatingScope())) return;
      if (result.ok)
        void utils.healingSuggestions.byTestResult.invalidate({ testResultId });
      else setError(result.reason);
    },
    onError: (e) => setError(e.message),
  });
  const reviewMutation = trpcReact.healingSuggestions.review.useMutation({
    onMutate: initiatingScope,
    onSuccess: (_updated, _input, originalScope) => {
      if (sameAuthScope(originalScope ?? null, initiatingScope()))
        void utils.healingSuggestions.byTestResult.invalidate({ testResultId });
    },
    onError: (e) => setError(e.message),
  });

  function classify() {
    setError(null);
    classifyMutation.mutate({ testResultId });
  }

  function review(status: "APPROVED" | "REJECTED") {
    if (!suggestion) return;
    reviewMutation.mutate({ id: suggestion.id, status });
  }

  if (suggestionQuery.isLoading) return null;

  if (!suggestion) {
    return (
      <div style={{ marginTop: 4 }}>
        {canEdit && (
          <button
            className="btn-secondary"
            style={{ fontSize: 11 }}
            onClick={classify}
            disabled={classifyMutation.isPending}
          >
            {classifyMutation.isPending ? "Classifying…" : "Classify failure"}
          </button>
        )}
        {error && (
          <div style={{ color: "var(--ember)", fontSize: 11, marginTop: 4 }}>
            {error}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      style={{
        marginTop: 6,
        padding: 8,
        border: "1px solid var(--line)",
        borderRadius: 4,
        fontSize: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            fontWeight: 600,
            color:
              CLASSIFICATION_COLORS[suggestion.classification] ?? "inherit",
          }}
        >
          {suggestion.classification.replace("_", " ")}
        </span>
        {suggestion.resolvedAt && (
          <span style={{ color: "var(--frost)" }}>resolved</span>
        )}
        {suggestion.status !== "PENDING" && !suggestion.resolvedAt && (
          <span className="text-muted">{suggestion.status.toLowerCase()}</span>
        )}
      </div>
      <p style={{ margin: "4px 0" }}>{suggestion.classificationRationale}</p>
      {suggestion.suggestedDiff && (
        <>
          <div className="text-muted" style={{ marginTop: 6 }}>
            Suggested fix:
          </div>
          <pre
            style={{
              background: "var(--panel-bg, #1a1a1a)",
              padding: 6,
              borderRadius: 3,
              overflowX: "auto",
              margin: "4px 0",
            }}
          >
            {suggestion.suggestedDiff}
          </pre>
          {suggestion.suggestionRationale && (
            <p className="text-muted" style={{ margin: 0 }}>
              {suggestion.suggestionRationale}
            </p>
          )}
        </>
      )}
      {canEdit && suggestion.status === "PENDING" && (
        <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
          <button
            className="btn-secondary"
            style={{ fontSize: 11 }}
            onClick={() => review("APPROVED")}
          >
            Approve
          </button>
          <button
            className="btn-secondary"
            style={{ fontSize: 11 }}
            onClick={() => review("REJECTED")}
          >
            Reject
          </button>
        </div>
      )}
      {error && (
        <div style={{ color: "var(--ember)", fontSize: 11, marginTop: 4 }}>
          {error}
        </div>
      )}
    </div>
  );
}

function TestRunDetail({ id, canEdit }: { id: string; canEdit: boolean }) {
  const utils = trpcReact.useUtils();
  const runQuery = trpcReact.testRuns.byId.useQuery({ id });
  const run = runQuery.data;

  if (runQuery.error)
    return <p style={{ color: "var(--ember)" }}>{runQuery.error.message}</p>;
  if (!run) return <p>Loading…</p>;

  const reload = () => void utils.testRuns.byId.invalidate({ id });

  return (
    <div>
      <h1 style={{ marginBottom: 2 }}>
        {run.ciProvider === "manual"
          ? "Manual test run"
          : `${run.ciProvider} run`}
      </h1>
      <p className="text-muted" style={{ fontSize: 13 }}>
        {run.ciProvider === "manual" ? (
          <>{run.startedByEmail ?? "Unknown tester"}</>
        ) : (
          <>
            {run.branch} @ <code>{run.commitSha.slice(0, 12)}</code>
          </>
        )}
        {" — "}
        {new Date(run.startedAt).toLocaleString()}
        {run.ciRunUrl && (
          <>
            {" · "}
            <a href={run.ciRunUrl} target="_blank" rel="noreferrer">
              View in CI
            </a>
          </>
        )}
      </p>
      <table
        style={{ width: "100%", borderCollapse: "collapse", marginTop: 16 }}
      >
        <thead>
          <tr
            style={{ textAlign: "left", borderBottom: "1px solid var(--line)" }}
          >
            <th style={{ padding: "6px 8px", fontSize: 12 }}>Status</th>
            <th style={{ padding: "6px 8px", fontSize: 12 }}>Test</th>
            <th style={{ padding: "6px 8px", fontSize: 12 }}>Duration</th>
            <th style={{ padding: "6px 8px", fontSize: 12 }}>Error</th>
          </tr>
        </thead>
        <tbody>
          {run.results.map((r) => (
            <Fragment key={r.id}>
              <tr
                style={{
                  borderBottom:
                    r.status === "FAIL" && r.testCaseId
                      ? "none"
                      : "1px solid var(--line)",
                }}
              >
                <td
                  style={{
                    padding: "6px 8px",
                    fontSize: 12,
                    color: RESULT_COLORS[r.status] ?? "inherit",
                    fontWeight: 600,
                  }}
                >
                  {inspectorLabel(r.status)}
                </td>
                <td style={{ padding: "6px 8px", fontSize: 13 }}>
                  {r.testCaseTitle ? (
                    <span>
                      <code>{r.testCaseDisplayId}</code> {r.testCaseTitle}
                    </span>
                  ) : (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 4,
                      }}
                    >
                      <span className="text-muted">
                        {r.externalTestId ?? "(unknown)"} — unmatched
                      </span>
                      {canEdit && (
                        <LinkResultPicker
                          testResultId={r.id}
                          projectId={run.projectId}
                          onLinked={reload}
                        />
                      )}
                    </div>
                  )}
                </td>
                <td style={{ padding: "6px 8px", fontSize: 12 }}>
                  {r.durationMs !== null ? `${r.durationMs}ms` : "—"}
                </td>
                <td
                  style={{
                    padding: "6px 8px",
                    fontSize: 12,
                    color: r.errorMessage ? "var(--ember)" : "inherit",
                  }}
                >
                  {r.errorMessage ?? r.note ?? ""}
                </td>
              </tr>
              {r.status === "FAIL" && r.testCaseId && (
                <tr style={{ borderBottom: "1px solid var(--line)" }}>
                  <td colSpan={4} style={{ padding: "0 8px 8px" }}>
                    <HealingSuggestionPanel
                      testResultId={r.id}
                      canEdit={canEdit}
                    />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function coveragePct(covered: number, total: number): string {
  if (total === 0) return "—";
  return `${Math.round((covered / total) * 100)}%`;
}

// P5-06: a compact list of ingested coverage reports -- the deeper
// coverage-gap dashboard (which files are under-covered against defined
// thresholds) is Phase 7's job; this just makes the ingested data visible.
function CoverageSection({ projectId }: { projectId: string }) {
  const reportsQuery = trpcReact.coverage.list.useQuery({ projectId });
  const reports = reportsQuery.data ?? [];

  if (reportsQuery.isLoading || reports.length === 0) return null;

  return (
    <div style={{ marginTop: 32 }}>
      <h2 style={{ marginBottom: 4 }}>Coverage</h2>
      <p className="text-muted" style={{ fontSize: 13, marginBottom: 12 }}>
        Ingested coverage reports (Istanbul/nyc, Cobertura, JaCoCo). Most recent
        first.
      </p>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr
            style={{ textAlign: "left", borderBottom: "1px solid var(--line)" }}
          >
            <th style={{ padding: "6px 8px", fontSize: 12 }}>Tool</th>
            <th style={{ padding: "6px 8px", fontSize: 12 }}>Branch</th>
            <th style={{ padding: "6px 8px", fontSize: 12 }}>Commit</th>
            <th style={{ padding: "6px 8px", fontSize: 12 }}>Line coverage</th>
            <th style={{ padding: "6px 8px", fontSize: 12 }}>When</th>
          </tr>
        </thead>
        <tbody>
          {reports.map((r) => (
            <tr key={r.id} style={{ borderBottom: "1px solid var(--line)" }}>
              <td style={{ padding: "6px 8px", fontSize: 13 }}>{r.tool}</td>
              <td style={{ padding: "6px 8px", fontSize: 13 }}>{r.branch}</td>
              <td style={{ padding: "6px 8px", fontSize: 12 }}>
                <code>{r.commitSha.slice(0, 10)}</code>
              </td>
              <td style={{ padding: "6px 8px", fontSize: 13 }}>
                {coveragePct(r.linesCovered, r.linesTotal)} ({r.linesCovered}/
                {r.linesTotal})
              </td>
              <td
                style={{
                  padding: "6px 8px",
                  fontSize: 12,
                  color: "var(--text-muted, #57606a)",
                }}
              >
                {new Date(r.createdAt).toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// P6.5-05: aggregate brittle-vs-real signal for the project -- if a
// specific test keeps generating brittle-failure suggestions, that's a
// signal the test itself needs attention, not the app.
function HealingSignalSection({ projectId }: { projectId: string }) {
  const signalQuery = trpcReact.healingSuggestions.aggregateSignal.useQuery({
    projectId,
  });
  const signal = signalQuery.data;

  if (!signal || signal.totalCount === 0) return null;

  return (
    <div style={{ marginTop: 32 }}>
      <h2 style={{ marginBottom: 4 }}>Failure classification signal</h2>
      <p className="text-muted" style={{ fontSize: 13, marginBottom: 12 }}>
        {signal.brittleCount} brittle · {signal.realRegressionCount} real
        regressions · {signal.uncertainCount} uncertain · {signal.resolvedCount}{" "}
        resolved (of {signal.totalCount} classified)
      </p>
      {signal.repeatOffenders.length > 0 && (
        <>
          <div className="eyebrow" style={{ marginBottom: 6 }}>
            Repeat brittle offenders
          </div>
          <ul style={{ paddingLeft: 18, margin: 0 }}>
            {signal.repeatOffenders.map((o) => (
              <li key={o.testCaseId} style={{ fontSize: 13 }}>
                {o.testCaseTitle} — {o.brittleCount} brittle failures
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

// P1-15
export default function TestRunsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const router = useRouter();
  const { canEdit, organizationId } = useProjectPermissions(projectId);
  const manualAccess = useManualExecutionAccess(projectId);
  const manualInFlight = useRef(false);
  const linkedRunId = useSyncExternalStore(
    subscribeRunHash,
    readRunHash,
    () => null,
  );
  const [selectedRunId, setOpenRunId] = useState<string | null | undefined>(
    undefined,
  );
  const openRunId = selectedRunId === undefined ? linkedRunId : selectedRunId;
  const [manualOpen, setManualOpen] = useState(false);
  const [manualSearch, setManualSearch] = useState("");
  const [manualSuite, setManualSuite] = useState("");
  const [manualPriority, setManualPriority] = useState("");
  const [manualType, setManualType] = useState("");
  const [manualBulkMode, setManualBulkMode] = useState<RunBulkSelectionMode>("SET");
  const [manualBulkScope, setManualBulkScope] = useState("matching");
  const [manualBulkNotice, setManualBulkNotice] = useState("");
  const [manualStartRequest, setManualStartRequest] = useState<{
    projectId: string;
    testCaseIds: string[];
    idempotencyKey: string;
    originalOrganizationId: string;
    expectedClerkActorId: string;
  } | null>(null);
  const [manualStartScope, setManualStartScope] = useState<ReturnType<typeof currentSessionScope>>(null);
  const [manualStartEverAmbiguous, setManualStartEverAmbiguous] = useState(false);
  const [manualSelection, setManualSelection] = useState<Set<string>>(
    new Set(),
  );
  const [manualError, setManualError] = useState<string | null>(null);
  const casesQuery = trpcReact.testCases.list.useQuery(
    { projectId },
    { enabled: manualOpen },
  );
  const startManualMutation = trpcReact.manualExecution.start.useMutation();
  const manualSourceReady = manualAccess.ready && casesQuery.isFetchedAfterMount && !casesQuery.isFetching && !casesQuery.isPaused && !casesQuery.error;
  const eligibleCases = (manualSourceReady ? casesQuery.data ?? [] : []).filter(testCase => !testCase.archived && testCase.reviewStatus === "APPROVED");
  const manualCases = eligibleCases.filter((testCase) =>
    (!manualSuite || testCase.suitePath === manualSuite) &&
    (!manualPriority || testCase.priority === manualPriority) &&
    (!manualType || testCase.testType === manualType) &&
    `${testCase.displayId} ${testCase.title} ${testCase.tags.join(" ")}`
      .toLowerCase()
      .includes(manualSearch.trim().toLowerCase()),
  );

  function toggleManualCase(id: string) {
    if (!manualSelectionWritable() || !eligibleCases.some(testCase => testCase.id === id)) return;
    if (!manualSelection.has(id) && manualSelection.size >= 1000) {
      setManualError("A run supports up to 1,000 cases including prerequisites. Split the reviewed scope; nothing was silently truncated.");
      return;
    }
    setManualSelection((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const manualBulkScopeValid = ["matching", "all", "suite"].includes(manualBulkScope) && (manualBulkScope !== "suite" || Boolean(manualSuite));
  const manualBulkCandidates = manualBulkScope === "all" ? eligibleCases : manualBulkScope === "suite" && manualSuite ? eligibleCases.filter(testCase => testCase.suitePath === manualSuite) : manualBulkScope === "matching" ? manualCases : [];
  const manualBulkPreview = manualBulkScopeValid ? applyRunBulkSelection([...manualSelection], manualBulkCandidates.map(testCase => testCase.id), manualBulkMode) : { ok: false as const, error: "Choose a current suite or another approved scope before applying selection. Nothing was changed." };
  const manualBulkReady = canEdit && manualAccess.canWrite && manualSourceReady;
  function manualSelectionWritable() {
    const current = currentSessionScope(window.Clerk?.loaded ? window.Clerk.session : null);
    return manualBulkReady && !!current && current.userId === manualAccess.origin?.clerkActorId && organizationId === manualAccess.origin?.organizationId && !manualStartRequest && !manualInFlight.current && !startManualMutation.isPending;
  }
  function selectScope() {
    if (!manualSelectionWritable() || !manualBulkScopeValid) return;
    const result = applyRunBulkSelection([...manualSelection], manualBulkCandidates.map(testCase => testCase.id), manualBulkMode);
    if (!result.ok) { setManualError(result.error); return; }
    setManualSelection(new Set(result.ids));
    setManualBulkNotice(`${manualBulkMode === "SET" ? "Set" : manualBulkMode === "ADD" ? "Add" : "Remove"}: ${result.added} added, ${result.removed} removed. ${result.before} → ${result.after} selected.`);
    setManualError(null);
  }

  async function startManualRun() {
    if (!canEdit || !manualAccess.canWrite || manualInFlight.current || startManualMutation.isPending || manualSelection.size === 0) return;
    setManualError(null);
    const scope = currentSessionScope(window.Clerk?.loaded ? window.Clerk.session : null);
    if (!scope || !organizationId || (manualStartRequest && (!sameAuthScope(manualStartScope, scope) || manualStartRequest.originalOrganizationId !== organizationId))) {
      setManualError("Restore the original signed-in account and session before retrying this retained start request.");
      return;
    }
    manualInFlight.current = true;
    try {
      // Retain the exact payload on an unknown acknowledgement. A retry must
      // not spend the same idempotency key on a newly edited selection.
      const request = manualStartRequest ?? {
        projectId,
        testCaseIds: [...manualSelection],
        idempotencyKey: crypto.randomUUID(),
        originalOrganizationId: organizationId,
        expectedClerkActorId: scope.userId,
      };
      setManualStartRequest(request);
      if (!manualStartRequest) setManualStartScope(scope);
      const result = await startManualMutation.mutateAsync(request);
      assertManualStartAcknowledgement(result, request);
      if (!sameAuthScope(scope, currentSessionScope(window.Clerk?.loaded ? window.Clerk.session : null)))
        throw new Error("The signed-in session changed while this run was starting. Restore the original session and retry the retained request.");
      router.push(
        `/projects/${projectId}/test-runs/manual/${result.testRunId}`,
      );
    } catch (cause) {
      if (manualStartDefinitivelyRejected(cause, manualStartEverAmbiguous)) {
        setManualStartRequest(null);
        setManualStartScope(null);
      } else setManualStartEverAmbiguous(true);
      setManualError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      manualInFlight.current = false;
    }
  }

  return (
    <div style={{ maxWidth: 900 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
        }}
      >
        <h1 style={{ marginBottom: 4 }}>Test Runs</h1>
        {canEdit && (
          <button
            className="btn-primary"
            type="button"
            onClick={() => setManualOpen(true)}
          >
            Start manual run
          </button>
        )}
      </div>
      <p className="text-muted" style={{ marginBottom: 20 }}>
        Results ingested from CI (JUnit XML) or recorded through manual
        execution. Most recent first.
      </p>

      <RunHistoryDashboard key={projectId} projectId={projectId} organizationId={organizationId} onView={setOpenRunId} />

      <RunAllPagesDashboard key={projectId} projectId={projectId} />

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 16 }}>
        <a className="btn-secondary" href={`/projects/${projectId}/import`}>Import historical results</a>
        <a className="btn-secondary" href="/settings/integrations">Configure CI and integrations</a>
      </div>

      <Drawer open={openRunId !== null} onClose={() => setOpenRunId(null)}>
        {openRunId && <TestRunDetail id={openRunId} canEdit={canEdit} />}
      </Drawer>

      <Modal
        open={manualOpen}
        onClose={() => setManualOpen(false)}
        title="Start a manual test run"
      >
        <div style={{ display: "grid", gap: 10 }}>
          <p className="text-muted" style={{ margin: 0, fontSize: 13 }}>
            Select the cases a tester will execute. Results are recorded in the
            same release and compliance history as CI results.
          </p>
          <input
            value={manualSearch}
            onChange={(event) => setManualSearch(event.target.value)}
            placeholder="Search test cases"
            aria-label="Search test cases"
          />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <select aria-label="Run case suite" value={manualSuite} onChange={e => setManualSuite(e.target.value)}><option value="">All suites</option>{[...new Set(eligibleCases.map(testCase => testCase.suitePath).filter((path): path is string => !!path))].sort().map(path => <option key={path} value={path}>{path}</option>)}</select>
            <select aria-label="Run case priority" value={manualPriority} onChange={e => setManualPriority(e.target.value)}><option value="">All priorities</option>{["CRITICAL", "HIGH", "MEDIUM", "LOW"].map(value => <option key={value} value={value}>{inspectorLabel(value)}</option>)}</select>
            <select aria-label="Run case type" value={manualType} onChange={e => setManualType(e.target.value)}><option value="">All test types</option>{[...new Set(eligibleCases.map(testCase => testCase.testType))].sort().map(value => <option key={value} value={value}>{inspectorLabel(value)}</option>)}</select>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <label>Apply to approved scope<select value={manualBulkScope} disabled={!!manualStartRequest || startManualMutation.isPending || !manualBulkReady} onChange={event => setManualBulkScope(event.target.value)}><option value="matching">Current filter matches ({manualCases.length})</option><option value="all">All loaded approved cases ({eligibleCases.length})</option><option value="suite" disabled={!manualSuite}>{manualSuite ? `Current suite only (${eligibleCases.filter(testCase => testCase.suitePath === manualSuite).length})` : "Current suite unavailable — choose a suite or another scope"}</option></select></label>
            <label>Selection operation<select value={manualBulkMode} disabled={!!manualStartRequest || startManualMutation.isPending || !manualBulkReady} onChange={event => setManualBulkMode(event.target.value as RunBulkSelectionMode)}><option value="SET">Set — replace selection</option><option value="ADD">Add — keep existing and add matches</option><option value="REMOVE">Remove — subtract matches</option></select></label>
            <button type="button" className="btn-secondary" disabled={!!manualStartRequest || startManualMutation.isPending || !manualBulkReady || !manualBulkPreview.ok} onClick={selectScope}>Apply {manualBulkMode === "SET" ? "Set" : manualBulkMode === "ADD" ? "Add" : "Remove"} selection</button>
            <button type="button" className="btn-secondary" disabled={!!manualStartRequest || startManualMutation.isPending || !manualBulkReady} onClick={() => { if (!manualSelectionWritable()) return; setManualSelection(new Set()); setManualBulkNotice("Cleared the current selection explicitly. No run was started."); }}>Clear selection</button>
          </div>
          {manualStartRequest ? <p role="status">Selection changes are locked while confirming the original {manualStartRequest.testCaseIds.length}-case request.</p> : manualBulkPreview.ok ? <p role="status">Applying this operation will add {manualBulkPreview.added}, remove {manualBulkPreview.removed}, and leave {manualBulkPreview.after} selected ({manualBulkPreview.matched} scope matches).</p> : <p role="alert">{manualBulkPreview.error}</p>}
          {manualBulkNotice && <p role="status">{manualBulkNotice}</p>}
          {casesQuery.error && <p role="alert">{casesQuery.error.message}</p>}
          <p className="text-muted">Bulk operations use the complete loaded approved scope, not hidden or unloaded pages. Filter and suite browsing never changes the selection until you apply Set, Add or Remove. Up to 1,000 cases including required prerequisites; archived and unreviewed cases are excluded. Starting freezes the current procedures for this run.</p>
          <div
            style={{
              maxHeight: 320,
              overflowY: "auto",
              border: "1px solid var(--line)",
              borderRadius: 6,
            }}
          >
            {casesQuery.isLoading && (
              <p className="text-muted" style={{ padding: 12 }}>
                Loading test cases…
              </p>
            )}
            {!casesQuery.isLoading && manualCases.length === 0 && (
              <p className="text-muted" style={{ padding: 12 }}>
                No test cases match this search. Import or create cases first.
              </p>
            )}
            {manualCases.map((testCase) => (
              <label
                key={testCase.id}
                style={{
                  display: "flex",
                  gap: 8,
                  padding: "9px 10px",
                  borderBottom: "1px solid var(--line)",
                }}
              >
                <input
                  type="checkbox"
                  checked={manualSelection.has(testCase.id)}
                  disabled={!!manualStartRequest || startManualMutation.isPending || !manualBulkReady}
                  onChange={() => toggleManualCase(testCase.id)}
                />
                <span>
                  <code>{testCase.displayId}</code> {testCase.title}
                </span>
              </label>
            ))}
          </div>
          {manualError && (
            <p style={{ color: "var(--ember)", margin: 0 }}>{manualError}</p>
          )}
          {manualStartRequest && <p role="status">This start request retains its original {manualStartRequest.testCaseIds.length} cases. Retry checks that same request without creating a duplicate run.</p>}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span className="text-muted" style={{ fontSize: 12 }}>
              {manualSelection.size} selected
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className="btn-secondary"
                onClick={() => setManualOpen(false)}
              >
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={startManualRun}
                disabled={
                  manualSelection.size === 0 || startManualMutation.isPending || !manualAccess.canWrite
                }
              >
                {startManualMutation.isPending
                  ? "Starting…"
                  : manualStartRequest ? "Retry retained start" : "Begin execution"}
              </button>
            </div>
          </div>
        </div>
      </Modal>

      <CoverageSection projectId={projectId} />
      <HealingSignalSection projectId={projectId} />
    </div>
  );
}
