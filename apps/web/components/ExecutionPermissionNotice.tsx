"use client";
import { useRef, useState } from "react";

/** Read-only recovery. A successful lookup never starts or retries a run. */
export function ExecutionPermissionNotice({ state, onRetry }: {
  state: "checking" | "unavailable" | null;
  onRetry: () => Promise<unknown>;
}) {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function retry() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setFailed(false);
    try { await onRetry(); }
    catch { setFailed(true); }
    finally { pending.current = false; setBusy(false); }
  }
  if (!state) return null;
  return <aside aria-label="Execution permissions" role={state === "unavailable" || failed ? "alert" : "status"}
    style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBlock: 12 }}>
    <p style={{ margin: 0, flex: "1 1 220px" }}>
      {busy ? "Checking execution permissions…" : state === "unavailable" || failed
        ? "Execution permissions could not be checked." : "Execution permissions are not ready yet."}
    </p>
    <button type="button" className="btn-secondary" disabled={busy} onClick={() => void retry()}>Retry permissions</button>
  </aside>;
}
