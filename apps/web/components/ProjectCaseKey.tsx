"use client";

import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { trpcReact, type RouterInputs, type RouterOutputs } from "@/lib/trpcReact";
import { currentSessionScope, sameAuthScope } from "@/lib/auth-query-cache";
import { manualStartDefinitivelyRejected } from "@/lib/manual-run-start";
import { Modal } from "@/components/Modal";

type Identity = RouterOutputs["project"]["caseIdentity"];
type Input = RouterInputs["project"]["saveCaseKey"];
type Draft = { identity: Identity; key: string };
type Pending = { input: Readonly<Input>; actorId: string; requestHash: string; uncertain: boolean };
const keyPattern = /^[a-z][a-z0-9-]{0,23}$/;

async function requestHash(input: Input, actorId: string) {
  // Exact native property order; neither refreshed actor nor cached label is
  // substituted into a retained ProjectCaseKey/v1 request.
  const bytes = new TextEncoder().encode(JSON.stringify({ kind: "ProjectCaseKey/v1", actorId,
    projectId: input.projectId, originalOrganizationId: input.originalOrganizationId,
    expectedClerkActorId: input.expectedClerkActorId, expectedNativeActorId: input.expectedNativeActorId, requestId: input.requestId,
    expectedCaseKey: input.expectedCaseKey, expectedRevision: input.expectedRevision, caseKey: input.caseKey,
  }));
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
}
function assertAcknowledged(value: unknown, pending: Pending) {
  const fields = ["projectId", "organizationId", "actorId", "actorClerkUserId", "requestId", "requestHash", "beforeKey", "caseKey", "beforeRevision", "revision", "keyLocked", "aliasesPreserved", "replayed"];
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Unmatched key acknowledgement");
  const receipt = value as Record<string, unknown>, input = pending.input;
  if (Object.keys(receipt).length !== fields.length || fields.some(field => !Object.hasOwn(receipt, field)) ||
    receipt.projectId !== input.projectId || receipt.organizationId !== input.originalOrganizationId ||
    receipt.actorId !== pending.actorId || receipt.actorId !== input.expectedNativeActorId || receipt.actorClerkUserId !== input.expectedClerkActorId ||
    receipt.requestId !== input.requestId || receipt.requestHash !== pending.requestHash ||
    receipt.beforeKey !== input.expectedCaseKey || receipt.caseKey !== input.caseKey ||
    receipt.beforeRevision !== input.expectedRevision || receipt.revision !== input.expectedRevision + (input.caseKey === input.expectedCaseKey ? 0 : 1) ||
    receipt.keyLocked !== false || receipt.aliasesPreserved !== true || typeof receipt.replayed !== "boolean") throw Error("Unmatched key acknowledgement");
}
function sameOriginal(original: Identity, current: Identity | null) {
  return !!current && original.projectId === current.projectId && original.organizationId === current.organizationId &&
    original.actorId === current.actorId && original.actorClerkUserId === current.actorClerkUserId;
}

export function ProjectCaseKey({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const auth = useAuth(), helpId = useId(), utils = trpcReact.useUtils();
  const authReady = !!(auth.isLoaded && auth.isSignedIn && auth.userId && auth.sessionId);
  const identity = trpcReact.project.caseIdentity.useQuery({ projectId, expectedClerkActorId: auth.userId ?? undefined },
    { enabled: authReady, retry: false, staleTime: 0, refetchOnWindowFocus: false });
  const save = trpcReact.project.saveCaseKey.useMutation();
  const [open, setOpen] = useState(false), [draft, setDraft] = useState<Draft | null>(null);
  const [confirmed, setConfirmed] = useState(false), [reviewRequired, setReviewRequired] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null), [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(""), [refreshFailed, setRefreshFailed] = useState(false);
  const [generation, publishGeneration] = useState(0);
  const held = useRef<Pending | null>(null), inFlight = useRef(false), eventGeneration = useRef(0);
  const data = identity.data;
  const current = authReady && identity.isFetchedAfterMount && !identity.error && !identity.isFetching && !identity.isPaused &&
    data?.projectId === projectId && !!data.organizationId && !!data.actorId && data.actorClerkUserId === auth.userId &&
    keyPattern.test(data.caseKey) && Number.isSafeInteger(data.revision) && data.revision >= 0 && data.revision <= 2147483646 &&
    Number.isSafeInteger(data.allocatedCount) && data.allocatedCount >= 0 && data.keyLocked === false && typeof data.canEdit === "boolean" ? data : null;
  const frame = useMemo(() => ({ projectId, current, canEdit, authReady, userId: auth.userId ?? "", sessionId: auth.sessionId ?? "" }),
    [projectId, current, canEdit, authReady, auth.userId, auth.sessionId]);
  const committed = useRef<typeof frame | null>(null);
  useLayoutEffect(() => { committed.current = frame; return () => { if (committed.current === frame) committed.current = null; }; }, [frame]);
  function sdkCurrent() {
    return frame.authReady && sameAuthScope({ userId: frame.userId, sessionId: frame.sessionId },
      typeof window === "undefined" ? null : currentSessionScope(window.Clerk?.loaded ? window.Clerk.session : null));
  }
  function sessionCurrent() { return committed.current === frame && sdkCurrent(); }
  function owns(original: Identity, edit = true) {
    return sessionCurrent() && sameOriginal(original, frame.current) && (!edit || frame.canEdit && !!frame.current?.canEdit);
  }
  function advance() { publishGeneration(++eventGeneration.current); }
  function show() {
    if (generation !== eventGeneration.current || inFlight.current || held.current || !current || !owns(current)) return;
    if (draft && !sameOriginal(draft.identity, current)) return;
    if (!draft) setDraft({ identity: Object.freeze({ ...current }), key: current.caseKey });
    setOpen(true); setNotice(""); advance();
  }
  function canChange() {
    return generation === eventGeneration.current && !inFlight.current && !held.current && !reviewRequired && !!draft && owns(draft.identity) &&
      current?.revision === draft.identity.revision && current.caseKey === draft.identity.caseKey;
  }
  async function submit() {
    if (generation !== eventGeneration.current || inFlight.current || save.isPending) return;
    let attempt = held.current;
    if (!draft || !owns(draft.identity)) return;
    const original = draft.identity;
    const normalized = draft.key.trim().toLowerCase();
    if (!attempt && (!canChange() || !confirmed || !keyPattern.test(normalized))) return;
    inFlight.current = true; setBusy(true); setNotice("");
    try {
      if (!attempt) {
        const input: Input = Object.freeze({ projectId: original.projectId, originalOrganizationId: original.organizationId,
          expectedClerkActorId: original.actorClerkUserId, expectedNativeActorId: original.actorId, requestId: crypto.randomUUID(),
          expectedCaseKey: original.caseKey, expectedRevision: original.revision, caseKey: normalized });
        attempt = { input, actorId: original.actorId, requestHash: await requestHash(input, original.actorId), uncertain: false };
        held.current = attempt; setPending(attempt);
        if (!owns(original)) return;
      }
      try {
        const result = await save.mutateAsync(attempt.input);
        assertAcknowledged(result, attempt);
        if (!owns(original)) { held.current = { ...attempt, uncertain: true }; setPending(held.current); return; }
      } catch (cause) {
        held.current = manualStartDefinitivelyRejected(cause, attempt.uncertain) ? null : { ...attempt, uncertain: true };
        setPending(held.current);
        if (!held.current) { setConfirmed(false); setReviewRequired(true); advance(); }
        if (owns(original)) setNotice(held.current
          ? "The key change was not acknowledged. Retry the same original key, revision and request ID; do not start a replacement."
          : "The key change was refused. The key may be reserved, or project identity may have changed. Load current identity and review again; your draft is retained.");
        return;
      }
      held.current = null; setPending(null); setOpen(false); setDraft(null); setConfirmed(false); setReviewRequired(false); advance();
      setNotice("Project key renamed. Live labels now use the new key; old aliases and immutable case IDs are preserved.");
      try {
        await utils.project.caseIdentity.invalidate({ projectId: original.projectId });
        await utils.testCases.list.invalidate({ projectId: original.projectId });
        if (owns(original, false)) setRefreshFailed(false);
      } catch {
        if (owns(original, false)) { setRefreshFailed(true); setNotice("The key rename was acknowledged, but refreshing labels failed. Retry the read, not the write."); }
      }
    } catch {
      if (owns(original)) setNotice("The key request could not be prepared. No change was submitted; your draft is retained.");
    } finally { inFlight.current = false; setBusy(false); }
  }
  async function retryRead() {
    if (!sessionCurrent() || draft && draft.identity.actorClerkUserId !== frame.userId) return;
    try {
      await identity.refetch();
      if (refreshFailed) await utils.testCases.list.invalidate({ projectId });
      if (sessionCurrent()) setRefreshFailed(false);
    } catch { if (sessionCurrent()) setRefreshFailed(true); }
  }
  const original = draft?.identity;
  const visible = sdkCurrent() && !!current && (!original || sameOriginal(original, current));
  if (!visible) return <p role="status">{identity.error ? "Current case identifiers could not be verified." : identity.isFetching || !identity.isFetchedAfterMount ? "Checking current case identifiers…" : "Restore the original signed-in account and project access."} Any key draft or uncertain request stays retained and withheld. <button type="button" disabled={!authReady || identity.isFetching} onClick={retryRead}>Retry identity read</button></p>;
  const editable = canEdit && current.canEdit && !busy && !save.isPending;
  const contextChanged = !!draft && (current.revision !== draft.identity.revision || current.caseKey !== draft.identity.caseKey);
  function close() {
    if (generation !== eventGeneration.current || inFlight.current || held.current || !draft || !owns(draft.identity, false)) return;
    setOpen(false); advance();
  }
  return <>
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, margin: "12px 0" }}>
      <span>Case key: <code>{current.caseKey}</code></span><span className="text-muted">Example: {current.caseKey}-01</span>
      {editable && <button type="button" className="btn-secondary" aria-haspopup="dialog" onClick={show} disabled={Boolean(pending)}>Change case key</button>}
    </div>
    {notice && !open && <p role="status">{notice}</p>}
    {refreshFailed && !open && <button type="button" className="btn-secondary" disabled={identity.isFetching} onClick={retryRead}>Refresh case labels</button>}
    <Modal open={open} onClose={close} dismissible={!busy && !pending} title="Rename the project case key">
      <form onSubmit={event => { event.preventDefault(); return submit(); }} style={{ display: "grid", gap: 12 }}>
        <p>{draft?.identity.allocatedCount} cases have allocated numbers. A rename changes their live display labels, not their immutable IDs or numbers. Old references remain aliases; frozen run procedures and evidence are not rewritten.</p>
        <fieldset disabled={!editable || Boolean(pending) || reviewRequired || contextChanged} style={{ border: 0, padding: 0, minWidth: 0 }}>
          <label style={{ display: "grid", gap: 6 }}>Project key<input autoFocus value={draft?.key ?? ""} maxLength={24} pattern="[A-Za-z][A-Za-z0-9-]{0,23}" required aria-describedby={helpId}
            onChange={event => { if (!canChange()) return; setDraft({ ...draft!, key: event.target.value }); setConfirmed(false); advance(); }} /></label>
          <p id={helpId} className="text-muted">Use 1–24 letters, numbers or hyphens, starting with a letter. Keys are lowercase. Existing cases can use a renamed key without losing their old references.</p>
          <p aria-live="polite">Case preview: <code>{draft?.key.trim().toLowerCase() || "project"}-01</code></p>
          <label><input type="checkbox" checked={confirmed} onChange={event => { if (canChange()) { setConfirmed(event.target.checked); advance(); } }} /> I reviewed the new live labels and preservation of old aliases and frozen evidence.</label>
        </fieldset>
        {notice && <p role="status">{notice}</p>}
        {pending && <p role="status">Original request {pending.input.requestId} is retained with key {pending.input.caseKey} and revision {pending.input.expectedRevision}. Restore original edit access and retry identical content.</p>}
        {!pending && (reviewRequired || contextChanged) && <p role="status">Load current identity before reviewing another request. This deliberately replaces the unsaved key draft.</p>}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {!pending && <button type="button" className="btn-secondary" disabled={!editable} onClick={() => {
            if (generation !== eventGeneration.current || inFlight.current || held.current || !draft || !owns(draft.identity)) return;
            setDraft({ identity: Object.freeze({ ...current }), key: current.caseKey }); setConfirmed(false); setReviewRequired(false); setNotice(""); advance();
          }}>Load current identity for review</button>}
          <button type="button" className="btn-secondary" disabled={busy || Boolean(pending)} onClick={close}>Close retained draft</button>
          <button type="submit" className="btn-primary" disabled={!editable || (!pending && (!confirmed || reviewRequired || contextChanged || !keyPattern.test(draft?.key.trim().toLowerCase() ?? "")))}>{busy ? "Saving…" : pending ? "Retry same key change" : "Save reviewed key"}</button>
        </div>
      </form>
    </Modal>
  </>;
}
