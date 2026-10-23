"use client";
import { useLayoutEffect, useRef, useState } from "react";
import { useCasePriorityAccess, type PriorityAccess } from "./use-case-priority-access";
import { assertPriorityAck, freezePriorityEnvelope, priorityRequestHash, samePriorityReader, type PriorityAck, type PriorityDraft, type PriorityEnvelope, type PriorityInput, type PriorityPending } from "./case-priority-draft";
import { manualStartDefinitivelyRejected } from "./manual-run-start";
export type PriorityController = { reads: PriorityAccess; draft: PriorityDraft | null; pending: PriorityPending | null; settled: boolean; busy: boolean; readable: boolean; canSave: boolean; notice: string; change: (value: PriorityInput["priority"]) => void; reviewCurrent: () => void; save: () => Promise<void> };
export function useCasePriorityController(projectId: string, caseId: string, active: boolean, readOnly: boolean, mutation: { isPending: boolean; mutateAsync: (input: PriorityEnvelope) => Promise<PriorityAck> }, onSaved: () => void | Promise<void>): PriorityController {
  const reads = useCasePriorityAccess(projectId, caseId, active);
  const [draft, setDraft] = useState<PriorityDraft | null>(null), [pending, setPending] = useState<PriorityPending | null>(null), [settledIdentity, setSettledIdentity] = useState<string | null>(null), [notice, setNotice] = useState(""), [preparing, setPreparing] = useState(false);
  const draftRef = useRef(draft), pendingRef = useRef(pending), settledRef = useRef(settledIdentity), busyRef = useRef(false);
  const authority = JSON.stringify([active, readOnly, projectId, caseId, reads.activation, !!reads.fresh, reads.fresh?.readScope, reads.fresh?.caseRevision, reads.fresh?.priority, reads.fresh?.canChange, reads.fresh?.canRecover]);
  const [epochState, setEpochState] = useState({ authority, epoch: 0 });
  if (epochState.authority !== authority) setEpochState({ authority, epoch: epochState.epoch + 1 });
  const epoch = epochState.epoch;
  const frame = useRef<{ active: boolean; readOnly: boolean; projectId: string; caseId: string; activation: string; epoch: number; fresh: PriorityAccess["fresh"] } | null>(null);
  useLayoutEffect(() => { frame.current = { active, readOnly, projectId, caseId, activation: reads.activation, epoch, fresh: reads.fresh }; return () => { frame.current = null; }; }, [active, readOnly, projectId, caseId, reads.activation, epoch, reads.fresh]);
  const readable = !!reads.fresh && (!draft || samePriorityReader(reads.fresh.readScope, draft.origin)) && (!pending || samePriorityReader(reads.fresh.readScope, pending.draft.origin));
  const currentHandler = () => { const current = frame.current; return readable && !!current?.active && !current.readOnly && current.projectId === projectId && current.caseId === caseId && current.activation === reads.activation && current.epoch === epoch && current.fresh === reads.fresh && !!current.fresh?.canRecover; };
  function change(value: PriorityInput["priority"]) {
    const fresh = reads.fresh;
    if (!currentHandler() || !fresh?.canChange || !fresh.caseRevision || !reads.origin || busyRef.current || pendingRef.current || settledRef.current) return;
    if (draftRef.current && draftRef.current.caseRevision !== fresh.caseRevision) { setNotice("The case changed. Keep this choice and explicitly review the current case before saving."); return; }
    const next = Object.freeze({ identity: crypto.randomUUID(), origin: reads.origin, priority: value, previousPriority: fresh.priority, caseRevision: fresh.caseRevision }); draftRef.current = next; setDraft(next); setNotice("");
  }
  function reviewCurrent() {
    const fresh = reads.fresh, retained = draftRef.current;
    if (!currentHandler() || !fresh?.canChange || !fresh.caseRevision || !reads.origin || busyRef.current || pendingRef.current) return;
    const next = Object.freeze({ identity: crypto.randomUUID(), origin: reads.origin, priority: retained?.priority ?? fresh.priority, previousPriority: fresh.priority, caseRevision: fresh.caseRevision });
    draftRef.current = next; setDraft(next); settledRef.current = null; setSettledIdentity(null); setNotice("Reviewed the current case with your retained priority choice. This changes scheduling priority only; it is not a business-need rationale or risk assessment.");
  }
  async function save() {
    const held = pendingRef.current, captured = held?.draft ?? draftRef.current;
    if (!captured || busyRef.current || !currentHandler() || settledRef.current === captured.identity) return;
    const activation = frame.current?.activation, startedEpoch = frame.current?.epoch;
    const owns = () => { const current = frame.current; return !!current?.active && !current.readOnly && current.projectId === captured.origin.projectId && current.caseId === captured.origin.caseId && current.activation === activation && current.epoch === startedEpoch && !!current.fresh?.canRecover && samePriorityReader(current.fresh.readScope, captured.origin); };
    if (!owns()) return;
    busyRef.current = true; let retained = held;
    try {
      if (!retained) {
        const fresh = frame.current!.fresh!;
        if (!fresh.canChange || captured.caseRevision !== fresh.caseRevision || captured.priority === fresh.priority) return;
        const envelope = freezePriorityEnvelope(captured, crypto.randomUUID()); setPreparing(true); const requestHash = await priorityRequestHash(envelope.input);
        if (!owns() || draftRef.current?.identity !== captured.identity || pendingRef.current) return;
        retained = Object.freeze({ envelope, draft: captured, requestHash, everAmbiguous: false }); pendingRef.current = retained; setPending(retained);
      }
      const saved = await mutation.mutateAsync(retained.envelope); assertPriorityAck(saved, retained);
      if (pendingRef.current !== retained) return;
      pendingRef.current = null; setPending(current => current === retained ? null : current); settledRef.current = captured.identity; setSettledIdentity(captured.identity);
      if (!owns() || draftRef.current?.identity !== captured.identity) return;
      settledRef.current = null; setSettledIdentity(null); draftRef.current = null; setDraft(current => current?.identity === captured.identity ? null : current); setNotice("Priority saved. The case procedure and existing risk/business-need decisions were retained.");
      const failed = () => { if (owns()) setNotice("Priority saved, but refreshing failed. Refresh reads only; do not submit another decision."); };
      try { void Promise.resolve(onSaved()).catch(failed); } catch { failed(); }
      reads.refresh();
    } catch (cause) {
      if (retained && pendingRef.current === retained) { const next = owns() && manualStartDefinitivelyRejected(cause, retained.everAmbiguous) ? null : Object.freeze({ ...retained, everAmbiguous: true }); pendingRef.current = next; setPending(current => current === retained ? next : current); }
      if (owns()) setNotice(cause instanceof Error ? cause.message : "The priority response is uncertain. Retain the exact native-scoped decision for recovery.");
    } finally { busyRef.current = false; setPreparing(false); }
  }
  const busy = preparing || mutation.isPending, settled = !!draft && settledIdentity === draft.identity;
  return { reads, draft, pending, settled, busy, readable, notice, change, reviewCurrent, save, canSave: readable && active && !readOnly && !!reads.fresh?.canRecover && !busy && !settled && (!!pending || !!draft && !!reads.fresh?.canChange && reads.fresh.caseRevision === draft.caseRevision && draft.priority !== reads.fresh.priority) };
}
