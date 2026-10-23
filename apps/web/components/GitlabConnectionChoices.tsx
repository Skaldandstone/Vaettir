"use client";

import { useState } from "react";
import { RepositoryOAuthConnection } from "./GitlabRepositoryConnection";
import { TokenRepositoryConnection } from "./TokenRepositoryConnection";
import { GuidedGitlabTokenSetup } from "./GuidedGitlabTokenSetup";
import { trpcReact } from "@/lib/trpcReact";

/** Choose a connection mechanism before submitting any account or secret. */
export function GitlabConnectionChoices({ projectId, onConnected, onClose, active = true }: {
  projectId: string; onConnected: () => void; onClose: () => void; active?: boolean;
}) {
  const [method, setMethod] = useState<"guided" | "token" | "oauth" | null>(null);
  const configurations=trpcReact.repositoryConnections.configurations.useQuery({projectId},{enabled:active});
  const recent=trpcReact.repositoryConnections.mine.useQuery({projectId},{enabled:active&&configurations.isSuccess&&configurations.data.canConnect});
  const savedOAuth=active&&recent.isSuccess&&!recent.isFetching&&!recent.isPaused&&recent.data.some(connection=>connection.provider==="gitlab"&&connection.accessMethod==="oauth");
  if (method === "guided") return <GuidedGitlabTokenSetup projectId={projectId} onConnected={onConnected} onClose={onClose} active={active}/>;
  if (method === "token") return <TokenRepositoryConnection projectId={projectId} providerId="gitlab" onConnected={onConnected} onClose={onClose} active={active}/>;
  if (method === "oauth") return <RepositoryOAuthConnection projectId={projectId} providerId="gitlab" onConnected={onConnected} onClose={onClose} active={active}/>;
  return <section aria-label="GitLab connection method" className="repository-connection-panel" style={{ display: "grid", gap: 16 }}>
    <header><h3>Connect GitLab</h3><p className="text-muted">GitLab.com or your own publicly reachable instance.</p></header>
    <p className="repository-connection-notice">A short-lived token with <code>read_api</code> grants broader read access than repository metadata. Vaettir verifies your account and lists repositories only; no source files are read or sent to AI.</p>
    <details className="connection-options"><summary>Other connection methods</summary>
      <div style={{display:"grid",gap:12,paddingTop:12}}>
        <button type="button" className="btn-secondary" disabled={!active} onClick={() => setMethod("token")}>Use a read-only access token</button>
        <p className="text-muted">No OAuth application registration is needed. Verify an existing personal or group token.</p>
        <button type="button" className="btn-secondary" disabled={!active} onClick={() => setMethod("oauth")}>Use workspace-configured OAuth</button>
        <p className="text-muted">Your workspace must have an application configured for the exact GitLab instance. Review GitLab’s permissions before authorizing.</p>
      </div>
    </details>
    <footer className="connection-footer">
      <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
      <button type="button" className="btn-primary" disabled={!active} onClick={() => setMethod(savedOAuth?"oauth":"guided")}>{savedOAuth?"Manage existing GitLab access":"Connect self-hosted GitLab"}</button>
    </footer>
  </section>;
}
