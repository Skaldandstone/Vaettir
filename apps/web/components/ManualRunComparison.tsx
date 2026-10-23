"use client";
import { useLayoutEffect, useRef, useState } from "react";
import { trpcReact, type RouterOutputs } from "@/lib/trpcReact";
import { useManualExecutionAccess } from "@/lib/use-manual-execution-access";
import { DistributionBar } from "./MetricVisuals";
import { downloadFile } from "@/lib/download";
import { manualRunComparisonRequestKey, type ManualRunComparisonInput } from "@vaettir/api/src/services/manualRunComparisonSchema";
import { renderManualRunComparisonCsv, renderManualRunComparisonJson } from "@/lib/manual-run-comparison-export";
type Comparison = RouterOutputs["manualRunComparison"]["compare"];
type Cursor = NonNullable<Comparison["nextCursor"]>;
type CatalogCursor = NonNullable<RouterOutputs["manualRunComparison"]["runs"]["nextCursor"]>;
function initialInterval() {
  const end = new Date(), start = new Date(end); start.setUTCDate(start.getUTCDate() - 29);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}
const label = (value: string) => value.toLowerCase().replaceAll("_", " ");
export function ManualRunComparison({ projectId }: { projectId: string }) { return <ComparisonView key={projectId} projectId={projectId} />; }
function ComparisonView({ projectId }: { projectId: string }) {
  const access = useManualExecutionAccess(projectId);
  const [dates, setDates] = useState(initialInterval), [applied, setApplied] = useState(initialInterval);
  const [catalogRequestId, setCatalogRequestId] = useState(() => crypto.randomUUID());
  const [catalogPages, setCatalogPages] = useState<CatalogCursor[]>([]);
  const [baseline, setBaseline] = useState(""), [candidate, setCandidate] = useState("");
  const [pair, setPair] = useState<{ baselineRunId: string; candidateRunId: string; requestId: string } | null>(null);
  const [pages, setPages] = useState<Cursor[]>([]), [expectedPairHash, setExpectedPairHash] = useState<string>();
  const [exportError, setExportError] = useState("");
  const scope = { projectId, originalOrganizationId: access.origin?.organizationId ?? "pending", expectedClerkActorId: access.origin?.clerkActorId ?? "pending" };
  const catalogInput = { ...scope, requestId: catalogRequestId, interval: applied, ...(catalogPages.at(-1) ? { cursor: catalogPages.at(-1)! } : {}) };
  const catalog = trpcReact.manualRunComparison.runs.useQuery(catalogInput, { enabled: access.ready, retry: false, staleTime: 0 });
  const catalogFresh = access.ready && !catalog.error && !catalog.isFetching && !catalog.isPaused && catalog.data?.requestKey === manualRunComparisonRequestKey(catalogInput) && catalog.data.organizationId === scope.originalOrganizationId && catalog.data.clerkActorId === scope.expectedClerkActorId;
  const choices = catalogFresh ? catalog.data!.items : [];
  const comparisonInput: ManualRunComparisonInput = { ...scope, ...(pair ?? { baselineRunId: "pending-baseline", candidateRunId: "pending-candidate", requestId: catalogRequestId }), ...(expectedPairHash ? { expectedPairHash } : {}), ...(pages.at(-1) ? { cursor: pages.at(-1)! } : {}) };
  const comparison = trpcReact.manualRunComparison.compare.useQuery(comparisonInput, { enabled: access.ready && !!pair, retry: false, staleTime: 0 });
  const fresh = access.ready && !!pair && !comparison.error && !comparison.isFetching && !comparison.isPaused && comparison.data?.requestKey === manualRunComparisonRequestKey(comparisonInput) && comparison.data.organizationId === scope.originalOrganizationId && comparison.data.clerkActorId === scope.expectedClerkActorId;
  const value = fresh ? comparison.data! : null;
  const current = useRef<{ ready: boolean; value: Comparison | null }>({ ready: false, value: null });
  useLayoutEffect(() => { current.current = { ready: fresh, value }; return () => { current.current = { ready: false, value: null }; }; }, [fresh, value]);
  function restartPair() {
    if (!access.ready || !baseline || !candidate || baseline === candidate) return;
    setPages([]); setExpectedPairHash(undefined); setExportError("");
    setPair({ baselineRunId: baseline, candidateRunId: candidate, requestId: crypto.randomUUID() });
  }
  function exportPage(format: "CSV" | "JSON") {
    setExportError(""); const original = current.current;
    if (!original.ready || !original.value) { setExportError("Current original access and the exact comparison page must be verified before export."); return; }
    try {
      const body = format === "CSV" ? renderManualRunComparisonCsv(original.value) : renderManualRunComparisonJson(original.value);
      if (!current.current.ready || current.current.value?.requestKey !== original.value.requestKey || current.current.value.pairHash !== original.value.pairHash) throw new Error("Comparison scope changed. Nothing was exported.");
      downloadFile(`vaettir-manual-comparison-page-${pages.length + 1}.${format.toLowerCase()}`, body, format === "CSV" ? "text/csv" : "application/json");
    } catch (error) { setExportError(error instanceof Error ? error.message : "Comparison export could not be prepared."); }
  }
  return <main>
    <h1>Compare manual runs</h1>
    <p>Compare two saved manual executions: recorded case verdicts, unfinished scope and changes to their saved definitions. This never records a result or starts paid analysis.</p>
    <p><a href={`/projects/${projectId}/test-runs`}>Run dashboard</a> · <a href={`/projects/${projectId}/execution-trends`}>Recorded outcome trends and exports</a> · <a href={`/projects/${projectId}/recorded-run-comparison`}>Separate CI run comparison</a></p>
    {!access.ready ? <section role={access.denied ? "alert" : "status"}><p>Verify the original signed-in actor and workspace before showing private run choices or comparisons. Your selections remain retained, not reassigned to another account.</p><button type="button" onClick={() => void access.refresh()}>Recheck original access</button></section> : <>
      <section className="panel" aria-label="Manual run catalogue">
        <h2>Choose the two runs</h2>
        <form onSubmit={event => { event.preventDefault(); setApplied({ ...dates }); setCatalogPages([]); setCatalogRequestId(crypto.randomUUID()); }} style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "end" }}>
          <label>Started from (UTC)<input type="date" value={dates.start} onChange={event => setDates({ ...dates, start: event.target.value })} /></label>
          <label>Started through (UTC)<input type="date" value={dates.end} onChange={event => setDates({ ...dates, end: event.target.value })} /></label>
          <button type="submit" className="btn-secondary">Apply catalogue dates</button>
        </form>
        <p className="text-muted">At most 90 inclusive UTC days, using stored run start time, not observation dates. Dates narrow the catalogue only; retained baseline/candidate selections are not silently replaced.</p>
        {catalog.error && <p role="alert">{catalog.error.message} <button type="button" onClick={() => void catalog.refetch()}>Retry same catalogue</button></p>}
        {(catalog.isFetching || catalog.isPaused) && <p role="status">Checking the exact current manual-run catalogue…</p>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,280px),1fr))", gap: 12 }}>
          {(["baseline", "candidate"] as const).map(side => <label key={side} style={{ display: "grid", gap: 6 }}>{side === "baseline" ? "Baseline run" : "Candidate run"}
            <select value={side === "baseline" ? baseline : candidate} disabled={!catalogFresh} onChange={event => side === "baseline" ? setBaseline(event.target.value) : setCandidate(event.target.value)}>
              <option value="">Choose an exact run…</option>
              {(side === "baseline" ? baseline : candidate) && !choices.some(run => run.id === (side === "baseline" ? baseline : candidate)) && <option value={side === "baseline" ? baseline : candidate}>Retained run: {side === "baseline" ? baseline : candidate} (not on this catalogue page)</option>}
              {choices.map(run => <option key={run.id} value={run.id}>{new Date(run.startedAt).toLocaleString()} · {label(run.status)} · {run.plannedCases ?? "unsupported"} cases · {run.versionOneSnapshotPresent ? "saved snapshot needs validation" : "legacy/unsupported snapshot"} · {run.id.slice(-12)}</option>)}
            </select>
          </label>)}
        </div>
        {catalogFresh && !choices.length && <p>No manual runs in this catalogue interval. This is not missing comparison evidence; choose a different interval.</p>}
        <nav aria-label="Manual catalogue pages" style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button type="button" disabled={!catalogFresh || !catalogPages.length} onClick={() => setCatalogPages(current => current === catalogPages ? current.slice(0, -1) : current)}>Newer runs</button>
          <span>Catalogue page {catalogPages.length + 1}</span>
          <button type="button" disabled={!catalogFresh || !catalog.data?.nextCursor} onClick={() => { if (catalog.data?.nextCursor) setCatalogPages(current => current === catalogPages ? [...current, catalog.data!.nextCursor!] : current); }}>Older runs</button>
        </nav>
        <button type="button" className="btn-primary" style={{ marginTop: 12 }} disabled={!access.ready || !baseline || !candidate || baseline === candidate || comparison.isFetching} onClick={restartPair}>Compare selected saved runs</button>
        {baseline && baseline === candidate && <p role="alert">Choose two different runs.</p>}
      </section>
      {(comparison.isFetching || comparison.isPaused) && pair && <p role="status">Checking both exact frozen records. No cached comparison can authorize export.</p>}
      {comparison.error && <section role="alert"><p>{comparison.error.message}</p><button type="button" onClick={() => void comparison.refetch()}>Retry same pair/page</button><button type="button" onClick={restartPair}>Restart selected comparison explicitly</button></section>}
      {value && <>
        <div className="run-card-grid" style={{ marginTop: 16 }}>
          {(["baseline", "candidate"] as const).map(side => { const run = value[side], summary = side === "baseline" ? value.baselineSummary : value.candidateSummary; return <section className="panel run-card" key={side}>
            <h2>{side === "baseline" ? "Baseline" : "Candidate"} · {label(run.status)}</h2>
            <p><time dateTime={run.startedAt}>{new Date(run.startedAt).toLocaleString()}</time> · {run.finishedAt ? `Finished ${new Date(run.finishedAt).toLocaleString()}` : "No finish time recorded"}</p>
            <div className="run-card-progress"><strong>{summary.total === 0 ? "No planned cases" : `${summary.percentComplete}% with recorded verdicts`}</strong><span>{summary.total === 0 ? "Recorded percentage not applicable" : `${summary.remaining} cases without a verdict`}</span></div>
            {summary.total > 0 && <progress max={summary.total} value={summary.recorded} aria-label={`${side} planned case verdict progress`} />}
            <DistributionBar label={`${side} recorded verdicts`} segments={[{ label: "Passed", value: summary.pass, tone: "success" }, { label: "Failed", value: summary.fail, tone: "danger" }, { label: "Blocked", value: summary.blocked, tone: "warning" }, { label: "Skipped", value: summary.skip, tone: "neutral" }, { label: "Flaky", value: summary.flaky, tone: "info" }, { label: "No verdict", value: summary.remaining, tone: "neutral" }]} />
            <p>{summary.recorded}/{summary.total} planned cases have a recorded verdict. {summary.ignoredOutsideScopeResults} unmatched/out-of-scope observations excluded.</p>
            <a href={`/projects/${projectId}/test-runs/manual/${run.id}`}>Open this saved execution</a>
          </section>; })}
        </div>
        <p>{value.configuration.sameRecordedConfiguration ? "Same recorded configuration labels." : "Different recorded configuration labels."} This does not establish equivalent test environments.</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}><button type="button" onClick={() => exportPage("CSV")}>Export comparison page · CSV</button><button type="button" onClick={() => exportPage("JSON")}>Export comparison page · JSON</button></div>
        {exportError && <p role="alert">{exportError}</p>}
        <p className="text-muted">Page {pages.length + 1}: {value.items.length} of {value.unionCaseCount} saved union identities. Friendly case ID labels are current identity metadata; both titles and definition hashes below come from their respective saved runs. Title excerpts are marked.</p>
        {!value.unionCaseCount ? <p>Both supported saved records contain zero planned cases. This is an empty recorded scope, not missing or legacy snapshot evidence.</p> : <div className="table-scroll"><table className="workspace-table"><thead><tr><th>Case identity</th><th>Baseline saved case</th><th>Candidate saved case</th><th>Saved definition</th></tr></thead><tbody>
          {value.items.map(item => <tr key={item.caseId}><td><code>{item.currentCaseIdLabel ?? item.caseId}</code><small style={{ display: "block" }}>{item.currentCaseIdLabel ? "Current case ID label" : "Saved native identity; friendly label unavailable"}</small></td>
            {(["baseline", "candidate"] as const).map(side => { const saved = item[side]; return <td key={side}>{saved ? <><p>{saved.title}{saved.titleClipped && " (excerpt)"}</p><strong>{saved.outcome === "NO_CASE_VERDICT" ? "No recorded case verdict" : label(saved.outcome)}</strong><p><a href={`/projects/${projectId}/test-runs/manual/${value[side].id}?caseId=${encodeURIComponent(item.caseId)}`}>Open exact saved case</a></p></> : "Not in this run’s saved scope"}</td>; })}
            <td>{label(item.definitionState)}</td></tr>)}
        </tbody></table></div>}
        <nav aria-label="Comparison case pages" style={{ display: "flex", gap: 8, marginTop: 12 }}><button type="button" disabled={!pages.length} onClick={() => { setExpectedPairHash(value.pairHash); setPages(current => current === pages ? current.slice(0, -1) : current); }}>Previous cases</button><button type="button" disabled={!value.nextCursor} onClick={() => { if (value.nextCursor) { setExpectedPairHash(value.pairHash); setPages(current => current === pages ? [...current, value.nextCursor!] : current); } }}>Next cases</button></nav>
        <details style={{ marginTop: 16 }}><summary>What this comparison does and does not establish</summary><ul>{value.limitations.map(note => <li key={note}>{note}</li>)}</ul></details>
      </>}
    </>}
  </main>;
}
