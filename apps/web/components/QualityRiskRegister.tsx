"use client";
import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { trpcReact } from "@/lib/trpcReact";
import { Modal } from "./Modal";
import { QualityRiskOverview } from "./QualityRiskOverview";
import { QualityRiskStarter } from "./QualityRiskStarter";
import { canApplyQualityRiskStarter, reviewedQualityRiskStarter, type QualityRiskStarterId, type RiskStarterBoundary } from "@/lib/quality-risk-starters";
import { readableMetric } from "@/lib/frozen-report";
import { retainSavedQueryRequest } from "@/lib/saved-case-query-recovery";
import { qualityRiskDefinition, qualityResidualDecision, type QualityRiskDefinition, type QualityRiskWriteInput } from "@vaettir/api/src/services/qualityRiskSchema";

const blank = (): QualityRiskDefinition => ({ title: "", component: "", failureMode: "", cause: "", effect: "",
  likelihood: "UNKNOWN", consequence: "UNKNOWN", rationale: "", mitigation: "", requirementIds: [], caseIds: [] });
const fieldStyle = { width: "100%", minWidth: 0, boxSizing: "border-box" as const };
const labelStyle = { display: "grid", gap: 6, minWidth: 0, marginBlock: 12 };
const likelihood = ["UNKNOWN", "RARE", "POSSIBLE", "FREQUENT"] as const;
const consequence = ["UNKNOWN", "MINOR", "SIGNIFICANT", "SEVERE"] as const;
type Review = { likelihood: (typeof likelihood)[number]; consequence: (typeof consequence)[number];
  rationale: string; evidenceNotes: string; disposition: "FURTHER_ACTION" | "REVIEW_RECORDED" | "HUMAN_ACCEPTANCE_RECORDED"; resultIds: string[] };
const emptyReview = (): Review => ({ likelihood: "UNKNOWN", consequence: "UNKNOWN", rationale: "", evidenceNotes: "", disposition: "FURTHER_ACTION", resultIds: [] });
export function QualityRiskRegister({ projectId }: { projectId: string }) {
  return <Register key={projectId} projectId={projectId} />;
}
function Register({ projectId }: { projectId: string }) {
  const utils = trpcReact.useUtils();
  const { isLoaded, isSignedIn, userId } = useAuth();
  const [origin, setOrigin] = useState<{ organizationId: string; actorClerkUserId: string } | null>(null);
  const [starter, setStarter] = useState<QualityRiskStarterId | null>(null);
  const [offset, setOffset] = useState(0), [open, setOpen] = useState(false),
    [selected, setSelected] = useState(""), [historyOffset, setHistoryOffset] = useState(0),
    [mode, setMode] = useState<"VIEW" | "CREATE" | "UPDATE" | "REVIEW">("VIEW"),
    [definition, setDefinition] = useState<QualityRiskDefinition>(blank),
    [baseline, setBaseline] = useState<{ id: string; version: number; displayId: string } | null>(null),
    [review, setReview] = useState<Review>(emptyReview), [acknowledged, setAcknowledged] = useState(false),
    [dropUnavailable, setDropUnavailable] = useState(false),
    [pending, setPending] = useState<QualityRiskWriteInput | null>(null), [message, setMessage] = useState(""),
    [screen, setScreen] = useState(0),
    [lookupKind, setLookupKind] = useState<"CASE" | "REQUIREMENT" | "RESULT">("CASE"),
    [search, setSearch] = useState(""), [choice, setChoice] = useState(""),
    [labels, setLabels] = useState<Record<string, string>>({});
  const project = trpcReact.project.byId.useQuery({ id: projectId }, { staleTime: 0 });
  const organizations = trpcReact.organization.mine.useQuery(undefined, { staleTime: 0 });
  const actorReady = isLoaded && isSignedIn && !!userId;
  const projectReady = !project.error && !project.isFetching && !project.isPaused && project.data?.id === projectId;
  const memberChecked = !organizations.error && !organizations.isFetching && !organizations.isPaused && Array.isArray(organizations.data);
  const membership = memberChecked ? organizations.data?.find(row => row.id === project.data?.organizationId &&
    ["OWNER", "ADMIN", "EDITOR", "VIEWER", "COMPLIANCE_AUDITOR"].includes(row.role) && ["FULL", "READ_ONLY"].includes(row.seatType)) : undefined;
  useEffect(() => {
    if (!origin && actorReady && projectReady && membership) setOrigin({ organizationId: project.data!.organizationId, actorClerkUserId: userId! });
  }, [origin, actorReady, projectReady, membership, project.data, userId]);
  const identityChanged = !!origin && ((actorReady && origin.actorClerkUserId !== userId) ||
    (projectReady && origin.organizationId !== project.data?.organizationId));
  const ready = !!origin && actorReady && projectReady && !!membership && !identityChanged;
  const originalOrganizationId = origin?.organizationId;
  const list = trpcReact.qualityRisks.list.useQuery({ projectId, originalOrganizationId, offset }, { enabled: ready, staleTime: 0 });
  const detail = trpcReact.qualityRisks.byId.useQuery({ projectId, originalOrganizationId, id: selected || "unselected", historyOffset },
    { enabled: ready && open && !!selected, staleTime: 0 });
  const lookup = trpcReact.qualityRisks.lookup.useQuery({ projectId, originalOrganizationId, kind: lookupKind, search },
    { enabled: ready && open && mode !== "VIEW", staleTime: 0 });
  const mutation = trpcReact.qualityRisks.write.useMutation();
  const denied = (isLoaded && !actorReady) || identityChanged || !!project.error || !!organizations.error ||
    (projectReady && memberChecked && !membership) || [list, ...(open && selected ? [detail] : []), ...(open && mode !== "VIEW" ? [lookup] : [])]
      .some(query => !!query.error && ["UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND"].includes(query.error.data?.code ?? ""));
  const paused = project.isPaused || organizations.isPaused || list.isPaused || (open && !!selected && detail.isPaused) ||
    (open && mode !== "VIEW" && lookup.isPaused);
  const displayReady = ready && !denied && !paused;
  const page = displayReady && !list.error && !list.isFetching && !list.isPaused && list.data?.projectId === projectId &&
    list.data.organizationId === originalOrganizationId && list.data.organizationId === project.data?.organizationId && list.data.actorClerkUserId === userId &&
    list.data.offset === offset ? list.data : null;
  const current = displayReady && open && selected && !detail.error && !detail.isFetching && !detail.isPaused && !!detail.data &&
    detail.data?.organizationId === originalOrganizationId && detail.data.organizationId === project.data?.organizationId && detail.data.actorClerkUserId === userId &&
    detail.data?.projectId === projectId && detail.data.entry.id === selected && detail.data.historyOffset === historyOffset ? detail.data : null;
  const choices = displayReady && !lookup.error && !lookup.isFetching && !lookup.isPaused && lookup.data?.projectId === projectId &&
    lookup.data.organizationId === originalOrganizationId && lookup.data.organizationId === project.data?.organizationId && lookup.data.actorClerkUserId === userId &&
    lookup.data.kind === lookupKind && lookup.data.search === search.trim() ? lookup.data.items : null;
  const writeReady = displayReady && membership?.seatType === "FULL" && ["OWNER", "ADMIN", "EDITOR"].includes(membership.role) && !!page?.canWrite;
  const formVisible = displayReady && !!page && (mode === "CREATE" || !!current);
  const reviewed = writeReady && (mode === "CREATE" || (!!current?.canWrite && !!baseline &&
    current.entry.id === baseline.id && current.entry.version === baseline.version));
  const frozen = mutation.isPending || !!pending;
  const starterBoundary: RiskStarterBoundary = { open, mode, canWrite: writeReady && formVisible, pending: !!pending, busy: mutation.isPending,
    hasBaseline: !!baseline, hasSelectedEntry: !!selected, acknowledged, dropUnavailableLinks: dropUnavailable, review };
  function close() { setOpen(false); }
  function view(id: string) {
    if (pending) { setOpen(true); return; }
    setSelected(id); setHistoryOffset(0); setMode("VIEW"); setBaseline(null); setMessage(""); setOpen(true);
  }
  function edit(next: "UPDATE" | "REVIEW") {
    if (!writeReady || !current || !current.canWrite || frozen) return;
    setBaseline({ id: current.entry.id, version: current.entry.version, displayId: current.entry.displayId });
    setDefinition(structuredClone(current.entry.definition)); setReview(emptyReview()); setAcknowledged(false); setDropUnavailable(false);
    setLabels(Object.fromEntries([...current.entry.links.cases.map(c => [c.id, `${c.label} · ${c.title}`]),
      ...current.entry.links.requirements.map(r => [r.id, r.label])]));
    setLookupKind(next === "REVIEW" ? "RESULT" : "CASE"); setSearch(""); setChoice(""); setMode(next); setMessage(""); setScreen(0);
  }
  async function send(input: QualityRiskWriteInput, recovery = false) {
    if (mutation.isPending || !writeReady) return;
    const request = pending ?? { ...structuredClone(input), expectedScope: { organizationId: origin!.organizationId, clerkActorId: origin!.actorClerkUserId } };
    // Scope is captured only once with this first UUID payload. In particular,
    // a legacy or current unknown retry is never rebound to a newer identity.
    setPending(request); setMessage("");
    let receipt: Awaited<ReturnType<typeof mutation.mutateAsync>>;
    try {
      receipt = await mutation.mutateAsync(request);
      if (receipt.requestId !== request.requestId || receipt.operation !== request.operation) throw Error("Unexpected risk receipt");
    } catch (error) {
      if (!retainSavedQueryRequest(recovery, error)) setPending(null);
      setMessage(retainSavedQueryRequest(recovery, error)
        ? "Could not confirm the risk change. Its exact request is retained; retry it before making another change."
        : "The risk change was not accepted. Refresh and review the current baseline before trying another change.");
      return;
    }
    // Receipt acknowledgement precedes all reads. Failed read-only refresh can
    // never retain or resubmit this now-confirmed mutation.
    setPending(null); setSelected(receipt.entry.id); setMode("VIEW"); setBaseline(null); setHistoryOffset(0);
    setMessage(`Recorded ${receipt.entry.displayId}, version ${receipt.entry.version}. This is not a verified mitigation or qualified approval.`);
    void Promise.all([
      utils.qualityRiskOverview.summary.invalidate({ projectId }),
      utils.qualityRiskOverview.byId.invalidate({ projectId }),
    ]).catch(() => undefined);
    void Promise.all([list.refetch(), ...(receipt.entry.id === selected ? [detail.refetch()] : [])]).catch(() => undefined);
  }
  async function refresh() {
    const [freshProject, freshOrganizations] = await Promise.all([project.refetch(), organizations.refetch()]);
    if (!origin || !actorReady || userId !== origin.actorClerkUserId || freshProject.error || freshProject.isFetching || freshProject.isPaused ||
      freshOrganizations.error || freshOrganizations.isFetching || freshOrganizations.isPaused || freshProject.data?.id !== projectId ||
      freshProject.data.organizationId !== origin.organizationId || !freshOrganizations.data?.some(row => row.id === origin.organizationId &&
        ["OWNER", "ADMIN", "EDITOR", "VIEWER", "COMPLIANCE_AUDITOR"].includes(row.role) && ["FULL", "READ_ONLY"].includes(row.seatType))) return;
    await Promise.all([list.refetch(), ...(open && selected ? [detail.refetch()] : []), ...(open && mode !== "VIEW" ? [lookup.refetch()] : [])]);
  }
  function submit() {
    if (!reviewed || frozen) return;
    if (mode === "REVIEW") {
      const parsed = qualityResidualDecision.safeParse({ ...review, acknowledgeNotQualifiedApproval: acknowledged });
      if (!parsed.success) { setMessage(parsed.error.issues[0]?.message ?? "Review the residual decision."); return; }
      void send({ operation: "REVIEW", projectId, id: baseline!.id, expectedVersion: baseline!.version,
        requestId: crypto.randomUUID(), decision: parsed.data });
    } else {
      const parsed = qualityRiskDefinition.safeParse(definition);
      if (!parsed.success) { setMessage(parsed.error.issues[0]?.message ?? "Review the risk definition."); return; }
      void send(mode === "CREATE" ? { operation: "CREATE", projectId, requestId: crypto.randomUUID(), definition: parsed.data }
        : { operation: "UPDATE", projectId, requestId: crypto.randomUUID(), id: baseline!.id,
          expectedVersion: baseline!.version, dropUnavailableLinks: dropUnavailable, definition: parsed.data });
    }
  }
  const prefix = `/projects/${encodeURIComponent(projectId)}`;
  return <section>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
      <h1 style={{ marginRight: "auto" }}>Quality risk register</h1>
      <button type="button" className="btn-primary" disabled={mutation.isPending || (!pending && !writeReady)} onClick={() => {
        if (pending) { setOpen(true); return; }
        setSelected(""); setMode("CREATE"); setDefinition(blank()); setBaseline(null); setMessage(""); setLabels({}); setStarter(null);
        setReview(emptyReview()); setAcknowledged(false); setDropUnavailable(false);
        setSearch(""); setChoice(""); setLookupKind("CASE"); setScreen(0); setOpen(true);
      }}>{pending ? "Recover unconfirmed change" : "Add risk or failure mode"}</button>
      <button type="button" className="btn-secondary" onClick={() => void refresh()}>Refresh register</button>
    </div>
    <p>Record failure modes, intended mitigations and human residual decisions. This is separate from release flags and AI case risk scores.</p>
    <p className="text-muted">A case link or passing result alone does not establish risk reduction, clinical/food/device qualification or a formal sign-off.</p>
    <QualityRiskOverview projectId={projectId} />
    {denied ? <div role="alert"><p>Current actor, project membership or original register ownership could not be verified. Retained definitions, native links and drafts are hidden, not discarded.</p>
      <button type="button" className="btn-secondary" onClick={() => void refresh()}>Recheck register access</button></div>
      : list.error ? <div role="alert"><p>Risk register unavailable; no cached scope or empty result has been substituted.</p>
      <button type="button" className="btn-secondary" onClick={() => void refresh()}>Retry register</button></div>
      : !page ? <p role="status">{paused ? "Waiting for a connection to verify access…" : "Checking register and current access…"}</p>
      : <>
        {!page.canWrite && <p>Read-only for your current seat. Full editors can record changes; ordinary review is not a qualified signature.</p>}
        <div className="table-scroll" role="region" aria-label="Scrollable quality risk register" tabIndex={0}>
          <table className="workspace-table" style={{ width: "100%", minWidth: 920 }}><thead><tr>
            <th scope="col">Risk ID</th><th scope="col">Failure mode</th><th scope="col">Component</th><th scope="col">Initial likelihood / consequence</th>
            <th scope="col">Latest human residual</th><th scope="col">Human review</th><th scope="col">Updated</th><th scope="col">Open</th>
          </tr></thead><tbody>{page.items.map(row => <tr key={row.id}>
            <th scope="row">{row.displayId}<div className="text-muted">Version {row.version}</div></th><td style={{ whiteSpace: "normal" }}>{row.title}</td><td style={{ whiteSpace: "normal" }}>{row.component}</td>
            <td>{readableMetric(row.likelihood)} / {readableMetric(row.consequence)}</td>
            <td>{row.residual ? <>{readableMetric(row.residual.likelihood)} / {readableMetric(row.residual.consequence)}<div className="text-muted">{readableMetric(row.residual.disposition)}{!row.residual.currentEntryBaseline ? " · Historical" : ""}</div></> : "Not reviewed"}</td>
            <td>{readableMetric(row.reviewState)}</td><td>{new Date(row.updatedAt).toLocaleString()}</td>
            <td><button type="button" className="btn-secondary" onClick={() => view(row.id)}>View {row.displayId}</button></td>
          </tr>)}</tbody></table>
        </div>
        {!page.items.length && <p>No risk entries on this page. This is not evidence of an absence of hazards.</p>}
        <p className="text-muted">Scroll sideways for all columns. Up to 50 entries per page; order follows the stable risk number.</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBlock: 12 }}>
          <button type="button" className="btn-secondary" disabled={offset === 0 || frozen} onClick={() => setOffset(Math.max(0, offset - 50))}>Previous risks</button>
          <button type="button" className="btn-secondary" disabled={!page.hasMore || frozen} onClick={() => setOffset(offset + 50)}>Next risks</button>
        </div>
      </>}
    <Modal open={open} onClose={close} size="wide" title={!formVisible ? "Verify quality risk access" : mode === "CREATE" ? "Record a quality risk" : baseline ? `${baseline.displayId} · ${mode === "REVIEW" ? "Residual decision" : "Edit risk"}` : "Quality risk"}>
      {formVisible && message && <p role="status">{message}</p>}
      {!formVisible && <div role="alert"><p>Current access, actor and original organization must be verified before displaying retained definition or draft fields. Your fields and any exact unconfirmed request are retained without rebasing.</p>
        <button type="button" className="btn-secondary" onClick={() => void refresh()}>Recheck current risk access</button></div>}
      {pending && <div role="alert"><p>Unconfirmed {pending.operation.toLowerCase()} request. Its baseline and fields are fixed, including after this module closes.</p>
        <button type="button" className="btn-primary" disabled={mutation.isPending || !writeReady}
          onClick={() => void send(pending, true)}>Retry exact risk change</button></div>}
      {displayReady && !!selected && (detail.error ? <div role="alert"><p>The current risk is unavailable. Cached details cannot authorize a change.</p>
        <button type="button" className="btn-secondary" onClick={() => void refresh()}>Retry current risk</button></div>
        : !current ? <p role="status">{detail.isPaused ? "Waiting to verify current risk…" : "Checking current risk baseline…"}</p> : null)}
      {displayReady && mode !== "VIEW" && selected && !reviewed && !frozen && <div role="alert"><p>The edit baseline no longer matches fresh current access and entry version. No cached approval is accepted; your draft is still retained.</p>
        <button type="button" className="btn-secondary" onClick={() => void refresh()}>Recheck current baseline without replacing draft</button></div>}
      {mode === "VIEW" && current && <>
        <h2>{current.entry.displayId} · {current.entry.definition.title}</h2>
        <p>Version {current.entry.version}. Human review records are not a formal regulatory approval. Matching entry version does not automatically reverify later result, procedure or requirement changes.</p>
        <dl><dt>Component</dt><dd>{current.entry.definition.component}</dd><dt>Failure mode</dt><dd>{current.entry.definition.failureMode}</dd>
          <dt>Cause</dt><dd>{current.entry.definition.cause}</dd><dt>Effect</dt><dd>{current.entry.definition.effect}</dd>
          <dt>Initial likelihood / consequence</dt><dd>{readableMetric(current.entry.definition.likelihood)} / {readableMetric(current.entry.definition.consequence)}</dd>
          <dt>Initial rationale</dt><dd>{current.entry.definition.rationale}</dd><dt>Intended mitigation</dt><dd>{current.entry.definition.mitigation || "Not described"}</dd></dl>
        <h3>Mitigation references</h3>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {current.entry.links.cases.map(c => <Link className="btn-secondary" key={c.id} href={`${prefix}/test-cases/${encodeURIComponent(c.id)}`}>{c.label}{c.archived ? " · Archived" : ""}</Link>)}
          {current.entry.links.requirements.map(r => <Link className="btn-secondary" key={r.id} href={`${prefix}/requirements#requirement-${encodeURIComponent(r.id)}`}>{r.label}</Link>)}
        </div>
        {!current.entry.links.cases.length && <p>No currently available case links. Execution verification has not been established.</p>}
        {!!current.entry.missingLinks && <p role="alert">{current.entry.missingLinks} original references are unavailable. Their native IDs are withheld, not replaced.</p>}
        {current.canWrite && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBlock: 16 }}>
          <button type="button" className="btn-secondary" disabled={frozen} onClick={() => edit("UPDATE")}>Edit risk and mitigation</button>
          <button type="button" className="btn-primary" disabled={frozen} onClick={() => edit("REVIEW")}>Record residual decision</button>
        </div>}
        <h3>Recorded human decisions</h3>
        {!current.decisions.length && <p>No decision on this history page. A linked test does not substitute for human review.</p>}
        {current.decisions.map(d => <article key={d.id} style={{ borderTop: "1px solid var(--line)", paddingBlock: 12 }}>
          <h4>{readableMetric(d.decision.disposition)} · {new Date(d.createdAt).toLocaleString()}</h4>
          <p>Assessed version {d.assessedVersion}; recorded version {d.createdVersion}. {d.currentBaseline ? "Matches the current entry baseline." : "Historical: the entry baseline has changed."}</p>
          <p>Residual: {readableMetric(d.decision.likelihood)} / {readableMetric(d.decision.consequence)}</p>
          <p>{d.decision.rationale}</p><p>{d.decision.evidenceNotes || "No additional evidence note recorded."}</p>
          <details><summary>Assessed initial definition</summary><p>{d.assessedDefinition.component} · {d.assessedDefinition.failureMode}</p>
            <p>{d.assessedDefinition.cause} → {d.assessedDefinition.effect}</p><p>Initial: {readableMetric(d.assessedDefinition.likelihood)} / {readableMetric(d.assessedDefinition.consequence)}</p>
            <p>{d.assessedDefinition.rationale}</p></details>
          {!d.evidence.length && <p>No execution-result references were recorded. This decision does not establish mitigation verification.</p>}
          {d.evidence.map((e, index) => <p key={index}>{e.caseDisplayId} · recorded status {readableMetric(e.status)} · observed {new Date(e.observedAt).toLocaleString()}{" "}
            {e.available && e.runId ? <Link href={`${prefix}/test-runs#run-${encodeURIComponent(e.runId)}`}>View run</Link> : " · Reference currently unavailable"}</p>)}
          <p className="text-muted">{d.verification}</p>
        </article>)}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button type="button" className="btn-secondary" disabled={historyOffset === 0 || frozen} onClick={() => setHistoryOffset(Math.max(0, historyOffset - 10))}>Newer decisions</button>
          <button type="button" className="btn-secondary" disabled={!current.hasMoreHistory || frozen} onClick={() => setHistoryOffset(historyOffset + 10)}>Older decisions</button>
        </div>
        <details style={{ marginBlock: 16 }}><summary>Evidence and qualification limits</summary><ul>{current.warnings.map(w => <li key={w}>{w}</li>)}</ul></details>
      </>}
      {formVisible && mode !== "VIEW" && <fieldset disabled={frozen || !reviewed} style={{ minWidth: 0 }}>
        <legend>{mode === "REVIEW" ? "Human residual assessment" : "Failure mode and intended mitigation"}</legend>
        <p role="status">Step {screen + 1} of {mode === "REVIEW" ? 3 : 4}: {(mode === "REVIEW" ? ["Residual assessment", "Execution evidence", "Review decision"] : ["Failure description", "Initial assessment", "Intended mitigation", "Review risk definition"])[screen]}</p>
        {open && mode === "CREATE" && <QualityRiskStarter eligible={canApplyQualityRiskStarter(definition, starterBoundary)} applied={starter} screen={screen}
          onApply={(id, confirmed) => {
            const accepted = reviewedQualityRiskStarter(definition, starterBoundary, id, confirmed);
            if (accepted) setStarter(accepted);
          }} />}
        {mode === "REVIEW" ? <>
          {screen === 0 && <>
          <p>Reviewing {baseline?.displayId}, version {baseline?.version}. Initial assessment: {readableMetric(definition.likelihood)} / {readableMetric(definition.consequence)}. {definition.rationale}</p>
          <label style={labelStyle}>Residual likelihood<select style={fieldStyle} value={review.likelihood} onChange={e => setReview({ ...review, likelihood: e.target.value as Review["likelihood"] })}>{likelihood.map(v => <option key={v} value={v}>{readableMetric(v)}</option>)}</select></label>
          <label style={labelStyle}>Residual consequence<select style={fieldStyle} value={review.consequence} onChange={e => setReview({ ...review, consequence: e.target.value as Review["consequence"] })}>{consequence.map(v => <option key={v} value={v}>{readableMetric(v)}</option>)}</select></label>
          <label style={labelStyle}>Residual rationale<textarea style={fieldStyle} value={review.rationale} maxLength={2000} onChange={e => setReview({ ...review, rationale: e.target.value })} /></label>
          <label style={labelStyle}>Evidence or remaining uncertainty<textarea style={fieldStyle} value={review.evidenceNotes} maxLength={2000} onChange={e => setReview({ ...review, evidenceNotes: e.target.value })} /></label>
          </>}
          {screen === 2 && <>
          <p>{readableMetric(review.likelihood)} / {readableMetric(review.consequence)}</p><p>{review.rationale || "Residual rationale is required."}</p><p>{review.evidenceNotes || "No additional uncertainty note."}</p>
          <p>{review.resultIds.length} execution references selected. Their statuses will be observed when the server records this decision.</p>
          <ul>{review.resultIds.map(id => <li key={id}>{labels[id] || "Selected execution reference"}</li>)}</ul>
          <label style={labelStyle}>Human decision<select style={fieldStyle} value={review.disposition} onChange={e => setReview({ ...review, disposition: e.target.value as Review["disposition"] })}>
            <option value="FURTHER_ACTION">Further action required</option><option value="REVIEW_RECORDED">Review recorded, no acceptance asserted</option><option value="HUMAN_ACCEPTANCE_RECORDED">Reviewer states acceptance (not qualified approval)</option>
          </select></label>
          {!review.resultIds.length && <p>No execution evidence selected. Recording a human rationale is permitted but does not prove mitigation effectiveness.</p>}
          </>}
        </> : <>
          {([['title','Risk title',160,0],['component','Component or process',160,0],['failureMode','Failure mode',1000,0],['cause','Cause',1500,0],['effect','Effect',1500,0],['rationale','Initial rationale and uncertainty',2000,1],['mitigation','Intended mitigation',2000,2]] as const).filter(([, , , at]) => at === screen).map(([field, text, limit]) =>
            <label style={labelStyle} key={field}>{text}{field === "title" || field === "component" ? <input style={fieldStyle} maxLength={limit} value={definition[field]} onChange={e => setDefinition({ ...definition, [field]: e.target.value })} />
              : <textarea style={fieldStyle} maxLength={limit} value={definition[field]} onChange={e => setDefinition({ ...definition, [field]: e.target.value })} />}</label>)}
          {screen === 1 && <><label style={labelStyle}>Initial likelihood<select style={fieldStyle} value={definition.likelihood} onChange={e => setDefinition({ ...definition, likelihood: e.target.value as QualityRiskDefinition["likelihood"] })}>{likelihood.map(v => <option key={v} value={v}>{readableMetric(v)}</option>)}</select></label>
          <label style={labelStyle}>Initial consequence<select style={fieldStyle} value={definition.consequence} onChange={e => setDefinition({ ...definition, consequence: e.target.value as QualityRiskDefinition["consequence"] })}>{consequence.map(v => <option key={v} value={v}>{readableMetric(v)}</option>)}</select></label>
          </>}
          {screen === 3 && <><h3>{definition.title || "Risk title required"}</h3><p>{definition.component} · {definition.failureMode}</p><p>{definition.cause} → {definition.effect}</p>
            <p>Initial: {readableMetric(definition.likelihood)} / {readableMetric(definition.consequence)}</p><p>{definition.rationale || "Initial rationale required."}</p>
            <p>Mitigation: {definition.mitigation || "Not described"}</p><p>{definition.caseIds.length} case links; {definition.requirementIds.length} requirement links.</p>
            <ul>{[...definition.caseIds, ...definition.requirementIds].map(id => <li key={id}>{labels[id] || "Selected mitigation reference"}</li>)}</ul>
            {!!current?.entry.missingLinks && <label style={{ display: "flex", gap: 8 }}><input type="checkbox" checked={dropUnavailable} onChange={e => setDropUnavailable(e.target.checked)} />I reviewed removal of {current.entry.missingLinks} unavailable original references.</label>}</>}
        </>}
        {screen === (mode === "REVIEW" ? 1 : 2) && <><h3>{mode === "REVIEW" ? "Link recorded execution results" : "Link mitigation requirements and cases"}</h3>
          {mode !== "REVIEW" && <label style={labelStyle}>Record type<select style={fieldStyle} value={lookupKind} onChange={e => { setLookupKind(e.target.value as "CASE" | "REQUIREMENT"); setChoice(""); }}><option value="CASE">Test case</option><option value="REQUIREMENT">Requirement</option></select></label>}
          <label style={labelStyle}>Find project record<input style={fieldStyle} value={search} maxLength={80} onChange={e => { setSearch(e.target.value); setChoice(""); }} /></label>
          {lookup.error ? <div role="alert"><p>Project records unavailable. No cached choices have been substituted.</p><button type="button" className="btn-secondary" onClick={() => void refresh()}>Retry linked records</button></div>
            : !choices ? <p role="status">{lookup.isPaused ? "Waiting for linked records…" : "Checking project records…"}</p> : <>
              <label style={labelStyle}>Project record<select style={fieldStyle} value={choice} onChange={e => setChoice(e.target.value)}><option value="">Choose one of up to 20 results…</option>{choices.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
              <button type="button" className="btn-secondary" disabled={!choice || !choices.some(c => c.id === choice) || (lookupKind === "RESULT" ? review.resultIds : lookupKind === "CASE" ? definition.caseIds : definition.requirementIds).length >= 20}
                onClick={() => {
                  const record = choices.find(c => c.id === choice); if (!record) return;
                  setLabels({ ...labels, [record.id]: record.label });
                  if (lookupKind === "RESULT") setReview({ ...review, resultIds: [...new Set([...review.resultIds, record.id])] });
                  else { const key = lookupKind === "CASE" ? "caseIds" : "requirementIds"; setDefinition({ ...definition, [key]: [...new Set([...definition[key], record.id])] }); }
                  setChoice("");
                }}>Add reference</button>
              {!choices.length && <p>No project records matched. This is not an absence-of-risk verdict.</p>}
            </>}
          {mode === "REVIEW" && <p>Only results of cases already linked as mitigations may be recorded. Unmatched results are not substitutes. Status is captured at review time, not a formal verification.</p>}
        </>}
        {screen === (mode === "REVIEW" ? 1 : 2) && <>
        {(mode === "REVIEW" ? review.resultIds : [...definition.caseIds, ...definition.requirementIds]).map(id => <div key={id} style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBlock: 8 }}>
          <span>{labels[id] || "Selected project reference"}</span><button type="button" className="btn-secondary" aria-label={`Remove ${labels[id] || "reference"}`} onClick={() => {
            if (mode === "REVIEW") setReview({ ...review, resultIds: review.resultIds.filter(v => v !== id) });
            else setDefinition({ ...definition, caseIds: definition.caseIds.filter(v => v !== id), requirementIds: definition.requirementIds.filter(v => v !== id) });
          }}>Remove reference</button></div>)}
        </>}
        {mode === "REVIEW" && screen === 2 && <label style={{ display: "flex", gap: 8, marginBlock: 16 }}><input type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} />I understand this records an ordinary human review, not qualified regulatory acceptance, an e-signature or proven mitigation.</label>}
        <p className="text-muted">Qualitative categories are uncalibrated. No numerical score, standard-specific threshold or safety certification is calculated.</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button type="button" className="btn-secondary" disabled={screen === 0} onClick={() => setScreen(screen - 1)}>Previous step</button>
          {screen < (mode === "REVIEW" ? 2 : 3) ? <button type="button" className="btn-primary" onClick={() => setScreen(screen + 1)}>Continue</button>
            : <button type="button" className="btn-primary" disabled={!reviewed || (mode === "REVIEW" && !acknowledged)} onClick={submit}>{mode === "REVIEW" ? "Record human decision" : mode === "CREATE" ? "Create risk record" : "Save reviewed risk edit"}</button>}
        </div>
      </fieldset>}
      {displayReady && mode !== "VIEW" && selected && <button type="button" className="btn-secondary" disabled={frozen} onClick={() => { setMode("VIEW"); setBaseline(null); }}>Back to current risk</button>}
    </Modal>
  </section>;
}
