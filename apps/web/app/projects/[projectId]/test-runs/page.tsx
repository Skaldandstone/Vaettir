"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { useParams } from "next/navigation";
import { useRouter } from "next/navigation";
import { trpcReact } from "@/lib/trpcReact";
import { Drawer } from "@/components/Drawer";
import { Modal } from "@/components/Modal";
import { useProjectPermissions } from "@/lib/use-project-permissions";
import { inspectorLabel } from "@/lib/case-inspector";
import { currentSessionScope } from "@/lib/auth-query-cache";
import { RunHistoryDashboard } from "@/components/RunHistoryDashboard";
import { CiRunDetail } from "@/components/CiRunDetail";
import { RunAllPagesDashboard } from "@/components/RunAllPagesDashboard";
import { RunConfigurationModal } from "@/components/RunConfigurationModal";
import type { ReviewedRunStartEnvelope } from "@/lib/run-start-reviewed-write";
import {
  applyRunBulkSelection,
  type RunBulkSelectionMode,
} from "@/lib/run-bulk-selection";
import { useManualExecutionAccess } from "@/lib/use-manual-execution-access";
import {
  RUN_SUITE_ALL_VALUE,
  resolveRunSuiteScope,
  runSuiteScopeMatches,
  runSuiteScopeOptions,
} from "@/lib/run-suite-scope";

const subscribeRunHash = (notify: () => void) => {
  window.addEventListener("hashchange", notify);
  return () => window.removeEventListener("hashchange", notify);
};
const readRunHash = () => {
  const match = window.location.hash.match(/^#run-([a-zA-Z0-9_-]+)$/);
  return match?.[1] ?? null;
};

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
  const [manualSuite, setManualSuite] = useState(RUN_SUITE_ALL_VALUE);
  const [manualPriority, setManualPriority] = useState("");
  const [manualType, setManualType] = useState("");
  const [manualBulkMode, setManualBulkMode] =
    useState<RunBulkSelectionMode>("SET");
  const [manualBulkScope, setManualBulkScope] = useState("matching");
  const [manualBulkNotice, setManualBulkNotice] = useState("");
  const [configurationSelection, setConfigurationSelection] = useState<
    string[] | null
  >(null);
  const [configurationOpen, setConfigurationOpen] = useState(false);
  // Event-owned admission latch: stale first-stage handlers cannot replace a
  // later configuration draft, pending request or known receipt before render.
  const retainedSelection = useRef<{ projectId: string; ids: string[] } | null>(
    null,
  );
  const [manualSelection, setManualSelection] = useState<Set<string>>(
    new Set(),
  );
  const [selectionRevision, setSelectionRevision] = useState(0);
  const selectionEvents = useRef({ revision: 0, ids: new Set<string>() });
  const selectionWriteLocked = useRef(false);
  const [selectionWriteStarted, setSelectionWriteStarted] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);
  const casesQuery = trpcReact.testCases.list.useQuery(
    { projectId },
    { enabled: manualOpen || configurationOpen },
  );
  const startManualMutation =
    trpcReact.manualRunStartReviewed.start.useMutation();
  const manualSourceReady =
    manualAccess.ready &&
    casesQuery.isFetchedAfterMount &&
    !casesQuery.isFetching &&
    !casesQuery.isPaused &&
    !casesQuery.error;
  const eligibleCases = (
    manualSourceReady ? (casesQuery.data ?? []) : []
  ).filter(
    (testCase) => !testCase.archived && testCase.reviewStatus === "APPROVED",
  );
  const suiteCatalog = runSuiteScopeOptions(
      eligibleCases.map((testCase) => testCase.suitePath),
    ),
    manualSuiteSelection = resolveRunSuiteScope(
      manualSuite,
      suiteCatalog.options,
    ),
    manualSuiteCases = manualSuiteSelection.available
      ? eligibleCases.filter((testCase) =>
          runSuiteScopeMatches(manualSuiteSelection.scope, testCase.suitePath),
        )
      : [];
  const manualCases = manualSuiteCases.filter(
    (testCase) =>
      (!manualPriority || testCase.priority === manualPriority) &&
      (!manualType || testCase.testType === manualType) &&
      `${testCase.displayId} ${testCase.title} ${testCase.tags.join(" ")}`
        .toLowerCase()
        .includes(manualSearch.trim().toLowerCase()),
  );

  function toggleManualCase(id: string) {
    if (
      !manualSelectionWritable() ||
      !eligibleCases.some((testCase) => testCase.id === id)
    )
      return;
    if (!manualSelection.has(id) && manualSelection.size >= 1000) {
      setManualError(
        "A run supports up to 1,000 cases including prerequisites. Split the reviewed scope; nothing was silently truncated.",
      );
      return;
    }
    const next = new Set(selectionEvents.current.ids);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    publishSelection(next);
  }
  function publishSelection(ids: Set<string>) {
    // Called only by admitted selection events, never during render. A captured
    // old Continue must not freeze a pre-edit cohort even before React commits.
    const revision = selectionEvents.current.revision + 1;
    selectionEvents.current = { revision, ids };
    setManualSelection(ids);
    setSelectionRevision(revision);
  }
  function clearSelection() {
    if (!manualSelectionWritable()) return;
    publishSelection(new Set());
    setManualBulkNotice(
      "Cleared the current selection explicitly. No run was started.",
    );
  }

  const manualBulkScopeValid =
    ["matching", "all", "suite"].includes(manualBulkScope) &&
    (manualBulkScope === "all" ||
      (manualSuiteSelection.available &&
        (manualBulkScope !== "suite" || manualSuiteSelection.specific)));
  const manualBulkCandidates =
    manualBulkScope === "all"
      ? eligibleCases
      : manualBulkScope === "suite" && manualSuiteSelection.specific
        ? manualSuiteCases
        : manualBulkScope === "matching"
          ? manualCases
          : [];
  const manualBulkPreview = manualBulkScopeValid
    ? applyRunBulkSelection(
        [...manualSelection],
        manualBulkCandidates.map((testCase) => testCase.id),
        manualBulkMode,
      )
    : {
        ok: false as const,
        error:
          "Choose a current suite or another approved scope before applying selection. Nothing was changed.",
      };
  const manualBulkReady = canEdit && manualAccess.canWrite && manualSourceReady;
  function manualSelectionWritable() {
    const current = currentSessionScope(
      window.Clerk?.loaded ? window.Clerk.session : null,
    );
    return (
      manualBulkReady &&
      !!current &&
      current.userId === manualAccess.origin?.clerkActorId &&
      organizationId === manualAccess.origin?.organizationId &&
      configurationSelection === null &&
      retainedSelection.current === null &&
      selectionRevision === selectionEvents.current.revision &&
      !startManualMutation.isPending
    );
  }
  function selectScope() {
    if (!manualSelectionWritable() || !manualBulkScopeValid) return;
    const result = applyRunBulkSelection(
      [...manualSelection],
      manualBulkCandidates.map((testCase) => testCase.id),
      manualBulkMode,
    );
    if (!result.ok) {
      setManualError(result.error);
      return;
    }
    publishSelection(new Set(result.ids));
    setManualBulkNotice(
      `${manualBulkMode === "SET" ? "Set" : manualBulkMode === "ADD" ? "Add" : "Remove"}: ${result.added} added, ${result.removed} removed. ${result.before} → ${result.after} selected.`,
    );
    setManualError(null);
  }

  function continueConfiguration() {
    // Reopening preserves the originally admitted selection and the mounted
    // controller's draft/UUID/receipt; background filters never replace it.
    if (retainedSelection.current !== null) {
      if (retainedSelection.current.projectId !== projectId) return;
      setManualOpen(false);
      setConfigurationOpen(true);
      return;
    }
    if (!manualSelectionWritable() || manualSelection.size === 0) return;
    const ids = [...selectionEvents.current.ids];
    if (ids.length > 1000) return;
    if (
      ids.some((id) => !eligibleCases.some((testCase) => testCase.id === id))
    ) {
      setManualError(
        "A selected case is no longer in the current loaded approved scope. Review the selection; nothing was started.",
      );
      return;
    }
    Object.freeze(ids);
    retainedSelection.current = { projectId, ids };
    setConfigurationSelection(ids);
    setManualError(null);
    setManualOpen(false);
    setConfigurationOpen(true);
  }
  function changeConfigurationSelection(requestedIds: string[]) {
    const current = currentSessionScope(
      window.Clerk?.loaded ? window.Clerk.session : null,
    );
    if (
      !configurationOpen ||
      !manualBulkReady ||
      !current ||
      current.userId !== manualAccess.origin?.clerkActorId ||
      organizationId !== manualAccess.origin?.organizationId ||
      retainedSelection.current?.projectId !== projectId ||
      selectionRevision !== selectionEvents.current.revision ||
      selectionWriteLocked.current ||
      startManualMutation.isPending
    )
      return;
    if (
      requestedIds.length > 1000 ||
      new Set(requestedIds).size !== requestedIds.length ||
      requestedIds.some(
        (id) =>
          typeof id !== "string" ||
          !id ||
          id.length > 200 ||
          !eligibleCases.some((testCase) => testCase.id === id),
      )
    )
      return;
    const ids = [...requestedIds];
    Object.freeze(ids);
    retainedSelection.current = { projectId, ids };
    publishSelection(new Set(ids));
    setConfigurationSelection(ids);
    setManualError(null);
  }
  async function startManualRun(envelope: ReviewedRunStartEnvelope) {
    const configuration = envelope.request;
    if (
      envelope.projectId !== projectId ||
      configuration.projectId !== projectId ||
      !retainedSelection.current ||
      retainedSelection.current.projectId !== projectId ||
      configuration.testCaseIds.length !==
        retainedSelection.current.ids.length ||
      configuration.testCaseIds.some(
        (id, index) => id !== retainedSelection.current?.ids[index],
      )
    )
      throw new Error(
        "Restore the originally reviewed selection before starting. No replacement request was sent.",
      );
    // Mutation-only. The existing mounted controller owns exact ACK settlement
    // and guards any navigation; this host never generates a UUID or retries.
    // Selection changes are pre-send only. A request may have been accepted
    // even when no response arrives; no callback can replace its case cohort.
    selectionWriteLocked.current = true;
    setSelectionWriteStarted(true);
    return startManualMutation.mutateAsync(envelope);
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
            onClick={() =>
              configurationSelection !== null
                ? setConfigurationOpen(true)
                : setManualOpen(true)
            }
          >
            {configurationSelection !== null
              ? "Reopen run configuration"
              : "Start manual run"}
          </button>
        )}
      </div>
      <p className="text-muted" style={{ marginBottom: 20 }}>
        Results ingested from CI (JUnit XML) or recorded through manual
        execution. Most recent first.
      </p>

      <RunHistoryDashboard
        key={`${projectId}:run-history`}
        projectId={projectId}
        organizationId={organizationId}
        onView={setOpenRunId}
      />

      <RunAllPagesDashboard key={`${projectId}:all-pages`} projectId={projectId} />

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 16 }}>
        <a className="btn-secondary" href={`/projects/${projectId}/import`}>
          Import historical results
        </a>
        <a className="btn-secondary" href="/settings/integrations">
          Configure CI and integrations
        </a>
      </div>

      <Drawer
        open={Boolean(openRunId)}
        onClose={() => setOpenRunId(null)}
        title="CI run results"
      >
        {openRunId && (
          <CiRunDetail
            key={`${projectId}:${openRunId}`}
            projectId={projectId}
            testRunId={openRunId}
            organizationId={organizationId}
            active={Boolean(openRunId)}
          />
        )}
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
            <select
              aria-label="Run case suite"
              value={manualSuite}
              onChange={(e) => setManualSuite(e.target.value)}
            >
              {!manualSuiteSelection.available && (
                <option value={manualSuite} disabled>
                  Suite scope unavailable — explicitly choose a current scope
                </option>
              )}
              {suiteCatalog.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <select
              aria-label="Run case priority"
              value={manualPriority}
              onChange={(e) => setManualPriority(e.target.value)}
            >
              <option value="">All priorities</option>
              {["CRITICAL", "HIGH", "MEDIUM", "LOW"].map((value) => (
                <option key={value} value={value}>
                  {inspectorLabel(value)}
                </option>
              ))}
            </select>
            <select
              aria-label="Run case type"
              value={manualType}
              onChange={(e) => setManualType(e.target.value)}
            >
              <option value="">All test types</option>
              {[...new Set(eligibleCases.map((testCase) => testCase.testType))]
                .sort()
                .map((value) => (
                  <option key={value} value={value}>
                    {inspectorLabel(value)}
                  </option>
                ))}
            </select>
          </div>
          {!manualSuiteSelection.available && (
            <p role="alert">
              The selected suite scope is unavailable. Choose an exact current
              scope; no All-suites fallback or selection change was applied.
            </p>
          )}
          {suiteCatalog.unsupportedCount > 0 && (
            <p role="status">
              {suiteCatalog.unsupportedCount} approved case(s) have unavailable
              suite metadata. They were not interpreted as unassigned; All
              suites still includes every loaded approved identity.
            </p>
          )}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <label>
              Apply to approved scope
              <select
                value={manualBulkScope}
                disabled={
                  configurationSelection !== null ||
                  startManualMutation.isPending ||
                  !manualBulkReady
                }
                onChange={(event) => setManualBulkScope(event.target.value)}
              >
                <option value="matching">
                  Current filter matches ({manualCases.length})
                </option>
                <option value="all">
                  All loaded approved cases ({eligibleCases.length})
                </option>
                <option value="suite" disabled={!manualSuiteSelection.specific}>
                  {manualSuiteSelection.specific
                    ? `${manualSuiteSelection.label} only (${manualSuiteCases.length})`
                    : "Current suite unavailable — choose a suite or another scope"}
                </option>
              </select>
            </label>
            <label>
              Selection operation
              <select
                value={manualBulkMode}
                disabled={
                  configurationSelection !== null ||
                  startManualMutation.isPending ||
                  !manualBulkReady
                }
                onChange={(event) =>
                  setManualBulkMode(event.target.value as RunBulkSelectionMode)
                }
              >
                <option value="SET">Set — replace selection</option>
                <option value="ADD">Add — keep existing and add matches</option>
                <option value="REMOVE">Remove — subtract matches</option>
              </select>
            </label>
            <button
              type="button"
              className="btn-secondary"
              disabled={
                configurationSelection !== null ||
                startManualMutation.isPending ||
                !manualBulkReady ||
                !manualBulkPreview.ok
              }
              onClick={selectScope}
            >
              Apply{" "}
              {manualBulkMode === "SET"
                ? "Set"
                : manualBulkMode === "ADD"
                  ? "Add"
                  : "Remove"}{" "}
              selection
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={
                configurationSelection !== null ||
                startManualMutation.isPending ||
                !manualBulkReady
              }
              onClick={clearSelection}
            >
              Clear selection
            </button>
          </div>
          {configurationSelection !== null ? (
            <p role="status">
              The original {configurationSelection.length}-case configuration is
              retained. Reopen its review; browsing cannot replace its cases.
            </p>
          ) : manualBulkPreview.ok ? (
            <p role="status">
              Applying this operation will add {manualBulkPreview.added}, remove{" "}
              {manualBulkPreview.removed}, and leave {manualBulkPreview.after}{" "}
              selected ({manualBulkPreview.matched} scope matches).
            </p>
          ) : (
            <p role="alert">{manualBulkPreview.error}</p>
          )}
          {manualBulkNotice && <p role="status">{manualBulkNotice}</p>}
          {casesQuery.error && (
            <p role="alert">
              The approved case scope could not be loaded. Your selection is
              retained; refresh original access before continuing.
            </p>
          )}
          <p className="text-muted">
            Bulk operations use the complete loaded approved scope, not hidden
            or unloaded pages. Filter and suite browsing never changes the
            selection until you apply Set, Add or Remove. Up to 1,000 cases
            including required prerequisites; archived and unreviewed cases are
            excluded. Starting freezes the current procedures for this run.
          </p>
          <div
            style={{
              maxHeight: 320,
              overflowY: "auto",
              border: "1px solid var(--line)",
              borderRadius: 6,
            }}
          >
            {casesQuery.isLoading && (
              <p role="status" className="text-muted" style={{ padding: 12 }}>
                Loading test cases…
              </p>
            )}
            {!casesQuery.error && !casesQuery.isLoading && !manualSourceReady && (
              <p role="status" className="text-muted" style={{ padding: 12 }}>
                {casesQuery.isPaused
                  ? "Case loading is paused. Your selection is retained; wait for the current approved scope before continuing."
                  : casesQuery.isFetching
                    ? "Refreshing approved test cases. Your selection is retained; wait for the current scope before continuing."
                    : "Waiting for current access and approved test cases. Your selection is retained; no empty scope was inferred."}
              </p>
            )}
            {manualSourceReady && manualCases.length === 0 && (
              <p className="text-muted" style={{ padding: 12 }}>
                {eligibleCases.length === 0
                  ? "No approved test cases are available. Import or create cases, or review pending cases first."
                  : "No approved test cases match the current filters. Adjust the search, suite, priority or test type."}
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
                  disabled={
                    configurationSelection !== null ||
                    startManualMutation.isPending ||
                    !manualBulkReady
                  }
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
          <p>
            Continue to review configuration, platform, build and execution
            environment before any run is started.
          </p>
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
                onClick={continueConfiguration}
                disabled={
                  manualSelection.size === 0 ||
                  startManualMutation.isPending ||
                  !manualAccess.canWrite ||
                  (configurationSelection === null && !manualBulkReady)
                }
              >
                {startManualMutation.isPending
                  ? "Starting…"
                  : configurationSelection !== null
                    ? "Reopen retained configuration"
                    : "Continue to configuration"}
              </button>
            </div>
          </div>
        </div>
      </Modal>
      <RunConfigurationModal
        key={`${projectId}:run-configuration`}
        open={configurationOpen}
        projectId={projectId}
        caseCount={configurationSelection?.length ?? 0}
        testCaseIds={configurationSelection ?? []}
        bulkScopes={[
          {
            key: "matching",
            label: "Current filter matches",
            testCaseIds: manualCases.map((testCase) => testCase.id),
          },
          {
            key: "all",
            label: "All loaded approved cases",
            testCaseIds: eligibleCases.map((testCase) => testCase.id),
          },
          ...(manualSuiteSelection.specific
            ? [
                {
                  key: "suite",
                  label: `Current suite: ${manualSuiteSelection.label}`,
                  testCaseIds: manualSuiteCases.map((testCase) => testCase.id),
                },
              ]
            : []),
        ]}
        bulkScopesReady={
          configurationOpen &&
          manualBulkReady &&
          manualSuiteSelection.available &&
          !selectionWriteStarted
        }
        onSelectionChange={changeConfigurationSelection}
        onClose={() => setConfigurationOpen(false)}
        onStart={startManualRun}
        onConfirmedStart={(acknowledgement, request) => {
          router.push(
            `/projects/${encodeURIComponent(request.projectId)}/test-runs/manual/${encodeURIComponent(acknowledgement.testRunId)}`,
          );
        }}
      />

      <CoverageSection projectId={projectId} />
      <HealingSignalSection projectId={projectId} />
    </div>
  );
}
