"use client";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { Modal } from "./Modal";
import { trpcReact } from "@/lib/trpcReact";
import { manualCaseAckMatches, manualCaseReadMatches } from "@/lib/manual-case-result-ack";
import { parseStepMeasurements, type StepReading } from "@/lib/step-execution-form";
import { manualCaseResultWriteSchema, type ManualCaseResultRead, type ManualCaseResultWrite, type ManualCaseResultPreview, type ManualCaseResultAck } from "@vaettir/api/src/services/manualCaseResultSchema";
type Draft = { baseline: ManualCaseResultPreview; status: ManualCaseResultWrite["status"] | ""; note: string; reason: string;
  context: Omit<ManualCaseResultWrite["observations"], "measurements">; readings: StepReading[] };
const fullField = { width: "100%", boxSizing: "border-box" as const, minWidth: 0 };
const sameScope = (a: ManualCaseResultRead["expectedScope"] | null, b: ManualCaseResultRead["expectedScope"] | null) => !!a && !!b && a.projectId === b.projectId && a.organizationId === b.organizationId && a.clerkActorId === b.clerkActorId;
/** Keep keyed project/run/case and mounted through parent refresh. No reload-durable drafts. */
export function ManualCaseResultHistory({ projectId, testRunId, testCaseId, active = true, disabled = false, onUnconfirmedChange, onChanged }: {
  projectId: string; testRunId: string; testCaseId: string; active?: boolean; disabled?: boolean; onUnconfirmedChange?: (pending: boolean) => void; onChanged?: () => Promise<unknown>;
}) {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const utils = trpcReact.useUtils();
  const [nativeOrigin] = useState({ projectId, testRunId, testCaseId });
  const nativeSame = nativeOrigin.projectId === projectId && nativeOrigin.testRunId === testRunId && nativeOrigin.testCaseId === testCaseId;
  const project = trpcReact.project.byId.useQuery({ id: projectId }, { enabled: active, staleTime: 0, retry: false });
  const organizations = trpcReact.organization.mine.useQuery(undefined, { enabled: active, staleTime: 0, retry: false });
  const [origin, setOrigin] = useState<ManualCaseResultRead["expectedScope"] | null>(null);
  const projectReady = !project.error && !project.isFetching && !project.isPaused && project.data?.id === projectId;
  const memberReady = !organizations.error && !organizations.isFetching && !organizations.isPaused;
  const member = memberReady ? organizations.data?.find(row => row.id === project.data?.organizationId) : null;
  const readable = !!member && ["OWNER", "ADMIN", "EDITOR", "VIEWER", "COMPLIANCE_AUDITOR"].includes(member.role) && ["FULL", "READ_ONLY"].includes(member.seatType);
  const current = active && isLoaded && isSignedIn && userId && projectReady && readable ? { projectId, organizationId: project.data!.organizationId, clerkActorId: userId } : null;
  useEffect(() => { if (!origin && current) setOrigin(current); }, [origin, current]);
  const ready = active && nativeSame && sameScope(origin, current);
  const editor = !disabled && readable && member?.seatType === "FULL" && ["OWNER", "ADMIN", "EDITOR"].includes(member.role);
  const [before, setBefore] = useState<string | undefined>();
  const [limit, setLimit] = useState(10);
  const read = { projectId, testRunId, testCaseId, expectedScope: origin ?? { projectId, organizationId: "pending", clerkActorId: "pending" }, before, limit };
  const history = trpcReact.manualCaseResults.history.useQuery(read, { enabled: ready, staleTime: 0, retry: false });
  const page = ready && !history.error && !history.isFetching && !history.isPaused && history.data && manualCaseReadMatches(read, history.data) ? history.data : null;
  const denied = !!history.error && ["FORBIDDEN", "UNAUTHORIZED", "NOT_FOUND"].includes(history.error.data?.code ?? "");
  const available = ready && !denied && !history.error && !history.isFetching && !history.isPaused && !!page;
  const accessNow = useRef({ available, origin, editor }); accessNow.current = { available, origin, editor };
  const [open, setOpen] = useState(false), [screen, setScreen] = useState<"EDIT" | "REVIEW">("EDIT");
  const [draft, setDraft] = useState<Draft | null>(null), [attempt, setAttempt] = useState<ManualCaseResultWrite | null>(null);
  const [receipt, setReceipt] = useState<ManualCaseResultAck | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [definitive, setDefinitive] = useState(false), [accessRejected, setAccessRejected] = useState(false), [refreshNotice, setRefreshNotice] = useState("");
  const unknown = useRef(false), openNow = useRef(false); openNow.current = open;
  const currentClerk = useRef(userId); currentClerk.current = userId;
  const mutation = trpcReact.manualCaseResults.record.useMutation();
  useEffect(() => { onUnconfirmedChange?.(busy || !!attempt && !receipt && (!definitive || unknown.current)); }, [busy, attempt, receipt, definitive, onUnconfirmedChange]);
  async function refreshAccess() {
    if (!nativeSame || !active) return false; // Never fetch/rebase a retained workflow onto new props.
    try {
      const [p, o, h] = await Promise.all([project.refetch(), organizations.refetch(), history.refetch()]);
      return !!origin && currentClerk.current === origin.clerkActorId && !p.error && !p.isFetching && !p.isPaused && p.data?.id === projectId && p.data.organizationId === origin.organizationId &&
        !o.error && !o.isFetching && !o.isPaused && !!o.data?.some(row => row.id === origin.organizationId && row.seatType === "FULL" && ["OWNER", "ADMIN", "EDITOR"].includes(row.role)) &&
        !h.error && !h.isFetching && !h.isPaused && !!h.data && manualCaseReadMatches(read, h.data);
    } catch { setError("Current access could not be refreshed. The draft and original request remain retained."); return false; }
  }
  async function loadReview(confirmedNext = false) {
    if (!available || !editor || !origin || busy || ((!confirmedNext || !receipt) && (attempt || draft || receipt))) return;
    setOpen(true); openNow.current = true; setBusy(true); setError("");
    const input = { projectId, testRunId, testCaseId, expectedScope: origin };
    try {
      const value = await utils.manualCaseResults.preview.fetch(input, { staleTime: 0 });
      if (!accessNow.current.available || !accessNow.current.editor || !openNow.current || !sameScope(input.expectedScope, accessNow.current.origin)) throw Error("Original access or the open review changed. No approval baseline was replaced.");
      if (!manualCaseReadMatches(input, value) || !value.canWrite) throw Error("The exact current manual observation scope could not be verified.");
      const o = value.current?.observations;
      setDraft({ baseline: value, status: value.current?.status ?? "", note: value.current?.note ?? "", reason: "",
        context: { specimen: o?.specimen ?? "", hardwareRevision: o?.hardwareRevision ?? "", firmwareVersion: o?.firmwareVersion ?? "", environment: o?.environment ?? "" },
        readings: (o?.measurements ?? []).map(m => ({ ...m, value: String(m.value), lowerLimit: m.lowerLimit === undefined ? "" : String(m.lowerLimit), upperLimit: m.upperLimit === undefined ? "" : String(m.upperLimit) })) });
      if (confirmedNext && receipt) { setAttempt(null); setReceipt(null); setDefinitive(false); setRefreshNotice(""); setScreen("EDIT"); }
    } catch (e) { if (["FORBIDDEN", "UNAUTHORIZED", "NOT_FOUND"].includes((e as { data?: { code?: string } }).data?.code ?? "")) setAccessRejected(true); setError(e instanceof Error ? e.message : "Current observations could not be reviewed."); }
    finally { setBusy(false); }
  }
  const locked = busy || !!attempt || !!receipt;
  function update(change: Partial<Draft>) { if (!locked) { setDraft(d => d ? { ...d, ...change } : d); setScreen("EDIT"); } }
  function buildRequest(): ManualCaseResultWrite {
    if (!draft || !origin || !draft.status) throw Error("Choose the observed whole-case status explicitly.");
    if (draft.baseline.current && !draft.reason.trim()) throw Error("Explain the reason for correcting the retained observation.");
    return manualCaseResultWriteSchema.parse({ projectId, testRunId, testCaseId, expectedScope: origin, expectedRevisionId: draft.baseline.currentRevisionId,
      expectedCurrentFingerprint: draft.baseline.currentFingerprint, status: draft.status, note: draft.note || null, correctionReason: draft.reason.trim() || null,
      observations: { ...draft.context, measurements: parseStepMeasurements(draft.readings, draft.status) }, idempotencyKey: crypto.randomUUID() });
  }
  async function save() {
    if (!available || !editor || accessRejected || !open || !draft || screen !== "REVIEW" || busy || receipt || definitive) return;
    let input: ManualCaseResultWrite;
    try { input = attempt ?? buildRequest(); } catch (e) { setError(e instanceof Error ? e.message : "Review the entered evidence."); return; }
    if (!sameScope(input.expectedScope, origin)) { setError("Restore the exact original actor and organization before retrying; request was not rebound."); return; }
    setAttempt(input); setBusy(true); setError(""); onUnconfirmedChange?.(true);
    try {
      const value = await mutation.mutateAsync(input);
      if (!await manualCaseAckMatches(input, draft.baseline.revisionNumber + 1, value, draft.baseline.current?.resultId, draft.baseline.scope.actorId)) { unknown.current = true; setError("The exact correction receipt could not be verified. Keep and retry the identical UUID; a saved response may be unknown."); return; }
      setReceipt(value); unknown.current = false; setDefinitive(false); onUnconfirmedChange?.(false);
      void Promise.all([Promise.resolve().then(() => utils.manualCaseResults.history.invalidate({ projectId, testRunId, testCaseId })),
        Promise.resolve().then(() => utils.manualCaseResults.preview.invalidate({ projectId, testRunId, testCaseId })), Promise.resolve().then(() => onChanged?.())])
        .catch(() => setRefreshNotice("The revision is confirmed, but refreshing the native view failed. Refresh without resubmitting the accepted correction."));
    } catch (e) {
      const code = (e as { data?: { code?: string } }).data?.code ?? "";
      if (["FORBIDDEN", "UNAUTHORIZED", "NOT_FOUND"].includes(code)) setAccessRejected(true);
      const known = ["BAD_REQUEST", "CONFLICT", "FORBIDDEN", "UNAUTHORIZED", "NOT_FOUND"].includes(code);
      if (known && !unknown.current) setDefinitive(true); else unknown.current = true;
      setError(`${e instanceof Error ? e.message : "Correction response unknown."} ${unknown.current ? "Retry the exact retained UUID after restoring original access." : "Retain the draft and explicitly re-review current observations."}`);
    } finally { setBusy(false); }
  }
  async function reviewRejected() {
    if (!available || !editor || !draft || !definitive || unknown.current || busy || receipt || !origin) return;
    setBusy(true);
    try {
      const input = { projectId, testRunId, testCaseId, expectedScope: origin }, value = await utils.manualCaseResults.preview.fetch(input, { staleTime: 0 });
      if (!accessNow.current.available || !accessNow.current.editor || !openNow.current || !sameScope(origin, accessNow.current.origin) || !manualCaseReadMatches(input, value) || !value.canWrite) throw Error("Current original scope could not be verified; exact rejected request remains retained.");
      // Explicit new review preserves human fields but replaces only the refused baseline.
      setDraft(d => d ? { ...d, baseline: value } : d); setAttempt(null); setDefinitive(false); setAccessRejected(false); setScreen("EDIT"); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Current baseline unavailable; draft remains retained."); }
    finally { setBusy(false); }
  }
  return <section style={{ minWidth: 0, overflowWrap: "anywhere" }}>
    <h3>Whole-case observation history</h3>
    {ready && !denied && <label style={{ display: "block" }}>History page size<select disabled={busy || !!attempt && !receipt && !definitive} value={limit} onChange={e => { setLimit(Number(e.target.value)); setBefore(undefined); }}>{[1, 5, 10, 20].map(n => <option key={n} value={n}>{n} revisions</option>)}</select><span className="text-muted"> Choose fewer revisions if the complete page exceeds its evidence size limit.</span></label>}
    {!nativeSame ? <p role="alert">The project, run or case changed. This exact original workflow was not rebound; restore the original selection to recover retained drafts or requests.</p>
    : history.error ? <p role="alert">{denied ? "Current history access was refused. Private prior observations are hidden." : "History could not be verified, not an empty history."} <button type="button" onClick={() => void refreshAccess()}>Retry current history access</button></p>
    : project.isPaused || organizations.isPaused || history.isPaused ? <p role="status">Waiting for a connection to verify original access. Private cached observations are hidden; drafts and exact requests remain retained.</p>
    : !ready ? <p role="status">Current original actor and organization must be verified. Private observations are hidden; exact local requests and drafts remain retained. <button type="button" onClick={() => void refreshAccess()}>Recheck access</button></p>
    : history.isFetching || !history.data ? <p role="status">Checking the exact native observation history…</p>
    : !page ? <p role="alert">The returned history did not match the exact original actor, organization or page. Private evidence is withheld. <button type="button" onClick={() => void refreshAccess()}>Retry exact history</button></p> : <>
      <p>Corrections retain earlier evidence; they are not new executions, defect resolutions or qualified sign-offs.</p>
      {page.revisions.length === 0 ? <p>No immutable whole-case revisions were recorded. An older result may still exist; its prior author/time have not been reconstructed.</p> : <ol>{page.revisions.map(r => <li key={r.id}><strong>Revision {r.revisionNumber} · {r.result.status}</strong> · {r.actorLabel} · {new Date(r.recordedAt).toLocaleString()}<p style={{ whiteSpace: "pre-wrap" }}>{r.result.note || "No note"}</p>{r.correctionReason && <p>Reason: {r.correctionReason}</p>}<details><summary>Recorded observations</summary><pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(r.result.observations, null, 2)}</pre></details>{r.legacyPrior && <details><summary>Previous unversioned observation captured at this correction</summary><p>Original recorder/time unknown; this is not a backfilled execution or approval.</p><p>{r.legacyPrior.captured.status}: {r.legacyPrior.captured.note || "No note"}</p><pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(r.legacyPrior.captured.observations, null, 2)}</pre></details>}</li>)}</ol>}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}><button type="button" disabled={!before} onClick={() => setBefore(undefined)}>Latest revisions</button><button type="button" disabled={!page.nextCursor} onClick={() => setBefore(page.nextCursor ?? undefined)}>Older revisions</button>
      {editor && page.canWrite && <button type="button" onClick={() => { if (draft || attempt || receipt) setOpen(true); else void loadReview(); }}>Review whole-case observation</button>}</div>
      {!page.canWrite && <p>Read-only history. New observation revisions require an active run and current full-editor access.</p>}
    </>}
    <Modal open={open && active} onClose={() => setOpen(false)} title="Review whole-case observation" size="wide" dismissible={!busy}>
      {!available || !editor || accessRejected ? <p role="status">Current original full-editor access is unavailable. Private baseline/actions are hidden; local evidence and UUID remain retained. <button type="button" onClick={async () => { if (await refreshAccess()) setAccessRejected(false); }}>Recheck original access</button></p> : <>
      {error && <p role="alert">{error}</p>}{receipt ? <section><h3>Revision {receipt.revisionNumber} confirmed</h3><p>Prior observations retained. No test was run and no defect was declared resolved.</p>{refreshNotice && <p role="alert">{refreshNotice}</p>}<button type="button" onClick={() => void refreshAccess()}>Refresh current view, not correction</button>{page?.canWrite && <button type="button" disabled={busy} onClick={() => void loadReview(true)}>Review another correction against current evidence</button>}</section> : !draft ? <p role="status">{busy ? "Loading current observation…" : "No verified baseline available."}</p>
      : screen === "EDIT" ? <section><p>{draft.baseline.displayId} · {draft.baseline.current ? "Correct existing observation" : "Record initial observation"}</p>
      {!draft.baseline.tracked && draft.baseline.current && <p>Earlier result is unversioned. Its exact prior mutable evidence will be retained now, without inventing the original recorder/time.</p>}
      <label style={{ display: "block" }}>Observed status<select style={fullField} disabled={locked} value={draft.status} onChange={e => update({ status: e.target.value as Draft["status"] })}><option value="">Choose observed status</option>{["PASS", "FAIL", "BLOCKED", "SKIP"].map(s => <option key={s}>{s}</option>)}</select></label>
      <label style={{ display: "block" }}>What actually happened<textarea style={fullField} rows={3} maxLength={10000} disabled={locked} value={draft.note} onChange={e => update({ note: e.target.value })} /></label>
      {Object.entries(draft.context).map(([key, value]) => <label key={key} style={{ display: "block" }}>{key.replace(/([A-Z])/g, " $1")}<input style={fullField} disabled={locked} value={value} onChange={e => update({ context: { ...draft.context, [key]: e.target.value } })} /></label>)}
      <details><summary>Measured evidence ({draft.readings.length})</summary>{draft.readings.map((m, i) => <fieldset key={i} disabled={locked} style={{ minWidth: 0 }}><legend>Reading {i + 1}</legend>{["name", "unit", "value", "lowerLimit", "upperLimit", "instrument"].map(key => <label key={key} style={{ display: "block" }}>{key}<input style={fullField} value={String(m[key as keyof StepReading] ?? "")} onChange={e => update({ readings: draft.readings.map((r, n) => n === i ? { ...r, [key]: e.target.value } : r) })} /></label>)}<button type="button" onClick={() => update({ readings: draft.readings.filter((_, n) => n !== i) })}>Remove reading</button></fieldset>)}<button type="button" disabled={locked || draft.readings.length >= 100} onClick={() => update({ readings: [...draft.readings, { name: "", unit: "", value: "", lowerLimit: "", upperLimit: "", instrument: "" }] })}>Add reading</button></details>
      <label style={{ display: "block" }}>Human correction reason{draft.baseline.current ? " (required)" : " (optional)"}<textarea style={fullField} rows={2} maxLength={2000} disabled={locked} value={draft.reason} onChange={e => update({ reason: e.target.value })} /></label>
      <button type="button" disabled={locked} onClick={() => { try { buildRequest(); setScreen("REVIEW"); setError(""); } catch (e) { setError(e instanceof Error ? e.message : "Review the entered observation."); } }}>Review before recording</button></section>
      : <section><h3>Confirm one immutable observation revision</h3><p>{draft.status} · {draft.baseline.displayId}</p><p style={{ whiteSpace: "pre-wrap" }}>{draft.note || "No note"}</p><p>Reason: {draft.reason || "Initial observation; no correction reason"}</p><details><summary>Exact measured evidence</summary><pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify({ ...draft.context, measurements: draft.readings }, null, 2)}</pre></details><p>Earlier results remain evidence. This records a human observation, not execution automation or a qualified electronic signature.</p>{attempt && <p role="status">Exact original request remains retained. Retrying does not create another revision; reloading does not preserve this local draft.</p>}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}><button type="button" disabled={locked} onClick={() => setScreen("EDIT")}>Edit draft</button><button type="button" disabled={busy || definitive} onClick={() => void save()}>{attempt ? "Retry identical observation request" : "Confirm and record revision"}</button>{definitive && !unknown.current && <button type="button" disabled={busy} onClick={() => void reviewRejected()}>Review current baseline; retain my draft</button>}</div></section>}
      </>}
    </Modal>
  </section>;
}
