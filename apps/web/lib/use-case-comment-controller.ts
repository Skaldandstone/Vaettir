"use client";
import { useLayoutEffect, useRef, useState } from "react";
import { useCaseCommentAccess, type CommentAccess } from "./use-case-comment-access";
import { assertCommentAck, commentRequestHash, freezeCommentInput, sameCommentReader, type CommentAck, type CommentDraft, type CommentInput, type CommentPending } from "./case-comment-draft";
import { manualStartDefinitivelyRejected } from "./manual-run-start";
export type CommentController = { reads: CommentAccess; draft: CommentDraft | null; pending: CommentPending | null; settled: boolean; busy: boolean; notice: string; open: boolean; readable: boolean; canRead: () => boolean; canHandle: () => boolean; show: () => void; close: () => void; startNew: () => void; change: (body: string) => void; submit: () => Promise<void> };
export function useCaseCommentController(projectId: string, caseId: string, active: boolean, mutation: { isPending: boolean; mutateAsync: (input: CommentInput) => Promise<CommentAck> }, onSaved: () => void): CommentController {
  const reads = useCaseCommentAccess(projectId, caseId, active);
  const [draft, setDraft] = useState<CommentDraft | null>(null), [pending, setPending] = useState<CommentPending | null>(null), [settledIdentity, setSettledIdentity] = useState<string | null>(null), [notice, setNotice] = useState(""), [open, setOpen] = useState(true), [preparing, setPreparing] = useState(false);
  const draftRef = useRef(draft), pendingRef = useRef(pending), settledRef = useRef(settledIdentity), busyRef = useRef(false);
  const authority = JSON.stringify([active, open, projectId, caseId, reads.activation, !!reads.fresh, reads.fresh?.readScope, reads.fresh?.canComment]);
  const [epochState, setEpochState] = useState({ authority, epoch: 0 });
  if (epochState.authority !== authority) setEpochState({ authority, epoch: epochState.epoch + 1 });
  const handlerEpoch = epochState.epoch;
  const frame = useRef<{ active: boolean; open: boolean; projectId: string; caseId: string; activation: string; epoch: number; fresh: CommentAccess["fresh"] } | null>(null);
  useLayoutEffect(() => {
    frame.current = { active, open, projectId, caseId, activation: reads.activation, epoch: handlerEpoch, fresh: reads.fresh };
    return () => { frame.current = null; };
  }, [active, open, projectId, caseId, reads.activation, handlerEpoch, reads.fresh]);
  const readable = !!reads.fresh && (!draft || sameCommentReader(reads.fresh.readScope, draft.origin)) && (!pending || sameCommentReader(reads.fresh.readScope, pending.draft.origin));
  function canRead() { const current = frame.current; return readable && !!current?.active && current.projectId === projectId && current.caseId === caseId && current.activation === reads.activation && current.epoch === handlerEpoch && current.fresh === reads.fresh; }
  function canHandle() { return canRead() && !!frame.current?.open; }
  function close() { if (frame.current) frame.current = { ...frame.current, open: false }; setOpen(false); }
  function show() { setOpen(true); reads.refresh(); }
  function startNew() {
    if (!canHandle() || busyRef.current || pendingRef.current || !draftRef.current || settledRef.current !== draftRef.current.identity) return;
    settledRef.current = null; setSettledIdentity(null); draftRef.current = null; setDraft(null); setNotice("The original comment was confirmed posted. Enter a new comment deliberately."); reads.refresh();
  }
  function change(body: string) {
    if (!canHandle() || !reads.origin || busyRef.current || pendingRef.current || settledRef.current) return;
    const next = Object.freeze({ identity: crypto.randomUUID(), origin: reads.origin, body });
    draftRef.current = next; setDraft(next); setNotice("");
  }
  async function submit() {
    const held = pendingRef.current, captured = held?.draft ?? draftRef.current;
    if (!captured || busyRef.current || !canHandle() || settledRef.current === captured.identity) return;
    const activation = frame.current?.activation, startedEpoch = frame.current?.epoch;
    const owns = () => { const current = frame.current; return !!current?.active && current.open && current.projectId === captured.origin.projectId && current.caseId === captured.origin.caseId && current.activation === activation && current.epoch === startedEpoch && !!current.fresh?.canComment && sameCommentReader(current.fresh.readScope, captured.origin); };
    if (!owns()) return;
    busyRef.current = true; let retained = held;
    try {
      if (!retained) {
        const input = freezeCommentInput(captured, crypto.randomUUID());
        setPreparing(true); const requestHash = await commentRequestHash(input);
        if (!owns() || draftRef.current?.identity !== captured.identity || pendingRef.current) return;
        retained = Object.freeze({ input, draft: captured, requestHash, everAmbiguous: false });
        pendingRef.current = retained; setPending(retained);
      }
      const saved = await mutation.mutateAsync(retained.input);
      assertCommentAck(saved, retained);
      if (pendingRef.current !== retained) return;
      // A known exact receipt settles privately even after close or unmount.
      pendingRef.current = null; setPending(current => current === retained ? null : current);
      settledRef.current = captured.identity; setSettledIdentity(captured.identity);
      if (!owns() || draftRef.current?.identity !== captured.identity) return;
      settledRef.current = null; setSettledIdentity(null);
      draftRef.current = null; setDraft(current => current?.identity === captured.identity ? null : current); setNotice("Comment posted. Comments do not edit or approve the case.");
      try { onSaved(); } catch { if (owns()) setNotice("Comment posted, but refreshing failed. Refresh comments only; do not post again."); }
      reads.refresh();
    } catch (cause) {
      if (retained && pendingRef.current === retained) {
        const next = owns() && manualStartDefinitivelyRejected(cause, retained.everAmbiguous) ? null : Object.freeze({ ...retained, everAmbiguous: true });
        pendingRef.current = next; setPending(current => current === retained ? next : current);
      }
      if (owns()) setNotice(cause instanceof Error ? cause.message : "The comment response is uncertain. Keep the exact request for recovery.");
    } finally { busyRef.current = false; setPreparing(false); }
  }
  return { reads, draft, pending, settled: !!draft && settledIdentity === draft.identity, busy: preparing || mutation.isPending, notice, open, readable, canRead, canHandle, show, close, startNew, change, submit };
}
