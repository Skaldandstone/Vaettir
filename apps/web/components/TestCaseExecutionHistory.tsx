"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import type { CaseExecutionHistoryItem } from "@vaettir/core";
import { trpcReact } from "@/lib/trpcReact";
import { ManualRetestActions } from "./ManualRetestWizard";
import { Modal } from "./Modal";
import { CaseObservationHistoryEntry } from "./CaseObservationHistoryEntry";
import { caseExecutionHistoryInputSchema, caseHistoryRequestKey, type CaseExecutionHistoryInput } from "@vaettir/api/src/services/caseExecutionHistoryScopeSchema";
import type { CaseHistoryRunFilters } from "@vaettir/api/src/services/caseHistoryRunFiltersSchema";
import { executionDatePresets, resolveExecutionDatePreset } from "@/lib/execution-date-presets";

const recordedSources = [
  { value: "MANUAL", label: "Manual runs" },
  { value: "CI_IMPORT", label: "Imported provider runs" },
] as const;
const overallStatuses = [
  { value: "RUNNING", label: "In progress" },
  { value: "PASSED", label: "Passed" },
  { value: "FAILED", label: "Failed" },
  { value: "PARTIAL", label: "Partial" },
] as const;

const outcomes = {
  PASS: "Passed",
  FAIL: "Failed",
  BLOCKED: "Blocked",
  SKIP: "Skipped",
  FLAKY: "Flaky",
  NOT_RECORDED: "No result",
  MIXED: "Mixed results",
};
const runStatuses = {
  RUNNING: "In progress",
  PASSED: "Passed",
  FAILED: "Failed",
  PARTIAL: "Partial",
};

function ExecutionEntry({
  item,
  projectId,
  testCaseId,
  displayId,
  onReviewRetest,
}: {
  item: CaseExecutionHistoryItem;
  projectId: string;
  testCaseId: string;
  displayId: string;
  onReviewRetest: (item: CaseExecutionHistoryItem) => void;
}) {
  return (
    <article
      style={{
        border: "1px solid var(--line)",
        borderRadius: 8,
        padding: 12,
        minWidth: 0,
        overflowWrap: "anywhere",
      }}
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <strong>
          Case outcome:{" "}
          {item.outcomeMode === "PARTIAL_STEPS"
            ? "No confirmed result"
            : outcomes[item.outcome]}
        </strong>
        <time dateTime={item.startedAt}>
          {new Date(item.startedAt).toLocaleString()}
        </time>
      </header>
      <dl
        style={{
          display: "grid",
          gridTemplateColumns:
            "repeat(auto-fit, minmax(min(100%, 160px), 1fr))",
          gap: 12,
          margin: "12px 0",
        }}
      >
        <div>
          <dt className="muted">Overall run</dt>
          <dd style={{ margin: 0 }}>{runStatuses[item.runStatus]}</dd>
        </div>
        <div>
          <dt className="muted">Platform / build</dt>
          <dd style={{ margin: 0, whiteSpace: "pre-wrap" }}>
            {item.platform === null ? "Platform not recorded" : item.platform === "" ? "Platform left blank" : item.platform}
            <br />
            {item.build === null ? "Build not recorded" : item.build === "" ? "Build left blank" : item.build}
          </dd>
        </div>
        <div>
          <dt className="muted">Run starter (current profile)</dt>
          <dd style={{ margin: 0 }}>{item.starter?.label || "Not recorded"}</dd>
        </div>
      </dl>
      {item.outcomeMode === "PARTIAL_STEPS" && (
        <p role="note">Partial step observations, not a completed test case.</p>
      )}
      {item.outcome === "NOT_RECORDED" &&
        item.outcomeMode !== "PARTIAL_STEPS" && (
          <p>
            {item.planned
              ? "Included in this run, but no case outcome has been recorded."
              : "No case outcome recorded."}
          </p>
        )}
      {item.steps.correctionCount > 0 && (
        <p>
          {item.steps.correctionCount} step observation{" "}
          {item.steps.correctionCount === 1 ? "correction" : "corrections"}{" "}
          within this same execution.
        </p>
      )}
      {item.wholeCase && item.wholeCase.correctionCount > 0 && <p>
        {item.wholeCase.correctionCount} recorded whole-case {item.wholeCase.correctionCount === 1 ? "correction" : "corrections"} within this same execution, not separate retests.
      </p>}
      <details>
        <summary>Review execution evidence</summary>
        <dl style={{ marginTop: 12 }}>
          <dt className="muted">Execution identity</dt>
          <dd style={{ margin: "0 0 10px" }}>{item.runId}</dd>
          <dt className="muted">Reported by</dt>
          <dd style={{ margin: "0 0 10px" }}>
            {item.source === "MANUAL" ? "Manual execution" : item.provider}
          </dd>
          <dt className="muted">Saved case definition</dt>
          <dd style={{ margin: "0 0 10px" }}>
            {item.definition.titleAtRun ||
              (item.definition.source === "UNSUPPORTED_METADATA"
                ? "Unsupported or incomplete saved metadata"
                : "Not recorded for this execution")}
          </dd>
          <dt className="muted">Recorded steps</dt>
          <dd style={{ margin: "0 0 10px" }}>
            {item.steps.recordedCount} /{" "}
            {item.definition.stepCount ?? "unknown"}
          </dd>
          <dt className="muted">Result evidence</dt>
          <dd style={{ margin: "0 0 10px" }}>
            {item.outcomeCounts.length
              ? item.outcomeCounts
                  .map((c) => `${c.count} ${outcomes[c.status].toLowerCase()}`)
                  .join(", ")
              : "No case result"}
            ; {item.artifactCount} artifact references
          </dd>
          {item.environment !== null && (
            <>
              <dt className="muted">Recorded environment</dt>
              <dd style={{ margin: "0 0 10px", whiteSpace: "pre-wrap" }}>{item.environment === "" ? "Environment left blank" : item.environment}</dd>
            </>
          )}
          {item.reportedCommit && (
            <>
              <dt className="muted">
                Reported source commit, not deployed release proof
              </dt>
              <dd style={{ margin: "0 0 10px" }}>{item.reportedCommit}</dd>
            </>
          )}
          {item.steps.lastObservation && (
            <>
              <dt className="muted">
                Last step observer (name recorded at observation)
              </dt>
              <dd style={{ margin: "0 0 10px" }}>
                {item.steps.lastObservation.recordedActorName} ·{" "}
                <time dateTime={item.steps.lastObservation.recordedAt}>
                  {new Date(
                    item.steps.lastObservation.recordedAt,
                  ).toLocaleString()}
                </time>
              </dd>
            </>
          )}
          {item.wholeCase && <>
            <dt className="muted">Retained whole-case observations</dt>
            <dd style={{ margin: "0 0 10px" }}>{item.wholeCase.revisionCount} tracked {item.wholeCase.revisionCount === 1 ? "revision" : "revisions"}; current recorded outcome: {outcomes[item.wholeCase.lastStatus]}. Original observations remain in the native history.</dd>
            <dt className="muted">Last whole-case recorder (name recorded at observation)</dt>
            <dd style={{ margin: "0 0 10px", whiteSpace: "pre-wrap" }}>{item.wholeCase.lastRecorderName} · <time dateTime={item.wholeCase.lastRecordedAt}>{new Date(item.wholeCase.lastRecordedAt).toLocaleString()}</time></dd>
          </>}
        </dl>
        <ul>
          {item.limitations.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </details>
      {item.source === "MANUAL" && <CaseObservationHistoryEntry projectId={projectId} testCaseId={testCaseId} displayId={displayId} item={item} />}
      {item.source === "MANUAL" && <button type="button" className="btn-secondary" onClick={() => onReviewRetest(item)}>Review native retest links{item.outcome === "FAIL" || item.outcome === "BLOCKED" ? " or separate retest" : ""}</button>}
    </article>
  );
}

export function TestCaseExecutionHistory({
  projectId,
  testCaseId,
  active = true,
}: {
  projectId: string;
  testCaseId: string;
  active?: boolean;
}) {
  return <History key={`${projectId}:${testCaseId}`} projectId={projectId} testCaseId={testCaseId} active={active} />;
}
type HistoryFilterDraft = {
  start: string; end: string; platform: string; build: string; environment: string;
  recordedSource: NonNullable<CaseHistoryRunFilters["recordedSource"]> | "";
  runStatus: NonNullable<CaseHistoryRunFilters["runStatus"]> | "";
};
const blankFilters: HistoryFilterDraft = { start: "", end: "", platform: "", build: "", environment: "", recordedSource: "", runStatus: "" };
function History({ projectId, testCaseId, active }: { projectId: string; testCaseId: string; active: boolean }) {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const [originalOrganizationId, setOriginalOrganizationId] = useState<string>();
  const [originalClerkActorId, setOriginalClerkActorId] = useState<string>();
  const [filterDraft, setFilterDraft] = useState(blankFilters), [applied, setApplied] = useState(blankFilters);
  const [selectedRetest, setSelectedRetest] = useState<{ runId: string; caseId: string; canRetest: boolean } | null>(null);
  const [retainedRetest, setRetainedRetest] = useState(false), [retestNotice, setRetestNotice] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false), [filterError, setFilterError] = useState("");
  const [dateShortcut, setDateShortcut] = useState<string>("");
  const [anchors, setAnchors] = useState<Array<{ runId: string; filterKey?: string } | undefined>>([
    undefined,
  ]);
  const project = trpcReact.project.byId.useQuery({ id: projectId }, { enabled: active, staleTime: 0, retry: false });
  const organizations = trpcReact.organization.mine.useQuery(undefined, { enabled: active, staleTime: 0, retry: false });
  const actorReady = isLoaded && isSignedIn && !!userId;
  const projectReady = !project.error && !project.isFetching && !project.isPaused && project.data?.id === projectId;
  const memberChecked = !organizations.error && !organizations.isFetching && !organizations.isPaused && Array.isArray(organizations.data);
  const memberReady = memberChecked && !!organizations.data?.find(row => row.id === project.data?.organizationId &&
    ["OWNER", "ADMIN", "EDITOR", "VIEWER", "COMPLIANCE_AUDITOR"].includes(row.role) && ["FULL", "READ_ONLY"].includes(row.seatType));
  const memberCanWrite = memberChecked && !!organizations.data?.find(row => row.id === originalOrganizationId &&
    ["OWNER", "ADMIN", "EDITOR"].includes(row.role) && row.seatType === "FULL");
  const changed = (!!originalOrganizationId && projectReady && originalOrganizationId !== project.data?.organizationId) ||
    (!!originalClerkActorId && actorReady && originalClerkActorId !== userId);
  useEffect(() => {
    if (active && actorReady && projectReady && memberReady && !originalOrganizationId && !originalClerkActorId) {
      setOriginalOrganizationId(project.data!.organizationId); setOriginalClerkActorId(userId!);
    }
  }, [active, actorReady, projectReady, memberReady, originalOrganizationId, originalClerkActorId, project.data, userId]);
  const ready = active && actorReady && projectReady && memberReady && !!originalOrganizationId && !!originalClerkActorId && !changed;
  const filters = {
    ...(applied.recordedSource ? { recordedSource: applied.recordedSource } : {}),
    ...(applied.runStatus ? { runStatus: applied.runStatus } : {}),
    ...(applied.start && applied.end ? { interval: { start: applied.start, end: applied.end } } : {}),
    ...(applied.platform ? { platform: applied.platform } : {}), ...(applied.build ? { build: applied.build } : {}),
    ...(applied.environment ? { environment: applied.environment } : {}),
  };
  const input: CaseExecutionHistoryInput = { projectId, testCaseId, limit: 10, originalOrganizationId, expectedClerkActorId: originalClerkActorId,
    before: anchors[anchors.length - 1], ...(Object.keys(filters).length ? { filters } : {}) };
  const history = trpcReact.caseExecutionHistory.list.useQuery(
    input,
    { enabled: ready, retry: false, staleTime: 0 },
  );
  const denied = (isLoaded && !actorReady) || changed || !!project.error || !!organizations.error ||
    (projectReady && memberChecked && !memberReady) || !!history.error && ["FORBIDDEN", "UNAUTHORIZED", "NOT_FOUND"].includes(history.error.data?.code ?? "");
  const paused = project.isPaused || organizations.isPaused || history.isPaused;
  const page = ready && !denied && !paused && !history.error && !history.isFetching && !history.isPaused &&
    history.data?.projectId === projectId && history.data.testCase.id === testCaseId && history.data.organizationId === originalOrganizationId &&
    history.data.organizationId === project.data?.organizationId && history.data.actorClerkUserId === originalClerkActorId &&
    history.data.actorClerkUserId === userId && history.data.requested === caseHistoryRequestKey(input) ? history.data : null;
  async function refresh() {
    try {
      const [freshProject, freshOrganizations] = await Promise.all([project.refetch(), organizations.refetch()]);
      if (freshProject.error || freshProject.isFetching || freshProject.isPaused || freshOrganizations.error || freshOrganizations.isFetching || freshOrganizations.isPaused ||
        freshProject.data?.id !== projectId || freshProject.data.organizationId !== originalOrganizationId || !originalClerkActorId ||
        !freshOrganizations.data?.some(row => row.id === originalOrganizationId && ["OWNER", "ADMIN", "EDITOR", "VIEWER", "COMPLIANCE_AUDITOR"].includes(row.role) && ["FULL", "READ_ONLY"].includes(row.seatType))) return;
      if (anchors.length > 1) setAnchors([undefined]); else await history.refetch();
    } catch { /* Preserve filters and cursor; an access/read failure never enables cached history. */ }
  }
  function applyFilters() {
    if (!ready || denied || paused) return;
    if (!!filterDraft.start !== !!filterDraft.end) { setFilterError("Choose both UTC dates, or leave both blank for all recorded dates."); return; }
    const parsed = caseExecutionHistoryInputSchema.safeParse({ projectId, testCaseId, limit: 10, filters: {
      ...(filterDraft.recordedSource ? { recordedSource: filterDraft.recordedSource } : {}),
      ...(filterDraft.runStatus ? { runStatus: filterDraft.runStatus } : {}),
      ...(filterDraft.start && filterDraft.end ? { interval: { start: filterDraft.start, end: filterDraft.end } } : {}),
      ...(filterDraft.platform ? { platform: filterDraft.platform } : {}), ...(filterDraft.build ? { build: filterDraft.build } : {}),
      ...(filterDraft.environment ? { environment: filterDraft.environment } : {}),
    } });
    if (!parsed.success) { setFilterError(parsed.error.issues.map(issue => issue.message).join(" ")); return; }
    setApplied(filterDraft); setAnchors([undefined]); setFiltersOpen(false); setFilterError("");
  }
  function chooseDateShortcut() {
    if (!ready || denied || paused || !filtersOpen || !dateShortcut) return;
    try {
      const dates = resolveExecutionDatePreset(dateShortcut);
      setFilterDraft(current => ({ ...current, ...dates })); setFilterError("");
    } catch (error) { setFilterError(error instanceof Error ? error.message : "Choose supported explicit UTC dates."); }
  }
  return (
    <section aria-label="Case executions" style={{ marginBottom: 24 }}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <h3>Executions</h3>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button type="button" className="btn-secondary" disabled={!ready || denied || paused} onClick={() => { setFilterDraft(applied); setDateShortcut(""); setFilterError(""); setFiltersOpen(true); }}>Filter executions</button>
        <button
          className="btn-secondary"
          type="button"
          disabled={history.isFetching}
          onClick={refresh}
        >
          Refresh latest
        </button>
        </div>
      </header>
      <p className="muted">
        One entry per run. Step corrections stay within that run; a later
        execution does not by itself verify a defect fix or a linked retest.
      </p>
      {denied ? <div role="alert"><p>Current actor, project membership or original organization could not be verified. Retained execution evidence is hidden; filter choices are preserved.</p><button type="button" className="btn-secondary" onClick={refresh}>Recheck history access</button></div>
      : paused ? <p role="status">Waiting for a connection to verify execution history. Cached evidence is hidden.</p>
      : history.error ? (
        <div role="alert">
          <p>Execution history could not be loaded. {history.error.message}</p>
          <button
            type="button"
            className="btn-secondary"
            onClick={refresh}
          >
            Retry history
          </button>
        </div>
      ) : !page ? <p role="status">Verifying current access and this exact history page…</p> : (
          <>
            <p>
              <strong>{page.testCase.displayId}</strong> ·{" "}
              {page.testCase.archived ? "Archived case" : "Test case"} · Page{" "}
              {anchors.length}
            </p>
            <p className="muted">{applied.start ? `Run started ${applied.start} through ${applied.end}, inclusive UTC` : "All recorded run-start dates"}
              {applied.recordedSource && ` · Recorded source: ${recordedSources.find(item => item.value === applied.recordedSource)?.label}`}
              {applied.runStatus && ` · Overall run: ${overallStatuses.find(item => item.value === applied.runStatus)?.label}`}
              {(["platform", "build", "environment"] as const).filter(key => applied[key]).map(key => ` · Exact recorded ${key}: ${applied[key]}`).join("")}. Observed {page.observedAt && new Date(page.observedAt).toLocaleString()}.</p>
            {!page.items.length ? (
              <p>
                No linked or planned executions match this applied scope. Missing or unsupported manual configuration and CI imports are not substituted when configuration filters are selected.
              </p>
            ) : (
              <div style={{ display: "grid", gap: 12 }}>
                {page.items.map((item) => (
                  <ExecutionEntry
                    key={item.runId}
                    item={item}
                    projectId={projectId}
                    testCaseId={page.testCase.id}
                    displayId={page.testCase.displayId}
                    onReviewRetest={item => {
                      if (selectedRetest && selectedRetest.runId !== item.runId) { setRetestNotice("Close the selected retest workflow before reviewing another execution. An unconfirmed request must first recover its receipt."); return; }
                      setRetestNotice(""); setSelectedRetest({ runId: item.runId, caseId: item.definition.originalCaseId, canRetest: item.outcome === "FAIL" || item.outcome === "BLOCKED" });
                    }}
                  />
                ))}
              </div>
            )}
            <nav
              aria-label="Execution history pages"
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                marginTop: 12,
              }}
            >
              {anchors.length > 1 && (
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={history.isFetching}
                  onClick={() => setAnchors((current) => current.slice(0, -1))}
                >
                  Newer executions
                </button>
              )}
              {page.nextCursor && (
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={history.isFetching}
                  onClick={() =>
                    setAnchors((current) => [...current, page.nextCursor!])
                  }
                >
                  Older executions
                </button>
              )}
            </nav>
            <details style={{ marginTop: 12 }}><summary>History scope and evidence limits</summary><ul>{page.limits?.map(limit => <li key={limit}>{limit}</li>)}</ul></details>
          </>
      )}
      {selectedRetest && <section className="panel" style={{ marginBlock: 12 }} aria-label="Retained native retest workflow">
        {!!page && <><h4>Selected original execution</h4><code style={{ overflowWrap: "anywhere" }}>{selectedRetest.runId}</code>
          <p>Filtering or refreshing history does not replace this separately selected native execution.</p></>}
        {retestNotice && !!page && <p role="status">{retestNotice}</p>}
        <ManualRetestActions key={`${projectId}:${selectedRetest.runId}:${selectedRetest.caseId}`} projectId={projectId}
          sourceRunId={selectedRetest.runId} testCaseId={selectedRetest.caseId} canRetest={selectedRetest.canRetest && memberCanWrite} active={!!page}
          onRetainedRequestChange={setRetainedRetest} />
        {!!page && <button type="button" className="btn-secondary" disabled={retainedRetest} onClick={() => { setSelectedRetest(null); setRetestNotice(""); }}>Close selected retest workflow</button>}
        {retainedRetest && <p role="status">A request or review is pending in this mounted workflow. Recover it before selecting another execution; reloading does not preserve local state.</p>}
      </section>}
      <Modal open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filter recorded case executions">
        {!ready || denied || paused ? <p role="alert">Current original access must be verified before displaying retained filters. Your choices remain preserved.</p> : <>
          <p>Leave dates blank for all history, or choose up to 90 inclusive UTC days. Filters do not change original results.</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(180px,100%),1fr))", gap: 12, marginBlock: 12 }}>
            <label style={{ display: "grid", gap: 6 }}>Recorded source
              <select value={filterDraft.recordedSource} onChange={event => setFilterDraft(current => ({ ...current, recordedSource: recordedSources.find(item => item.value === event.target.value)?.value ?? "" }))}>
                <option value="">All recorded sources</option>{recordedSources.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <label style={{ display: "grid", gap: 6 }}>Overall run status
              <select value={filterDraft.runStatus} onChange={event => setFilterDraft(current => ({ ...current, runStatus: overallStatuses.find(item => item.value === event.target.value)?.value ?? "" }))}>
                <option value="">All run statuses</option>{overallStatuses.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
          </div>
          <p className="muted">Overall run status is not this case's outcome. Imported provider records do not by themselves verify automation or delivery from that provider.</p>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "end", gap: 8, marginBlock: 12 }}>
            <label style={{ display: "grid", gap: 6, minWidth: 0 }}>UTC date shortcut
              <select value={dateShortcut} onChange={event => setDateShortcut(event.target.value)} style={{ maxWidth: "100%" }}>
                <option value="">Choose a date shortcut…</option>{executionDatePresets.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </label>
            <button type="button" className="btn-secondary" disabled={!dateShortcut} onClick={chooseDateShortcut}>Set draft dates</button>
          </div>
          <p className="muted">Shortcuts set explicit draft dates only. Apply filters to change the displayed history; your selected retest workflow stays separate.</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(180px,100%),1fr))", gap: 12 }}>
            {(["start", "end"] as const).map(key => <label key={key} style={{ display: "grid", gap: 6, minWidth: 0 }}>UTC {key} date<input type="date" style={{ width: "100%", boxSizing: "border-box", minWidth: 0 }} value={filterDraft[key]} max={new Date().toISOString().slice(0, 10)} onChange={event => setFilterDraft(value => ({ ...value, [key]: event.target.value }))} /></label>)}
          </div>
          <details style={{ marginBlock: 12 }}><summary>Exact recorded manual configuration</summary><p>Only complete supported selected-case manual snapshots match. CI commits are not treated as build, platform or environment evidence. Match literal text including case and whitespace.</p>
            {(["platform", "build", "environment"] as const).map(key => <label key={key} style={{ display: "grid", gap: 6, minWidth: 0, marginBlock: 12 }}>Recorded {key}<input style={{ width: "100%", boxSizing: "border-box", minWidth: 0 }} value={filterDraft[key]} maxLength={key === "environment" ? 2000 : 300} onChange={event => setFilterDraft(value => ({ ...value, [key]: event.target.value }))} /></label>)}
          </details>
          {filterDraft.recordedSource === "CI_IMPORT" && !!(filterDraft.platform || filterDraft.build || filterDraft.environment) && <p role="note">Exact manual configuration filters exclude imported providers. This combined scope will have no matching runs; clear configuration fields to review imported runs.</p>}
          {filterError && <p role="alert">{filterError}</p>}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}><button type="button" className="btn-secondary" onClick={() => { setFilterDraft(blankFilters); setDateShortcut(""); setFilterError(""); }}>Clear draft filters</button><button type="button" className="btn-secondary" onClick={() => setFiltersOpen(false)}>Cancel</button><button type="button" className="btn-primary" onClick={applyFilters}>Apply filters</button></div>
        </>}
      </Modal>
    </section>
  );
}
