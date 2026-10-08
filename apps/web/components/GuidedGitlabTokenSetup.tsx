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
  return <section aria-label="Self-hosted GitLab setup" style={{ display: "grid", gap: 12 }}>
    <h3>Connect your GitLab instance</h3>
    <label style={{ display: "grid", gap: 6 }}>GitLab address
      <input type="url" placeholder="https://gitlab.example.com" value={host} disabled={!active} onChange={event => { if (active) setHost(event.target.value); }}/>
    </label>
    <p className="text-muted">Use a publicly reachable HTTPS instance. No application ID, client secret or password is needed.</p>
    {host && !origin && <p role="alert">Enter a public HTTPS GitLab address without credentials, a custom port, query or fragment.</p>}
    {origin && <a href={`${origin}/-/user_settings/personal_access_tokens`} target="_blank" rel="noopener noreferrer">Open your GitLab token settings</a>}
    <p>Create a short-lived token in GitLab with <code>read_api</code>, then continue to verify it and choose your groups, subgroups and repositories.</p>
    <details><summary>Permissions and group tokens</summary>
      <p>Choose a short expiry, such as 7 days if your policy permits. Do not select write permissions or the broader api scope. read_api allows broader read access than repository metadata; this connection flow only verifies your account and lists repositories. It does not read source files or send them to AI.</p>
      <p>For a group token, select the exact group in GitLab, then Settings → Access tokens. A group Owner must create it; use a read-only Reporter role with read_api. Group token availability depends on your GitLab edition. Vaettir does not create or issue tokens automatically.</p>
    </details>
    <button type="button" disabled={!active || !origin} onClick={() => { if (active && origin) setVerifiedOrigin(origin); }}>I have a token: verify and choose repositories</button>
    <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
  </section>;
}
