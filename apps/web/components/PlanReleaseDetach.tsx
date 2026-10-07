"use client";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { trpcReact, type RouterInputs, type RouterOutputs } from "@/lib/trpcReact";
import { usePlanGovernance } from "@/lib/use-plan-governance";
import { currentSessionScope, sameAuthScope } from "@/lib/auth-query-cache";
import { sameCaseFieldOrigin, type CaseFieldOrigin } from "@/lib/case-field-origin";
import {
  assertGovernanceAcknowledgement,
  planGovernanceRequestHash,
  retainedGovernancePending,
  type GovernancePending,
} from "@/lib/plan-governance-receipt";

type Input = RouterInputs["testPlanGovernance"]["detachAttachedPlan"];
type Preview = RouterOutputs["testPlanGovernance"]["preview"];
type Draft = { preview: Preview; origin: CaseFieldOrigin; releaseId: string };

// A single controller belongs to the release page, not an attached-plan row.
// In particular, a committed detach with a lost ACK must survive row removal.
export function PlanReleaseDetach({ projectId, releaseId, releaseStatus, plans, active, onChanged }: {
  projectId: string;
  releaseId: string;
  releaseStatus: string;
  plans: Array<{ id: string; name: string }>;
  active: boolean;
  onChanged: () => void;
}) {
  const auth = useAuth();
  const [planId, setPlanId] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [reviewRequired, setReviewRequired] = useState(false);
  const [notice, setNotice] = useState("");
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [pending, setPending] = useState<GovernancePending<Input> | null>(null);
  const [busy, setBusy] = useState(false);
  const [generation, publishGeneration] = useState(0);
  const held = useRef<GovernancePending<Input> | null>(null);
  const inFlight = useRef(false);
  const eventGeneration = useRef(0);
  const { access, fresh, query } = usePlanGovernance(projectId, pending?.input.testPlanId ?? draft?.preview.snapshot.id ?? planId, active);
  const save = trpcReact.testPlanGovernance.detachAttachedPlan.useMutation();
  const currentOrigin = access.current, canEdit = access.canEdit, readable = access.readable;
  const frame = useMemo(() => ({ projectId, releaseId, active, currentOrigin, canEdit, readable, fresh,
    userId: auth.userId ?? "", sessionId: auth.sessionId ?? "",
    signedIn: !!(auth.isLoaded && auth.isSignedIn), releaseStatus,
  }), [projectId, releaseId, active, currentOrigin, canEdit, readable, fresh, auth.userId, auth.sessionId, auth.isLoaded, auth.isSignedIn, releaseStatus]);
  const committed = useRef<typeof frame | null>(null);
  useLayoutEffect(() => {
    committed.current = frame;
    return () => { if (committed.current === frame) committed.current = null; };
  }, [frame]);
  function owns(original: CaseFieldOrigin) {
    return committed.current === frame && frame.active && frame.signedIn &&
      original.projectId === frame.projectId && original.clerkActorId === frame.userId &&
      sameAuthScope({ userId: frame.userId, sessionId: frame.sessionId },
        typeof window === "undefined" ? null : currentSessionScope(window.Clerk?.loaded ? window.Clerk.session : null)) &&
      access.owns(original, "edit");
  }
  function newDraftAllowed() {
    return !!fresh?.canEdit && releaseStatus === "PLANNING" &&
      fresh.snapshot.releaseId === releaseId && !["APPROVED", "ARCHIVED"].includes(fresh.snapshot.status);
  }
  function review() {
    if (generation !== eventGeneration.current || inFlight.current || held.current || !newDraftAllowed() || !access.origin || !owns(access.origin)) return;
    setDraft({ preview: fresh!, origin: access.origin, releaseId });
    setReason(""); setConfirmed(false); setReviewRequired(false); setNotice("");
    publishGeneration(++eventGeneration.current);
  }
  function canChangeDraft() {
    return !reviewRequired && !inFlight.current && !held.current && generation === eventGeneration.current &&
      !!draft && owns(draft.origin) && draft.releaseId === releaseId && newDraftAllowed() &&
      fresh?.planRevision === draft.preview.planRevision;
  }
  async function commit() {
    if (generation !== eventGeneration.current || inFlight.current) return;
    let retained = held.current;
    const original = retained?.origin ?? draft?.origin;
    if (!original || !owns(original) || save.isPending) return;
    if (retained) {
      if (retained.input.expectedReleaseId !== releaseId || !fresh?.canRecover) return;
    } else if (!canChangeDraft() || !draft || !confirmed || !reason.trim()) return;
    // Authoritative pre-await guard prevents duplicate callbacks from creating
    // multiple UUIDs, including during asynchronous hashing.
    inFlight.current = true; setBusy(true); setNotice("");
    try {
      if (!retained) {
        const input: Input = Object.freeze({ projectId, testPlanId: draft!.preview.snapshot.id,
          releaseId: null, expectedReleaseId: draft!.releaseId,
          expectedPlanRevision: draft!.preview.planRevision,
          originalOrganizationId: original.organizationId, expectedClerkActorId: original.clerkActorId,
          requestId: crypto.randomUUID(), reason: reason.trim(), confirmed: true,
        });
        retained = { input, origin: original, operation: "DETACH_ATTACHED_PLAN",
          requestHash: await planGovernanceRequestHash("DETACH_ATTACHED_PLAN", input), uncertain: false };
        held.current = retained; setPending(retained);
        if (!owns(original)) return;
      }
      try {
        const result = await save.mutateAsync(retained.input);
        assertGovernanceAcknowledgement(result, retained);
        if (!owns(original)) {
          held.current = { ...retained, uncertain: true }; setPending(held.current); return;
        }
      } catch (cause) {
        held.current = retainedGovernancePending(retained, cause); setPending(held.current);
        if (!held.current) {
          setConfirmed(false); setReviewRequired(true); publishGeneration(++eventGeneration.current);
          if (owns(original)) void query.refetch();
        }
        if (owns(original)) setNotice(held.current
          ? "Detachment was not acknowledged. Retry the same original request; its plan, release, reason and UUID remain fixed."
          : "Detachment was refused. No acknowledged change is shown; load the current plan and review again.");
        return;
      }
      held.current = null; setPending(null); setDraft(null); setPlanId(""); setReason(""); setConfirmed(false);
      publishGeneration(++eventGeneration.current);
      setNotice("Plan detached with an audited version. Its criteria, verdicts and requirements remain on the unassigned plan.");
      try { onChanged(); await query.refetch(); if (owns(original)) setRefreshFailed(false); }
      catch {
        if (owns(original)) {
          setRefreshFailed(true);
          setNotice("The plan was acknowledged as detached, but the workspace refresh failed. Retry the read; do not submit another detachment.");
        }
      }
    } catch {
      if (owns(original)) setNotice("The detachment request could not be prepared. No change was submitted.");
    } finally { inFlight.current = false; setBusy(false); }
  }
  const original = pending?.origin ?? draft?.origin;
  const visible = active && access.readable && (!original || original.projectId === projectId && original.clerkActorId === frame.userId && sameCaseFieldOrigin(original, access.current)) &&
    auth.isLoaded && auth.isSignedIn && sameAuthScope({ userId: frame.userId, sessionId: frame.sessionId },
      typeof window === "undefined" ? null : currentSessionScope(window.Clerk?.loaded ? window.Clerk.session : null)) &&
    (!draft || draft.releaseId === releaseId) && (!pending || pending.input.expectedReleaseId === releaseId);
  if (!visible) return <section aria-label="Detach an attached quality plan"><p role="status">Restore the original signed-in account and release workspace. Any reviewed draft or uncertain detachment remains retained and withheld here.</p></section>;
  const editable = !busy && !save.isPending && access.canEdit && newDraftAllowed();
  return <section aria-label="Detach an attached quality plan" style={{ display: "grid", gap: 8, marginTop: 12 }}>
    <h3>Detach a quality plan</h3>
    {(query.error || refreshFailed) && <p role="alert">The reviewed workspace could not fully refresh. <button type="button" disabled={query.isFetching} onClick={async () => {
      const reader = pending?.origin ?? draft?.origin ?? access.origin;
      if (!reader || !owns(reader)) return;
      try { if (refreshFailed) onChanged(); await query.refetch(); if (owns(reader)) setRefreshFailed(false); }
      catch { if (owns(reader)) setRefreshFailed(true); }
    }}>Retry plan read</button></p>}
    {pending ? <>
      <p>The exact detachment request remains retained until acknowledged, even if this plan no longer appears in the attached list.</p>
      <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>Plan: {pending.input.testPlanId}{"\n"}Original release: {pending.input.expectedReleaseId}{"\n"}Reviewed revision: {pending.input.expectedPlanRevision}{"\n"}Reason: {pending.input.reason}</p>
      <button type="button" onClick={commit} disabled={busy || save.isPending || !access.canEdit || !fresh?.canRecover}>Retry same detachment</button>
    </> : <>
      {releaseStatus !== "PLANNING" && <p>Return this release to PLANNING before reviewing a new detachment.</p>}
      {!draft && <label>Attached test plan<select value={planId} disabled={busy || !access.canEdit || releaseStatus !== "PLANNING"} onChange={event => {
        if (generation !== eventGeneration.current || inFlight.current || held.current || !access.origin || !owns(access.origin) || releaseStatus !== "PLANNING") return;
        setPlanId(event.target.value); setConfirmed(false); publishGeneration(++eventGeneration.current);
      }}><option value="">Choose a plan…</option>{plans.map(plan => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select></label>}
      {fresh?.editBlockedReason && <p role="status">{fresh.editBlockedReason}</p>}
      <button type="button" disabled={!editable} onClick={review}>{draft ? "Reload current plan for review (replaces unsaved reason)" : "Load current plan for review"}</button>
      {draft && <>
        <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>Plan: {draft.preview.snapshot.name}{"\n"}Plan ID: {draft.preview.snapshot.id}{"\n"}Source release: {draft.releaseId}{"\n"}Reviewed revision: {draft.preview.planRevision}</p>
        <p>{draft.preview.snapshot.criteria.length} criteria will stop contributing to this release. Their wording, verdicts and linked requirements stay on the plan; no test case or evidence is deleted.</p>
        {fresh?.planRevision !== draft.preview.planRevision && <p role="status">The plan changed after this review. Reload the current plan before submitting a new detachment.</p>}
        {reviewRequired && <p role="status">Load the current plan for a deliberate new review before another request. Your unsaved reason remains here until you choose to replace it.</p>}
        <label>Reason for detachment<input value={reason} maxLength={1000} disabled={!editable || reviewRequired} onChange={event => { if (!canChangeDraft()) return; setReason(event.target.value); setConfirmed(false); publishGeneration(++eventGeneration.current); }} /></label>
        <label><input type="checkbox" checked={confirmed} disabled={!editable || reviewRequired || fresh?.planRevision !== draft.preview.planRevision} onChange={event => { if (canChangeDraft()) { setConfirmed(event.target.checked); publishGeneration(++eventGeneration.current); } }} /> I reviewed this plan and its removal from this release&apos;s quality scope.</label>
        <button type="button" disabled={!editable || reviewRequired || !confirmed || !reason.trim() || fresh?.planRevision !== draft.preview.planRevision} onClick={commit}>Detach reviewed plan</button>
        <button type="button" className="btn-secondary" disabled={busy || save.isPending} onClick={() => {
          if (generation !== eventGeneration.current || inFlight.current || held.current || !owns(draft.origin)) return;
          setDraft(null); setReason(""); setConfirmed(false); publishGeneration(++eventGeneration.current);
        }}>Cancel unsaved detachment</button>
      </>}
    </>}
    {notice && <p role="status">{notice}</p>}
  </section>;
}
