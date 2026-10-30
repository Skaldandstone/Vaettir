"use client";

import { ActionButton } from "@/components/ui/ActionButton";
import { useLayoutEffect, useRef, useState } from "react";
import { defectRecordKey } from "@vaettir/core";
import { trpcReact, type RouterInputs, type RouterOutputs } from "@/lib/trpcReact";

/** No provider I/O or requirement writes; imports only server-bound summaries. */
export function JiraDefectReview({ projectId, runId, runVersion, issueIds, disabled, onSaved, onHeldChange, onWorkingChange }: {
  projectId: string; runId: string; runVersion: number; issueIds: string[];
  disabled: boolean; onSaved: () => void; onHeldChange: (held: boolean) => void; onWorkingChange: (working: boolean) => void;
}) {
  const previewRpc = trpcReact.defectMap.previewJira.useMutation();
  const saveRpc = trpcReact.defectMap.approveJira.useMutation();
  const [review, setReview] = useState<RouterOutputs["defectMap"]["previewJira"] | null>(null);
  const [receipt, setReceipt] = useState<RouterInputs["defectMap"]["approveJira"] | null>(null);
  const [approved, setApproved] = useState(false), [message, setMessage] = useState("");
  const [done, setDone] = useState(false), [working, setWorking] = useState(false);
  const [reviewScope, setReviewScope] = useState(""), [rejected, setRejected] = useState(false);
  const ambiguous = useRef(false);
  const active = useRef(false), inFlight = useRef(false);
  useLayoutEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const busy = disabled || working;
  const scope = JSON.stringify([projectId, runId, runVersion, [...issueIds].sort()]);
  const shownReview = receipt || reviewScope === scope ? review : null;
  async function preview() {
    if (busy || !issueIds.length || inFlight.current || receipt) return;
    inFlight.current = true; setWorking(true); onWorkingChange(true); setMessage(""); setApproved(false);
    try {
      const result = await previewRpc.mutateAsync({ projectId, runId, runVersion, issueIds, approveMetadataRead: true });
      if (active.current) { setReview(result); setReviewScope(scope); setDone(false); }
    } catch (error) {
      if (active.current) { setReview(null); setMessage(error instanceof Error ? error.message : "Could not review these Jira tasks."); }
    } finally { inFlight.current = false; if (active.current) { setWorking(false); onWorkingChange(false); } }
  }
  async function save() {
    if (busy || inFlight.current || !shownReview || (!receipt && !approved)) return;
    const attempt = receipt ?? { projectId, runId, runVersion, issueIds: [...issueIds], version: shownReview.version, previewHash: shownReview.previewHash, requestId: crypto.randomUUID(), approveMetadataRead: true as const, approveImport: true as const };
    setReceipt(attempt); onHeldChange(true); inFlight.current = true; setWorking(true); onWorkingChange(true); setMessage(""); setRejected(false);
    try {
      const result = await saveRpc.mutateAsync(attempt);
      if (!active.current) return;
      setReceipt(null); onHeldChange(false); setApproved(false); setDone(true); ambiguous.current = false;
      setMessage(result.retried ? "The earlier Jira task import was already saved. No duplicate write was made." : "Reviewed Jira task summaries saved to the defect map. No requirements were created.");
      // A refresh failure cannot turn an acknowledged write into an unknown one.
      try { onSaved(); } catch { setMessage("Reviewed Jira tasks were saved. Refresh the defect map to load its latest view."); }
    } catch (error) {
      if (active.current) {
        const code = error && typeof error === "object" && "data" in error && error.data && typeof error.data === "object" && "code" in error.data ? error.data.code : null;
        const known = typeof code === "string" && ["CONFLICT", "BAD_REQUEST", "FORBIDDEN", "UNAUTHORIZED", "NOT_FOUND", "PRECONDITION_FAILED"].includes(code);
        ambiguous.current ||= !known;
        setRejected(known && !ambiguous.current);
        setMessage(`${error instanceof Error ? error.message : "Save could not be confirmed."} The exact request is retained. Retry it before changing this selection.`);
      }
    } finally { inFlight.current = false; if (active.current) { setWorking(false); onWorkingChange(false); } }
  }
  return <section aria-label="Review Jira defect tasks" style={{ display: "grid", gap: 10, minWidth: 0 }}>
    <h4>Add issue summaries to the defect map</h4>
    <p>Review {issueIds.length} selected summaries as tracker tasks. This does not create requirements or modify Jira. Source reads remain a manual snapshot; automatic sync is not enabled.</p>
    {!receipt && <ActionButton type="button" disabled={busy || !issueIds.length} onClick={() => void preview()} tooltip={<> {working ? "Working…" : "Review selected defect tasks"} </>}>{working ? "Working…" : "Review"}</ActionButton>}
    {shownReview && !done && <>
      <ul style={{ paddingLeft: 20, overflowWrap: "anywhere" }}>{shownReview.tasks.map(task => {
        const change = shownReview.changes.find(item => item.record === "task" && item.key === defectRecordKey(task));
        const action = change?.kind === "new" ? "Add new task" : change?.kind === "changed" ? "Update saved summary" : change?.kind === "stale" ? "Keep newer saved summary" : change?.kind === "unchanged" ? "Keep unchanged task" : "Review unavailable";
        return <li key={defectRecordKey(task)}><strong>{action}</strong>{" · "}<a href={task.url ?? undefined} target="_blank" rel="noopener noreferrer">{task.url?.split("/").at(-1) ?? task.externalId}</a>{" · "}{task.title}</li>;
      })}</ul>
      <p>Missing tasks and existing human link decisions are retained. Older snapshots do not overwrite newer saved summaries. Metadata labels may be redacted. Jira status labels are not mapped to a resolution category; imported status remains unknown until supported category evidence is available.</p>
      <label><input type="checkbox" checked={approved} disabled={busy || !!receipt} onChange={event => setApproved(event.target.checked)} /> I approve saving these reviewed Jira summaries as defect-map tasks.</label>
      <ActionButton type="button" disabled={busy || (!receipt && !approved)} onClick={() => void save()} tooltip={<> {working ? "Saving tasks…" : receipt ? "Retry the same task import" : "Save reviewed Jira tasks"} </>}>{working ? "Saving tasks…" : receipt ? "Retry" : "Save"}</ActionButton>
      {rejected && <ActionButton type="button" disabled={busy} onClick={() => { setReceipt(null); onHeldChange(false); setReview(null); setApproved(false); setRejected(false); setMessage("The rejected request was not applied. Review the current source and map before trying again."); }} tooltip={<> Review again after rejection </>}> Review </ActionButton>}
    </>}
    {message && <p role="status">{message}</p>}
  </section>;
}
