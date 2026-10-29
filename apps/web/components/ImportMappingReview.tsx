"use client";

import { useEffect, useRef, useState } from "react";
import { trpcReact, type RouterInputs, type RouterOutputs } from "@/lib/trpcReact";
import { useCaseFieldAccess } from "@/lib/use-case-field-access";

type Prepare = RouterInputs["importJobs"]["prepareMapping"];
type Confirm = RouterInputs["importJobs"]["confirmMapping"];
export type ImportMappingSource = Prepare["source"];

// The mounted review owns one source and one request. A late response may settle
// its private receipt, but cannot navigate or refresh another actor's view.
export function ImportMappingReview({ projectId, sourceLabel, source, onBack, onCommitted }: {
  projectId: string; sourceLabel: string; source: ImportMappingSource; onBack: () => void; onCommitted: () => void;
}) {
  const access = useCaseFieldAccess(projectId);
  const [frozen] = useState(() => structuredClone({ sourceLabel, source }));
  const prepare = trpcReact.importJobs.prepareMapping.useMutation();
  const confirm = trpcReact.importJobs.confirmMapping.useMutation();
  const cancel = trpcReact.importJobs.cancelMapping.useMutation();
  const request = useRef<Prepare | null>(null);
  const write = useRef<{ kind: "confirm" | "cancel"; input: Confirm } | null>(null);
  const busy = useRef(false);
  const mounted = useRef(true);
  const [working, setWorking] = useState(false);
  const [summary, setSummary] = useState<RouterOutputs["importJobs"]["prepareMapping"] | null>(null);
  const [receipt, setReceipt] = useState<RouterOutputs["importJobs"]["confirmMapping"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  async function stage() {
    const origin = access.origin;
    if (!origin || !access.owns(origin, "edit") || busy.current) return;
    request.current ??= { projectId, originalOrganizationId: origin.organizationId,
      expectedClerkActorId: origin.clerkActorId, requestId: crypto.randomUUID(), ...frozen };
    busy.current = true; setWorking(true); setError(null);
    try { const result = await prepare.mutateAsync(request.current); if (mounted.current) setSummary(result); }
    catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : "Could not prepare this import."); }
    finally { busy.current = false; if (mounted.current) setWorking(false); }
  }
  useEffect(() => {
    if (access.canEdit && !request.current) void stage();
    // A newly settled original access read starts this mounted review once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [access.canEdit]);

  const [pendingKind, setPendingKind] = useState<"confirm" | "cancel" | null>(null);
  async function submit(kind: "confirm" | "cancel") {
    const origin = access.origin;
    if (!origin || !access.owns(origin, "edit") || !summary || busy.current || receipt) return;
    if (write.current && write.current.kind !== kind) return;
    write.current ??= { kind, input: { projectId, originalOrganizationId: origin.organizationId,
      expectedClerkActorId: origin.clerkActorId, batchId: summary.id, expectedDigest: summary.digest, requestId: crypto.randomUUID() } };
    setPendingKind(write.current.kind);
    busy.current = true; setWorking(true); setError(null);
    try {
      if (kind === "cancel") {
        await cancel.mutateAsync(write.current.input);
        if (mounted.current && access.owns(origin, "edit")) onBack();
      } else {
        const result = await confirm.mutateAsync(write.current.input);
        if (mounted.current) setReceipt(result);
        if (mounted.current && access.owns(origin, "edit")) onCommitted();
      }
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : "No confirmed receipt. Retry this same request."); }
    finally { busy.current = false; if (mounted.current) setWorking(false); }
  }
  if (!access.canEdit) return <section aria-label="Import summary"><p>Import details are hidden until original access is verified.</p>
    <button onClick={() => void access.query.refetch()} disabled={access.query.isFetching}>Refresh</button></section>;
  return <section aria-label="Import summary">
    <h3>Import summary</h3>
    {receipt ? <><p role="status">{receipt.createdCount} created · {receipt.updatedCount} updated · {receipt.pendingCount} queued</p>
      {receipt.historyCount > 0 && <p>{receipt.historyCount} rows retain historical observations for separate pairing.</p>}
      <button onClick={onBack}>Done</button></> : <>
      {summary ? <><p>{summary.readyCount} ready · {summary.pendingCount} need mapping · {summary.contextCount} context rows</p>
        <p>Import ready cases now. Uncertain rows stay in your mapping queue.</p>
        <details><summary>Details</summary><p>{summary.sourceLabel}</p>
          <p>Original source cells are retained for unresolved rows. Context rows are not created as cases. Ordinary case approval stays separate from mapping.</p>
          {summary.historyCount > 0 && <p>Historical observations are retained; this confirmation imports cases only.</p>}
          <p>Existing human edits are preserved. No source rows are deleted.</p></details>
        <div className="button-row" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
          <button disabled={working || Boolean(pendingKind && pendingKind !== "confirm")} onClick={() => void submit("confirm")}>
            {working ? "Saving…" : pendingKind === "confirm" ? "Retry" : "Import"}</button>
          <button className="btn-secondary" disabled={working || Boolean(pendingKind && pendingKind !== "cancel")} onClick={() => void submit("cancel")}>
            {pendingKind === "cancel" ? "Retry back" : "Back"}</button>
        </div></> : <p role="status">{working ? "Preparing summary…" : "Summary unavailable."}</p>}
      {!summary && error && <button disabled={working} onClick={() => void stage()}>Retry</button>}
    </>}
    {error && <p role="alert">{error}{pendingKind && " Retry uses the same request; no second import is started."}</p>}
  </section>;
}
