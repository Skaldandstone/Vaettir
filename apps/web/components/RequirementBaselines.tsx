"use client";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { trpcReact, type RouterOutputs } from "@/lib/trpcReact";
import { Modal } from "./Modal";
import { readableMetric } from "@/lib/frozen-report";
import { requirementBaselineAckMatches, retainRequirementBaselineCapture, type RequirementBaselineOrigin } from "@/lib/requirement-baseline-ack";
import { requirementBaselineCaptureInput, type RequirementBaselineCapture } from "@vaettir/api/src/services/requirementBaselineSchema";
import { baselineCaseRelationshipLabel, baselineDirectLinkComparison, baselineLiteralSearch, baselineNativeCaseHref, baselineWordingValue, filterBaselineCasePage, groupBaselineWording } from "@/lib/requirement-baseline-presentation";
type Target = { requirementId?: string; baselineId?: string };
const control = { width: "100%", minWidth: 0, boxSizing: "border-box" as const };
const label = { display: "grid", gap: 6, marginBlock: 12, minWidth: 0 };
export function RequirementBaselines({ projectId }: { projectId: string }) { return <Register key={projectId} projectId={projectId} />; }
function Register({ projectId }: { projectId: string }) {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const [origin, setOrigin] = useState<RequirementBaselineOrigin | null>(null);
  const project = trpcReact.project.byId.useQuery({ id: projectId }, { retry: false, staleTime: 0, refetchOnMount: "always" });
  const organizations = trpcReact.organization.mine.useQuery(undefined, { retry: false, staleTime: 0, refetchOnMount: "always" });
  const projectReady = !project.error && project.isFetchedAfterMount && !project.isFetching && !project.isPaused && project.data?.id === projectId;
  const membersReady = !organizations.error && organizations.isFetchedAfterMount && !organizations.isFetching && !organizations.isPaused;
  const member = projectReady && membersReady ? organizations.data?.find(row => row.id === project.data?.organizationId) : undefined;
  const actorReady = isLoaded && isSignedIn && !!userId;
  useEffect(() => { if (!origin && actorReady && projectReady && member) setOrigin({ organizationId: project.data!.organizationId, clerkActorId: userId! }); }, [origin, actorReady, projectReady, member, project.data, userId]);
  const ready = !!origin && actorReady && projectReady && !!member && origin.organizationId === project.data?.organizationId && origin.clerkActorId === userId;
  const sameScope = (value: { projectId: string; organizationId: string; clerkActorId: string } | undefined) => ready && value?.projectId === projectId && value.organizationId === origin!.organizationId && value.clerkActorId === origin!.clerkActorId;
  const mounted = useRef(true);
  const receiptRef = useRef<{ input: RequirementBaselineCapture; uncertain: boolean } | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [offset, setOffset] = useState(0), [search, setSearch] = useState(""), [open, setOpen] = useState(false),
    [target, setTarget] = useState<Target>({}), [historyOffset, setHistoryOffset] = useState(0), [affectedOffset, setAffectedOffset] = useState(0),
    [reviewing, setReviewing] = useState(false), [screen, setScreen] = useState(0), [rationale, setRationale] = useState(""),
    [acknowledged, setAcknowledged] = useState(false), [approval, setApproval] = useState<{ requirementId: string; fingerprint: string; version: number; response: RouterOutputs["requirementBaselines"]["byId"]; epoch: number } | null>(null),
    [pending, setPending] = useState<RequirementBaselineCapture | null>(null), [message, setMessage] = useState(""), [caseSearch, setCaseSearch] = useState("");
  const searchTerm = baselineLiteralSearch(search);
  const list = trpcReact.requirementBaselines.list.useQuery({ projectId, offset, search: searchTerm, expectedScope: origin ?? undefined }, { enabled: ready, retry: false, staleTime: 0, refetchOnMount: "always" });
  const permissions = trpcReact.requirementBaselines.access.useQuery({ projectId, expectedScope: origin ?? undefined }, { enabled: ready, retry: false, staleTime: 0, refetchOnMount: "always" });
  const detail = trpcReact.requirementBaselines.byId.useQuery({ projectId, ...target, historyOffset, affectedOffset, expectedScope: origin ?? undefined },
    { enabled: ready && open && (!!target.requirementId || !!target.baselineId), retry: false, staleTime: 0, refetchOnMount: "always" });
  const mutation = trpcReact.requirementBaselines.capture.useMutation();
  const access = ready && !permissions.error && !permissions.isFetching && !permissions.isPaused && permissions.isFetchedAfterMount &&
    sameScope(permissions.data) ? permissions.data : null;
  const liveCapture = useRef({ available: false, epoch: 0, organizationId: "", clerkActorId: "" });
  const captureAvailable = ready && !!access?.canWrite;
  if (liveCapture.current.available !== captureAvailable || liveCapture.current.organizationId !== origin?.organizationId || liveCapture.current.clerkActorId !== userId) {
    liveCapture.current = { available: captureAvailable, epoch: liveCapture.current.epoch + 1, organizationId: origin?.organizationId ?? "", clerkActorId: userId ?? "" };
  }
  const catalog = !!access && !list.error && !list.isFetching && !list.isPaused && list.isFetchedAfterMount && list.data?.projectId === projectId && sameScope(list.data) &&
    list.data.offset === offset && list.data.search === searchTerm ? list.data : null;
  const current = open && !!access && !detail.error && !detail.isFetching && !detail.isPaused && detail.isFetchedAfterMount && detail.data?.projectId === projectId && sameScope(detail.data) &&
    detail.data.requested.requirementId === (target.requirementId ?? null) && detail.data.requested.baselineId === (target.baselineId ?? null) &&
    detail.data.requested.historyOffset === historyOffset && detail.data.requested.affectedOffset === affectedOffset ? detail.data : null;
  const canReview = !!access?.canWrite && !!current?.canWrite && current.captureAvailable && current.selectedIsLatest && !!current.requirementId && !!current.currentFingerprint;
  const availability = useRef({ ready: false, epoch: 0 });
  if (availability.current.ready !== !!canReview) { availability.current.ready = !!canReview; availability.current.epoch++; }
  const reviewed = canReview && !!approval && current!.requirementId === approval.requirementId &&
    current!.currentFingerprint === approval.fingerprint && current!.latestVersion === approval.version && approval.response === current && approval.epoch === availability.current.epoch;
  useEffect(() => { if (!reviewed) setAcknowledged(false); }, [reviewed]);
  const frozen = mutation.isPending || !!pending;
  const prefix = `/projects/${encodeURIComponent(projectId)}`;
  function view(next: Target) {
    if (pending) { setOpen(true); return; }
    setTarget(next); setAffectedOffset(0); setHistoryOffset(0); setReviewing(false); setApproval(null); setMessage(""); setOpen(true);
  }
  function startReview() {
    if (!canReview || !current || frozen) return;
    setApproval({ requirementId: current.requirementId!, fingerprint: current.currentFingerprint!, version: current.latestVersion, response: current, epoch: availability.current.epoch });
    setAcknowledged(false); setScreen(0); setReviewing(true); setMessage("");
  }
  async function send(input: RequirementBaselineCapture, recovering = false) {
    if (!ready || !origin || !access?.canWrite || mutation.isPending) return;
    const request = receiptRef.current?.input ?? pending ?? structuredClone(input); setPending(request); setMessage("");
    receiptRef.current ??= { input: request, uncertain: recovering };
    const requestEpoch = liveCapture.current.epoch;
    try {
      const receipt = await mutation.mutateAsync(request);
      if (!requirementBaselineAckMatches(receipt, request, origin)) throw Error("Unexpected baseline acknowledgement identity or captured fingerprint");
      if (!mounted.current) return;
      if (!liveCapture.current.available || liveCapture.current.epoch !== requestEpoch || liveCapture.current.organizationId !== origin.organizationId || liveCapture.current.clerkActorId !== origin.clerkActorId)
        throw Error("Current capture access changed while acknowledgement was pending; retain the exact request for recovery");
      receiptRef.current = null;
      setPending(null); setReviewing(false); setApproval(null); setTarget({ requirementId: request.requirementId, baselineId: receipt.baselineId });
      setHistoryOffset(0); setAffectedOffset(0); setMessage(`Recorded ${receipt.displayId}, version ${receipt.version}. Earlier baselines remain immutable; no coverage or regulatory approval was asserted.`);
      void Promise.all([list.refetch(), detail.refetch()]).then(results => {
        if (mounted.current && results.some(result => result.isError)) setMessage(previous => `${previous} Capture acknowledged; current view refresh failed. Retry reads without resubmitting the capture.`);
      }).catch(() => { if (mounted.current) setMessage(previous => `${previous} Capture acknowledged; current view refresh failed. Retry reads without resubmitting the capture.`); });
    } catch (error) {
      if (!mounted.current) return;
      const retained = receiptRef.current ? retainRequirementBaselineCapture(receiptRef.current, error) : null;
      receiptRef.current = retained;
      const unknown = !!retained;
      if (!unknown) { setPending(null); void detail.refetch(); }
      setMessage(unknown ? "Capture outcome unconfirmed. This exact reviewed request is retained, including after module close; retry it before a new capture."
        : "No new capture was accepted. Refresh and review the current wording, direct links and latest baseline before retrying.");
    }
  }
  function capture() {
    if (!reviewed || !approval || frozen) return;
    const parsed = requirementBaselineCaptureInput.safeParse({ projectId, requirementId: approval.requirementId,
      expectedScope: origin ?? undefined,
      requestId: crypto.randomUUID(), expectedLatestVersion: approval.version, currentFingerprint: approval.fingerprint,
      rationale, acknowledgeNotVerifiedCoverage: acknowledged });
    if (!parsed.success) { setMessage("Add a review rationale and acknowledge the capture's limits."); return; }
    void send(parsed.data);
  }
  function latest() {
    if (!current || frozen) return;
    setReviewing(false); setApproval(null); setAffectedOffset(0);
    setTarget(current.requirementId ? { requirementId: current.requirementId } : { baselineId: current.latestBaselineId! });
  }
  const wordingGroups = current ? groupBaselineWording(current.baseline?.requirement ?? null, current.current, current.comparison.changedFields) : null;
  const visibleCases = current ? filterBaselineCasePage(current.affected.items, caseSearch) : [];
  function wordingTable(rows: NonNullable<typeof wordingGroups>["changed"], caption: string) {
    return <div className="table-scroll" role="region" aria-label={caption} tabIndex={0}>
      <table className="workspace-table" style={{ width: "100%", minWidth: 560, tableLayout: "fixed" }}>
        <caption style={{ textAlign: "left", paddingBlock: 8 }}>{caption}</caption>
        <thead><tr><th scope="col" style={{ width: "24%" }}>Field</th><th scope="col">Captured baseline</th><th scope="col">Current requirement</th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.field}><th scope="row">{row.caption}</th>
          <td style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{baselineWordingValue(row.before, "captured")}</td>
          <td style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{baselineWordingValue(row.current, "current")}</td>
        </tr>)}</tbody>
      </table>
    </div>;
  }
  const wording = current && <>
    <h3>{current.current?.title ?? current.baseline?.requirement?.title ?? "Unavailable requirement"}</h3>
    <p>{readableMetric(current.comparison.status)}. {current.baseline ? `${current.baseline.displayId} · version ${current.baseline.version}` : "No baseline recorded"}.</p>
    {!current.selectedIsLatest && <p role="status">Comparing a historical baseline. Return to latest before reviewing a new capture.</p>}
    {current.captureUnavailableReason && <p role="status">{current.captureUnavailableReason} No history has been replaced or removed.</p>}
    <p>Captured wording belongs to the selected immutable baseline; current wording is a read-time native comparison. Unchanged displayed text is not proof of unchanged procedure, execution, external issue status or requirement fulfillment.</p>
    {wordingGroups && <>
      {wordingGroups.changed.length > 0 && <section><h4>Changed recorded fields ({wordingGroups.changed.length})</h4>{wordingTable(wordingGroups.changed, "Changed requirement wording and metadata")}</section>}
      {wordingGroups.unchanged.length > 0 && <details><summary>Unchanged recorded fields ({wordingGroups.unchanged.length})</summary>{wordingTable(wordingGroups.unchanged, "Unchanged displayed requirement fields")}</details>}
      {wordingGroups.uncomparable.length > 0 && <section><h4>Fields without two available comparison sides ({wordingGroups.uncomparable.length})</h4><p>A missing baseline or unavailable current requirement is not an unchanged comparison.</p>{wordingTable(wordingGroups.uncomparable, "Available recorded wording; comparison unavailable")}</section>}
      {wordingGroups.unsupportedChanges.length > 0 && <p role="alert">The comparison reports unsupported changed fields. Review the recorded scope limitations; no complete wording comparison is claimed.</p>}
    </>}
    {current.current?.externalRef && current.current.externalRef.startsWith("https://") && <p><a href={current.current.externalRef} target="_blank" rel="noopener noreferrer">Open safe current reference</a></p>}
    {(current.current?.externalRefWithheld || current.current?.issueIdentifiersWithheld || current.baseline?.requirement?.externalRefWithheld || current.baseline?.requirement?.issueIdentifiersWithheld) && <p>Unsafe external metadata was withheld. No credentials or query tokens are displayed or fetched.</p>}
    {current.comparison.withheldMetadataChanged && <p role="status">Reference metadata changed outside the displayed normalized fields. Review the source reference manually; its unsafe values are not disclosed.</p>}
  </>;
  const cases = current && <>
    <h3>Direct case scope and change-review candidates</h3>
    <p>{current.capturedDirectCases ?? "Unavailable"} captured direct cases; {current.currentDirectCases ?? "Unavailable"} current direct cases. {baselineDirectLinkComparison(!!current.baseline, !!current.current, current.comparison.coverageChanged)}</p>
    <p className="text-muted">These are the union of captured/current explicitly linked case IDs, not proven coverage. When requirement wording changes, review these cases; no automatic execution or suspect resolution occurs.</p>
    <label style={label}>Find a case ID or recorded title on this page<input type="search" style={control} value={caseSearch} maxLength={80} onChange={e => setCaseSearch(e.target.value)} /></label>
    <p className="text-muted">Literal search covers only the {current.affected.items.length} loaded candidates on this page, including bounded title excerpts. It does not search other pages or full case procedures. Clear it and use Previous / Next cases to review the complete bounded union.</p>
    {caseSearch && <button type="button" className="btn-secondary" onClick={() => setCaseSearch("")}>Show all candidates on this page</button>}
    <div style={{ display: "grid", gap: 8 }}>{visibleCases.map(c => {
      const href = baselineNativeCaseHref(projectId, c.caseId, c.available);
      return <details key={c.caseId ?? c.displayId} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 10, minWidth: 0 }}>
        <summary style={{ cursor: "pointer", overflowWrap: "anywhere" }}><span className="btn-secondary" style={{ display: "inline-block", marginInlineEnd: 8 }}>{c.displayId}</span>
          {baselineCaseRelationshipLabel(c, !!current.baseline, !!current.current)}
          {!c.available ? " · Native case unavailable" : !href ? " · Native case route unsupported" : ""}
        </summary>
        <p style={{ overflowWrap: "anywhere" }}>{c.title}{c.titleIsExcerpt ? "… (label excerpt)" : ""}{c.archived ? " · Archived in the displayed label snapshot" : ""}</p>
        <p>{c.isLinked ? "Label from the current linked snapshot at read time." : "Label retained from the selected captured baseline."} Neither label records the case's full procedure, current execution outcome or verified fulfillment.</p>
        {href ? <Link className="btn-secondary" href={href} aria-label={`Open current native test case ${c.displayId}`}>Open {c.displayId}</Link> : <p>No currently available same-project native case route. The retained label is not a replacement identity.</p>}
        {href && <p className="text-muted">This opens the current native case, not the historical procedure at baseline capture. Case identity availability does not restore a removed direct link or verify execution.</p>}
      </details>;
    })}</div>
    {!current.affected.items.length && <p>No direct cases on this page. No execution verification is inferred from plan-wide criteria.</p>}
    {current.affected.items.length > 0 && !visibleCases.length && <p>No literal case ID/title matches on this loaded page. The underlying comparison and other pages have not been removed or declared empty.</p>}
    <p>{visibleCases.length} of {current.affected.items.length} loaded candidates displayed; filtering does not change captured/current membership or capture approval.</p>
    <p>Showing {current.affected.items.length ? affectedOffset + 1 : 0}–{affectedOffset + current.affected.items.length} of {current.affected.total} review candidates.</p>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      <button type="button" className="btn-secondary" disabled={affectedOffset === 0 || frozen} onClick={() => setAffectedOffset(Math.max(0, affectedOffset - 20))}>Previous cases</button>
      <button type="button" className="btn-secondary" disabled={!current.affected.hasMore || frozen} onClick={() => setAffectedOffset(affectedOffset + 20)}>Next cases</button>
    </div>
  </>;
  return <section>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}><h1 style={{ marginRight: "auto" }}>Requirement baselines and changes</h1>
      <button type="button" className="btn-secondary" onClick={() => void Promise.all([project.refetch(), organizations.refetch(), permissions.refetch(), list.refetch()])}>Refresh current access and requirements</button>
      {pending && <button type="button" className="btn-primary" onClick={() => setOpen(true)}>Recover unconfirmed capture</button>}
    </div>
    <p>Compare current native requirement wording and explicit case links with a retained human-reviewed baseline. Changes are review candidates, not defects, verified coverage or formal regulatory sign-off.</p>
    <label style={label}>Find current or captured requirement by title<input type="search" style={control} value={search} maxLength={80} onChange={e => { setSearch(e.target.value); setOffset(0); }} /></label>
    <p className="text-muted">Case-insensitive literal title search; %, _ and backslash are text, not wildcard patterns. Surrounding whitespace is ignored. A match in older captured wording can display the current title or newest retained title on this register.</p>
    {!ready ? <p role="alert">Original organization and current signed-in membership are unavailable. Local rationale, selections and any exact pending capture are retained; cached wording, chips and history are hidden.</p> : list.error ? <div role="alert"><p>Requirement comparison unavailable; cached or incomplete results are not substituted.</p><button type="button" className="btn-secondary" onClick={() => void list.refetch()}>Retry register</button></div>
      : !catalog ? <p role="status">{list.isPaused ? "Waiting to verify current access…" : "Checking bounded requirement scope…"}</p>
        : <>
          {!catalog.canWrite && <p>Read-only. A current full editor seat is required for a new reviewed baseline.</p>}
          <div className="table-scroll" role="region" tabIndex={0} aria-label="Scrollable requirement change register"><table className="workspace-table" style={{ width: "100%", minWidth: 800 }}><thead><tr>
            <th scope="col">Requirement</th><th scope="col">Latest baseline</th><th scope="col">Change review</th><th scope="col">Direct cases captured / current</th><th scope="col">Compare</th>
          </tr></thead><tbody>{catalog.items.map(row => <tr key={row.requirementId ?? row.baselineId}>
            <th scope="row" style={{ whiteSpace: "normal" }}>{row.requirementId ? <Link href={`${prefix}/requirements#requirement-${encodeURIComponent(row.requirementId)}`}>{row.title}</Link> : <>{row.title} · Unavailable native requirement</>}</th>
            <td>{row.baselineDisplayId ?? "Not captured"}{row.baselineVersion ? ` · v${row.baselineVersion}` : ""}</td>
            <td>{readableMetric(row.status)}{row.wordingChanged ? " · Wording/reference" : ""}{row.coverageChanged ? " · Direct links" : ""}</td>
            <td>{row.capturedDirectCases ?? "Not recorded"} / {row.currentDirectCases ?? "Unavailable"}</td>
            <td><button type="button" className="btn-secondary" onClick={() => view(row.requirementId ? { requirementId: row.requirementId } : { baselineId: row.baselineId! })}>Compare</button></td>
          </tr>)}</tbody></table></div>
          {!catalog.items.length && <p>No matching requirements on this page. This does not establish complete requirements or an absence of risk.</p>}
          <p className="text-muted">Scroll sideways for all columns. Up to 20 rows per page and 1,000 matching identities; narrow the search for larger registers.</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}><button type="button" className="btn-secondary" disabled={offset === 0 || frozen} onClick={() => setOffset(Math.max(0, offset - 20))}>Previous requirements</button>
            <button type="button" className="btn-secondary" disabled={!catalog.hasMore || offset >= 980 || frozen} onClick={() => setOffset(offset + 20)}>Next requirements</button></div>
        </>}
    <Modal open={open} onClose={() => { setOpen(false); setAcknowledged(false); }} size="wide" title={reviewing ? "Review a new requirement baseline" : "Requirement change comparison"}>
      {ready && message && <p role="status">{message}</p>}
      {permissions.error && <div role="alert"><p>Current capture access could not be verified. Cached permissions cannot authorize a capture or retry.</p><button type="button" className="btn-secondary" onClick={() => void permissions.refetch()}>Retry capture access</button></div>}
      {pending && <div role="alert"><p>The original capture payload and baseline are fixed while its outcome is unconfirmed.</p><button type="button" className="btn-primary" disabled={!access?.canWrite || mutation.isPending} onClick={() => void send(pending, true)}>Retry exact baseline capture</button></div>}
      {detail.error ? <div role="alert"><p>Current comparison unavailable. No cached approval, zero coverage or partial comparison has been substituted.</p><button type="button" className="btn-secondary" onClick={() => void detail.refetch()}>Retry comparison</button></div>
        : !current ? <p role="status">{detail.isPaused ? "Waiting to verify comparison…" : "Checking current wording, native links and baseline…"}</p>
          : reviewing ? <>
            <p role="status">Step {screen + 1} of 3: {["Wording comparison", "Direct case scope", "Capture rationale and limits"][screen]}</p>
            {!reviewed && <div role="alert"><p>The reviewed wording, baseline or current access changed. No stale capture can be submitted.</p><button type="button" className="btn-secondary" disabled={frozen} onClick={() => { setReviewing(false); setApproval(null); void detail.refetch(); }}>Reload and review again</button></div>}
            {screen === 0 ? wording : screen === 1 ? cases : <fieldset disabled={frozen || !reviewed} style={{ minWidth: 0 }}>
              <legend>Explicit reviewed capture</legend><p>{current.current?.title}. Latest version {approval?.version ?? 0}; {current.currentDirectCases ?? "Unavailable"} current direct cases.</p>
              <p>New capture restarts the comparison against this wording and direct link scope. Earlier snapshots remain intact. It does not clear defects, attest mitigation, approve coverage or resolve an independently tracked suspect.</p>
              <label style={label}>Why record this baseline now?<textarea style={control} maxLength={600} value={rationale} onChange={e => setRationale(e.target.value)} /></label>
              <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}><input type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} />I reviewed the wording and bounded current direct case scope. This is not verified coverage, a qualified signature or regulatory approval.</label>
            </fieldset>}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBlock: 16 }}><button type="button" className="btn-secondary" disabled={screen === 0 || frozen} onClick={() => setScreen(screen - 1)}>Previous step</button>
              {screen < 2 ? <button type="button" className="btn-primary" disabled={frozen || !reviewed} onClick={() => setScreen(screen + 1)}>Continue</button>
                : <button type="button" className="btn-primary" disabled={frozen || !reviewed || !acknowledged || !rationale.trim()} onClick={capture}>Capture reviewed baseline</button>}
              <button type="button" className="btn-secondary" disabled={frozen} onClick={() => { setReviewing(false); setApproval(null); }}>Back to comparison</button>
            </div>
          </> : <>
            {wording}{cases}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBlock: 16 }}>
              {canReview && <button type="button" className="btn-primary" disabled={frozen} onClick={startReview}>Review a new baseline</button>}
              {!current.selectedIsLatest && <button type="button" className="btn-secondary" disabled={frozen} onClick={latest}>Compare latest baseline</button>}
              <button type="button" className="btn-secondary" disabled={frozen} onClick={() => void detail.refetch()}>Refresh comparison</button>
            </div>
            <details><summary>Retained immutable baseline history</summary><label style={label}>Compare a retained baseline<select style={control} disabled={frozen} value={current.baseline?.id ?? ""} onChange={e => {
              setTarget({ requirementId: current.requirementId ?? undefined, baselineId: e.target.value }); setAffectedOffset(0);
            }}><option value="" disabled>No baseline recorded</option>
              {current.baseline && !current.history.some(h => h.id === current.baseline!.id) && <option value={current.baseline.id}>{current.baseline.displayId} · v{current.baseline.version} (selected)</option>}
              {current.history.map(h => <option key={h.id} value={h.id}>{h.displayId} · v{h.version} · {new Date(h.createdAt).toLocaleString()}</option>)}
            </select></label>{current.baseline && <p>Capture rationale: {current.baseline.rationale}</p>}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}><button type="button" className="btn-secondary" disabled={historyOffset === 0 || frozen} onClick={() => setHistoryOffset(Math.max(0, historyOffset - 10))}>Newer baselines</button>
                <button type="button" className="btn-secondary" disabled={!current.hasMoreHistory || frozen} onClick={() => setHistoryOffset(historyOffset + 10)}>Older baselines</button></div>
            </details>
          </>}
      {current && <details style={{ marginBlock: 12 }}><summary>Recorded scope and evidence limitations</summary><ul>{current.limits.map(text => <li key={text}>{text}</li>)}</ul></details>}
    </Modal>
  </section>;
}
