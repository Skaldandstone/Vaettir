"use client";
import { useLayoutEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { trpcReact, type RouterInputs, type RouterOutputs } from "./trpcReact";
import { assertPrerequisiteAck, freezePrerequisiteInput, prerequisiteInputHash, samePrerequisiteReader, type PrerequisiteOrigin, type PrerequisiteDraft, type PrerequisitePending } from "./case-prerequisite-draft";
import { manualStartDefinitivelyRejected } from "./manual-run-start";

type CandidateCursor = NonNullable<RouterInputs["testCaseStructure"]["prerequisitePage"]["cursor"]>;
type CandidateSort = "case-id" | "title" | "inventory";
export type PrerequisiteController = {
  access: ReturnType<typeof trpcReact.testCaseStructure.prerequisiteAccess.useQuery>;
  page: ReturnType<typeof trpcReact.testCaseStructure.prerequisitePage.useQuery>;
  readable: boolean;
  freshAccess: RouterOutputs["testCaseStructure"]["prerequisiteAccess"] | null;
  freshPage: RouterOutputs["testCaseStructure"]["prerequisitePage"] | null;
  origin: PrerequisiteOrigin | null; open: boolean; draft: PrerequisiteDraft | null; pending: PrerequisitePending | null;
  settled: string | null; busy: boolean; notice: string; search: string; sort: CandidateSort; cursors: CandidateCursor[];
  show: () => void; close: () => void; change: (ids: string[]) => void; discard: () => void; submit: () => Promise<void>;
  refresh: () => void; setSearch: (value: string) => void; setSort: (value: CandidateSort) => void; previous: () => void; next: () => void;
};
export function useCasePrerequisites(projectId: string, caseId: string, active: boolean, permitted: boolean): PrerequisiteController {
  const auth = useAuth(), utils = trpcReact.useUtils();
  const [origin, setOrigin] = useState<PrerequisiteOrigin | null>(null), [search, setSearch] = useState(""), [sort, setSort] = useState<"case-id" | "title" | "inventory">("case-id"), [cursors, setCursors] = useState<NonNullable<RouterInputs["testCaseStructure"]["prerequisitePage"]["cursor"]>[]>([]);
  const [open, setOpen] = useState(false), [draft, setDraft] = useState<PrerequisiteDraft | null>(null), [pending, setPending] = useState<PrerequisitePending | null>(null), [settled, setSettled] = useState<string | null>(null), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false), [refresh, setRefresh] = useState(0);
  const authReady = Boolean(active && auth.isLoaded && auth.isSignedIn && auth.userId && auth.sessionId);
  const authority = JSON.stringify([active, authReady, auth.userId, auth.sessionId, projectId, caseId, origin, permitted, refresh]);
  const [cycle, setCycle] = useState({ authority, epoch: 0, id: crypto.randomUUID() });
  if (cycle.authority !== authority) setCycle({ authority, epoch: cycle.epoch + 1, id: crypto.randomUUID() });
  const access = trpcReact.testCaseStructure.prerequisiteAccess.useQuery({ projectId, caseId, readRequestId: cycle.id, ...(origin ? { originalOrganizationId: origin.organizationId, expectedClerkActorId: origin.actorClerkUserId, expectedActorId: origin.actorId } : {}) }, { enabled: authReady && cycle.authority === authority, retry: false, staleTime: 0, refetchOnWindowFocus: false });
  const freshAccess = authReady && cycle.authority === authority && access.isSuccess && !access.error && !access.isFetching && !access.isPaused && access.data.readRequestId === cycle.id && access.data.projectId === projectId && access.data.caseId === caseId && access.data.readScope.actorClerkUserId === auth.userId ? access.data : null;
  useLayoutEffect(() => { if (!origin && freshAccess && auth.sessionId) setOrigin({ ...freshAccess.readScope, caseId, sessionId: auth.sessionId }); }, [origin, freshAccess, caseId, auth.sessionId]);
  const readable = Boolean(freshAccess && samePrerequisiteReader(freshAccess.readScope, origin, caseId, auth.sessionId));
  const cursor = cursors.at(-1), pageBinding = JSON.stringify([cycle.id, open, search, sort, cursor]);
  const [pageCycle, setPageCycle] = useState({ binding: pageBinding, id: crypto.randomUUID() });
  if (pageCycle.binding !== pageBinding) setPageCycle({ binding: pageBinding, id: crypto.randomUUID() });
  const page = trpcReact.testCaseStructure.prerequisitePage.useQuery({ projectId, caseId, readRequestId: pageCycle.id, originalOrganizationId: origin?.organizationId ?? "", expectedClerkActorId: origin?.actorClerkUserId ?? "", expectedActorId: origin?.actorId ?? "", search, sort, cursor }, { enabled: readable && pageCycle.binding === pageBinding, retry: false, staleTime: 0, refetchOnWindowFocus: false });
  const freshPage = readable && pageCycle.binding === pageBinding && page.isSuccess && !page.error && !page.isFetching && !page.isPaused && page.data.readRequestId === pageCycle.id && page.data.projectId === projectId && page.data.caseId === caseId && samePrerequisiteReader(page.data.readScope, origin, caseId, auth.sessionId) ? page.data : null;
  // This authority generation is separate from the native-read nonce. Read or
  // edit admission lost and restored within one Clerk session still revokes old
  // handlers/ACK effects; it must not cause a query-key/refetch render loop.
  const handlerAuthority = JSON.stringify([cycle.epoch, readable, Boolean(permitted && freshAccess?.canEdit), open, pageCycle.id, Boolean(freshPage), freshPage?.graphHash]);
  const [handlerCycle, setHandlerCycle] = useState({ authority: handlerAuthority, epoch: 0 });
  if (handlerCycle.authority !== handlerAuthority) setHandlerCycle({ authority: handlerAuthority, epoch: handlerCycle.epoch + 1 });
  const handlerEpoch = handlerCycle.epoch;
  const mutation = trpcReact.testCaseStructure.reviewedSetPrerequisites.useMutation();
  const frame = useRef<{ epoch: number; readable: boolean; editable: boolean; open: boolean; origin: PrerequisiteOrigin | null; page: typeof freshPage } | null>(null), draftRef = useRef(draft), pendingRef = useRef(pending), settledRef = useRef(settled), busyRef = useRef(false);
  useLayoutEffect(() => { frame.current = { epoch: handlerEpoch, readable, editable: Boolean(readable && permitted && freshAccess?.canEdit), open, origin, page: freshPage }; return () => { frame.current = null; }; }, [handlerEpoch, readable, permitted, freshAccess, open, origin, freshPage]);
  function owns(value: PrerequisiteOrigin, epoch = handlerEpoch) { const f = frame.current; return Boolean(f?.readable && f.editable && f.open && f.epoch === epoch && f.origin && JSON.stringify(f.origin) === JSON.stringify(value)); }
  function show() { const f = frame.current; if (!readable || !permitted || !freshAccess?.canEdit || !f?.readable || !f.editable || f.epoch !== handlerEpoch || busyRef.current) return; setOpen(true); setRefresh(value => value + 1); }
  function close() { if (frame.current) frame.current = { ...frame.current, open: false }; setOpen(false); }
  function change(ids: string[]) {
    const f = frame.current;
    if (!f?.origin || !f.page || f.page !== freshPage || !owns(f.origin) || busyRef.current || pendingRef.current || settledRef.current || draftRef.current?.identity !== draft?.identity || ids.length > 50 || new Set(ids).size !== ids.length) return;
    const existing = draftRef.current;
    if (existing && (existing.graphHash !== f.page.graphHash || JSON.stringify([...existing.baseline].sort()) !== JSON.stringify([...f.page.prerequisiteIds].sort()))) { setNotice("Saved links changed. Your old draft is retained; discard it explicitly before reviewing a new baseline."); return; }
    const allowed = new Set([...(existing?.ids ?? f.page.prerequisiteIds), ...(existing?.baseline ?? f.page.prerequisiteIds), ...f.page.items.filter(item => !item.unavailable && !item.archived && item.reviewStatus === "APPROVED").map(item => item.id)]);
    if (ids.some(id => !allowed.has(id))) return;
    const retainedIds = new Set([...(existing?.baseline ?? f.page.prerequisiteIds), ...ids]);
    const next = Object.freeze({ identity: crypto.randomUUID(), origin: f.origin, baseline: existing?.baseline ?? Object.freeze([...f.page.prerequisiteIds]), graphHash: existing?.graphHash ?? f.page.graphHash, ids: Object.freeze([...ids]), linked: [...(existing?.linked ?? f.page.linked), ...f.page.items].filter((item, index, all) => retainedIds.has(item.id) && all.findIndex(other => other.id === item.id) === index) });
    draftRef.current = next; setDraft(next); setNotice("");
  }
  function discard() { const f = frame.current; if (!f?.origin || !owns(f.origin) || busyRef.current || pendingRef.current || draftRef.current?.identity !== draft?.identity) return; draftRef.current = null; setDraft(null); settledRef.current = null; setSettled(null); setNotice("The unsent or confirmed draft was explicitly discarded. Saved links were not changed."); setRefresh(value => value + 1); }
  async function submit() {
    const held = pendingRef.current, captured = held?.draft ?? draftRef.current, startedEpoch = handlerEpoch;
    if (!captured || !owns(captured.origin, startedEpoch) || busyRef.current || settledRef.current === captured.identity) return;
    if (held ? held !== pending : captured.identity !== draft?.identity) return;
    if (!held && (!frame.current?.page || frame.current.page.graphHash !== captured.graphHash)) { setNotice("Refresh and review the saved graph before a new write. Your draft remains retained."); return; }
    busyRef.current = true; setBusy(true); let retained = held;
    try {
      if (!retained) {
        const input = freezePrerequisiteInput(captured, crypto.randomUUID()), requestHash = await prerequisiteInputHash(input);
        if (!owns(captured.origin, startedEpoch) || draftRef.current?.identity !== captured.identity || pendingRef.current) return;
        retained = Object.freeze({ input, draft: captured, requestHash, everAmbiguous: false }); pendingRef.current = retained; setPending(retained);
      }
      const ack = await mutation.mutateAsync(retained.input); assertPrerequisiteAck(ack, retained);
      if (pendingRef.current !== retained) return;
      pendingRef.current = null; setPending(current => current === retained ? null : current); settledRef.current = captured.identity; setSettled(captured.identity);
      // The exact ACK settles privately after close/access loss. It cannot clear
      // a newer draft or trigger current-page effects in another session/frame.
      if (!owns(captured.origin, startedEpoch) || draftRef.current?.identity !== captured.identity) return;
      draftRef.current = null; setDraft(current => current?.identity === captured.identity ? null : current); settledRef.current = null; setSettled(null); setNotice("Prerequisites saved. Existing procedures and frozen run evidence were not changed.");
      setRefresh(value => value + 1);
      await utils.testCaseStructure.list.invalidate({ projectId: captured.origin.projectId });
    } catch (cause) {
      if (retained && pendingRef.current === retained) { const next = owns(captured.origin, startedEpoch) && manualStartDefinitivelyRejected(cause, retained.everAmbiguous) ? null : Object.freeze({ ...retained, everAmbiguous: true }); pendingRef.current = next; setPending(current => current === retained ? next : current); }
      if (owns(captured.origin, startedEpoch)) setNotice(cause instanceof Error ? cause.message : "The response is uncertain. Keep the exact UUID for recovery.");
    } finally { busyRef.current = false; setBusy(false); }
  }
  function canBrowse() { return Boolean(frame.current?.readable && frame.current.epoch === handlerEpoch && frame.current.page === freshPage && freshPage && !busyRef.current && !pendingRef.current); }
  // Narrowing a refused candidate cohort needs only a fresh current native
  // reader, not the very page that failed admission. Add/navigation remain
  // bound to their exact admitted page; filter changes never edit saved links.
  function canFilter() { return Boolean(frame.current?.readable && frame.current.open && frame.current.epoch === handlerEpoch && !busyRef.current && !pendingRef.current); }
  return { access, page, readable, freshAccess, freshPage, origin, open, draft, pending, settled, busy, notice, search, sort, cursors, show, close, change, discard, submit, refresh: () => { setCursors([]); setRefresh(value => value + 1); }, setSearch: (value: string) => { if (!canFilter()) return; if (value.length > 200) { setNotice("Search supports at most 200 characters. The previous exact filter remains unchanged; shorten the search to continue."); return; } setSearch(value); setCursors([]); }, setSort: (value: typeof sort) => { if (canFilter()) { setSort(value); setCursors([]); } }, previous: () => { if (canBrowse()) setCursors(value => value.slice(0, -1)); }, next: () => { if (canBrowse() && freshPage?.nextCursor) setCursors(value => [...value, freshPage.nextCursor!]); } };
}
