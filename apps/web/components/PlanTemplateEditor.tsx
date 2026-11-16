"use client";

import { ActionButton } from "@/components/ui/ActionButton";
import { useEffect, useRef, useState } from "react";
import { trpcReact, type RouterInputs } from "@/lib/trpcReact";
import { usePlanChangeEditor } from "@/lib/use-plan-change-editor";
import { editablePlanTemplate, emptyPlanContext, initialPlanTemplate, movePlanCase, planTemplateProblem, togglePlanCase, unconfiguredPlanTemplate, type PlanTemplateDraft } from "@/lib/plan-template-draft";
import { Modal } from "./Modal";
import { IconButton } from "./ui/IconButton";

type Input = RouterInputs["testPlanGovernance"]["saveExecutionTemplate"];
const labels: Record<string, string> = { configuration: "Variant", platform: "Platform", build: "Build", environment: "Environment", hardwareRevision: "Hardware revision", firmwareVersion: "Firmware", rig: "Rig", batchOrLot: "Batch / lot", calibrationReference: "Calibration", protocolReference: "Protocol" };
export function PlanTemplateEditor({ projectId, testPlanId, organizationId, onChanged, readOnly = false }: {
  projectId: string; testPlanId: string; organizationId: string; onChanged: () => void; readOnly?: boolean;
}) {
  const mutation = trpcReact.testPlanGovernance.saveExecutionTemplate.useMutation();
  const editor = usePlanChangeEditor<PlanTemplateDraft, Input>({
    projectId, testPlanId, organizationId, readOnly, operation: "SAVE_EXECUTION_TEMPLATE", mutation, onChanged,
    initialize: preview => initialPlanTemplate(preview.snapshot.executionTemplate, crypto.randomUUID()),
    canChange: preview => preview.canEdit && (unconfiguredPlanTemplate(preview.snapshot.executionTemplate) || !!editablePlanTemplate(preview.snapshot.executionTemplate)),
    validate: (draft, current) => draft.baseline.planRevision !== current.planRevision ? "This plan changed. Reload the current selection before saving." : planTemplateProblem(draft.values),
    makeInput: (draft, base) => ({ ...base, template: draft.values }),
    savedNotice: "Plan selection and configurations saved.",
  });
  const initialized = useRef(false);
  useEffect(() => {
    if (!editor.open) { initialized.current = false; return; }
    if (!initialized.current && editor.readable) {
      if (editor.draft || editor.pending) initialized.current = true;
      else if (editor.reads.fresh?.canEdit) { initialized.current = true; editor.review(); }
    }
  }, [editor]);
  const [search, setSearch] = useState(""), [cursor, setCursor] = useState<{ scopeKey: string; lastId: string } | undefined>();
  const requestBinding = JSON.stringify([editor.reads.activation, search, cursor]);
  const [request, setRequest] = useState({ binding: requestBinding, id: crypto.randomUUID() });
  if (request.binding !== requestBinding) setRequest({ binding: requestBinding, id: crypto.randomUUID() });
  const requestId = request.id;
  const scope = editor.reads.fresh?.scope;
  const input = { projectId, testPlanId, originalOrganizationId: organizationId, expectedClerkActorId: scope?.actorClerkUserId ?? "", expectedNativeActorId: scope?.actorId ?? "", requestId, search, limit: 50, ...(cursor ? { cursor } : {}) };
  const candidates = trpcReact.planExecutionReads.page.useQuery(input, {
    enabled: editor.open && editor.readable && !!scope && request.binding === requestBinding, retry: false, staleTime: 0, refetchOnWindowFocus: false,
  });
  const data = editor.readable && request.binding === requestBinding && candidates.isFetchedAfterMount && !candidates.isFetching && !candidates.isPaused && !candidates.error &&
    candidates.data?.readContext.requestId === requestId &&
    candidates.data.readContext.scope.actorId === scope?.actorId &&
    candidates.data.readContext.scope.actorClerkUserId === scope?.actorClerkUserId &&
    candidates.data.readContext.scope.organizationId === organizationId &&
    candidates.data.plan.id === testPlanId && candidates.data.plan.projectId === projectId ? candidates.data : null;
  const visibleIds = useRef(new Set<string>());
  useEffect(() => { visibleIds.current = new Set(data?.candidates.map(c => c.id) ?? []); }, [data]);
  const labelScope = JSON.stringify([projectId, testPlanId, editor.reads.activation]);
  const [labelCache, setLabelCache] = useState({ scope: labelScope, data, names: new Map<string, string>() });
  let names = labelCache.names;
  if (labelCache.scope !== labelScope || labelCache.data !== data) {
    names = new Map(labelCache.scope === labelScope ? names : []);
    for (const c of data?.candidates ?? []) names.set(c.id, `${c.displayId || c.id} · ${c.title}`);
    for (const c of data?.selected ?? []) if (c.metadata) names.set(c.testCaseId, `${c.metadata.displayId || c.testCaseId} · ${c.metadata.title}`);
    setLabelCache({ scope: labelScope, data, names });
  }
  const draft = editor.draft?.values;
  const notice = editor.notice.startsWith("Loaded the current native snapshot.") ? "" : editor.notice;
  function change(values: PlanTemplateDraft) {
    if (!editor.canHandleDraft()) return;
    editor.change({ values, reason: "Updated ordered test selection and execution configurations", confirmed: false });
  }
  return <>
    <button type="button" hidden={readOnly} className="btn-primary" onClick={editor.show}>Configure cases</button>
    <Modal open={editor.open} onClose={editor.close} title="Plan cases & configurations" size="wide" keepMounted>
      {!editor.readable ? <p role="status">{editor.reads.query.error ? "Unable to load this plan. Check your access and try again." : "Loading your plan…"}</p> : <>
        {editor.reads.fresh?.editBlockedReason && <p role="alert">{editor.reads.fresh.editBlockedReason}</p>}
        {editor.pending ? <section role="status" aria-busy={editor.busy}>
          {editor.busy || !editor.pending.uncertain ? <p>Saving plan…</p> : <>
            <p>The save needs confirmation. Your reviewed selection is retained.</p>
            <button type="button" disabled={editor.busy} onClick={() => void editor.commit()}>Retry save</button>
          </>}</section> : draft ? <>
          <div className="plan-selection-grid">
            <section><h3>Available tests</h3>
              <label className="field-label">Search tests<input value={search} maxLength={200} placeholder="Test ID or summary" onChange={e => { setCursor(undefined); setSearch(e.target.value); }} /></label>
              {candidates.isFetching && <p role="status">Loading tests…</p>}
              {candidates.error && <p role="alert">Tests could not be loaded. <button type="button" onClick={() => void candidates.refetch()}>Retry</button></p>}
              <ul className="plan-case-options">{data?.candidates.map(c => <li key={c.id}>
                <label><input type="checkbox" checked={draft.testCaseIds.includes(c.id)} disabled={editor.busy || (!draft.testCaseIds.includes(c.id) && draft.testCaseIds.length >= 500)}
                  onChange={() => { if (editor.canHandleDraft() && visibleIds.current.has(c.id)) change(togglePlanCase(editor.draftRef.current!.values, c.id)); }} />
                  <span><code>{c.displayId || c.id}</code><span>{c.title}</span><small>{c.reviewStatus === "APPROVED" ? "Approved" : "Needs review before execution"}</small></span>
                </label>
              </li>)}</ul>
              {data && !data.candidates.length && <p>No tests match this search.</p>}
              <div className="workspace-toolbar">
                {cursor && <button type="button" onClick={() => setCursor(undefined)}>First page</button>}
                <button type="button" disabled={!data?.nextCursor} onClick={() => { if (data?.nextCursor) setCursor(data.nextCursor); }}>More tests</button>
              </div>
            </section>
            <section><h3>Selected <span className="muted">{draft.testCaseIds.length}</span></h3>
              {!draft.testCaseIds.length && <p className="muted">Choose tests to build your ordered plan.</p>}
              <ol className="plan-selected-cases">{draft.testCaseIds.map((id, index) => <li key={id}>
                <span className="plan-case-order">{String(index + 1).padStart(2, "0")}</span><span>{names.get(id) ?? id}</span>
                <div className="workspace-toolbar">
                  <IconButton icon="up" label={`Move test ${index + 1} up`} disabled={editor.busy || index === 0} onClick={() => change(movePlanCase(editor.draftRef.current!.values, id, -1))} />
                  <IconButton icon="down" label={`Move test ${index + 1} down`} disabled={editor.busy || index === draft.testCaseIds.length - 1} onClick={() => change(movePlanCase(editor.draftRef.current!.values, id, 1))} />
                  <IconButton icon="close" label={`Remove test ${index + 1}`} disabled={editor.busy} onClick={() => change(togglePlanCase(editor.draftRef.current!.values, id))} />
                </div>
              </li>)}</ol>
            </section>
          </div>
          <details className="plan-configurations" open><summary>Configurations <span className="muted">{draft.configurations.length}</span></summary>
            {draft.configurations.map((config, index) => <fieldset key={config.id} disabled={editor.busy} className="plan-configuration">
              <legend>Configuration {index + 1}</legend>
              <label>Name<input value={config.name} maxLength={120} onChange={e => change({ ...draft, configurations: draft.configurations.map(c => c.id === config.id ? { ...c, name: e.target.value } : c) })} /></label>
              {(["platform", "environment", "build", "configuration"] as const).map(key => <label key={key}>{labels[key]}<input value={config.context[key]} maxLength={key === "environment" || key === "configuration" ? 2000 : 300}
                onChange={e => change({ ...draft, configurations: draft.configurations.map(c => c.id === config.id ? { ...c, context: { ...c.context, [key]: e.target.value } } : c) })} /></label>)}
              <details><summary>Technical context</summary>{(["hardwareRevision", "firmwareVersion", "rig", "batchOrLot", "calibrationReference", "protocolReference"] as const).map(key => <label key={key}>{labels[key]}<input value={config.context[key]} maxLength={300} onChange={e => change({ ...draft, configurations: draft.configurations.map(c => c.id === config.id ? { ...c, context: { ...c.context, [key]: e.target.value } } : c) })} /></label>)}</details>
              <IconButton icon="delete" label={`Remove configuration ${index + 1}`} onClick={() => change({ ...draft, configurations: draft.configurations.filter(c => c.id !== config.id) })} />
            </fieldset>)}
            <button type="button" disabled={editor.busy || draft.configurations.length >= 20} onClick={() => change({ ...draft, configurations: [...draft.configurations, { id: crypto.randomUUID(), name: `Configuration ${draft.configurations.length + 1}`, context: emptyPlanContext() }] })}>Add configuration</button>
          </details>
          {editor.problem && <p role="alert">{editor.problem}</p>}
          <footer className="plan-save-footer">
            <label><input type="checkbox" checked={editor.draft!.confirmed} onChange={e => editor.change({ reason: "Updated ordered test selection and execution configurations", confirmed: e.target.checked })} /> I reviewed the selected tests and configurations.</label>
            <button type="button" className="btn-primary" disabled={!editor.canSave} onClick={() => void editor.commit()}>{editor.busy ? "Saving…" : "Save plan"}</button>
          </footer>
        </> : <p>{notice || "No editable configuration is available."}</p>}
        {notice && draft && <p role="status">{notice}</p>}
        {!editor.pending && <ActionButton type="button" className="btn-secondary" disabled={editor.busy} onClick={editor.review} tooltip={<> Reload saved selection </>}> Refresh </ActionButton>}
      </>}
      {editor.reads.query.error && <ActionButton type="button" onClick={editor.reads.refresh} tooltip={<> Retry loading plan </>}> Retry </ActionButton>}
    </Modal>
  </>;
}
