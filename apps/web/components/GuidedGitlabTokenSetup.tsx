"use client";

import { useState } from "react";
import { gitlabInstanceOrigin } from "@/lib/gitlab-instance-selection";
import { TokenRepositoryConnection } from "./TokenRepositoryConnection";

/** Guidance only: creating a token remains an explicit action in GitLab. */
export function GuidedGitlabTokenSetup({ projectId, onConnected, onClose, active = true }: {
  projectId: string; onConnected: () => void; onClose: () => void; active?: boolean;
}) {
  const [host, setHost] = useState("");
  const [verifiedOrigin, setVerifiedOrigin] = useState<string | null>(null);
  const origin = gitlabInstanceOrigin(host);
  // Once verification opens, keep its private draft and uncertain outcomes mounted.
  if (verifiedOrigin) return <TokenRepositoryConnection projectId={projectId} providerId="gitlab" initialInstanceUrl={verifiedOrigin} onConnected={onConnected} onClose={onClose} active={active}/>;
  return <section aria-label="Self-hosted GitLab setup" className="repository-connection-panel" style={{ display: "grid", gap: 16 }}>
    <header><h3>Connect your GitLab instance</h3><p className="text-muted">Choose the host, create a token in GitLab, then verify access.</p></header>
    <label style={{ display: "grid", gap: 6 }}>GitLab address
      <input type="url" placeholder="https://gitlab.example.com" value={host} disabled={!active} onChange={event => { if (active) setHost(event.target.value); }}/>
    </label>
    <p className="text-muted">Public HTTPS only. No application ID, client secret or password needed.</p>
    {host && !origin && <p role="alert">Enter a public HTTPS GitLab address without credentials, a custom port, query or fragment.</p>}
    {active && origin && <a href={`${origin}/-/user_settings/personal_access_tokens`} target="_blank" rel="noopener noreferrer">Open your GitLab token settings</a>}
    <p className="repository-connection-notice">Create a short-lived token with <code>read_api</code>. Do not select write permissions or the broader <code>api</code> scope. read_api permits broader reads than metadata; Vaettir only verifies your account and lists repositories. No source files or AI processing.</p>
    <details className="connection-options"><summary>Token expiry and group-token help</summary>
      <p>Choose a short expiry, such as 7 days if your policy permits. Continue to choose your verified groups, subgroups and repositories; nothing is connected until you review and approve.</p>
      <p>For a group token, select the exact group in GitLab, then Settings → Access tokens. A group Owner must create it; use a read-only Reporter role with read_api. Group token availability depends on your GitLab edition. Vaettir does not create or issue tokens automatically.</p>
    </details>
    <footer className="connection-footer">
      <button type="button" className="btn-primary" style={{order:1}} disabled={!active || !origin} onClick={() => { if (active && origin) setVerifiedOrigin(origin); }}>Verify token &amp; choose repositories</button>
      <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
    </footer>
  </section>;
}
