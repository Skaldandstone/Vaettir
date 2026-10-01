"use client";

import type { ConnectionAccessState } from "@/lib/connection-access";

export function ConnectionAccessGate({ state, busy, onRetry, onClose }: {
  state: Exclude<ConnectionAccessState, "ready">;
  busy: boolean;
  onRetry: () => void;
  onClose: () => void;
}) {
  const checking = state === "checking-permissions" || state === "checking-connections";
  return <div style={{ display: "grid", gap: 16, minWidth: 0 }}>
    <p role={checking ? "status" : "alert"}>{
      state === "checking-permissions" ? "Checking your connection permissions…" :
      state === "checking-connections" ? "Checking saved access…" :
      state === "permission-error" ? "Your connection permissions could not be refreshed. Retry before entering credentials or continuing." :
      state === "connection-error" ? "Saved access could not be refreshed. Retry before reconnecting or continuing. Your selections and approved scope are retained." :
      "A full editor seat is required to connect sources. Ask a workspace owner or admin for access."
    }</p>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {!checking && state !== "denied" && <button type="button" disabled={busy} onClick={onRetry}>Retry connection check</button>}
      <button type="button" className="btn-secondary" disabled={busy} onClick={onClose}>Cancel</button>
    </div>
  </div>;
}
