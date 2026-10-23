"use client";
import { trpcReact, type RouterInputs } from "@/lib/trpcReact";
import { reviewedPlanStatus, type PlanStatus } from "@/lib/plan-change-draft";
import { usePlanChangeEditor } from "@/lib/use-plan-change-editor";
import { Modal } from "./Modal";
type Values = { status: PlanStatus; intent: "CHANGE" | "REOPEN" };
type Input = RouterInputs["testPlanGovernance"]["setPlanStatus"];
const labels: Record<PlanStatus, string> = { DRAFT: "Draft", ACTIVE: "Active", IN_REVIEW: "In review", APPROVED: "Approved (saved planning status)", ARCHIVED: "Archived" };
export function PlanStatusEditor({ projectId, testPlanId, organizationId, readOnly = false, onChanged }: { projectId: string; testPlanId: string; organizationId: string; readOnly?: boolean; onChanged: () => void }) {
  const mutation = trpcReact.testPlanGovernance.setPlanStatus.useMutation();
  const editor = usePlanChangeEditor<Values, Input>({ projectId, testPlanId, organizationId, readOnly, operation: "SET_PLAN_STATUS", mutation, onChanged,
    initialize: preview => ({ status: ["APPROVED", "ARCHIVED"].includes(preview.snapshot.status) ? "DRAFT" : preview.snapshot.status, intent: "CHANGE" }),
    canChange: preview => preview.statusActions.canChange || preview.statusActions.canReopen,
    validate: (draft, current) => { if (draft.baseline.planRevision !== current.planRevision) return "The complete plan changed after review. Load and review the current snapshot; your local draft remains unchanged."; try { reviewedPlanStatus(draft.baseline.snapshot.status, draft.values.status, draft.values.intent); return null; } catch (cause) { return cause instanceof Error ? cause.message : "Review a supported status transition."; } },
    makeInput: (draft, base) => ({ ...base, ...reviewedPlanStatus(draft.baseline.snapshot.status, draft.values.status, draft.values.intent) }),
    savedNotice: "Planning status saved with governed version and history. No test result, quality verdict, readiness, release approval or compliance sign-off is inferred." });
  const frozen = !!editor.draft && ["APPROVED", "ARCHIVED"].includes(editor.draft.baseline.snapshot.status);
  return <>
    {(!readOnly || editor.pending) && <button type="button" className="btn-secondary" onClick={editor.show}>{editor.pending ? "Reconcile planning status request" : "Change planning status"}</button>}
    <Modal open={editor.open} onClose={editor.close} title="Review planning status" keepMounted>
      {!editor.readable ? <p>Restore the original project, plan and native signed-in reader with current full-editor access. Retained drafts and uncertain requests stay mounted but private.</p> : <div style={{ display: "grid", gap: 12 }}>
        <p>Changes the plan’s saved planning status only. Header text, metadata, procedures, criteria, requirement links and assignment are not submitted. This is not a quality/readiness verdict or qualified approval.</p>
        {editor.reads.fresh?.statusActions.blockedReason && <p role="alert">{editor.reads.fresh.statusActions.blockedReason}</p>}
        {editor.pending ? <>
          <p>The original request is retained. Reconcile it without changing its UUID, reviewed status, intent, reason or revision.</p>
          <details><summary>Exact reviewed status request</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(editor.pending.input, null, 2)}</pre></details>
          <button type="button" disabled={editor.busy} onClick={() => void editor.commit()}>Retry identical planning status request</button>
        </> : <>
          <button type="button" disabled={editor.busy || !(editor.reads.fresh?.statusActions.canChange || editor.reads.fresh?.statusActions.canReopen)} onClick={editor.review}>{editor.draft ? "Load current status (replaces unsaved status draft)" : "Load current status for review"}</button>
          {editor.draft && <fieldset disabled={editor.busy || !(editor.reads.fresh?.statusActions.canChange || editor.reads.fresh?.statusActions.canReopen)} style={{ border: 0, padding: 0, display: "grid", gap: 12 }}>
            <p>Reviewed saved status: {labels[editor.draft.baseline.snapshot.status]}</p>
            {frozen ? <label><input type="checkbox" checked={editor.draft.values.intent === "REOPEN"} onChange={event => editor.change({ values: { status: "DRAFT", intent: event.target.checked ? "REOPEN" : "CHANGE" } })} /> Explicitly reopen this {editor.draft.baseline.snapshot.status.toLowerCase()} plan to Draft. Its historical status and evidence remain retained.</label>
              : <label>New planning status<select value={editor.draft.values.status} onChange={event => editor.change({ values: { status: event.target.value as PlanStatus, intent: "CHANGE" } })}>{(Object.keys(labels) as PlanStatus[]).map(status => <option key={status} value={status}>{labels[status]}</option>)}</select></label>}
            {editor.problem && <p role="alert">{editor.problem}</p>}
            <label>Reason<textarea rows={2} maxLength={1000} value={editor.draft.reason} onChange={event => editor.change({ reason: event.target.value })} /></label>
            <label><input type="checkbox" checked={editor.draft.confirmed} onChange={event => editor.change({ confirmed: event.target.checked })} /> I reviewed this exact status transition and intent; all other plan content remains unchanged.</label>
            <button type="button" disabled={!editor.canSave} onClick={() => void editor.commit()}>Save reviewed planning status</button>
          </fieldset>}
        </>}
        {editor.notice && <p role="status">{editor.notice}</p>}
      </div>}
    </Modal>
  </>;
}
