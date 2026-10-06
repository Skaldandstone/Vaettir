"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { trpcReact } from "@/lib/trpcReact";
import { useCaseFieldAccess } from "@/lib/use-case-field-access";
import { caseFieldReadPins } from "@/lib/case-field-origin";
import { freshCasePresentation } from "@/lib/case-presentation-read";
import { manualSummaryReadActivation, type ManualSummaryReadState } from "@/lib/manual-run-summary";
import { initialFieldPresentationDraft, changeFieldPresentation, fieldPresentationWidgets, freezeFieldPresentationRequest, assertFieldPresentationAck, retainedFieldPresentationReceipt, sameFieldPresentationFrame, currentFieldPresentationBaseline, fieldPresentationSessionRead, sameFieldPresentationSessionProof, type FieldPresentationDraft, type FieldPresentationReceipt, type FieldPresentationFrame, type FieldPresentationSessionProof } from "@/lib/project-case-field-presentation";
import type { CaseFieldPresentationSetting } from "@vaettir/api/src/services/caseFieldPresentationSchema";
import { Modal } from "./Modal";

const widgets = { AUTO: "Native default (no value changes)", TEXT_INPUT: "Single-line text", PARAGRAPH: "Multiline paragraph", DROPDOWN: "Dropdown", RADIO: "Radio choices", TRI_STATE: "Tri-state: unset / yes / no", CHECKBOX: "Checkbox with explicit unset control" };
export function ProjectCaseFieldPresentation({ projectId }: { projectId: string }) {
  return <ProjectCaseFieldPresentationControl key={projectId} projectId={projectId} />;
}
/** Only native presentation metadata is written. Private drafts and uncertain
 * receipts remain mounted across close/access loss, never re-bound to an actor. */
export function ProjectCaseFieldPresentationControl({ projectId }: { projectId: string }) {
  const access = useCaseFieldAccess(projectId), auth = useAuth(), utils = trpcReact.useUtils();
  const [open, setOpen] = useState(false), [acceptedSession, setAcceptedSession] = useState<string | null>(null);
  const nativeActor = useRef<string | null>(null);
  const currentActor = access.readable && auth.isLoaded && !!auth.isSignedIn && auth.userId === access.origin?.clerkActorId && !!auth.sessionId;
  useEffect(() => { if (!acceptedSession && currentActor) { nativeActor.current = access.fresh?.readScope?.actorId ?? null; setAcceptedSession(auth.sessionId!); } }, [acceptedSession, currentActor, auth.sessionId, access.fresh]);
  const ready = currentActor && auth.sessionId === acceptedSession;
  const query = trpcReact.caseFieldPresentation.get.useQuery({ projectId, ...caseFieldReadPins(access.origin) }, { enabled: ready && open, retry: false, staleTime: 0, refetchOnWindowFocus: false });
  const [readState, setReadState] = useState<ManualSummaryReadState>({ ready: false, key: "", sessionId: null, baseline: 0, epoch: 0 });
  const activation = manualSummaryReadActivation(readState, { ready: ready && open, key: JSON.stringify([projectId, access.origin?.organizationId, access.origin?.clerkActorId]), sessionId: auth.sessionId ?? null, revision: query.dataUpdatedAt });
  if (activation.changed) setReadState(activation.state);
  useEffect(() => { if (ready && open) void query.refetch({ cancelRefetch: false }); }, [ready, open, activation.state.epoch]);
  const fresh = ready && open && activation.fresh && query.isFetchedAfterMount ? freshCasePresentation(query, access.current) : undefined;
  const save = trpcReact.caseFieldPresentation.configure.useMutation();
  const [draft, setDraft] = useState<FieldPresentationDraft | null>(null), [reason, setReason] = useState(""), [reviewed, setReviewed] = useState(false), [confirmed, setConfirmed] = useState(false), [notice, setNotice] = useState("");
  const [pending, setPending] = useState<FieldPresentationReceipt | null>(null);
  const pendingRef = useRef(pending), draftRef = useRef(draft), busyRef = useRef(false), epochRef = useRef(0);
  const [verifying, setVerifying] = useState(false), [verified, setVerified] = useState<FieldPresentationSessionProof | null>(null), [recoveryNotice, setRecoveryNotice] = useState("");
  const verifyBusy = useRef(false), verifiedRef = useRef(verified), adoptedInput = useRef<FieldPresentationReceipt["input"] | null>(null);
  const nativeReadGeneration = useRef(0), verifiedCacheRevision = useRef<number | null>(null);
  // Including losses and returns prevents A -> B -> A from reauthorizing an
  // old read/save callback merely because its final strings happen to match.
  const authorityKey = JSON.stringify([auth.isLoaded, auth.isSignedIn, auth.userId, auth.sessionId, access.readable, access.canConfigure, access.current?.projectId, access.current?.organizationId, access.fresh?.readScope?.actorId]);
  const [priorAuthority, setPriorAuthority] = useState(authorityKey);
  const frame = useRef<FieldPresentationFrame>({ ready: false, open: false, epoch: 0, origin: null, sessionId: null });
  const liveRecovery = useRef({ eligible: false, sessionId: null as string | null, origin: access.origin, nativeActorId: nativeActor.current, epoch: epochRef.current, open: false });
  if (priorAuthority !== authorityKey) {
    epochRef.current++; frame.current = { ...frame.current, ready: false, epoch: epochRef.current };
    liveRecovery.current = { ...liveRecovery.current, eligible: false, epoch: epochRef.current };
    verifiedRef.current = null; verifiedCacheRevision.current = null; setVerified(null); setRecoveryNotice(""); setReviewed(false); setConfirmed(false); setPriorAuthority(authorityKey);
  }
  const nativeMatches = !!nativeActor.current && (!access.fresh || access.fresh.readScope?.actorId === nativeActor.current) && (!fresh || fresh.readScope.actorId === nativeActor.current);
  const authorized = ready && nativeMatches && access.canConfigure && fresh?.canConfigure !== false && !!access.origin && access.owns(access.origin, "configure");
  const recoveryEligible = currentActor && !!acceptedSession && acceptedSession !== auth.sessionId && !!access.origin && !!nativeActor.current && access.fresh?.readScope?.actorId === nativeActor.current && access.canConfigure && access.owns(access.origin, "configure");
  useLayoutEffect(() => {
    frame.current = { ready: authorized, open, epoch: epochRef.current, origin: access.origin, sessionId: auth.sessionId ?? null };
    return () => { frame.current = { ...frame.current, ready: false, open: false }; };
  }, [authorized, open, access.origin, auth.sessionId, priorAuthority]);
  useLayoutEffect(() => {
    liveRecovery.current = { eligible: recoveryEligible, sessionId: auth.sessionId ?? null, origin: access.origin, nativeActorId: nativeActor.current, epoch: epochRef.current, open };
    return () => { liveRecovery.current = { ...liveRecovery.current, eligible: false, open: false }; };
  }, [recoveryEligible, auth.sessionId, access.origin, open, priorAuthority]);
  function invalidateReview() { epochRef.current++; frame.current = { ...frame.current, epoch: epochRef.current }; liveRecovery.current = { ...liveRecovery.current, epoch: epochRef.current }; verifiedRef.current = null; verifiedCacheRevision.current = null; setVerified(null); setReviewed(false); setConfirmed(false); }
  function close() { invalidateReview(); frame.current = { ...frame.current, open: false }; liveRecovery.current = { ...liveRecovery.current, open: false }; setOpen(false); }
  function show() { if (!authorized) return; invalidateReview(); setOpen(true); }
  function showRecovery() { if (!recoveryEligible) return; invalidateReview(); setRecoveryNotice(""); setOpen(true); }
  async function verifyCurrentSession() {
    if (!recoveryEligible || !open || !access.origin || !auth.sessionId || busyRef.current || save.isPending || verifyBusy.current || query.isFetching || query.isPaused) return;
    invalidateReview(); const started = { ...liveRecovery.current }, observedCacheRevision = query.dataUpdatedAt, beforeRevision = nativeReadGeneration.current, readGeneration = ++nativeReadGeneration.current, input = pendingRef.current?.input ?? null;
    verifyBusy.current = true; setVerifying(true); setRecoveryNotice("");
    try {
      // Direct typed client calls do not consult/join React Query's cache.
      // Even if its fetch-state observer lags, this is a new native request,
      // not a pre-renewal read relabelled as proof of the current session.
      const result = await utils.client.caseFieldPresentation.get.query({ projectId, ...caseFieldReadPins(started.origin) });
      const current = liveRecovery.current;
      if (!current.eligible || !current.open || current.epoch !== started.epoch || current.sessionId !== started.sessionId || current.nativeActorId !== started.nativeActorId || !current.origin || !access.owns(current.origin, "configure") || busyRef.current || pendingRef.current?.input !== (input ?? undefined)) return;
      const data = freshCasePresentation({ data: result, error: null, isFetching: false, isPaused: false }, current.origin);
      const proof = fieldPresentationSessionRead({ data, origin: current.origin, nativeActorId: current.nativeActorId, sessionId: current.sessionId!, epoch: current.epoch, beforeRevision, revision: readGeneration, input });
      verifiedCacheRevision.current = observedCacheRevision; verifiedRef.current = proof; setVerified(proof); setRecoveryNotice("The current session has a new completed native full Owner/Admin read for the unchanged original account and organization. Adopt it explicitly before viewing or retrying retained settings.");
    } catch (cause) {
      if (liveRecovery.current.eligible && liveRecovery.current.epoch === started.epoch) setRecoveryNotice(cause instanceof Error ? cause.message : "Verification was refused. Retained settings remain private.");
    } finally { verifyBusy.current = false; setVerifying(false); }
  }
  function adoptVerifiedSession() {
    const proof = verifiedRef.current, current = liveRecovery.current;
    if (!current.open || !current.origin || verifiedCacheRevision.current !== query.dataUpdatedAt || !access.owns(current.origin, "configure") || !sameFieldPresentationSessionProof(proof, { ready: current.eligible && !query.error && !query.isFetching && !query.isPaused, busy: busyRef.current || save.isPending || verifyBusy.current, origin: current.origin, nativeActorId: current.nativeActorId, sessionId: current.sessionId, epoch: current.epoch, data: proof?.data, revision: nativeReadGeneration.current, input: pendingRef.current?.input ?? null })) return;
    adoptedInput.current = proof!.input; invalidateReview(); setAcceptedSession(proof!.sessionId); setRecoveryNotice("");
    setNotice("Explicitly adopted the verified current session for the unchanged original actor and organization. Draft, original receipt session, UUID, hashes and request content remain unchanged. Review new writes again; pending writes retry identically.");
  }
  function loadCurrent() {
    if (!authorized || !fresh || pendingRef.current || busyRef.current) return;
    const next = initialFieldPresentationDraft(fresh);
    invalidateReview(); draftRef.current = next; setDraft(next);
    setNotice(next ? "Loaded current settings as an unsaved draft. Review before saving; existing values and unknown mappings stay retained." : "Saved definitions or settings are unsupported and remain read-only. Nothing was replaced with defaults.");
  }
  function change(key: string, setting: CaseFieldPresentationSetting | null) {
    if (!authorized || !draftRef.current || pendingRef.current || busyRef.current) return;
    try { const next = changeFieldPresentation(draftRef.current, key, setting); invalidateReview(); draftRef.current = next; setDraft(next); setNotice(""); }
    catch (cause) { setNotice(cause instanceof Error ? cause.message : "Presentation change refused. Exact settings remain retained."); }
  }
  function review() {
    if (!authorized || !draftRef.current || pendingRef.current || busyRef.current || !currentFieldPresentationBaseline(draftRef.current, fresh)) return;
    try { freezeFieldPresentationRequest(draftRef.current, access.origin!, reason, "00000000-0000-4000-8000-000000000000"); setReviewed(true); setConfirmed(false); setNotice("Reviewed local presentation only; not yet saved. Native field types, defaults, values, cases and permissions are unchanged."); }
    catch (cause) { setNotice(cause instanceof Error ? cause.message : "Review was refused."); }
  }
  async function submit() {
    if (busyRef.current || !authorized || !frame.current.open || !access.origin || !auth.sessionId) return;
    let attempt = pendingRef.current;
    if (attempt && ((attempt.sessionId !== auth.sessionId && adoptedInput.current !== attempt.input) || !access.owns(attempt.origin, "configure"))) return;
    if (!attempt) {
      if (!draftRef.current || !reviewed || !confirmed || !currentFieldPresentationBaseline(draftRef.current, fresh)) return;
      try { attempt = { input: freezeFieldPresentationRequest(draftRef.current, access.origin, reason, crypto.randomUUID()), origin: access.origin, sessionId: auth.sessionId, uncertain: false }; }
      catch (cause) { setNotice(cause instanceof Error ? cause.message : "Nothing was submitted."); return; }
      pendingRef.current = attempt; setPending(attempt);
    }
    const started = { ...frame.current }, heldDraft = draftRef.current;
    busyRef.current = true; setNotice("");
    try {
      const result = await save.mutateAsync(attempt.input);
      assertFieldPresentationAck(result, attempt);
      if (pendingRef.current !== attempt) return;
      // Settle only the exact receipt even after close. A stale UI frame may
      // never clear/rebase the retained draft or update another view's notice.
      pendingRef.current = null; setPending(null);
      if (!sameFieldPresentationFrame(started, frame.current) || !access.owns(attempt.origin, "configure") || draftRef.current !== heldDraft) return;
      draftRef.current = null; setDraft(null); invalidateReview(); setReason(""); close();
      setNotice("Saved custom-field presentation. Native field types, defaults, case values and frozen runs were not changed.");
      const settledFrame = { ...frame.current };
      try {
        await utils.caseFieldPresentation.get.invalidate({ projectId });
        if (!frame.current.ready || frame.current.epoch !== settledFrame.epoch || frame.current.sessionId !== started.sessionId || !access.owns(attempt.origin, "configure")) return;
        await utils.project.experience.invalidate({ projectId });
      }
      catch { if (frame.current.ready && frame.current.epoch === settledFrame.epoch && frame.current.sessionId === started.sessionId && access.owns(attempt.origin, "configure")) setNotice("Presentation was saved; refreshing context failed. Refresh settings, not the settled write."); }
    } catch (cause) {
      if (pendingRef.current === attempt) { const retained = retainedFieldPresentationReceipt(attempt, cause); pendingRef.current = retained; setPending(retained); }
      if (sameFieldPresentationFrame(started, frame.current) && access.owns(attempt.origin, "configure")) setNotice(cause instanceof Error ? cause.message : "Response uncertain. Restore original access and retry the identical request.");
    } finally { busyRef.current = false; }
  }
  const current = draft && currentFieldPresentationBaseline(draft, fresh);
  const adoptionReady = verifiedCacheRevision.current === query.dataUpdatedAt && sameFieldPresentationSessionProof(verified, { ready: recoveryEligible && !query.error && !query.isFetching && !query.isPaused, busy: busyRef.current || save.isPending || verifyBusy.current, origin: access.origin, nativeActorId: nativeActor.current, sessionId: auth.sessionId ?? null, epoch: epochRef.current, data: verified?.data, revision: nativeReadGeneration.current, input: pendingRef.current?.input ?? null });
  return <>
    {authorized && <button type="button" className="btn-secondary" onClick={show}>Configure custom-field presentation</button>}
    {recoveryEligible && !open && <button type="button" className="btn-secondary" onClick={showRecovery}>Recover retained settings in this session</button>}
    {authorized && !open && notice && <p role="status">{notice}</p>}
    <Modal open={open} onClose={close} title="Project custom-field presentation" size="wide">
      {!authorized ? <>
        <p role="status">Restore current full Owner/Admin access for the unchanged original account and organization. Private draft and exact pending request stay retained, not transferred.</p>
        {recoveryEligible && <><p>A renewed session can be adopted only after a new completed native access read. No retained draft, UUID or body is shown before adoption.</p><button type="button" className="btn-secondary" disabled={verifying || busyRef.current || save.isPending || query.isFetching || query.isPaused} onClick={() => void verifyCurrentSession()}>{verifying ? "Verifying current session…" : "Verify current session"}</button>{verified && <><button type="button" className="btn-primary" disabled={!adoptionReady} onClick={adoptVerifiedSession}>Adopt verified current session</button>{!adoptionReady && <p role="status">Verification is no longer current or an operation is busy. Verify again after it settles; retained settings remain private.</p>}</>}{recoveryNotice && <p role="status">{recoveryNotice}</p>}</>}
      </> : <>
        <p>Choose controls for existing native fields, not new field types or values. Hiding applies only when a key is absent. Null, empty text, whitespace, false and zero stay visible. Hidden absent fields have an explicit reveal action in the case editor.</p>
        {(!fresh || query.isFetching) && <p role="status">Awaiting a fresh original-scope settings read. Cached settings cannot authorize a new save.</p>}
        {query.error && <p role="alert">Settings could not be read. Retained drafts and pending requests remain unchanged. <button type="button" onClick={() => void query.refetch({ cancelRefetch: false })}>Retry settings read</button></p>}
        {fresh?.warnings.map((warning, index) => <p key={index} role="alert">{warning}</p>)}
        {fresh && !draft && !pending && <button type="button" className="btn-secondary" onClick={loadCurrent}>Load current settings for review</button>}
        {draft && <>
          {!current && <p role="alert">Project context or native schema changed, or its fresh read is unavailable. Your exact draft remains retained; a new write needs current settings and review.</p>}
          <fieldset disabled={!!pending || save.isPending || busyRef.current} style={{ border: 0, padding: 0, minWidth: 0 }}>
            {draft.baseline.definitionSchema?.fields.map(field => {
              const setting = draft.configuration.fields[field.key], selected = setting ?? { widget: "AUTO" as const };
              if (field.retired) return <div key={field.key} className="panel"><strong>{field.label}</strong> <code>{field.key}</code><p>Retired definition: retained read-only.</p>{setting && <pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(setting, null, 2)}</pre>}</div>;
              return <div key={field.key} className="panel" style={{ marginBlock: 12, minWidth: 0 }}>
                <strong>{field.label}</strong> <code>{field.key}</code><p>{field.type.toLowerCase()} · {field.required ? "required" : "optional"} · {setting ? "Explicit saved/draft setting" : "Native defaults; no saved mapping"}</p>
                <label>Control<select aria-label={`Control for ${field.key}`} value={selected.widget} onChange={event => change(field.key, { ...selected, widget: event.target.value as CaseFieldPresentationSetting["widget"] })}>{fieldPresentationWidgets(field).map(widget => <option key={widget} value={widget}>{widgets[widget]}</option>)}</select></label>
                <label style={{ display: "block" }}>Visibility<select aria-label={`Visibility for ${field.key}`} value={selected.visibility ?? "INHERIT"} onChange={event => { const next = { ...selected }; if (event.target.value === "INHERIT") delete next.visibility; else next.visibility = event.target.value as "SHOW" | "HIDE_WHEN_EMPTY"; change(field.key, next); }}><option value="INHERIT">Native default (no visibility override)</option><option value="SHOW">Show</option>{(!field.required || selected.visibility === "HIDE_WHEN_EMPTY") && <option value="HIDE_WHEN_EMPTY">{field.required ? "Retained hide-if-absent preference; required field always visible" : "Hide only when native value is absent; allow reveal"}</option>}</select></label>
                {["TEXT", "NUMBER"].includes(field.type) && <><label style={{ display: "block" }}>Optional placeholder (presentation only)<input aria-label={`Placeholder for ${field.key}`} maxLength={200} value={selected.placeholder ?? ""} onChange={event => change(field.key, { ...selected, placeholder: event.target.value })} /></label>{Object.hasOwn(selected, "placeholder") && <button type="button" onClick={() => { const next = { ...selected }; delete next.placeholder; change(field.key, next); }}>Remove placeholder override</button>}</>}
                {setting && <button type="button" onClick={() => change(field.key, null)}>Use native defaults for this field</button>}
              </div>;
            })}
            {Object.entries(draft.configuration.fields).filter(([key]) => !draft.baseline.definitionSchema?.fields.some(field => field.key === key)).map(([key, setting]) => <div key={key} className="panel"><code>{key}</code><p>Unknown saved mapping: exact settings retained read-only. Not removed or repaired.</p><pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(setting, null, 2)}</pre></div>)}
            {!draft.baseline.definitionSchema?.fields.length && <p>No native fields are defined. Define supported fields separately; this panel cannot invent definitions.</p>}
            <label style={{ display: "block" }}>Reason<textarea rows={2} maxLength={1000} value={reason} onChange={event => { invalidateReview(); setReason(event.target.value); }} /></label>
            <button type="button" className="btn-secondary" disabled={!current || !reason.trim()} onClick={review}>Review unsaved presentation</button>
            {reviewed && <label style={{ display: "block", marginBlock: 12 }}><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /> I reviewed these exact native-compatible controls and full current project/schema snapshots. No values, defaults or field types will change.</label>}
          </fieldset>
        </>}
        {pending && <p role="status">Request <code>{pending.input.requestId}</code> is retained with its original actor, organization, hashes and exact content. {pending.uncertain ? "A previous response was uncertain. A later refusal does not prove that write failed." : "Do not start a replacement while this response is pending."}</p>}
        {(draft || pending) && <button type="button" className="btn-primary" disabled={save.isPending || busyRef.current || (!pending && (!current || !reviewed || !confirmed))} onClick={() => void submit()}>{save.isPending ? "Saving…" : pending ? "Retry identical presentation request" : "Save reviewed presentation"}</button>}
        {fresh && draft && !pending && <button type="button" className="btn-secondary" disabled={save.isPending || busyRef.current} onClick={loadCurrent}>Discard draft and load current settings</button>}
        {notice && <p role="alert">{notice}</p>}
      </>}
    </Modal>
  </>;
}
