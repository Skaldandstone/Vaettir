"use client";
import Link from "next/link";
import type { CaseExecutionHistoryItem } from "@vaettir/core";
import { caseObservationHistoryEntry } from "@/lib/case-observation-history-entry";

/** Mount ONLY within the parent's exact fresh authorized case-history page.
 * No history fetch, confidential observation body or write controls are added. */
export function CaseObservationHistoryEntry({ projectId, testCaseId, displayId, item, active = true }: {
  projectId: string; testCaseId: string; displayId: string; item: CaseExecutionHistoryItem; active?: boolean;
}) {
  if (!active) return null;
  const entry = caseObservationHistoryEntry({ projectId, testCaseId, displayId, item });
  if (entry.kind === "UNAVAILABLE") return <p className="text-muted">{entry.reason}</p>;
  return <section aria-label={`Saved execution history for ${displayId}`} style={{ minWidth: 0, marginBlock: 12 }}>
    <h4 style={{ marginBlock: 8 }}>Saved run history · {displayId}</h4>
    <Link className="btn-secondary" href={entry.href} target="_blank" rel="noopener noreferrer" prefetch={false}
      aria-label={`${entry.label} for ${displayId}, opens in a new tab`} style={{ display: "inline-block", overflowWrap: "anywhere" }}>
      {entry.label} ↗
    </Link>
    <p className="text-muted">Opens in a new tab to preserve this case-history selection, filters and mounted drafts. The native run rechecks current workspace access; this link is not an authorization grant. This does not record or correct anything automatically.</p>
    <details><summary>Execution, correction and legacy evidence limits</summary><ul>{entry.limitations.map(note => <li key={note}>{note}</li>)}</ul></details>
  </section>;
}
