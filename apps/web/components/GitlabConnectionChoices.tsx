"use client";

import { useState } from "react";
import { RepositoryOAuthConnection } from "./GitlabRepositoryConnection";
import { TokenRepositoryConnection } from "./TokenRepositoryConnection";
import { GuidedGitlabTokenSetup } from "./GuidedGitlabTokenSetup";

/** Choose a connection mechanism before submitting any account or secret. */
export function GitlabConnectionChoices({ projectId, onConnected, onClose, active = true }: {
  projectId: string; onConnected: () => void; onClose: () => void; active?: boolean;
}) {
  const [method, setMethod] = useState<"guided" | "token" | "oauth" | null>(null);
  if (method === "guided") return <GuidedGitlabTokenSetup projectId={projectId} onConnected={onConnected} onClose={onClose} active={active}/>;
  if (method === "token") return <TokenRepositoryConnection projectId={projectId} providerId="gitlab" onConnected={onConnected} onClose={onClose} active={active}/>;
  if (method === "oauth") return <RepositoryOAuthConnection projectId={projectId} providerId="gitlab" onConnected={onConnected} onClose={onClose} active={active}/>;
  return <section aria-label="GitLab connection method" className="repository-connection-panel" style={{ display: "grid", gap: 16 }}>
    <header><h3>Connect GitLab</h3><p className="text-muted">GitLab.com or your own publicly reachable instance.</p></header>
    <p>Continue with GitLab OAuth. An Owner or Admin can configure an application for the exact instance if needed.</p>
    <p className="repository-connection-notice">Review GitLab’s permissions before authorizing. Vaettir verifies your account and lists repositories; no source files are read or sent to AI.</p>
    <details className="connection-options"><summary>Advanced</summary>
      <div style={{display:"grid",gap:12,paddingTop:12}}>
        <p>A token with <code>read_api</code> grants broader read access than repository metadata. No OAuth application is needed for this fallback.</p>
        <button type="button" className="btn-secondary" disabled={!active} onClick={() => setMethod("token")}>Existing token</button>
        <button type="button" className="btn-secondary" disabled={!active} onClick={() => setMethod("guided")}>Token setup</button>
      </div>
    </details>
    <footer className="connection-footer">
      <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
      <button type="button" className="btn-primary" disabled={!active} onClick={() => setMethod("oauth")}>Continue</button>
    </footer>
  </section>;
}
