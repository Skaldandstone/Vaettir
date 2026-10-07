"use client";

import { useState } from "react";
import { RepositoryOAuthConnection } from "./GitlabRepositoryConnection";
import { TokenRepositoryConnection } from "./TokenRepositoryConnection";

/** Choose a connection mechanism before submitting any account or secret. */
export function GitlabConnectionChoices({ projectId, onConnected, onClose, active = true }: {
  projectId: string; onConnected: () => void; onClose: () => void; active?: boolean;
}) {
  const [method, setMethod] = useState<"token" | "oauth" | null>(null);
  if (method === "token") return <TokenRepositoryConnection projectId={projectId} providerId="gitlab" onConnected={onConnected} onClose={onClose} active={active}/>;
  if (method === "oauth") return <RepositoryOAuthConnection projectId={projectId} providerId="gitlab" onConnected={onConnected} onClose={onClose} active={active}/>;
  return <section aria-label="GitLab connection method" style={{ display: "grid", gap: 12 }}>
    <p>Connect GitLab.com or your publicly reachable GitLab instance, then choose multiple repositories for this project.</p>
    <button type="button" disabled={!active} onClick={() => setMethod("token")}>Use a read-only access token</button>
    <p className="text-muted">No OAuth application registration is needed. Use a short-lived personal or group access token with read_api. It can grant broader read access than metadata; Vaettir uses this connection flow only to verify your account and list repositories.</p>
    <button type="button" className="btn-secondary" disabled={!active} onClick={() => setMethod("oauth")}>Use workspace-configured OAuth</button>
    <p className="text-muted">Authorize through GitLab when your workspace has an application configured for that exact instance. No source files are read or sent to AI by either connection flow.</p>
    <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
  </section>;
}
