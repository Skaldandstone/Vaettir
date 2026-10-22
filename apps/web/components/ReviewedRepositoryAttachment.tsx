"use client";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { trpcReact } from "@/lib/trpcReact";
import { useCaseFieldAccess } from "@/lib/use-case-field-access";
import { useProjectCustomActions } from "@/lib/use-project-custom-actions";
import { currentSessionScope, sameAuthScope } from "@/lib/auth-query-cache";
import { parseReviewedAttachment, reviewedAttachmentKey, type ReviewedAttachmentReceipt } from "@/lib/reviewed-repository-receipt";
import { Modal } from "./Modal";
import { ReadableSelect } from "./ui/ReadableSelect";
import { IconButton } from "./ui/IconButton";

/** Deliberately separate from broad editor/provider setup controls. */
export function ReviewedRepositoryAttachment({ projectId, onAttached }: { projectId: string; onAttached: () => Promise<unknown> }) {
  const auth = useAuth(), access = useCaseFieldAccess(projectId), actions = useProjectCustomActions(projectId);
  const connectionLabel = useId();
  const scope = useMemo(() => ({ projectId, organizationId: access.origin?.organizationId ?? "", nativeActorId: access.fresh?.readScope?.actorId ?? "",
    clerkSubject: auth.userId ?? "", sessionId: auth.sessionId ?? "" }), [projectId, access.origin?.organizationId, access.fresh?.readScope?.actorId, auth.userId, auth.sessionId]);
  const eligible = access.readable && actions.allows("integrations.manage", scope.organizationId) && !!scope.nativeActorId && !!scope.sessionId;
  const frame = useMemo(() => ({ scope, eligible }), [scope, eligible]);
  const current = useRef<typeof frame | null>(null), inFlight = useRef(false);
  useLayoutEffect(() => { current.current = frame; return () => { current.current = null; }; }, [frame]);
  const owns = () => current.current === frame && frame.eligible && actions.owns("integrations.manage", scope.organizationId) &&
    !!access.origin && access.owns(access.origin) && sameAuthScope({ userId: scope.clerkSubject, sessionId: scope.sessionId },
      currentSessionScope(window.Clerk?.loaded ? window.Clerk.session : null));
  const query = trpcReact.repositoryConnections.reviewedCatalogue.useQuery({ projectId }, { enabled: eligible, retry: false, staleTime: 0, refetchOnWindowFocus: "always" });
  const mutation = trpcReact.repositoryConnections.connectSelected.useMutation({ retry: false });
  const data = eligible && query.isSuccess && !query.error && !query.isFetching && !query.isPaused && query.data.projectId === scope.projectId &&
    query.data.organizationId === scope.organizationId && query.data.nativeActorId === scope.nativeActorId && query.data.clerkSubject === scope.clerkSubject ? query.data : null;
  const [open, setOpen] = useState(false), [connectionId, setConnectionId] = useState(""), [selected, setSelected] = useState<string[]>([]);
  const [selectedVersion, setSelectedVersion] = useState("");
  const [receipt, setReceipt] = useState<ReviewedAttachmentReceipt | null>(null), [loadedKey, setLoadedKey] = useState("");
  const [storageError, setStorageError] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const key = reviewedAttachmentKey(scope.projectId, scope.clerkSubject, scope.sessionId);
  useEffect(() => {
    // Reconcile external session storage only after commit; loadedKey gates writes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadedKey(""); setStorageError(false); setError(""); setNotice(""); setSelected([]); setConnectionId(""); setOpen(false);
    try { setReceipt(parseReviewedAttachment(sessionStorage.getItem(key))); setLoadedKey(key); }
    catch { setStorageError(true); }
  }, [key]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const ownReceipt = receipt && Object.entries(scope).every(([name, value]) => receipt[name as keyof typeof scope] === value) ? receipt : null;
  const connection = data?.connections.find(item => item.id === (ownReceipt?.input.id ?? connectionId));
  const fresh = !!connection && new Date(connection.expiresAt).getTime() > now;
  const selectionCurrent = !!connection && selectedVersion === connection.catalogVersion && selected.every(id => connection.repositories.some(repo => repo.id === id));
  const retryable = fresh && ownReceipt && connection.catalogVersion === ownReceipt.input.catalogVersion && ownReceipt.input.repositoryIds.every(id => connection.repositories.some(repo => repo.id === id));
  async function attach() {
    // Event-time expiry check, never called during render; the displayed clock may be one tick old.
    // eslint-disable-next-line react-hooks/purity
    if (!owns() || !data || !connection || !fresh || new Date(connection.expiresAt).getTime() <= Date.now() || inFlight.current || loadedKey !== key || storageError ||
      (receipt && !retryable) || (!receipt && (!selectionCurrent || !selected.length || selected.length > 100))) return;
    const request: ReviewedAttachmentReceipt = ownReceipt ?? { ...scope, input: { id: connection.id, repositoryIds: [...selected], catalogVersion: connection.catalogVersion, approved: true } };
    // Preserve only exact identifiers/version/approval, never provider tokens or content.
    try { sessionStorage.setItem(key, JSON.stringify(request)); } catch { setStorageError(true); return; }
    inFlight.current = true; setReceipt(request); setBusy(true); setError(""); setNotice("");
    try {
      const result = await mutation.mutateAsync(request.input);
      if (!result || Object.keys(result).length !== 1 || result.connected !== request.input.repositoryIds.length) throw Error("Unmatched attachment response");
      if (!owns()) return; // Original stored request survives scope changes/unmount.
      sessionStorage.removeItem(key); setReceipt(null); setSelected([]); setNotice(`${result.connected} repositories attached.`);
      // A list refresh failure is not a failed attachment or permission to replay it.
      try { await onAttached(); } catch { if (owns()) setError("Attachment confirmed. Saved references could not refresh."); }
    } catch { if (owns()) setError("Attachment could not be confirmed. The exact request is retained; check saved references before retrying."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  if (!eligible) return actions.error ? <p role="alert">Could not check attachment access. <button type="button" onClick={() => actions.retry()}>Retry access check</button></p> : null;
  return <section aria-label="Previously reviewed repositories" style={{ marginBlock: 16, minWidth: 0 }}>
    <button type="button" className="btn-secondary" aria-haspopup="dialog" onClick={() => { if (owns()) setOpen(true); }}>Review attachments</button>
    <Modal open={open} onClose={() => setOpen(false)} title="Attach reviewed repositories">
      <p className="text-muted">Choose from repositories previously reviewed by this account. No provider lookup or source read.</p>
      {storageError && <p role="alert">Saved-request storage is unavailable or needs review. No new attachment can start.</p>}
      {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
      {ownReceipt && <p role="status">A previous attachment is unresolved. Its exact selection and approval are retained, including after closing.</p>}
      {receipt && !ownReceipt && <p role="alert">The saved attachment belongs to the original workspace and account. Restore that scope to review it; no new request can start.</p>}
      {!data ? <p role={query.error ? "alert" : "status"}>{query.error ? "Reviewed catalogue could not be loaded." : "Checking reviewed catalogue…"}</p> :
        !data.connections.length ? <p>No current reviewed catalogue is available. An authorized editor must review it first.</p> : <>
          <div style={{ display: "grid", gap: 6 }}><label htmlFor={connectionLabel}>Reviewed connection</label><ReadableSelect id={connectionLabel} value={connection?.id ?? ""} disabled={busy || !!receipt} onChange={event => { setConnectionId(event.target.value); setSelected([]); }}>
            <option value="">Choose connection</option>{data.connections.map(item => <option key={item.id} value={item.id}>{item.provider} · {item.origin}</option>)}
          </ReadableSelect></div>
          {connection && <><p className="text-muted">Previously reviewed {new Date(connection.reviewedAt).toLocaleString()} · {Math.max(0, Math.floor((now - new Date(connection.reviewedAt).getTime()) / 60000))} minutes ago. {fresh ? "Not a fresh provider verification." : "This catalogue has expired."}</p>
            <fieldset disabled={busy || !!receipt || !fresh} style={{ display: "grid", gap: 10, maxHeight: 300, overflow: "auto", border: "1px solid var(--line)", borderRadius: 8, padding: 12 }}><legend>Repositories · {ownReceipt?.input.repositoryIds.length ?? (selectionCurrent ? selected.length : 0)} selected</legend>
              {connection.repositories.map(repo => <label key={repo.id} style={{ display: "flex", gap: 8, alignItems: "flex-start", overflowWrap: "anywhere" }}><input type="checkbox" checked={(ownReceipt?.input.repositoryIds ?? (selectionCurrent ? selected : [])).includes(repo.id)} onChange={() => { setSelectedVersion(connection.catalogVersion); setSelected(prior => !selectionCurrent ? [repo.id] : prior.includes(repo.id) ? prior.filter(id => id !== repo.id) : [...prior, repo.id]); }}/><span>{repo.name}<small style={{ display: "block" }}>{repo.url}</small></span></label>)}
            </fieldset></>}
        </>}
      {ownReceipt && !retryable && <p role="alert">The original scope or catalogue is no longer available. The saved attempt remains unresolved; no new approval is inferred.</p>}
      {selected.length > 100 && <p role="alert">Select at most 100 repositories for this attachment.</p>}
      {!receipt && selected.length > 0 && !selectionCurrent && <p role="alert">The catalogue changed. Review and select repositories again before approving.</p>}
      <footer className="connection-footer" style={{ flexDirection: "row", justifyContent: "flex-end", flexWrap: "wrap", gap: 8 }}>
        <IconButton icon="refresh" label="Reload saved catalogue" tooltip="Reload previously reviewed choices. This does not contact the provider." disabled={busy || query.isFetching} onClick={() => { if (owns()) void query.refetch(); }}/>
        <button type="button" className="btn-primary" disabled={busy || storageError || loadedKey !== key || !data || !fresh || (receipt ? !retryable : !selectionCurrent || !selected.length || selected.length > 100)} onClick={attach}>{busy ? "Attaching…" : receipt ? "Retry saved attachment" : "Approve attachment"}</button>
      </footer>
    </Modal>
  </section>;
}
