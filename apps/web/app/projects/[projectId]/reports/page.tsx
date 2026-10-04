"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useLayoutEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { Modal } from "@/components/Modal";
import { ReportBuilder } from "@/components/ReportBuilder";
import { trpcReact } from "@/lib/trpcReact";
import { canEditProject } from "@/lib/membership";
import { DEFAULT_REPORT_CASE_FILTERS, outcomePassShare, renderProjectReportCsv, renderProjectReportMarkdown, reportCaseFilterLabels, type ReportBucket, type ReportCaseFilters } from "@/lib/project-report";

function readable(value: string) { return value.replaceAll("_", " ").toLowerCase().replace(/^./, first => first.toUpperCase()); }
function dateTime(value: string | Date) { return new Date(value).toLocaleString(); }

function Distribution({ title, buckets, empty }: { title: string; buckets: ReportBucket[]; empty: string }) {
  return <div>
    <h3 style={{ fontSize: 15, marginBottom: 8 }}>{title}</h3>
    {buckets.length === 0 ? <p className="text-muted">{empty}</p> :
      <div className="table-scroll"><table className="workspace-table">
        <thead><tr><th scope="col">{title}</th><th scope="col" style={{ textAlign: "right" }}>Count</th></tr></thead>
        <tbody>{buckets.map(bucket => <tr key={bucket.key}><th scope="row">{readable(bucket.key)}</th><td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{bucket.count}</td></tr>)}</tbody>
      </table></div>}
  </div>;
}

function Metric({ label, value, note }: { label: string; value: number | string; note?: string }) {
  return <div className="metric-card"><span className="metric-top">{label}</span><strong>{value}</strong>{note && <small className="metric-note">{note}</small>}</div>;
}

function downloadText(filename: string, content: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function ProjectReportsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { isLoaded, isSignedIn, userId } = useAuth();
  const [originalActor, setOriginalActor] = useState<string | null>(null), [originalOrganization, setOriginalOrganization] = useState<string | null>(null);
  const actorReady = isLoaded && isSignedIn && !!userId;
  if (!originalActor && actorReady && userId) setOriginalActor(userId);
  const actorMatches = actorReady && originalActor === userId;
  const [windowDays, setWindowDays] = useState<7 | 30 | 90 | null>(30);
  const [selectedViewId, setSelectedViewId] = useState("");
  const [appliedFilters, setAppliedFilters] = useState<ReportCaseFilters | null>(null);
  const [queryOpen, setQueryOpen] = useState(false);
  const [queryStep, setQueryStep] = useState<0 | 1 | 2>(0);
  const [draftFilters, setDraftFilters] = useState<ReportCaseFilters>(DEFAULT_REPORT_CASE_FILTERS);
  const [queryName, setQueryName] = useState("");
  const project = trpcReact.project.byId.useQuery({ id: projectId }, { enabled: actorMatches, retry: false, staleTime: 0 });
  const organizations = trpcReact.organization.mine.useQuery(undefined, { enabled: actorMatches, retry: false, staleTime: 0 });
  const projectReady = actorMatches && !project.error && !project.isFetching && !project.isPaused && project.data?.id === projectId;
  const member = projectReady && !organizations.error && !organizations.isFetching && !organizations.isPaused ? organizations.data?.find(row => row.id === project.data?.organizationId) : undefined;
  if (!originalOrganization && member && project.data) setOriginalOrganization(project.data.organizationId);
  const accessReady = projectReady && !!member && originalOrganization === project.data?.organizationId;
  const writeReady = accessReady && canEditProject(member);
  const liveScope = useRef({ actor: userId, ready: accessReady });
  useLayoutEffect(() => { liveScope.current = { actor: userId, ready: accessReady }; return () => { liveScope.current = { ...liveScope.current, ready: false }; }; }, [userId, accessReady]);
  const views = trpcReact.testCaseViews.list.useQuery({ projectId }, { enabled: accessReady, retry: false, staleTime: 0 });
  const availableViews = accessReady && !views.error && !views.isFetching && !views.isPaused ? views.data : undefined;
  const saveQuery = trpcReact.testCaseViews.create.useMutation({ onSuccess: async saved => {
    if (!liveScope.current.ready || liveScope.current.actor !== originalActor) return;
    await views.refetch();
    setSelectedViewId(saved.id);
    setAppliedFilters(null);
    setQueryOpen(false);
  } });
  const report = trpcReact.reports.overview.useQuery({ projectId, windowDays,
    ...(selectedViewId ? { caseViewId: selectedViewId } : appliedFilters ? { caseFilters: appliedFilters } : {}) }, { enabled: accessReady, retry: false, staleTime: 0 });
  const preview = trpcReact.reports.overview.useQuery({ projectId, windowDays, caseFilters: draftFilters }, { enabled: accessReady && queryOpen && queryStep === 2, retry: false, staleTime: 0 });
  const data = accessReady && !report.error && !report.isFetching && !report.isPaused && report.data?.projectId === projectId && report.data.organizationId === originalOrganization && report.data.clerkActorId === userId ? report.data : undefined;
  const previewData = accessReady && !preview.error && !preview.isFetching && !preview.isPaused && preview.data?.projectId === projectId && preview.data.organizationId === originalOrganization && preview.data.clerkActorId === userId ? preview.data : undefined;

  function downloadReport(format: "md" | "csv") {
    if (!accessReady || !actorMatches || !data || !project.data) return;
    downloadText(`vaettir-project-report-${new Date(data.asOf).toISOString().slice(0, 10)}.${format}`,
      format === "md" ? renderProjectReportMarkdown(project.data.name, data) : renderProjectReportCsv(project.data.name, data),
      format === "md" ? "text/markdown;charset=utf-8" : "text/csv;charset=utf-8");
  }

  function beginQuery() {
    if (!accessReady || !availableViews) return;
    setDraftFilters(appliedFilters ?? availableViews.find(view => view.id === selectedViewId)?.filters ?? DEFAULT_REPORT_CASE_FILTERS);
    setQueryName("");
    setQueryStep(0);
    saveQuery.reset();
    setQueryOpen(true);
  }

  function updateFilter<K extends keyof ReportCaseFilters>(key: K, value: ReportCaseFilters[K]) {
    setDraftFilters(current => ({ ...current, [key]: value }));
  }

  const originalScopeMatches = actorMatches && (!originalOrganization || originalOrganization === project.data?.organizationId);
  return <>
    {!originalScopeMatches && <p role="status">Report query drafts remain retained but hidden. Return to the original account and workspace; no pending action is rebound.</p>}
    <div hidden={!originalScopeMatches} style={{ maxWidth: 1240, marginInline: "auto" }}>
    {!accessReady && <p role="status">Verifying current report access. Cached report bodies, private query names and exports are withheld. <button type="button" className="btn-secondary" onClick={() => { if (actorMatches) void Promise.all([project.refetch(), organizations.refetch(), report.refetch(), views.refetch()]); }}>Retry report access</button></p>}
    <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-end", justifyContent: "space-between", marginBottom: 20 }}>
      <div><p className="eyebrow">Project intelligence</p><h1 style={{ margin: "0 0 4px" }}>Reports</h1>
        <p className="text-muted" style={{ margin: 0 }}>Recorded inventory and execution evidence for {projectReady ? project.data?.name : "this project"}.</p></div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "end" }}>
        <label style={{ display: "grid", gap: 4 }}><span>Execution window</span>
          <select value={windowDays ?? "all"} onChange={event => setWindowDays(event.target.value === "all" ? null : Number(event.target.value) as 7 | 30 | 90)}>
            <option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="all">All recorded runs</option>
          </select></label>
        <button type="button" className="btn-secondary" onClick={() => void report.refetch()} disabled={report.isFetching}>Refresh</button>
        <button type="button" className="btn-secondary" onClick={() => downloadReport("md")} disabled={!data || !project.data}>Download Markdown</button>
        <button type="button" className="btn-secondary" onClick={() => downloadReport("csv")} disabled={!data || !project.data}>Download CSV</button>
      </div>
    </div>
    <ReportBuilder projectId={projectId} />
    <p><Link href={`/projects/${projectId}/execution-trends`}>Explore daily recorded outcomes and the runs behind them</Link>. This live view is separate from approved immutable stakeholder snapshots.</p>
    <section className="panel" aria-label="Case report query" style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "end", justifyContent: "space-between" }}>
        <label style={{ display: "grid", gap: 4, minWidth: "min(100%, 260px)" }}><span>Saved case query</span>
          <select value={selectedViewId} onChange={event => { if (!availableViews) return; setSelectedViewId(event.target.value); setAppliedFilters(null); }} disabled={!availableViews}>
            <option value="">All project cases</option>
            {availableViews?.map(view => <option key={view.id} value={view.id}>{view.name}</option>)}
          </select></label>
        <button className="btn-secondary" type="button" disabled={!availableViews} onClick={beginQuery}>Build case query</button>
      </div>
      {appliedFilters && <p role="status" className="text-muted" style={{ marginBottom: 0 }}>Unsaved query applied. Save it from the query builder to reuse it later.</p>}
      {views.error && <p role="alert" className="text-error">Saved queries unavailable: {views.error.message}</p>}
      <p className="text-muted" style={{ marginBottom: 0 }}>Case queries narrow the inventory section only. Requirements and execution stay project-wide. Saved queries are private to your account.</p>
    </section>
    {report.error || project.error ? <div className="panel text-error" role="alert">Report unavailable: {report.error?.message ?? project.error?.message}</div> : null}
    {!data && !report.error ? <p role="status">Loading project report…</p> : null}
    {data && <>
      <div className="panel" style={{ marginBottom: 20 }} role="note">
        <strong>Evidence boundary</strong><p style={{ margin: "4px 0" }}>This report describes Vaettir records. It does not establish release readiness, deployed behavior, or that every requirement has a linked test.</p>
        <small className="text-muted">Snapshot as of {dateTime(data.asOf)}. Inventory and requirements are current; execution is {data.windowStart ? `from ${dateTime(data.windowStart)} through the snapshot` : "all recorded runs through the snapshot"}. Refresh to include later changes.</small>
      </div>
      <div className="metric-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 190px), 1fr))" }} aria-label="Report totals">
        <Metric label="Active test cases" value={data.inventory.active} note={`${data.inventory.archived} archived separately`} />
        <Metric label="Requirements" value={data.requirements.total} note={`${data.requirements.withCriteria} with acceptance criteria`} />
        <Metric label="Runs in window" value={data.execution.runs} note="Recorded execution sessions" />
        <Metric label="Result outcomes" value={data.execution.results} note={`${data.execution.matchedResults} linked to a case`} />
      </div>
      {data.caseQuery && <section className="panel" aria-labelledby="report-case-query" style={{ marginBottom: 16 }}>
        <h2 id="report-case-query" style={{ marginTop: 0 }}>{data.caseQuery.source === "saved" ? data.caseQuery.name : "Unsaved case query"}</h2>
        <p><strong>{data.caseQuery.total}</strong> matching cases ({data.caseQuery.active} active, {data.caseQuery.archived} archived). {data.caseQuery.withSource} have linked test source; {data.caseQuery.riskAssessed} have risk assessments; {data.caseQuery.flaky} are marked flaky.</p>
        <p className="text-muted">Current case inventory only. This does not filter the project-wide inventory, requirements, or execution below.</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }} aria-label="Applied case filters">
          {reportCaseFilterLabels(data.caseQuery.filters).map(item => <span key={item.label} style={{ display: "inline-flex", border: "1px solid var(--line)", borderRadius: 999, padding: "4px 10px", background: "var(--panel)" }}>{item.label}: {item.value}</span>)}
        </div>
        {data.caseQuery.sample.length > 0 ? <div className="table-scroll" style={{ marginTop: 12 }}><table className="workspace-table">
          <caption style={{ textAlign: "left", marginBottom: 6 }}>First {data.caseQuery.sample.length} matching cases by the query sort</caption>
          <thead><tr><th scope="col">Test case</th><th scope="col">Type</th><th scope="col">Priority</th><th scope="col">State</th></tr></thead>
          <tbody>{data.caseQuery.sample.map(item => <tr key={item.id}><td><Link href={`/projects/${projectId}/test-cases/${item.id}`}>{item.title}</Link></td><td>{readable(item.testType)}</td><td>{readable(item.priority)}</td><td>{item.archived ? "Archived" : "Active"}</td></tr>)}</tbody>
        </table></div> : <p className="text-muted">No cases match. Adjust the query to see a different set.</p>}
      </section>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 360px), 1fr))", gap: 16 }}>
        <section className="panel" aria-labelledby="report-inventory"><h2 id="report-inventory" style={{ marginTop: 0 }}>Project-wide test inventory</h2>
          <p className="text-muted">{data.inventory.withSource} active cases have linked test source; {data.inventory.riskAssessed} have a recorded risk assessment; {data.inventory.flaky} are marked flaky.</p>
          <Distribution title="Type" buckets={data.inventory.byType} empty="No active cases." />
          <Distribution title="Priority" buckets={data.inventory.byPriority} empty="No priorities recorded." />
          <Distribution title="Review state" buckets={data.inventory.byReview} empty="No review states recorded." />
          <p><Link href={`/projects/${projectId}/test-cases`}>Open test case inventory →</Link></p>
        </section>
        <section className="panel" aria-labelledby="report-execution"><h2 id="report-execution" style={{ marginTop: 0 }}>Execution</h2>
          <p>{outcomePassShare(data) === null ? "No pass/fail outcomes in this window." : <><strong>{outcomePassShare(data)}%</strong> outcome pass share</>}</p>
          <p className="text-muted">PASS ÷ (PASS + FAIL + FLAKY). SKIP and BLOCKED are excluded; this is not case coverage or release readiness.</p>
          <Distribution title="Run state" buckets={data.execution.byRunStatus} empty="No runs in this window." />
          <Distribution title="Result state" buckets={data.execution.byResultStatus} empty="No results in this window." />
          <p><Link href={`/projects/${projectId}/test-runs`}>Open execution history →</Link></p>
        </section>
        <section className="panel" aria-labelledby="report-requirements"><h2 id="report-requirements" style={{ marginTop: 0 }}>Requirements</h2>
          <p>{data.requirements.withCriteria} of {data.requirements.total} requirements have at least one acceptance criterion.</p>
          <p className="text-muted">{data.requirements.linkedCriteria} test-plan criteria explicitly link to a requirement. The states below include all test-plan criteria, even unlinked ones. A MET state alone does not prove linked-case coverage.</p>
          <Distribution title="Test-plan criterion state" buckets={data.requirements.criteria} empty="No test-plan acceptance criteria recorded." />
          <p><Link href={`/projects/${projectId}/requirements`}>Open requirements →</Link></p>
        </section>
      </div>
      <section className="panel" style={{ marginTop: 16 }} aria-labelledby="report-recent-runs"><h2 id="report-recent-runs" style={{ marginTop: 0 }}>Recent runs in window</h2>
        {data.recentRuns.length === 0 ? <p className="text-muted">No runs in this window. Choose a wider window or add execution evidence.</p> :
          <div className="table-scroll"><table className="workspace-table"><thead><tr><th scope="col">Started</th><th scope="col">Provider</th><th scope="col">Status</th><th scope="col">Results</th><th scope="col">Reference</th></tr></thead>
            <tbody>{data.recentRuns.map(run => <tr key={run.id}><td><Link href={`/projects/${projectId}/test-runs#run-${run.id}`}>{dateTime(run.startedAt)}</Link></td><td>{run.ciProvider}</td><td>{readable(run.status)}</td><td>{run.resultCount}</td><td>{run.ciProvider === "manual" ? "Manual execution" : <span title={run.commitSha}>{run.branch} · {run.commitSha.slice(0, 9)}</span>}</td></tr>)}</tbody></table></div>}
      </section>
    </>}
    <Modal open={queryOpen && accessReady} onClose={() => setQueryOpen(false)} title="Build case query">
      <div style={{ display: "grid", gap: 14 }}>
        <p className="eyebrow" style={{ margin: 0 }}>Step {queryStep + 1} of 3 · {(["Focus", "Refine", "Review"] as const)[queryStep]}</p>
        {queryStep === 0 && <>
          <p style={{ margin: 0 }}>Choose the main case attributes to inspect.</p>
          <label style={{ display: "grid", gap: 4 }}>Type
            <select value={draftFilters.type} onChange={event => updateFilter("type", event.target.value)}>
              <option value="">All types</option>{["UNIT", "FUNCTIONAL", "CONTRACT", "INSTRUMENTATION", "SMOKE", "SANITY", "REGRESSION", "E2E", "PERFORMANCE", "SECURITY", "ACCESSIBILITY", "EXPLORATORY", "COMPLIANCE", "OTHER"].map(value => <option key={value} value={value}>{readable(value)}</option>)}
            </select></label>
          <label style={{ display: "grid", gap: 4 }}>Priority
            <select value={draftFilters.priority} onChange={event => updateFilter("priority", event.target.value)}><option value="">All priorities</option>{["CRITICAL", "HIGH", "MEDIUM", "LOW"].map(value => <option key={value} value={value}>{readable(value)}</option>)}</select></label>
          <label style={{ display: "grid", gap: 4 }}>Review state
            <select value={draftFilters.review} onChange={event => updateFilter("review", event.target.value)}><option value="">All review states</option>{["APPROVED", "PENDING_REVIEW", "REJECTED"].map(value => <option key={value} value={value}>{readable(value)}</option>)}</select></label>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}><input type="checkbox" checked={draftFilters.showArchived} onChange={event => updateFilter("showArchived", event.target.checked)} /> Include archived cases</label>
        </>}
        {queryStep === 1 && <>
          <p style={{ margin: 0 }}>Refine by title, tags, suite, or automation. Leave fields blank to include all.</p>
          <label style={{ display: "grid", gap: 4 }}>Title or tag contains
            <input value={draftFilters.search} maxLength={160} onChange={event => updateFilter("search", event.target.value)} /></label>
          <label style={{ display: "grid", gap: 4 }}>Suite path
            <input value={draftFilters.suitePath ?? ""} maxLength={240} onChange={event => updateFilter("suitePath", event.target.value || null)} placeholder="Leave blank for all suites" /></label>
          <label style={{ display: "grid", gap: 4 }}>Automation
            <select value={draftFilters.automation} onChange={event => updateFilter("automation", event.target.value)}><option value="">All automation states</option>{["MANUAL", "AUTOMATED", "PARTIALLY_AUTOMATED", "NEEDS_AUTOMATION"].map(value => <option key={value} value={value}>{readable(value)}</option>)}</select></label>
          <details><summary>Advanced filters</summary><div style={{ display: "grid", gap: 10, marginTop: 8 }}>
            <label style={{ display: "grid", gap: 4 }}>Origin<select value={draftFilters.origin} onChange={event => updateFilter("origin", event.target.value)}><option value="">All origins</option>{["AUTHORED", "AI_REVERSE_ENGINEERED", "IMPORTED"].map(value => <option key={value} value={value}>{readable(value)}</option>)}</select></label>
            <label style={{ display: "grid", gap: 4 }}>Sample sort<select value={draftFilters.sortBy} onChange={event => updateFilter("sortBy", event.target.value as ReportCaseFilters["sortBy"])}>{["updated", "title", "type", "automation", "risk", "priority", "origin", "review", "suite", "manual"].map(value => <option key={value} value={value}>{readable(value)}</option>)}</select></label>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}><input type="checkbox" checked={draftFilters.sortDescending} onChange={event => updateFilter("sortDescending", event.target.checked)} /> Descending</label>
          </div></details>
        </>}
        {queryStep === 2 && <>
          <p style={{ margin: 0 }}>Review the scope before using or saving it. No case is changed.</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }} aria-label="Query filters">{reportCaseFilterLabels(draftFilters).map(item => <span key={item.label} style={{ display: "inline-flex", border: "1px solid var(--line)", borderRadius: 999, padding: "4px 10px", background: "var(--panel)" }}>{item.label}: {item.value}</span>)}</div>
          {preview.isLoading || preview.isFetching || preview.isPaused ? <p role="status">Verifying matching cases…</p> : preview.error ? <p role="alert" className="text-error">Preview unavailable: {preview.error.message}</p> : previewData ? <p role="status"><strong>{previewData.caseQuery?.total ?? 0}</strong> matching cases in this project. Only case inventory is scoped; execution and requirements stay project-wide.</p> : <p role="status">Current preview access is unavailable; no cached count is shown.</p>}
          <label style={{ display: "grid", gap: 4 }}>Save this query for later (optional name)
            <input value={queryName} maxLength={80} onChange={event => setQueryName(event.target.value)} placeholder="For example: high-priority regression" /></label>
          {saveQuery.error && <p role="alert" className="text-error">Could not save: {saveQuery.error.message}</p>}
        </>}
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 8 }}>
          <button type="button" className="btn-secondary" onClick={() => queryStep === 0 ? setQueryOpen(false) : setQueryStep((queryStep - 1) as 0 | 1 | 2)}>{queryStep === 0 ? "Close" : "Back"}</button>
          {queryStep < 2 ? <button type="button" onClick={() => setQueryStep((queryStep + 1) as 0 | 1 | 2)} className="btn-primary">Continue</button> : <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button type="button" className="btn-secondary" disabled={!previewData} onClick={() => { if (!accessReady || !previewData) return; setAppliedFilters(draftFilters); setSelectedViewId(""); setQueryOpen(false); }}>Use once</button>
            <button type="button" className="btn-primary" disabled={!writeReady || !queryName.trim() || !previewData || saveQuery.isPending || !availableViews} onClick={() => { if (!writeReady || !actorMatches || !previewData || !availableViews || saveQuery.isPending) return; saveQuery.mutate({ projectId, name: queryName.trim(), filters: draftFilters }); }}>{saveQuery.isPending ? "Saving…" : "Save query"}</button>
          </div>}
        </div>
      </div>
    </Modal>
  </div></>;
}
