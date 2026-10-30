"use client";

import { ActionButton } from "@/components/ui/ActionButton";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { trpcReact, type RouterInputs, type RouterOutputs } from "@/lib/trpcReact";
import { definitiveSuggestionRefusal } from "@/lib/smart-suggestion-errors";
import { suggestedImportMapping } from "@/lib/reassign-import-column";

type Input = RouterInputs["caseSuggestions"]["recommend"];
type Review = RouterOutputs["caseSuggestions"]["recommend"];
type Selection = RouterInputs["caseSuggestions"]["applyReviewed"]["selections"][number];
type Suggestion = Review["suggestions"][number];
export type SmartImportCase = NonNullable<Input["cases"]>[number];
export type ImportSuggestionPatch = { id: string; reason: string; suitePath?: string; priority?: NonNullable<Suggestion["priority"]>; testType?: NonNullable<Suggestion["testType"]> };
const fields = ["suitePath", "priority", "testType"] as const;
const label = { suitePath: "Suite / subsuite", priority: "Priority", testType: "Test type" };
function useAvailability(projectId: string, organizationId: string | undefined) {
  const auth = useAuth(), utils = trpcReact.useUtils();
  const identity = JSON.stringify([projectId, organizationId, auth.userId, auth.sessionId]);
  const [state, setState] = useState<{ identity: string; configuration: RouterOutputs["caseSuggestions"]["configuration"] } | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (auth.isLoaded && auth.isSignedIn && auth.userId && organizationId) {
      void Promise.resolve().then(() => utils.client.caseSuggestions.configuration.query({ projectId, originalOrganizationId: organizationId, expectedClerkActorId: auth.userId! }))
        .then(result => { if (!cancelled) setState({ identity, configuration: result }); })
        .catch(() => { if (!cancelled) setState(null); });
    }
    return () => { cancelled = true; };
  }, [auth.isLoaded, auth.isSignedIn, auth.userId, organizationId, projectId, identity, utils.client]);
  return state?.identity === identity ? state.configuration : null;
}
function changes(review: Review): Selection[] {
  return review.suggestions.flatMap(s => {
    const before = review.before.find(c => c.id === s.id)!;
    const value = { id: s.id, suitePath: s.suitePath !== null && s.suitePath !== before.suitePath, priority: s.priority !== null && s.priority !== before.priority, testType: s.testType !== null && s.testType !== before.testType };
    return fields.some(f => value[f]) ? [value] : [];
  });
}
export function SmartCaseSuggestions({ projectId, cases, caseIds, onApplyImport, onSaved }: {
  projectId: string; cases?: SmartImportCase[]; caseIds?: string[];
  onApplyImport?: (patches: ImportSuggestionPatch[]) => void; onSaved?: () => void;
}) {
  const auth = useAuth(), utils = trpcReact.useUtils();
  const project = trpcReact.project.byId.useQuery({ id: projectId }, { retry: false, staleTime: 0 });
  const availability = useAvailability(projectId, project.data?.organizationId);
  const available = availability?.enabled;
  const key = JSON.stringify([projectId, auth.userId, auth.sessionId, cases, caseIds, availability?.policyVersion]);
  const latest = useRef(key);
  useLayoutEffect(() => { latest.current = key; }, [key]);
  const [consentKey, setConsentKey] = useState<string | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [progress, setProgress] = useState(0);
  const [notice, setNotice] = useState<{ identity: string; text: string } | null>(null);
  const identity = JSON.stringify([projectId, auth.userId, auth.sessionId]);
  const [draft, setDraft] = useState<{ key: string; scope: Pick<Input, "projectId" | "originalOrganizationId" | "expectedClerkActorId">; reviews: Review[]; selected: Record<string, Selection> } | null>(null);
  const [hasPending, setHasPending] = useState(false), [hasAnalysis, setHasAnalysis] = useState(false);
  const pending = useRef<Array<{ input: RouterInputs["caseSuggestions"]["applyReviewed"]; done: boolean; unknown: boolean }> | null>(null);
  const analysis = useRef<Array<Input> | null>(null);
  const analysisController = useRef<AbortController | null>(null);
  useEffect(() => () => { analysisController.current?.abort(); }, [key]);
  const count = cases?.length ?? caseIds?.length ?? 0;
  const consent = consentKey === key;
  const maximum = cases ? 2500 : 200;
  const analysisKey = useRef<string | null>(null);
  const ready = available && auth.isLoaded && auth.isSignedIn && Boolean(project.data) && !project.error && !project.isFetching && !project.isPaused;
  const visible = draft?.key === key && ready;
  async function analyze() {
    if (!consent || !availability?.canAnalyze || !ready || !auth.userId || !project.data || count === 0 || count > maximum || pending.current) return;
    const captured = key, scope = { projectId, originalOrganizationId: project.data.organizationId, expectedClerkActorId: auth.userId };
    const controller = new AbortController(); analysisController.current = controller;
    setBusy(true); setError(""); setNotice(null); setProgress(0);
    // Retain exact analysis request identities for uncertain provider outcomes.
    if (analysisKey.current !== captured) { analysis.current = null; analysisKey.current = captured; }
    analysis.current ??= Array.from({ length: Math.ceil(count / 20) }, (_, i) => ({ ...scope, requestId: crypto.randomUUID(), approved: true, expectedPolicyVersion: availability.policyVersion, ...(cases ? { cases: cases.slice(i * 20, i * 20 + 20) } : { caseIds: caseIds!.slice(i * 20, i * 20 + 20) }) }));
    setHasAnalysis(true);
    const reviews: Review[] = [];
    try {
      for (const input of analysis.current) {
        if (latest.current !== captured || controller.signal.aborted) return;
        const review = await utils.client.caseSuggestions.recommend.mutate(input, { signal: controller.signal });
        if (latest.current !== captured || controller.signal.aborted) return;
        reviews.push(review); setProgress(n => n + review.before.length);
      }
      setDraft({ key: captured, scope, reviews, selected: Object.fromEntries(reviews.flatMap(changes).map(s => [s.id, s])) });
      setConsentKey(null);
    } catch (cause) { if (latest.current === captured) setError(controller.signal.aborted ? "Analysis stopped. An in-flight provider request may have completed; no case changes were applied." : cause instanceof Error ? cause.message : "Suggestions could not finish. Nothing was applied."); }
    finally { if (analysisController.current === controller) analysisController.current = null; setBusy(false); }
  }
  function selectedPatches() {
    return (draft?.reviews ?? []).flatMap(review => review.suggestions.flatMap(s => {
      const selected = draft?.selected[s.id];
      if (!selected || !fields.some(f => selected[f])) return [];
      return [{ id: s.id, reason: s.reason, ...(selected.suitePath && s.suitePath ? { suitePath: s.suitePath } : {}), ...(selected.priority && s.priority ? { priority: s.priority } : {}), ...(selected.testType && s.testType ? { testType: s.testType } : {}) }];
    }));
  }
  async function apply() {
    if (!visible || !draft || busy) return;
    if (onApplyImport) { onApplyImport(selectedPatches()); setDraft(null); analysis.current = null; setHasAnalysis(false); return; }
    pending.current ??= [{ input: { ...draft.scope, requestId: crypto.randomUUID(), reviewIds: draft.reviews.map(r => r.reviewId), approved: true,
      selections: Object.values(draft.selected).filter(s => fields.some(f => s[f])) }, done: false, unknown: false }];
    setHasPending(true); setBusy(true); setError("");
    let changed = 0;
    try {
      for (const batch of pending.current) {
        if (batch.done) continue;
        if (latest.current !== draft.key) throw new Error("Restore the original account and case selection to reconcile the retained save.");
        const result = await utils.client.caseSuggestions.applyReviewed.mutate(batch.input);
        changed += result.changed;
        batch.done = true;
      }
      pending.current = null; analysis.current = null; setHasPending(false); setHasAnalysis(false); setDraft(null); setConsentKey(null);
      setNotice({ identity, text: `Reviewed changes confirmed for ${changed} ${changed === 1 ? "case" : "cases"}.` }); onSaved?.();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Save was not confirmed.";
      if (definitiveSuggestionRefusal(cause) && !pending.current?.some(p => p.unknown)) {
        pending.current = null; setHasPending(false);
        setError(`${message} The server refused this save before committing changes. Discard these suggestions and review the current cases.`);
      } else {
        for (const batch of pending.current ?? []) if (!batch.done) batch.unknown = true;
        setError(`${message} Retry uses the exact retained request. A confirmed save is acknowledged without applying it twice.`);
      }
    }
    finally { setBusy(false); }
  }
  if (draft && !visible) return <section className="panel"><p role="status">Restore the original signed-in account, workspace and source selection to review the retained suggestions. No changes will be sent from this view.</p></section>;
  if (!available) return null;
  return <details className="panel smart-case-suggestions" open>
    <summary>Suggest suites, subsuites, priorities and test types</summary>
    {notice?.identity === identity && <p role="status">{notice.text}</p>}
    <p>Vaettir proposes placement based on each case’s complete procedure and expected outcome, using existing suites first. Review the explanations and select changes before applying. Suggestions do not verify the tests.</p>
    {!draft && <>
      <p>{availability?.reason}</p><p>{count > maximum ? `Choose at most ${maximum} cases for one review, using the case selection or filters. ` : ""}{count} selected cases. Suggestions are included without deducting AI credits. Work runs in batches of 20, up to {maximum.toLocaleString()} selected cases.</p>
      <label><input type="checkbox" checked={consent} disabled={busy} onChange={e => { setConsentKey(e.target.checked ? key : null); analysis.current = null; setHasAnalysis(false); }} /> I approve sending these selected case definitions, tags, current placement and project suite names to Vaettir’s configured Anthropic AI provider for suggestions. This approval does not grant plugin access or apply changes.</label>
      <p><ActionButton type="button" className="btn-primary" disabled={!consent || !availability?.canAnalyze || !ready || busy || !count || count > maximum} onClick={() => void analyze()} tooltip={<> {busy ? `Reviewing ${progress} of ${count}…` : hasAnalysis ? "Retry suggestion review" : "Generate suggestions"} </>}>{busy ? "Reviewing…" : hasAnalysis ? "Retry" : "Generate suggestions"}</ActionButton></p>
      {busy && <button type="button" className="btn-secondary" onClick={() => { analysisController.current?.abort(); analysis.current = null; setHasAnalysis(false); setConsentKey(null); }}>Stop analysis</button>}
    </>}
    {visible && draft && <>
      <p role="status">Review {draft.reviews.reduce((n, r) => n + r.before.length, 0)} cases. New paths create the named suite and subsuite levels when applied. Uncertain values remain unchanged.</p>
      {draft.reviews.some(r => r.legacySuitePaths?.length) && <p>Older imported suite labels remain unchanged and are included in this review’s source checks. They are not converted into folders. Only the selected case placements below can change.</p>}
      <ActionButton type="button" className="btn-secondary" disabled={busy || hasPending} onClick={() => setDraft({ ...draft, selected: Object.fromEntries(draft.reviews.flatMap(changes).map(s => [s.id, s])) })} tooltip={<> Select all proposed changes </>}> Select all </ActionButton>{" "}
      <button type="button" className="btn-secondary" disabled={busy || hasPending} onClick={() => setDraft({ ...draft, selected: {} })}>Clear selection</button>
      <div className="smart-suggestion-list">{draft.reviews.flatMap(review => review.suggestions.map(s => {
        const before = review.before.find(c => c.id === s.id)!;
        return <details key={s.id} className="panel"><summary>{before.title} · {s.confidence.toLowerCase()} confidence</summary>
          <p>{s.reason}</p>{s.evidence.map((quote, i) => <blockquote key={i}>{quote}</blockquote>)}
          {fields.map(field => <label key={field} className="smart-suggestion-choice"><input type="checkbox" disabled={busy || hasPending || s[field] === null || s[field] === before[field]} checked={Boolean(draft.selected[s.id]?.[field])} onChange={event => setDraft({ ...draft, selected: { ...draft.selected, [s.id]: { id: s.id, suitePath: false, priority: false, testType: false, ...draft.selected[s.id], [field]: event.target.checked } } })} /><span><strong>{label[field]}</strong>: {before[field] ?? "Unassigned"} → {s[field] ?? "Leave unchanged"}{field === "suitePath" && s.suitePath && !review.knownSuites.includes(s.suitePath) ? " (new suite path)" : ""}</span></label>)}
        </details>;
      }))}</div>
      <p><ActionButton type="button" className="btn-primary" disabled={busy || !selectedPatches().length} onClick={() => void apply()} tooltip={<> {busy ? "Applying reviewed changes…" : hasPending ? "Retry the exact reviewed save" : onApplyImport ? "Use selected suggestions in import preview" : "Apply selected changes"} </>}>{busy ? "Applying…" : hasPending ? "Retry" : onApplyImport ? "Use" : "Apply changes"}</ActionButton>{" "}<button type="button" className="btn-secondary" disabled={busy || hasPending} onClick={() => { setDraft(null); setConsentKey(null); analysis.current = null; setHasAnalysis(false); }}>Discard suggestions</button></p>
      {onApplyImport && <p>No cases are saved by this action. Review the updated import preview, then confirm the import separately.</p>}
    </>}
    {error && <p role="alert">{error}</p>}
  </details>;
}

export function SmartColumnMapping({ projectId, csvText, fileBase64, sheetName, currentMapping, onApply }: {
  projectId: string; csvText?: string; fileBase64?: string; sheetName?: string; currentMapping: Partial<Record<"title" | "given" | "when" | "then" | "priority" | "tags" | "testType" | "automationStatus" | "externalId", string>>;
  onApply: (mapping: typeof currentMapping) => Promise<void>;
}) {
  const auth = useAuth(), utils = trpcReact.useUtils(), project = trpcReact.project.byId.useQuery({ id: projectId }, { retry: false, staleTime: 0 });
  const availability = useAvailability(projectId, project.data?.organizationId);
  const available = availability?.enabled;
  const signature = JSON.stringify([projectId, auth.userId, auth.sessionId, csvText, fileBase64, sheetName, currentMapping, availability?.policyVersion]), latest = useRef(signature);
  useLayoutEffect(() => { latest.current = signature; }, [signature]);
  const [consentSignature, setConsentSignature] = useState<string | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const request = useRef<{ signature: string; input: RouterInputs["caseSuggestions"]["mapping"] } | null>(null);
  const [result, setResult] = useState<{ signature: string; mappings: RouterOutputs["caseSuggestions"]["mapping"]["mappings"] } | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const reviewedMapping = suggestedImportMapping(currentMapping, (result?.signature === signature ? result.mappings : []).filter(m => chosen.has(m.field)));
  const consent = consentSignature === signature;
  const ready = available && auth.isLoaded && auth.isSignedIn && project.data && !project.error && !project.isFetching && !project.isPaused;
  async function analyze() {
    if (!consent || !availability?.canAnalyze || !ready || !project.data || !auth.userId) return;
    if (request.current?.signature !== signature) request.current = { signature, input: { projectId, originalOrganizationId: project.data.organizationId, expectedClerkActorId: auth.userId, requestId: crypto.randomUUID(), approved: true, expectedPolicyVersion: availability.policyVersion, ...(csvText ? { csvText } : { fileBase64, sheetName }) } };
    setBusy(true); setError("");
    try {
      const response = await utils.client.caseSuggestions.mapping.mutate(request.current.input);
      if (latest.current !== signature) return;
      setResult({ signature, mappings: response.mappings }); setChosen(new Set(response.mappings.map(m => m.field))); setConsentSignature(null);
    } catch (cause) { if (latest.current === signature) setError(cause instanceof Error ? cause.message : "Column analysis could not finish."); }
    finally { setBusy(false); }
  }
  if (!available) return null;
  return <details className="panel" open><summary>Suggest column mappings from the content</summary>
    <p>{availability?.reason}</p><p>Use this when column names or layout are unfamiliar. Expected behavior and historical pass/fail results remain separate.</p>
    <label><input type="checkbox" checked={consent} disabled={busy} onChange={e => setConsentSignature(e.target.checked ? signature : null)} /> I approve sending the column names and first 25 data rows to Vaettir’s Anthropic AI provider to propose mappings. No source is changed or imported.</label>
    <p><ActionButton type="button" className="btn-primary" disabled={!consent || !availability?.canAnalyze || !ready || busy} onClick={() => void analyze()} tooltip={<> {busy ? "Reading column meanings…" : "Suggest mappings"} </>}>{busy ? "Reading…" : "Suggest mappings"}</ActionButton></p>
    {result?.signature === signature && ready && <>
      {result.mappings.length === 0 && <p>No defensible mapping was found. Existing mappings are unchanged.</p>}
      {result.mappings.map(m => <label key={m.field} className="smart-suggestion-choice"><input type="checkbox" checked={chosen.has(m.field)} disabled={busy} onChange={e => setChosen(previous => { const next = new Set(previous); if (e.target.checked) next.add(m.field); else next.delete(m.field); return next; })} /><span><strong>{m.field}</strong>: {currentMapping[m.field] || "Unmapped"} → {m.column}<br />{m.confidence.toLowerCase()} confidence. {m.reason}{m.evidence.map((q, i) => <blockquote key={i}>{q}</blockquote>)}</span></label>)}
      <p>Review all mapping changes, including any field unmapped because a column can have only one role:</p>
      <dl>{([...new Set([...Object.keys(currentMapping), ...Object.keys(reviewedMapping)])] as Array<keyof typeof currentMapping>).filter(field => currentMapping[field] !== reviewedMapping[field]).map(field => <div key={field}><dt>{field}</dt><dd>{currentMapping[field] || "Unmapped"} → {reviewedMapping[field] || "Unmapped"}</dd></div>)}</dl>
      <ActionButton type="button" className="btn-primary" disabled={busy || !chosen.size} onClick={() => {
        setBusy(true); void onApply(reviewedMapping).then(() => { setResult(null); request.current = null; }).catch(cause => setError(cause instanceof Error ? cause.message : "Preview could not refresh.")).finally(() => setBusy(false));
      }} tooltip={<> Use selected mappings in preview </>}> Use </ActionButton>
    </>}
    {error && <p role="alert">{error}</p>}
  </details>;
}
