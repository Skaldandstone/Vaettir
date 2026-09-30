"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { trpcReact } from "@/lib/trpcReact";
import { outcomePassShare, renderProjectReportMarkdown, type ReportBucket } from "@/lib/project-report";

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

export default function ProjectReportsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [windowDays, setWindowDays] = useState<7 | 30 | 90 | null>(30);
  const project = trpcReact.project.byId.useQuery({ id: projectId });
  const report = trpcReact.reports.overview.useQuery({ projectId, windowDays });
  const data = report.data;

  function downloadReport() {
    if (!data || !project.data) return;
    const markdown = renderProjectReportMarkdown(project.data.name, data);
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `vaettir-project-report-${new Date(data.asOf).toISOString().slice(0, 10)}.md`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <div style={{ maxWidth: 1240, marginInline: "auto" }}>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-end", justifyContent: "space-between", marginBottom: 20 }}>
      <div><p className="eyebrow">Project intelligence</p><h1 style={{ margin: "0 0 4px" }}>Reports</h1>
        <p className="text-muted" style={{ margin: 0 }}>Recorded inventory and execution evidence for {project.data?.name ?? "this project"}.</p></div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "end" }}>
        <label style={{ display: "grid", gap: 4 }}><span>Execution window</span>
          <select value={windowDays ?? "all"} onChange={event => setWindowDays(event.target.value === "all" ? null : Number(event.target.value) as 7 | 30 | 90)}>
            <option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="all">All recorded runs</option>
          </select></label>
        <button type="button" className="btn-secondary" onClick={() => void report.refetch()} disabled={report.isFetching}>Refresh</button>
        <button type="button" className="btn-secondary" onClick={downloadReport} disabled={!data || !project.data}>Download Markdown</button>
      </div>
    </div>
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
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 360px), 1fr))", gap: 16 }}>
        <section className="panel" aria-labelledby="report-inventory"><h2 id="report-inventory" style={{ marginTop: 0 }}>Test inventory</h2>
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
  </div>;
}
