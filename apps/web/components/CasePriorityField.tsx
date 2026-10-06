"use client";
import { trpcReact } from "@/lib/trpcReact";
import { inspectorLabel } from "@/lib/case-inspector";
import { useCasePriorityController } from "@/lib/use-case-priority-controller";
import type { PriorityInput } from "@/lib/case-priority-draft";

export function CasePriorityField({ projectId, caseId, readOnly = false, onChanged, active = true }: { projectId: string; caseId: string; priority: string; caseRevision: string; readOnly?: boolean; onChanged?: () => void; active?: boolean }) {
  const mutation = trpcReact.casePriority.setReviewed.useMutation(), utils = trpcReact.useUtils();
  const control = useCasePriorityController(projectId, caseId, active, readOnly, mutation, () => {
    const refreshed = Promise.all([utils.testCases.byId.invalidate({ id: caseId }), utils.testCases.prioritySuggestion.invalidate({ id: caseId }), utils.testCases.history.invalidate({ testCaseId: caseId })]);
    onChanged?.(); return refreshed.then(() => undefined);
  });
  const fresh = control.reads.fresh;
  if (!control.readable || !fresh) return <><span role="status">Checking current priority access… Retained decisions were not transferred.</span>{" "}<button type="button" className="btn-secondary" onClick={control.reads.refresh}>Recheck priority access</button>{control.reads.query.error && <span role="alert">{control.reads.query.error.message}</span>}</>;
  if (readOnly || !fresh.canRecover) return <>{inspectorLabel(fresh.priority)}{" "}<button type="button" className="btn-secondary" onClick={control.reads.refresh}>Recheck priority access</button></>;
  return <div>
    <select aria-label="Case priority" title="Scheduling intent only. Risk matching and business-need overrides remain separate reviewed decisions. Choices and retry receipts stay only while this page is mounted." value={control.pending?.envelope.input.priority ?? control.draft?.priority ?? fresh.priority} disabled={control.busy || Boolean(control.pending) || control.settled || !fresh.canChange} onChange={event => control.change(event.target.value as PriorityInput["priority"])}>
      {(["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const).map(value => <option key={value} value={value}>{inspectorLabel(value)}</option>)}
    </select>{" "}
    <button type="button" className="btn-secondary" disabled={!control.canSave} onClick={() => void control.save()}>{control.busy ? "Saving…" : control.pending ? "Retry same priority" : "Save priority"}</button>
    {control.pending && !control.busy && <p role="status">The response is uncertain. Your exact original native author, case revision, priority and UUID remain retained.</p>}
    {(control.settled || control.draft && fresh.caseRevision !== control.draft.caseRevision) && <p role="status">{control.settled ? "This original decision was confirmed after the view changed. It will not be submitted again." : "The current case changed; your chosen priority is retained."}{" "}<button type="button" className="btn-secondary" disabled={control.busy || Boolean(control.pending) || !fresh.canChange} onClick={control.reviewCurrent}>Review current case with this choice</button></p>}
    {fresh.blockedReason && <p role="status">{fresh.blockedReason}</p>}
    {control.notice && <p role="status">{control.notice}</p>}
    {(control.draft || control.pending || control.notice || fresh.blockedReason) && <button type="button" className="btn-secondary" disabled={control.busy} onClick={control.reads.refresh}>Refresh current case and access without discarding choice</button>}
  </div>;
}
