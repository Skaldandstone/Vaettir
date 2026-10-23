"use client";

import { StatusPill } from "./ui/Workspace";

type ReviewKind = "archive" | "restore" | "delete";
type ReviewCase = { id: string; displayId: string; title: string };

// Presentation of the parent's frozen reviewed selection only. This component
// neither changes selected IDs nor submits a batch, retries a write or estimates
// progress. The existing parent owns all authorization and outcome handling.
export function TestCaseBulkActionReview({ kind, ids, cases, busy, onCancel, onConfirm }: {
  kind: ReviewKind;
  ids: readonly string[];
  cases: readonly ReviewCase[];
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const action = kind === "delete" ? "Delete" : kind === "archive" ? "Archive" : "Restore";
  const count = ids.length, batches = Math.ceil(count / 200);
  const byId = new Map<string, ReviewCase>();
  for (const item of cases) if (!byId.has(item.id)) byId.set(item.id, item);
  const missing = ids.filter(id => !byId.has(id)).length;
  return <section aria-label={`${action} selection review`} aria-busy={busy} style={{ display: "grid", gap: 14, minWidth: 0 }}>
    <header style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
      <h3 style={{ margin: 0, fontSize: 18 }}>{count} {count === 1 ? "case" : "cases"} selected</h3>
      <div role="status" aria-live="polite"><StatusPill tone={busy ? "warning" : "neutral"}>{busy ? `${action === "Delete" ? "Deletion" : action === "Archive" ? "Archiving" : "Restoration"} in progress` : "Ready for confirmation"}</StatusPill></div>
    </header>
    <p role="note" style={{ margin: 0, padding: "10px 12px", border: "1px solid var(--line)", borderLeft: `3px solid ${kind === "delete" ? "var(--ember)" : "var(--line)"}`, borderRadius: 6, background: "var(--panel)" }}>
      {kind === "delete" ? <>Selected cases will be permanently deleted where permitted. <strong>This cannot be undone.</strong></>
        : kind === "archive" ? "Selected cases will be archived, preserving history." : "Selected cases will be restored to the active library."}
    </p>
    <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 6, fontSize: 12, color: "var(--muted)" }}>
      <span>Selected scope only</span><span>Up to {batches} sequential {batches === 1 ? "batch" : "batches"}, 200 cases maximum each</span>
    </div>
    {missing > 0 && <p role="status" style={{ margin: 0, fontSize: 12 }}>{missing} {missing === 1 ? "case is" : "cases are"} unavailable in the current list. Their immutable IDs remain in this reviewed selection; no display reference or title is guessed.</p>}
    <div role="region" aria-label="Selected case references and titles" tabIndex={0} style={{ maxHeight: "min(42vh, 360px)", overflow: "auto", overscrollBehavior: "contain", border: "1px solid var(--line)", borderRadius: 6, minWidth: 0 }}>
      <table style={{ width: "100%", tableLayout: "fixed", borderCollapse: "collapse", fontSize: 13 }}>
        <caption className="sr-only">{count} selected {count === 1 ? "case" : "cases"}, in the original review order</caption>
        <colgroup><col style={{ width: "28%" }} /><col /></colgroup>
        <thead style={{ position: "sticky", top: 0, background: "var(--panel)", zIndex: 1 }}><tr>
          <th scope="col" style={{ textAlign: "left", padding: "9px 10px", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap", letterSpacing: 0, fontSize: 12 }}>Reference</th>
          <th scope="col" style={{ textAlign: "left", padding: "9px 10px", borderBottom: "1px solid var(--line)" }}>Case title</th>
        </tr></thead>
        <tbody>{ids.map(id => {
          const item = byId.get(id);
          return <tr key={id}>
            <td style={{ padding: "9px 10px", verticalAlign: "top", borderBottom: "1px solid var(--line)", overflowWrap: "anywhere" }}>
              <code title={item?.displayId ? "Current case reference" : "Immutable case ID; current display reference unavailable"} style={{ display: "inline-block", maxWidth: "100%", padding: "2px 5px", border: "1px solid var(--line)", borderRadius: 4, fontSize: 11, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{item?.displayId || id}</code>
            </td>
            <td style={{ padding: "9px 10px", verticalAlign: "top", borderBottom: "1px solid var(--line)", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {item ? item.title === "" ? <span className="text-muted">Empty title</span> : item.title : <span className="text-muted">Case details unavailable in the current list</span>}
            </td>
          </tr>;
        })}</tbody>
      </table>
    </div>
    <p className="text-muted" style={{ margin: 0, fontSize: 12 }}>
      {busy ? "Waiting for the current request. Later batches are sent only after a confirmed result; do not submit this action again. " : "Review the references and titles before confirming. "}
      Later batches stop on an unconfirmed result. Unconfirmed cases remain selected; check refreshed status before retrying.
    </p>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "flex-end" }}>
      <button type="button" className="btn-secondary" disabled={busy} onClick={onCancel}>Cancel</button>
      <button type="button" className={kind === "delete" ? "btn-danger" : "btn-primary"} disabled={busy || count === 0} onClick={onConfirm}>{busy ? "Applying…" : `${action} ${count} ${count === 1 ? "case" : "cases"}`}</button>
    </div>
  </section>;
}
