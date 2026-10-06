"use client";
import { useLayoutEffect, useRef, useState, type MutableRefObject } from "react";
import type { CaseFieldOrigin } from "./case-field-origin";
import { assertGovernanceAcknowledgement, planGovernanceRequestHash, retainedGovernancePending, type GovernancePending, type GovernanceScope } from "./plan-governance-receipt";
import { usePlanChangeAccess, type PlanChangePreview, type PlanChangeAccess } from "./use-plan-change-access";
import { freezePlanChangeJson } from "./plan-change-draft";

type BaseInput = { projectId: string; testPlanId: string; originalOrganizationId: string; expectedClerkActorId: string; expectedPlanRevision: string; requestId: string; reason: string; confirmed: true };
type Ack = Parameters<typeof assertGovernanceAcknowledgement>[0];
export type PlanChangeDraft<D> = { identity: string; baseline: PlanChangePreview; origin: CaseFieldOrigin; nativeActorId: string; values: D; reason: string; confirmed: boolean };
export type PlanChangePending<D, I> = GovernancePending<I> & { nativeActorId: string; reviewedDraft: PlanChangeDraft<D> };
export type PlanChangeEditor<D, I> = { open: boolean; show: () => void; close: () => void; reads: PlanChangeAccess; readable: boolean; draft: PlanChangeDraft<D> | null; draftRef: MutableRefObject<PlanChangeDraft<D> | null>; pending: PlanChangePending<D, I> | null; pendingRef: MutableRefObject<PlanChangePending<D, I> | null>; busy: boolean; notice: string; review: () => void; change: (values: Partial<Pick<PlanChangeDraft<D>, "values" | "reason" | "confirmed">>) => void; commit: () => Promise<void>; problem: string | null; canHandleDraft: () => boolean; canSave: boolean };
export const samePlanChangeReader = (scope: GovernanceScope | undefined, origin: CaseFieldOrigin, nativeActorId: string) => !!scope && scope.projectId === origin.projectId && scope.organizationId === origin.organizationId && scope.actorClerkUserId === origin.clerkActorId && scope.actorId === nativeActorId;

export function usePlanChangeEditor<D, I extends BaseInput>({ projectId, testPlanId, organizationId, readOnly, operation, mutation, initialize, canChange, validate, makeInput, onChanged, savedNotice }: {
  projectId: string; testPlanId: string; organizationId: string; readOnly: boolean;
  operation: "SET_PLAN_STATUS" | "EDIT_PLAN_CUSTOM_FIELDS";
  mutation: { isPending: boolean; mutateAsync: (input: I) => Promise<Ack> };
  initialize: (preview: PlanChangePreview) => D;
  canChange: (preview: PlanChangePreview) => boolean;
  validate: (draft: PlanChangeDraft<D>, current: PlanChangePreview) => string | null;
  makeInput: (draft: PlanChangeDraft<D>, base: BaseInput) => I;
  onChanged: () => void | Promise<void>; savedNotice: string;
}): PlanChangeEditor<D, I> {
  const [open, setOpen] = useState(false), [draft, setDraft] = useState<PlanChangeDraft<D> | null>(null), [pending, setPending] = useState<PlanChangePending<D, I> | null>(null), [notice, setNotice] = useState(""), [preparing, setPreparing] = useState(false);
  const reads = usePlanChangeAccess(projectId, testPlanId, organizationId, open);
  const draftRef = useRef(draft), pendingRef = useRef(pending), busyRef = useRef(false);
  const authority = JSON.stringify([open, projectId, testPlanId, reads.activation, readOnly, !!reads.fresh, reads.fresh?.canRecover, reads.fresh?.planRevision, reads.fresh?.scope.actorId, reads.fresh?.scope.organizationId, reads.fresh?.scope.actorClerkUserId, reads.fresh?.metadataSchema.fieldSchemaHash, reads.fresh?.metadataSchema.canEdit, reads.fresh?.statusActions.canChange, reads.fresh?.statusActions.canReopen]);
  const [authorityState, setAuthorityState] = useState({ authority, epoch: 0 });
  if (authorityState.authority !== authority) setAuthorityState({ authority, epoch: authorityState.epoch + 1 });
  const frame = useRef<{ open: boolean; projectId: string; testPlanId: string; activation: string; epoch: number; readOnly: boolean; fresh: PlanChangePreview | null } | null>(null);
  const handlerEpoch = authorityState.epoch;
  useLayoutEffect(() => {
    frame.current = { open, projectId, testPlanId, activation: reads.activation, epoch: handlerEpoch, readOnly, fresh: reads.fresh };
    return () => { frame.current = null; };
  }, [open, projectId, testPlanId, reads.activation, handlerEpoch, readOnly, reads.fresh]);
  const busy = preparing || mutation.isPending;
  const readable = !!reads.fresh && !readOnly && reads.fresh.canRecover && (!draft || draft.baseline.snapshot.id === testPlanId && samePlanChangeReader(reads.fresh.scope, draft.origin, draft.nativeActorId)) && (!pending || pending.input.testPlanId === testPlanId && samePlanChangeReader(reads.fresh.scope, pending.origin, pending.nativeActorId));
  const currentHandler = () => !!frame.current?.open && !frame.current.readOnly && frame.current.projectId === projectId && frame.current.testPlanId === testPlanId && frame.current.activation === reads.activation && frame.current.epoch === handlerEpoch && frame.current.fresh === reads.fresh;
  function close() { if (frame.current) frame.current = { ...frame.current, open: false }; setOpen(false); }
  function review() {
    const fresh = reads.fresh;
    if (!fresh || !readable || !currentHandler() || !reads.origin || !canChange(fresh) || busyRef.current || pendingRef.current) return;
    const next = { identity: crypto.randomUUID(), baseline: fresh, origin: reads.origin, nativeActorId: fresh.scope.actorId, values: initialize(fresh), reason: "", confirmed: false };
    draftRef.current = next; setDraft(next); setNotice("Loaded the current native snapshot. Choose the exact changes and review them before saving.");
  }
  function change(values: Partial<Pick<PlanChangeDraft<D>, "values" | "reason" | "confirmed">>) {
    const current = draftRef.current;
    if (!current || !readable || !currentHandler() || !reads.fresh || !canChange(reads.fresh) || busyRef.current || pendingRef.current) return;
    const next = { ...current, ...values, identity: crypto.randomUUID(), confirmed: values.confirmed === true }; draftRef.current = next; setDraft(next);
  }
  async function commit() {
    const held = pendingRef.current, captured = held?.reviewedDraft ?? draftRef.current;
    if (!captured || busyRef.current) return;
    const activation = frame.current?.activation, startedEpoch = frame.current?.epoch;
    const owns = () => {
      const current = frame.current;
      return !!current?.open && !current.readOnly && current.projectId === captured.origin.projectId && current.testPlanId === captured.baseline.snapshot.id && current.activation === activation && current.epoch === startedEpoch && !!current.fresh?.canRecover && samePlanChangeReader(current.fresh.scope, captured.origin, captured.nativeActorId);
    };
    if (!owns()) return;
    busyRef.current = true; let retained = held;
    try {
      if (!retained) {
        const current = frame.current!.fresh!;
        if (!canChange(current) || !captured.confirmed || !captured.reason.trim() || captured.reason.trim().length > 1000 || captured.baseline.planRevision !== current.planRevision || validate(captured, current)) return;
        const base: BaseInput = { projectId, testPlanId, originalOrganizationId: captured.origin.organizationId, expectedClerkActorId: captured.origin.clerkActorId, expectedPlanRevision: captured.baseline.planRevision, requestId: crypto.randomUUID(), reason: captured.reason.trim(), confirmed: true };
        const input = freezePlanChangeJson(makeInput(captured, base));
        const reviewedDraft = { ...captured, values: freezePlanChangeJson(captured.values) };
        setPreparing(true); let requestHash: string;
        try { requestHash = await planGovernanceRequestHash(operation, input); } finally { setPreparing(false); }
        if (!owns() || draftRef.current?.identity !== captured.identity || pendingRef.current) return;
        retained = { input, origin: captured.origin, nativeActorId: captured.nativeActorId, operation, requestHash, uncertain: false, reviewedDraft };
        pendingRef.current = retained; setPending(retained);
      }
      const saved = await mutation.mutateAsync(retained.input);
      assertGovernanceAcknowledgement(saved, retained);
      if (saved.scope.actorId !== retained.nativeActorId) throw Error("The acknowledgement belongs to a different native reader. Retain the original request.");
      if (pendingRef.current !== retained) return;
      pendingRef.current = null; setPending(current => current === retained ? null : current);
      // Exact native/hash ACK settles only its private receipt, even after
      // close/access loss/unmount. It never reclassifies known success UNKNOWN.
      // All draft, notice, cache and parent effects still require this frame.
      if (!owns()) return;
      if (draftRef.current?.identity !== captured.identity) { setNotice("The original request was confirmed; your newer draft remains unchanged. Review current saved values before another save."); return; }
      draftRef.current = null; setDraft(current => current?.identity === captured.identity ? null : current); setNotice(savedNotice);
      // A known ACK is settled once. Refresh/callback failure never recreates
      // the request or invites another write, and cannot change another frame.
      reads.refresh();
      const failedRefresh = () => { if (owns()) setNotice(`${savedNotice} The parent view could not refresh; refresh reads only, do not resubmit.`); };
      try { void Promise.resolve(onChanged()).catch(failedRefresh); } catch { failedRefresh(); }
    } catch (cause) {
      if (retained && pendingRef.current === retained) {
        const result = owns() ? retainedGovernancePending(retained, cause) : { ...retained, uncertain: true };
        const next = result ? { ...retained, uncertain: result.uncertain } : null;
        pendingRef.current = next; setPending(current => current === retained ? next : current);
      }
      if (owns()) setNotice(cause instanceof Error ? cause.message : "The write was not acknowledged. Keep the exact reviewed request.");
    } finally { busyRef.current = false; setPreparing(false); }
  }
  const problem = draft && reads.fresh ? validate(draft, reads.fresh) : null;
  return { open, show: () => setOpen(true), close, reads, readable, draft, draftRef, pending, pendingRef, busy, notice, review, change, commit, problem,
    canHandleDraft: () => readable && currentHandler() && !busyRef.current && !pendingRef.current && !!reads.fresh && canChange(reads.fresh),
    canSave: !!draft && !!reads.fresh && canChange(reads.fresh) && !problem && draft.confirmed && !!draft.reason.trim() && draft.reason.trim().length <= 1000 && draft.baseline.planRevision === reads.fresh.planRevision && readable && !busy };
}
