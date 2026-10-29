"use client";
import { ActionButton } from "./ui/ActionButton";

import { useEffect, useRef, useState } from "react";
import { trpcReact, type RouterInputs, type RouterOutputs } from "@/lib/trpcReact";
import { useCaseFieldAccess } from "@/lib/use-case-field-access";

type Access = ReturnType<typeof useCaseFieldAccess>;
type Resolve = RouterInputs["importJobs"]["resolveMapping"];
type Candidate = Resolve["rows"][number]["candidate"];
type QueueRow = RouterOutputs["importJobs"]["mappingQueue"]["rows"][number];
const fieldStyle = { display: "grid", gap: 6, minWidth: 0 };
const inputStyle = { width: "100%", minWidth: 0, boxSizing: "border-box" as const };
type PendingWrite = { kind: "resolve"; input: Resolve } | { kind: "confirm"; input: RouterInputs["importJobs"]["confirmMapping"] };

function SourceCells({ original }: { original: QueueRow["original"] }) {
  const source = original as { headers?: unknown; cells?: unknown };
  if (!Array.isArray(source.headers) || !Array.isArray(source.cells)) return null;
  return <dl>{source.cells.map((value, index) => <div key={index}><dt>{String((source.headers as unknown[])[index] ?? `Column ${index + 1}`)}</dt><dd style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{String(value)}</dd></div>)}</dl>;
}

function QueueEditor({ projectId, batchId, access, onCommitted }: { projectId: string; batchId: string; access: Access; onCommitted: () => void }) {
  const origin = access.origin;
  const pins = { projectId, originalOrganizationId: origin?.organizationId ?? "", expectedClerkActorId: origin?.clerkActorId ?? "", batchId };
  const query = trpcReact.importJobs.mappingQueue.useQuery(pins, { enabled: access.canEdit, retry: false, refetchOnWindowFocus: false });
  const resolve = trpcReact.importJobs.resolveMapping.useMutation();
  const confirm = trpcReact.importJobs.confirmMapping.useMutation();
  const [edits, setEdits] = useState<Record<string, Candidate>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [request, setRequest] = useState<PendingWrite | null>(null);
  const [receipt, setReceipt] = useState<RouterOutputs["importJobs"]["resolveMapping"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refused, setRefused] = useState(false);
  const busy = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const data = access.canEdit && !query.isFetching && !query.isPaused && !query.error ? query.data : null;
  const frozen = Boolean(request);
  function edit(row: QueueRow, patch: Partial<Candidate>) {
    if (!row.candidate || frozen) return;
    setEdits(current => ({ ...current, [row.id]: { ...(current[row.id] ?? row.candidate!), ...patch } }));
  }
  async function apply() {
    if (!origin || !access.owns(origin, "edit") || busy.current || receipt || (!data && !request)) return;
    const base = { ...pins, requestId: crypto.randomUUID(), expectedDigest: data?.digest ?? "" };
    const retained: PendingWrite = request ?? (data!.state === "DRAFT" ? { kind: "confirm", input: base } : { kind: "resolve", input: {
      ...base, rows: data!.rows.filter(row => selected.has(row.id) && row.candidate).map(row => ({ id: row.id, candidate: edits[row.id] ?? row.candidate! })),
    } });
    if (retained.kind === "resolve" && (!retained.input.rows.length || retained.input.rows.length > 100)) return;
    setRequest(retained); setError(null); setRefused(false); busy.current = true;
    try {
      const result = retained.kind === "resolve" ? await resolve.mutateAsync(retained.input) : await confirm.mutateAsync(retained.input);
      if (mounted.current) setReceipt(result);
      if (mounted.current && access.owns(origin, "edit")) onCommitted();
    } catch (e) { if (mounted.current) {
      setError(e instanceof Error ? e.message : "No confirmed receipt. Retry this same request.");
      const code = (e as { data?: { code?: string } })?.data?.code;
      setRefused(code === "BAD_REQUEST" || code === "CONFLICT");
    } }
    finally { busy.current = false; }
  }
  async function refresh() {
    // A recorded receipt or explicit transactional refusal can be revised. An
    // ambiguous transport outcome keeps its exact immutable request for Retry.
    if (request && !receipt) return;
    setEdits({}); setSelected(new Set()); setRequest(null); setReceipt(null); setError(null);
    await query.refetch();
  }
  const pending = resolve.isPending || confirm.isPending;
  if (!access.canEdit) return <p>Queue details are hidden until original access is verified.</p>;
  return <section aria-label="Mapping rows">
    {query.error && <p role="alert">{query.error.message}</p>}
    <ActionButton type="button" tooltip="Refresh saved mapping rows" className="btn-secondary" disabled={pending || query.isFetching || Boolean(request && !receipt)} onClick={() => void refresh()}>Refresh rows</ActionButton>
    {receipt && <p role="status">{receipt.createdCount} created · {receipt.updatedCount} updated · {receipt.pendingCount} queued. Refresh to continue.</p>}
    {data && <>
      <p>{data.pendingCount} need mapping · {data.contextCount} context rows · {data.historyCount} historical rows</p>
      {data.state === "DRAFT" ? <><p>{data.readyCount} cases are ready. Confirm once to import them and keep uncertain rows here.</p>
        <button disabled={pending || Boolean(receipt)} onClick={() => void apply()}>{pending ? "Saving…" : request ? "Retry" : "Import"}</button></> : <>
        {data.rows.length === 0 && <p>No unresolved rows.</p>}
        {data.rows.map(row => {
          const value = edits[row.id] ?? row.candidate;
          return <details key={row.id} style={{ marginBlock: 12 }}>
            <summary>{row.sheet || "Source"} · Row {row.originalRowNumber} · {value?.title || (row.state === "HISTORY" ? "Historical observations" : "Needs mapping")}</summary>
            {row.reasons.map((reason, i) => <p key={i}>{reason}</p>)}
            {value && <fieldset disabled={frozen || pending} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))", gap: 16, minWidth: 0, padding: 16, border: "1px solid var(--line)" }}>
              <label style={{ gridColumn: "1 / -1" }}><input type="checkbox" checked={selected.has(row.id)} disabled={!selected.has(row.id) && selected.size >= 100}
                onChange={e => setSelected(current => { const next = new Set(current); if (e.target.checked) next.add(row.id); else next.delete(row.id); return next; })} /> Include row</label>
              <label style={fieldStyle}>Title<input style={inputStyle} value={value.title} maxLength={16384} onChange={e => edit(row, { title: e.target.value })} /></label>
              <label style={fieldStyle}>Source ID<input style={inputStyle} value={value.externalId ?? ""} maxLength={16384} onChange={e => edit(row, { externalId: e.target.value })} /></label>
              {(["given", "when", "then"] as const).map((field, i) => <label key={field} style={fieldStyle}>{["Preconditions", "Actions", "Expected results"][i]}
                <textarea style={inputStyle} rows={3} value={value[field].join("\n")} maxLength={16384} onChange={e => edit(row, { [field]: e.target.value ? [e.target.value] : [] })} /></label>)}
              <label style={fieldStyle}>Priority<select style={inputStyle} value={value.priority} onChange={e => edit(row, { priority: e.target.value as Candidate["priority"] })}>
                {["CRITICAL", "HIGH", "MEDIUM", "LOW"].map(priority => <option key={priority}>{priority}</option>)}</select></label>
              <label style={fieldStyle}>Suite<input style={inputStyle} value={value.suitePath ?? ""} maxLength={16384} onChange={e => edit(row, { suitePath: e.target.value })} /></label>
            </fieldset>}
            {row.state === "HISTORY" && <p>Case {row.caseId} is imported. These source observations still need pairing in historical import.</p>}
            <details><summary>Source</summary><SourceCells original={row.original} /></details>
          </details>;
        })}
        {data.rows.some(row => row.candidate) && <button disabled={pending || Boolean(receipt) || (!request && selected.size === 0)} onClick={() => void apply()}>
          {pending ? "Saving…" : request ? "Retry" : "Import"}</button>}
      </>}
    </>}
    {!data && !query.error && <p role="status">Checking queue…</p>}
    {error && <p role="alert">{error} Retry preserves the same request.</p>}
    {refused && <button disabled={pending} onClick={() => { setRequest(null); setRefused(false); setError(null); void query.refetch(); }}>Revise</button>}
  </section>;
}

export function ImportMappingQueue({ projectId, onCommitted }: { projectId: string; onCommitted: () => void }) {
  const access = useCaseFieldAccess(projectId);
  const origin = access.origin;
  const list = trpcReact.importJobs.mappingQueues.useQuery({ projectId,
    originalOrganizationId: origin?.organizationId ?? "", expectedClerkActorId: origin?.clerkActorId ?? "" },
  { enabled: access.canEdit, retry: false, refetchOnWindowFocus: false });
  const [batchId, setBatchId] = useState<string | null>(null);
  const available = access.canEdit && !list.isFetching && !list.isPaused && !list.error ? list.data : null;
  return <section className="panel" aria-label="Mapping queue" style={{ marginBlock: 20 }}>
    <h2>Mapping queue</h2>
    {!access.canEdit ? <p>Verify original access to view saved rows.</p> : <>
      <ActionButton type="button" tooltip="Refresh saved import list" className="btn-secondary" disabled={list.isFetching} onClick={() => void list.refetch()}>Refresh imports</ActionButton>
      {list.error && <p role="alert">{list.error.message}</p>}
      {available?.length === 0 && <p>No queued imports.</p>}
      {available && available.length > 0 && <label style={{ ...fieldStyle, marginBlock: 12, maxWidth: 400 }}>Import<select style={inputStyle} value={batchId ?? ""} onChange={e => setBatchId(e.target.value || null)}>
        <option value="">Choose an import</option>{available.map(batch => <option key={batch.id} value={batch.id}>{batch.sourceLabel || "Untitled import"}</option>)}</select></label>}
    </>}
    {/* Keep the original editor mounted while access is rechecked. */}
    {batchId && <QueueEditor key={batchId} projectId={projectId} batchId={batchId} access={access} onCommitted={onCommitted} />}
  </section>;
}
