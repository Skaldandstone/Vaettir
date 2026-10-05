"use client";
import { useState } from "react";
import { trpcReact, type RouterInputs } from "@/lib/trpcReact";
import { useCaseFieldAccess } from "@/lib/use-case-field-access";
import { inspectorLabel } from "@/lib/case-inspector";
import { manualStartDefinitivelyRejected as definitivelyRejected } from "@/lib/manual-run-start";
type Priority = RouterInputs["casePriority"]["set"]["priority"];
export function CasePriorityField({ projectId, caseId, priority, caseRevision, readOnly, onChanged }: { projectId: string; caseId: string; priority: string; caseRevision: string; readOnly?: boolean; onChanged?: () => void }) {
  const access = useCaseFieldAccess(projectId, caseId);
  const [pending, setPending] = useState<{ request: RouterInputs["casePriority"]["set"]; everAmbiguous: boolean } | null>(null);
  const [error, setError] = useState("");
  const mutation = trpcReact.casePriority.set.useMutation();
  const utils = trpcReact.useUtils();
  async function save(next: Priority) {
    const original = access.origin;
    if (!original || !access.owns(original, "edit") || readOnly) return;
    const receipt = pending ?? { request: { projectId, caseId, priority: next, expectedCaseRevision: caseRevision, requestId: crypto.randomUUID(), originalOrganizationId: original.organizationId, expectedClerkActorId: original.clerkActorId }, everAmbiguous: false };
    const request = receipt.request;
    setPending(receipt); setError("");
    try {
      const result = await mutation.mutateAsync(request);
      if (!access.owns(original, "edit")) { setPending({ ...receipt, everAmbiguous: true }); return; }
      if (result.requestId !== request.requestId) throw new Error("Unconfirmed priority response. Retry the same decision.");
    } catch (cause) {
      if (access.owns(original, "edit")) setError(cause instanceof Error ? cause.message : "Priority was not acknowledged. Retry the same decision.");
      // Proven server refusal cannot have committed the transaction; an unknown
      // response keeps the exact UUID/input retained for safe retry.
      setPending(definitivelyRejected(cause, receipt.everAmbiguous) ? null : { ...receipt, everAmbiguous: true });
      return;
    }
    if (!access.owns(original, "edit")) return;
    setPending(null);
    try {
      await Promise.all([utils.testCases.byId.invalidate({ id: caseId }), utils.testCases.prioritySuggestion.invalidate({ id: caseId }), utils.testCases.history.invalidate({ testCaseId: caseId })]);
      onChanged?.();
    } catch { if (access.owns(original, "edit")) setError("Priority saved, but refreshing failed. Refresh the case; do not submit another decision."); }
  }
  if (!access.readable) return <>Checking current access…</>;
  if (readOnly || !access.canEdit) return <>{inspectorLabel(priority)}</>;
  return <>
    <select aria-label="Case priority" value={pending?.request.priority ?? priority} disabled={mutation.isPending || Boolean(pending)} onChange={event => void save(event.target.value as Priority)}>
      {(["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const).map(value => <option key={value} value={value}>{inspectorLabel(value)}</option>)}
    </select>
    {pending && !mutation.isPending && <button onClick={() => void save(pending.request.priority)}>Retry same priority</button>}
    {error && <p role="alert">{error}</p>}
  </>;
}
