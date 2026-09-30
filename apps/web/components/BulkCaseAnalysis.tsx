"use client";

import { useState } from "react";
import { Modal } from "./Modal";
import { trpcReact } from "@/lib/trpcReact";

type Action = "RISK" | "TYPE_DESIGN";
type PlanItem = { id: string; hash: string; status: "NEW" | "SAVED" | "PENDING" | "SKIP"; cost: number };

export function BulkCaseAnalysis({ projectId, organizationId, selectedIds, onCompleted }: {
  projectId: string; organizationId: string; selectedIds: string[]; onCompleted: () => void;
}) {
  const utils = trpcReact.useUtils();
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState<Action>("RISK");
  const [offset, setOffset] = useState(0);
  const [plan, setPlan] = useState<PlanItem[] | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [canSpend, setCanSpend] = useState(false);
  const [approved, setApproved] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const risk = trpcReact.testCases.assessRisk.useMutation();
  const design = trpcReact.testDesign.review.useMutation();
  const request = trpcReact.creditUseRequests.create.useMutation();
  const myRequests = trpcReact.creditUseRequests.mine.useQuery({ projectId }, { enabled: open });
  const batch = selectedIds.slice(offset, offset + 20);
  const estimated = plan?.reduce((sum, item) => sum + item.cost, 0) ?? 0;
  const newItems = plan?.filter(item => item.status === "NEW") ?? [];

  function reset(nextAction = action, nextOffset = offset) {
    setAction(nextAction); setOffset(nextOffset); setPlan(null); setBalance(null);
    setApproved(false); setProgress(""); setError(""); setDone(false);
  }

  async function preview() {
    if (!batch.length) return;
    setBusy(true); setError(""); setPlan(null); setDone(false);
    try {
      // Provider calls are never made by a preview. These are authenticated,
      // tenant-scoped database reads; 20 is the hard per-batch ceiling.
      const rows: PlanItem[] = [];
      let firstBalance: number | null = null;
      let allowed = true;
      for (const id of batch) {
        if (action === "RISK") {
          const p = await utils.testCases.riskPreview.fetch({ id });
          firstBalance ??= p.balance; allowed &&= p.canSpend;
          const status = p.savedStatus === "READY" ? "SAVED" : p.savedStatus ? "PENDING" : p.alreadyAssessed ? "SKIP" : "NEW";
          rows.push({ id, hash: p.inputHash, status, cost: status === "NEW" ? p.cost : 0 });
        } else {
          const p = await utils.testDesign.preview.fetch({ id });
          firstBalance ??= p.balance; allowed &&= p.canSpend;
          const matched = p.reviews.find(review => review.inputHash === p.inputHash);
          const status = matched?.status === "READY" ? "SAVED" : matched ? "PENDING" : "NEW";
          rows.push({ id, hash: p.inputHash, status, cost: status === "NEW" ? p.cost : 0 });
        }
      }
      setBalance(firstBalance); setCanSpend(allowed); setPlan(rows);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not prepare analysis."); }
    finally { setBusy(false); }
  }

  async function run() {
    if (!plan || !approved || !canSpend || balance == null || estimated > balance) return;
    setBusy(true); setError(""); setDone(false);
    let succeeded = 0;
    const failures: string[] = [];
    for (let index = 0; index < newItems.length; index++) {
      const item = newItems[index];
      if (!item) break;
      setProgress(`Processing ${index + 1} of ${newItems.length}. ${succeeded} saved so far.`);
      try {
        if (action === "RISK") await risk.mutateAsync({ id: item.id, expectedHash: item.hash, approved: true });
        else await design.mutateAsync({ id: item.id, expectedHash: item.hash, approved: true });
        succeeded++;
      } catch (cause) {
        failures.push(`${item.id}: ${cause instanceof Error ? cause.message : "Unknown error"}`);
        // Stop on the first failure: stale previews, lost authorization or
        // exhausted balance must never cause blind continuation/spend.
        break;
      }
    }
    await Promise.all([
      utils.testCases.list.invalidate({ projectId, includeArchived: true }),
      utils.organization.aiCreditStatus.invalidate({ organizationId }),
    ]);
    onCompleted();
    setProgress(`${succeeded} new ${action === "RISK" ? "risk assessments" : "type/design reviews"} saved. ${failures.length ? "Stopped after one failure; completed items remain saved." : ""}`);
    if (failures.length) setError(failures[0] ?? "One analysis failed.");
    // Some cases may now be SAVED, while a failure may have changed the
    // balance or input hash. Never reuse the pre-run price/selection.
    setPlan(null); setApproved(false);
    setDone(failures.length === 0); setBusy(false);
  }

  async function askAdmin() {
    if (!plan || newItems.length === 0) return;
    setBusy(true); setError("");
    try {
      const result = await request.mutateAsync({ projectId, action, ids: newItems.map(item => item.id), reason: reason.trim() || undefined });
      await myRequests.refetch();
      setProgress(`Request ${result.id} is pending administrator review. No credits were spent or access granted.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not submit request."); }
    finally { setBusy(false); }
  }

  return <>
    <button className="btn-secondary" onClick={() => { reset("RISK", 0); setOpen(true); }}>Analyze selected…</button>
    <Modal open={open} title="Analyze selected test cases" onClose={() => setOpen(false)} dismissible={!busy}>
      <div style={{ display: "grid", gap: 12 }}>
        <p className="text-muted">Choose one analysis. Results are saved per case and never replace human edits. Type/design reviews suggest a better test level, framework and steps; they do not change the case.</p>
        <label>Analysis
          <select value={action} disabled={busy} onChange={event => reset(event.target.value as Action, offset)} style={{ display: "block", width: "100%" }}>
            <option value="RISK">Risk assessment</option><option value="TYPE_DESIGN">Test type &amp; design improvements</option>
          </select>
        </label>
        <p>{selectedIds.length} selected · reviewing {batch.length} in this batch{selectedIds.length > 20 ? ` (${offset + 1}–${offset + batch.length} of ${selectedIds.length})` : ""}. Each batch is capped at 20; remaining cases are not queued automatically.</p>
        {!plan && <button onClick={() => void preview()} disabled={busy || !batch.length}>{busy ? "Checking…" : "Review cases and cost"}</button>}
        {plan && <>
          <p>{newItems.length} new · {plan.filter(item => item.status === "SAVED").length} already saved · {plan.filter(item => item.status === "SKIP").length} already assessed · {plan.filter(item => item.status === "PENDING").length} pending reconciliation.</p>
          <p><strong>Estimated initial charge: {estimated} AI credits.</strong> Current balance: {balance ?? "unavailable"}. Final metered cost can differ. Reusing saved results costs 0.</p>
          <p>Only case text and source metadata are used. No repository is fetched. No supplied code is included, so type/design recommendations remain provisional.</p>
          {!canSpend && <p role="status">Your role or seat cannot use credits. You can request administrator review below.</p>}
          {balance != null && estimated > balance && <p role="status">The balance does not cover this batch. Request administrator review or choose fewer cases.</p>}
          {newItems.length > 0 && <label><input type="checkbox" checked={approved} disabled={busy} onChange={event => setApproved(event.target.checked)} /> I approve sending these cases to the AI provider and the estimated credit charge.</label>}
          <button disabled={busy || !newItems.length || !approved || !canSpend || balance == null || estimated > balance} onClick={() => void run()}>{busy ? "Processing…" : `Confirm ${newItems.length} analyses`}</button>
          <details><summary>Request administrator access or credits</summary>
            <p>This sends an in-app request to workspace Owners/Admins. It does not charge credits, grant a seat or email anyone.</p>
            <p>{newItems.length ? `Request review for ${newItems.length} new analyses (up to ${estimated} initial credits).` : "No new analyses need credits in this batch."}</p>
            <label>Reason (optional)<textarea value={reason} maxLength={500} onChange={event => setReason(event.target.value)} rows={2} style={{ width: "100%" }} /></label>
            <button className="btn-secondary" disabled={busy || !newItems.length} onClick={() => void askAdmin()}>Make a request</button>
          </details>
        </>}
        {progress && <p role="status">{progress}</p>}
        {error && <p role="alert">{error}</p>}
        {!!myRequests.data?.length && <details><summary>Your recent AI use requests</summary><ul>{myRequests.data.slice(0, 5).map(item => <li key={item.id}>{item.action === "RISK" ? "Risk" : "Type/design"} · {item.caseCount} cases · {item.status.toLowerCase()}{item.resolutionNote ? ` · ${item.resolutionNote}` : ""}</li>)}</ul></details>}
        {done && offset + batch.length < selectedIds.length && <button className="btn-secondary" onClick={() => reset(action, offset + batch.length)}>Review next 20</button>}
      </div>
    </Modal>
  </>;
}
