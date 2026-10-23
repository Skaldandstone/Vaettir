"use client";

import { useState } from "react";
import { trpcReact } from "@/lib/trpcReact";
import {gitlabInstanceOrigin} from "@/lib/gitlab-instance-selection";

/** Administrator-only setup, deliberately separate from the customer Connect flow. */
export function RepositoryOAuthApplicationSetup({ projectId, providerId, initialOrigin }: {
  projectId: string; providerId: "github" | "gitlab"; initialOrigin?: string;
}) {
  const providerName = providerId === "gitlab" ? "GitLab" : "GitHub";
  const configurations = trpcReact.repositoryConnections.configurations.useQuery({ projectId });
  const revocations = trpcReact.repositoryConnections.revocableGrants.useQuery({ projectId, provider: providerId }, {
    enabled: configurations.isSuccess && configurations.data.canConfigure,
  });
  const gitlab = trpcReact.repositoryConnections.configureGitlab.useMutation();
  const github = trpcReact.repositoryConnections.configureGithub.useMutation();
  const disconnect = trpcReact.repositoryConnections.disconnect.useMutation();
  const remove = trpcReact.repositoryConnections.removeConfiguration.useMutation();
  const [origin, setOrigin] = useState(() => gitlabInstanceOrigin(initialOrigin ?? "") ?? "https://gitlab.com");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [revokingId, setRevokingId] = useState("");
  const [removingId, setRemovingId] = useState("");
  const busy = gitlab.isPending || github.isPending || disconnect.isPending || remove.isPending;
  const field = { display: "grid", gap: 6 } as const;
  const inputStyle = { width: "100%", minWidth: 0, boxSizing: "border-box" } as const;
  const actions = { display: "flex", gap: 8, flexWrap: "wrap" } as const;

  if (!configurations.isSuccess) return <section>
    <p role={configurations.error ? "alert" : "status"}>{configurations.error ? "Workspace application permissions could not be refreshed." : "Checking administrator access…"}</p>
    {configurations.error && <button type="button" onClick={() => void configurations.refetch()}>Retry permission check</button>}
  </section>;
  if (!configurations.data.canConfigure) return <p role="alert">A full Owner or Admin seat is required to manage workspace applications.</p>;

  const callback = providerId === "github" ? configurations.data.githubRedirectUri : configurations.data.redirectUri;
  const available = configurations.data.configurations.filter(c => c.provider === providerId);
  // Virtual platform descriptors are not tenant credential records and cannot be removed.
  const removable = available.filter(c => !c.id.startsWith("platform:"));
  return <section style={{ display: "grid", gap: 16, minWidth: 0 }}>
    <p>Configure an application once for your workspace. Members then use Connect repo, authorize on {providerName}, and choose repositories without entering these credentials.</p>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {!configurations.data.storageReady ? <p role="alert">Vaettir platform setup is incomplete: encrypted credential storage and the public callback must be enabled before registering an application.</p> : <details>
      <summary>Configure a workspace {providerName} application{providerId === "gitlab" ? " / self-hosted instance" : ""}</summary>
      <form style={{ display: "grid", gap: 12, marginTop: 16 }} onSubmit={async e => {
        e.preventDefault(); setError(""); setNotice("");
        try {
          if (providerId === "gitlab") await gitlab.mutateAsync({ projectId, origin, clientId, clientSecret });
          else await github.mutateAsync({ projectId, clientId, clientSecret });
          setClientSecret(""); setClientId(""); await configurations.refetch();
          setNotice("Application saved securely. Account authorization has not run.");
        } catch { setError("Application setup failed. Check the instance, credentials and administrator permissions. Existing credentials were not replaced."); }
      }}>
        <p>{providerId === "gitlab" ? "For each publicly reachable self-hosted instance, register an OAuth application in GitLab with read_api and this callback. A GitLab.com application cannot authorize another instance. Private-network hosts are not supported." : "Register an OAuth application in GitHub Developer settings with this callback. GitHub repo scope grants broader read/write access than Vaettir’s metadata-only connection flow."}</p>
        <a href={providerId === "gitlab" ? "https://docs.gitlab.com/integration/oauth_provider/" : "https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app"} target="_blank" rel="noopener noreferrer">{providerName} application setup instructions</a>
        <code style={{ overflowWrap: "anywhere" }}>{callback}</code>
        <button type="button" className="btn-secondary" disabled={!callback} onClick={async () => {
          if (!callback) return;
          try { await navigator.clipboard.writeText(callback); setNotice("Callback URL copied."); }
          catch { setError("Could not copy. Select the callback URL and copy it manually."); }
        }}>Copy callback URL</button>
        {providerId === "gitlab" && <label style={field}>GitLab instance<input style={inputStyle} type="url" required maxLength={300} value={origin} onChange={e => setOrigin(e.target.value)}/></label>}
        <label style={field}>Application ID<input style={inputStyle} required maxLength={300} autoComplete="off" value={clientId} onChange={e => setClientId(e.target.value)}/></label>
        <label style={field}>Application secret<input style={inputStyle} type="password" required maxLength={2000} autoComplete="new-password" value={clientSecret} onChange={e => setClientSecret(e.target.value)}/></label>
        <button type="submit" disabled={busy}>Save application securely</button>
      </form>
    </details>}
    <h3>Configured instances</h3>
    {!available.length && <p>No {providerName} application available yet.</p>}
    {available.map(c => <p key={c.id} style={{ overflowWrap: "anywhere", margin: 0 }}>{new URL(c.origin).hostname} · Application configured, not account authorization</p>)}
    <h3>Saved workspace grants</h3>
    {!revocations.isSuccess ? <div><p role={revocations.error ? "alert" : "status"}>{revocations.error ? "Workspace authorizations could not be refreshed. Retry before revoking saved access." : "Checking saved grants…"}</p><button type="button" className="btn-secondary" disabled={busy || revocations.isFetching} onClick={() => void revocations.refetch()}>Retry authorization list</button></div> : !revocations.data.length ? <p>No outstanding grants for this provider.</p> : null}
    {revocations.isSuccess && Boolean(revocations.data?.length) && <div style={{ display: "grid", gap: 8 }}>
      <p className="text-muted">Revoke every grant before removing its application. Failed revocations retain the encrypted credential for retry.</p>
      {revocations.data.map(grant => <div key={grant.id} style={{ ...actions, alignItems: "center" }}>
        <span style={{ flex: "1 1 180px", overflowWrap: "anywhere" }}>{grant.projectName} · {new URL(grant.origin).hostname} · {grant.accountLabel ?? "Account not verified"} · {grant.status.replaceAll("_", " ").toLowerCase()}</span>
        <button type="button" className="btn-secondary" disabled={busy || Boolean(revokingId) || grant.status === "VERIFYING"} onClick={async () => {
          setRevokingId(grant.id); setError(""); setNotice("");
          try { await disconnect.mutateAsync({ id: grant.id }); await revocations.refetch(); setNotice("Grant cleared after provider revocation."); }
          catch { setError("Provider revocation was not confirmed. The encrypted grant remains for retry."); }
          finally { setRevokingId(""); }
        }}>{revokingId === grant.id ? "Clearing…" : grant.status === "VERIFYING" ? "Verification in progress" : "Cancel / revoke grant"}</button>
      </div>)}
    </div>}
    {removable.length > 0 && <details><summary>Remove an application</summary><p>Saved repository records are preserved. Removal is blocked while any pending authorization or encrypted grant remains.</p>
      {removable.map(c => <div key={c.id} style={{ ...actions, alignItems: "center", marginBottom: 8 }}><span style={{ overflowWrap: "anywhere", flex: "1 1 180px" }}>{new URL(c.origin).hostname}</span>
        {removingId !== c.id ? <button type="button" className="btn-secondary" disabled={busy || !revocations.isSuccess} onClick={() => setRemovingId(c.id)}>Review removal</button> : <>
          <button type="button" disabled={busy || !revocations.isSuccess} onClick={async () => {
            setError(""); setNotice("");
            try { await remove.mutateAsync({ projectId, configurationId: c.id, confirmed: true }); await configurations.refetch(); setRemovingId(""); setNotice("Workspace application removed. Repository records were preserved."); }
            catch { setError("Application could not be removed. Finish pending authorizations and revoke every saved grant first, then refresh permissions."); }
          }}>Confirm removal</button><button type="button" className="btn-secondary" disabled={busy} onClick={() => setRemovingId("")}>Keep application</button>
        </>}
      </div>)}
    </details>}
  </section>;
}
