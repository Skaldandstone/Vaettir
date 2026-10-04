"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { Modal } from "./Modal";
import { QualityRiskAggregateExport } from "./QualityRiskAggregateExport";
import { trpcReact } from "@/lib/trpcReact";
import { readableMetric } from "@/lib/frozen-report";
import { qualityRiskOverviewInput, qualityRiskOverviewRequestKey, type QualityRiskOverviewInput } from "@vaettir/api/src/services/qualityRiskOverviewSchema";

const control = { width: "100%", minWidth: 0, boxSizing: "border-box" as const };
const label = { display: "grid", gap: 6, marginBlock: 10, minWidth: 0 };
const chip = { display: "inline-flex", padding: "6px 10px", border: "1px solid var(--border)", borderRadius: 18, overflowWrap: "anywhere" as const };
const reviewLabel = (state: string) => state === "VERSION_MATCHING_REVIEW" ? "Entry version matches ordinary review"
  : state === "BASELINE_CHANGED" ? "Entry baseline changed since review" : "No ordinary review recorded";
const defaultFilters = { search: "", review: "ANY", disposition: "ANY", evidence: "ANY", mitigation: "ANY", likelihood: "", consequence: "" };
type FilterDraft = typeof defaultFilters;
export function QualityRiskOverview({ projectId }: { projectId: string }) { return <Overview key={projectId} projectId={projectId} />; }
function Overview({ projectId }: { projectId: string }) {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const [originalClerkActorId, setOriginalClerkActorId] = useState<string>();
  const [offset, setOffset] = useState(0), [originalOrganizationId, setOriginalOrganizationId] = useState<string>(),
    [filter, setFilter] = useState<FilterDraft>(defaultFilters), [draft, setDraft] = useState<FilterDraft>(defaultFilters),
    [filtersOpen, setFiltersOpen] = useState(false), [filterError, setFilterError] = useState(""), [selectedId, setSelectedId] = useState("");
  const project = trpcReact.project.byId.useQuery({ id: projectId }, { staleTime: 0 });
  const organizations = trpcReact.organization.mine.useQuery(undefined, { staleTime: 0 });
  const actorReady = isLoaded && isSignedIn && !!userId;
  const projectReady = !project.error && !project.isFetching && !project.isPaused && project.data?.id === projectId;
  const memberChecked = !organizations.error && !organizations.isFetching && !organizations.isPaused && Array.isArray(organizations.data);
  const memberReady = memberChecked && !!organizations.data?.find(row =>
    row.id === project.data?.organizationId && ["OWNER", "ADMIN", "EDITOR", "VIEWER", "COMPLIANCE_AUDITOR"].includes(row.role) && ["FULL", "READ_ONLY"].includes(row.seatType));
  const originChanged = (!!originalOrganizationId && projectReady && originalOrganizationId !== project.data?.organizationId) ||
    (!!originalClerkActorId && actorReady && originalClerkActorId !== userId);
  const ready = projectReady && memberReady && actorReady && !!originalOrganizationId && !!originalClerkActorId &&
    originalOrganizationId === project.data?.organizationId && originalClerkActorId === userId;
  useEffect(() => { if (actorReady && projectReady && memberReady && !originalOrganizationId && !originalClerkActorId) {
    setOriginalOrganizationId(project.data!.organizationId); setOriginalClerkActorId(userId!);
  } }, [actorReady, projectReady, memberReady, originalOrganizationId, originalClerkActorId, project.data, userId]);
  const actorNow = useRef({ actorReady: false, userId });
  useLayoutEffect(() => {
    actorNow.current = { actorReady, userId };
    return () => { actorNow.current = { actorReady: false, userId: undefined }; };
  }, [actorReady, userId]);
  const input: QualityRiskOverviewInput = qualityRiskOverviewInput.parse({ projectId, originalOrganizationId, expectedClerkActorId: originalClerkActorId, offset,
    ...filter, likelihood: filter.likelihood || undefined, consequence: filter.consequence || undefined });
  const detailInput = { projectId, originalOrganizationId, expectedClerkActorId: originalClerkActorId, id: selectedId || "unselected" };
  const summary = trpcReact.qualityRiskOverview.summary.useQuery(input, { enabled: ready, staleTime: 0 });
  const detail = trpcReact.qualityRiskOverview.byId.useQuery(detailInput, { enabled: ready && !!selectedId, staleTime: 0 });
  const denied = (isLoaded && !actorReady) || !!project.error || !!organizations.error || originChanged || (projectReady && memberChecked && !memberReady) ||
    [summary, ...(selectedId ? [detail] : [])].some(query => !!query.error && ["UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND"].includes(query.error.data?.code ?? ""));
  const paused = project.isPaused || organizations.isPaused || summary.isPaused || (!!selectedId && detail.isPaused);
  const current = ready && !denied && !paused && !summary.error && !summary.isFetching && !summary.isPaused && summary.data?.projectId === projectId &&
    summary.data.organizationId === originalOrganizationId && summary.data.organizationId === project.data?.organizationId &&
    summary.data.actorClerkUserId === originalClerkActorId && summary.data.actorClerkUserId === userId &&
    summary.data.requested === qualityRiskOverviewRequestKey(input) ? summary.data : null;
  const record = !!current && !!selectedId && !denied && !paused && !detail.error && !detail.isFetching && !detail.isPaused &&
    detail.data?.projectId === projectId && detail.data.organizationId === originalOrganizationId && detail.data.organizationId === project.data?.organizationId &&
    detail.data.actorClerkUserId === originalClerkActorId && detail.data.actorClerkUserId === userId &&
    detail.data.requested === qualityRiskOverviewRequestKey(detailInput) ? detail.data : null;
  const prefix = `/projects/${encodeURIComponent(projectId)}`;
  function closeDetail() { setSelectedId(""); }
  function setQuick(next: Partial<FilterDraft>) { setFilter({ ...defaultFilters, ...next }); setOffset(0); closeDetail(); }
  function apply() {
    if (!current) return;
    const parsed = qualityRiskOverviewInput.safeParse({ projectId, offset: 0, ...draft,
      likelihood: draft.likelihood || undefined, consequence: draft.consequence || undefined });
    if (!parsed.success) { setFilterError("Choose the supported human categories and a search within 80 characters."); return; }
    setFilter(draft); setOffset(0); closeDetail(); setFiltersOpen(false); setFilterError("");
  }
  async function refresh() {
    try {
    const [freshProject, freshOrganizations] = await Promise.all([project.refetch(), organizations.refetch()]);
    if (!originalClerkActorId || !actorNow.current.actorReady || actorNow.current.userId !== originalClerkActorId) return;
    if (freshProject.error || freshProject.isFetching || freshProject.isPaused || freshOrganizations.error || freshOrganizations.isFetching || freshOrganizations.isPaused ||
      freshProject.data?.id !== projectId || !freshOrganizations.data?.some(row => row.id === freshProject.data?.organizationId &&
        ["OWNER", "ADMIN", "EDITOR", "VIEWER", "COMPLIANCE_AUDITOR"].includes(row.role) && ["FULL", "READ_ONLY"].includes(row.seatType)) ||
      !originalOrganizationId || freshProject.data.organizationId !== originalOrganizationId) return;
    await summary.refetch(); if (selectedId) await detail.refetch();
    } catch { /* Retain selected detail and filters; failed access never authorizes cached output. */ }
  }
  const selector = (key: keyof FilterDraft, caption: string, values: string[], empty = "ANY") => <label style={label} key={key}>{caption}
    <select style={control} value={draft[key]} onChange={event => setDraft(value => ({ ...value, [key]: event.target.value }))}>
      <option value={empty}>All recorded categories</option>{values.map(value => <option key={value} value={value}>{value === "VERSION_MATCHING_REVIEW" || value === "BASELINE_CHANGED" || value === "NO_REVIEW" ? reviewLabel(value) : readableMetric(value)}</option>)}
    </select></label>;
  return <section aria-labelledby="quality-risk-overview" className="panel" style={{ marginBottom: 24 }}>
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <h2 id="quality-risk-overview" style={{ margin: 0 }}>Human quality-risk overview</h2>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}><button type="button" className="btn-secondary" disabled={!current} onClick={() => { setDraft(filter); setFilterError(""); setFiltersOpen(true); }}>Filter and explore risks</button>
        <button type="button" className="btn-secondary" onClick={refresh}>Refresh current register</button>
        <QualityRiskAggregateExport current={current} filters={filter} available={!!current && ready && !denied && !paused} revision={summary.dataUpdatedAt} /></div>
    </div>
    <p>Manual qualitative categories and ordinary recorded decisions. Version matching and available references do not establish verified mitigation, safety or regulatory acceptance.</p>
    {denied ? <div role="alert"><p>Current project access or original register ownership could not be verified. Retained counts and native links are hidden.</p><button type="button" className="btn-secondary" onClick={refresh}>Recheck current access</button></div>
      : paused ? <p role="status">Waiting for a connection to verify current access. Retained counts and native chips are hidden.</p>
      : summary.error ? <div role="alert"><p>The full risk overview could not be verified. No empty population or partial counts were substituted. {summary.error.message}</p><button type="button" className="btn-secondary" onClick={refresh}>Retry risk overview</button></div>
      : !current ? <p role="status">Verifying the full current register and recorded reference availability…</p>
      : <>
        <p>{current.population.entries} entries in the full project population; {current.filtered.entries} in this filtered cohort. Observed {new Date(current.observedAt).toLocaleString()}. These are live counts, not frozen historical reconstruction.</p>
        {!current.population.entries ? <p>No human risk entries are recorded. This is not a finding of no risk; the register below can record an initial assessment.</p> : <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(220px,100%),1fr))", gap: 12 }}>
            <section className="panel"><h3 style={{ marginTop: 0 }}>Ordinary review</h3>
              <div style={{ display: "grid", gap: 8 }}>{Object.entries(current.population.review).map(([key, count]) => <button type="button" className="btn-secondary" key={key} onClick={() => setQuick({ review: key })}>{reviewLabel(key)} · {count}</button>)}</div>
              <p className="text-muted">Matching checks the entry version only, not later test or requirement changes.</p>
            </section>
            <section className="panel"><h3 style={{ marginTop: 0 }}>Captured evidence references</h3>
              <p>{current.population.evidenceReferences.total} latest-review references · {current.population.evidenceReferences.available} available identities · {current.population.evidenceReferences.unavailable} unavailable identities.</p>
              <div style={{ display: "grid", gap: 8 }}><button type="button" className="btn-secondary" onClick={() => setQuick({ evidence: "NONE_RECORDED" })}>Reviewed with no evidence · {current.population.evidence.NONE_RECORDED}</button>
                <button type="button" className="btn-secondary" onClick={() => setQuick({ evidence: "SOME_REFERENCES_UNAVAILABLE" })}>Some unavailable references · {current.population.evidence.SOME_REFERENCES_UNAVAILABLE}</button>
                <button type="button" className="btn-secondary" onClick={() => setQuick({ evidence: "ALL_REFERENCES_UNAVAILABLE" })}>All references unavailable · {current.population.evidence.ALL_REFERENCES_UNAVAILABLE}</button></div>
              <p className="text-muted">No review and reviewed without evidence are distinct. References may repeat across risk entries; their statuses are historical.</p>
            </section>
          </div>
          <details style={{ marginBlock: 12 }}><summary>Full population qualitative categories and recorded dispositions</summary>
            <div className="table-scroll" role="region" aria-label="Human risk categories and counts" tabIndex={0}><table className="workspace-table" style={{ width: "100%", minWidth: 560 }}><thead><tr><th scope="col">Recorded dimension</th><th scope="col">Category</th><th scope="col">Entries</th><th scope="col">Explore</th></tr></thead>
              <tbody>{([['likelihood', current.population.likelihood], ['consequence', current.population.consequence], ['disposition', current.population.disposition]] as const).flatMap(([key, values]) => Object.entries(values).map(([value, count]) => <tr key={`${key}:${value}`}>
                <td>{key === "disposition" ? "Latest ordinary decision" : `Initial ${key}`}</td><td>{readableMetric(value)}</td><td>{count}</td><td><button type="button" className="btn-secondary" onClick={() => setQuick({ [key]: value })}>Explore {readableMetric(value)}</button></td></tr>))}</tbody></table></div>
            <p className="text-muted">UNKNOWN is explicitly recorded; NOT_RECORDED means no decision. No category cross-product, normative ranking or risk-reduction score is inferred.</p>
          </details>
        </>}
        <h3>Filtered risk entries</h3>
        <p>{Object.entries(filter).filter(([, value]) => value && value !== "ANY").map(([key, value]) => `${readableMetric(key)}: ${value}`).join(" · ") || "All current entries"}.</p>
        {!current.items.length ? <p>No entries match these filters. The full population counts above remain visible; this is not zero project risk.</p> : <>
          <p className="text-muted">Scroll sideways for all recorded fields.</p><div className="table-scroll" role="region" aria-label="Filtered human risk entries" tabIndex={0}>
            <table className="workspace-table" style={{ width: "100%", minWidth: 920 }}><thead><tr><th scope="col">Risk record</th><th scope="col">Component</th><th scope="col">Initial categories</th><th scope="col">Ordinary review</th><th scope="col">Latest disposition</th><th scope="col">Evidence references</th><th scope="col">Intended mitigation links</th></tr></thead><tbody>
              {current.items.map(entry => <tr key={entry.id}><td><button type="button" className="btn-secondary" style={chip} onClick={() => setSelectedId(entry.id)}>{entry.displayId}</button><div>{entry.title}</div></td><td>{entry.component}</td>
                <td>{readableMetric(entry.likelihood)} likelihood · {readableMetric(entry.consequence)} consequence</td><td>{reviewLabel(entry.review)}</td><td>{readableMetric(entry.disposition)}{entry.review === "BASELINE_CHANGED" && <div>Historical entry baseline</div>}</td>
                <td>{readableMetric(entry.evidence.state)} · {entry.evidence.available}/{entry.evidence.total} identities available</td><td>{readableMetric(entry.mitigation.state)} · {entry.mitigation.available}/{entry.mitigation.total} current references</td></tr>)}
            </tbody></table></div></>}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBlock: 12 }}>
          <button type="button" className="btn-secondary" disabled={!offset} onClick={() => { setOffset(offset - 20); closeDetail(); }}>Previous page</button><span>Page {offset / 20 + 1}</span>
          <button type="button" className="btn-secondary" disabled={!current.hasMore} onClick={() => { setOffset(offset + 20); closeDetail(); }}>Next page</button>
          <button type="button" className="btn-secondary" onClick={() => setQuick({})}>Clear filters</button>
        </div>
        <details><summary>Population and evidence limitations</summary><ul>{current.limits.map(limit => <li key={limit}>{limit}</li>)}</ul></details>
      </>}
    <Modal open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Explore human risk records">
      {!current ? <div role="alert"><p>Current actor, original organization and overview must be verified before displaying retained filter text. Your filter draft remains retained.</p><button type="button" className="btn-secondary" onClick={refresh}>Recheck filter access</button></div> : <>
      <p>Filter the complete supported current population. Full project counts stay separate from your filtered cohort.</p>
      <label style={label}>Find ID, title or component<input style={control} value={draft.search} maxLength={80} onChange={event => setDraft(value => ({ ...value, search: event.target.value }))} /></label>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(200px,100%),1fr))", gap: 12 }}>
        {selector("likelihood", "Initial likelihood", ["UNKNOWN", "RARE", "POSSIBLE", "FREQUENT"], "")}
        {selector("consequence", "Initial consequence", ["UNKNOWN", "MINOR", "SIGNIFICANT", "SEVERE"], "")}
      </div>
      {selector("review", "Latest ordinary review", ["NO_REVIEW", "VERSION_MATCHING_REVIEW", "BASELINE_CHANGED"])}
      <details><summary>Disposition, recorded evidence and intended links</summary>
        {selector("disposition", "Latest human disposition", ["NOT_RECORDED", "FURTHER_ACTION", "REVIEW_RECORDED", "HUMAN_ACCEPTANCE_RECORDED"])}
        {selector("evidence", "Recorded evidence identity availability", ["NO_REVIEW", "NONE_RECORDED", "ALL_REFERENCES_AVAILABLE", "SOME_REFERENCES_UNAVAILABLE", "ALL_REFERENCES_UNAVAILABLE"])}
        {selector("mitigation", "Intended mitigation link availability", ["NO_LINKS", "ALL_REFERENCES_AVAILABLE", "SOME_REFERENCES_UNAVAILABLE", "ALL_REFERENCES_UNAVAILABLE"])}
      </details>
      {filterError && <p role="alert">{filterError}</p>}<div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}><button type="button" className="btn-secondary" onClick={() => setFiltersOpen(false)}>Cancel</button><button type="button" className="btn-primary" onClick={apply}>Apply filters</button></div>
      </>}
    </Modal>
    <Modal open={!!selectedId} onClose={closeDetail} title="Read-only risk evidence overview" size="wide">
      {denied ? <div role="alert"><p>Current access or original register ownership could not be verified. Retained evidence is hidden.</p><button type="button" className="btn-secondary" onClick={refresh}>Recheck access</button></div>
        : paused ? <p role="status">Waiting for a connection to verify this risk. Retained evidence is hidden.</p>
        : detail.error ? <div role="alert"><p>This risk's recorded metadata could not be verified. No substitute empty evidence is shown. {detail.error.message}</p><button type="button" className="btn-secondary" onClick={refresh}>Retry risk evidence</button></div>
        : !record ? <p role="status">Verifying the current risk entry and exact recorded evidence identities…</p>
        : <>
          <h3>{record.entry.displayId} · {record.entry.title}</h3><p>Component: {record.entry.component}. Current entry version {record.entry.version}.</p>
          <p>Initial: {readableMetric(record.entry.likelihood)} likelihood · {readableMetric(record.entry.consequence)} consequence.</p>
          <p>{reviewLabel(record.entry.review)}. Latest disposition: {readableMetric(record.entry.disposition)}.</p>
          {record.entry.residual && <p>Latest human residual categories: {readableMetric(record.entry.residual.likelihood)} likelihood · {readableMetric(record.entry.residual.consequence)} consequence.
            Ordinary decision recorded {new Date(record.entry.residual.recordedAt).toLocaleString()} from assessed entry version {record.entry.residual.assessedVersion}; resulting entry version {record.entry.residual.createdVersion}.</p>}
          <p>Version matching checks only this risk entry. Later results, case procedures and requirements are not automatically reverified. This is not an effectiveness, safety or qualified approval finding.</p>
          <details><summary>Captured evidence references ({record.entry.evidence.total})</summary>
            {!record.evidence.length ? <p>{record.entry.review === "NO_REVIEW" ? "No ordinary review is recorded." : "This human decision recorded no evidence references."} No verification is implied.</p> : <>
              <p>Captured statuses and dates remain historical observations. Available means the original result/case/run tuple still resolves in this project—not that its status or procedure has been reverified.</p>
              <p className="text-muted">Scroll sideways to see all captured fields.</p><div className="table-scroll" role="region" aria-label="Historical risk evidence references" tabIndex={0}><table className="workspace-table" style={{ width: "100%", minWidth: 760 }}><thead><tr><th scope="col">Captured case</th><th scope="col">Captured outcome</th><th scope="col">Observed at review</th><th scope="col">Native run/result reference</th></tr></thead><tbody>{record.evidence.map((ref, index) => <tr key={`${index}:${ref.resultId ?? "unavailable"}`}>
                <td>{ref.available && ref.caseId ? <Link style={chip} href={`${prefix}/test-cases?caseId=${encodeURIComponent(ref.caseId)}`}>{ref.caseDisplayId}</Link> : <span style={chip}>{ref.caseDisplayId} · Native reference unavailable</span>}</td>
                <td>{readableMetric(ref.status)} · Historical</td><td>{new Date(ref.observedAt).toLocaleString()}</td><td>{ref.available && ref.runId ? <>
                  <Link style={chip} href={`${prefix}/test-runs#run-${encodeURIComponent(ref.runId)}`}>Recorded run</Link><div><code>{ref.resultId}</code> · Result reference, no standalone result route</div>
                </> : "Unavailable original tuple; native IDs withheld"}<div>Run started {new Date(ref.runStartedAt).toLocaleString()}</div></td>
              </tr>)}</tbody></table></div>
            </>}
          </details>
          <details><summary>Intended mitigation relationships ({record.entry.mitigation.total})</summary>
            <p>Declared intent only, not verified effectiveness or requirement fulfillment. Unavailable references stay in the denominator.</p>
            <h4>Case references</h4>{!record.cases.length ? <p>No intended cases linked.</p> : <div style={{ display: "grid", gap: 8 }}>{record.cases.map((ref, index) => <div key={index}>
              {ref.caseId && ref.available ? <Link style={chip} href={`${prefix}/test-cases?caseId=${encodeURIComponent(ref.caseId)}`}>{ref.label}</Link> : <span style={chip}>{ref.label}</span>}
              {ref.title && <span> · {ref.title}{ref.titleIsExcerpt ? " · Title excerpt" : ""}</span>}{ref.archived && <strong> · Currently archived</strong>}
            </div>)}</div>}
            <h4>Requirement references</h4>{!record.requirements.length ? <p>No intended requirements linked.</p> : <div style={{ display: "grid", gap: 8 }}>{record.requirements.map((ref, index) => <div key={index}>
              {ref.requirementId && ref.available ? <Link style={chip} href={`${prefix}/requirements#requirement-${encodeURIComponent(ref.requirementId)}`}>{ref.label}</Link> : <span style={chip}>{ref.label}</span>}{ref.titleIsExcerpt && " · Title excerpt"}
            </div>)}</div>}
          </details>
          <p className="text-muted">Use the register below for the full native definition and ordinary human edit/review workflow. This overview has no write or regulatory approval action.</p>
          <details><summary>Full overview limitations</summary><ul>{record.limits.map(limit => <li key={limit}>{limit}</li>)}</ul></details>
        </>}
    </Modal>
  </section>;
}
