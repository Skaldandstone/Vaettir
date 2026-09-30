"use client";

import { useRef, useState } from "react";
import { trpcReact, type RouterOutputs } from "@/lib/trpcReact";
import { ProviderMark } from "./SourceConnectionChips";

type Listing = RouterOutputs["repositoryConnections"]["list"];
const field = { display: "grid", gap: 6 } as const;
const inputStyle = { width: "100%", minWidth: 0, boxSizing: "border-box" } as const;
const actions = { display: "flex", gap: 8, flexWrap: "wrap" } as const;
const statusLabel = (status: string) => status.replaceAll("_", " ").toLowerCase();

/** Render inside the existing Modal. Provider credentials never enter browser storage. */
export function RepositoryOAuthConnection({ projectId, providerId, onConnected, onClose }: {
  projectId: string; providerId: "github" | "gitlab"; onConnected: () => void; onClose: () => void;
}) {
  const providerName = providerId === "github" ? "GitHub" : "GitLab";
  const utils = trpcReact.useUtils();
  const configurations = trpcReact.repositoryConnections.configurations.useQuery({ projectId });
  const recent = trpcReact.repositoryConnections.mine.useQuery({ projectId });
  const revocations = trpcReact.repositoryConnections.revocableGrants.useQuery({ projectId, provider: providerId }, { enabled: Boolean(configurations.data?.canConfigure) });
  const [step, setStep] = useState<"instance" | "authorize" | "repositories" | "review" | "done">("instance");
  const [configurationId, setConfigurationId] = useState("");
  const [configure, setConfigure] = useState(false);
  const [origin, setOrigin] = useState("https://gitlab.com");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [consent, setConsent] = useState(false);
  const [connectionId, setConnectionId] = useState("");
  const [search, setSearch] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [page, setPage] = useState(1);
  const [listing, setListing] = useState<Listing | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [selectedDetails, setSelectedDetails] = useState<Record<string, Listing["repositories"][number]>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [callbackCopied, setCallbackCopied] = useState(false);
  const [revokingId, setRevokingId] = useState("");
  const popup = useRef<Window | null>(null);
  const configureMutation = trpcReact.repositoryConnections.configureGitlab.useMutation();
  const configureGithub = trpcReact.repositoryConnections.configureGithub.useMutation();
  const begin = trpcReact.repositoryConnections.begin.useMutation();
  const connect = trpcReact.repositoryConnections.connectSelected.useMutation();
  const disconnect = trpcReact.repositoryConnections.disconnect.useMutation();
  const status = trpcReact.repositoryConnections.status.useQuery({ id: connectionId }, {
    enabled: Boolean(connectionId), retry: false,
    refetchInterval: query => !query.state.error && (!query.state.data || ["PENDING", "VERIFYING"].includes(query.state.data.status)) ? 2000 : false,
  });
  const provider = configurations.data?.configurations.find(c => c.id === configurationId);
  const availableConfigurations = configurations.data?.configurations.filter(c => c.provider === providerId) ?? [];
  const connectionReady = configurations.data?.storageReady ?? false;
  const showSetup = configure || (connectionReady && Boolean(configurations.data?.canConfigure) && availableConfigurations.length === 0);
  const busy = begin.isPending || configureMutation.isPending || configureGithub.isPending || connect.isPending || disconnect.isPending || loading;
  const failure = error || configurations.error?.message || status.error?.message;
  const selectedRepos = Object.values(selectedDetails).filter(repo => selected.includes(repo.id));

  async function authorize() {
    setError("");
    // Open synchronously from the user's click, before awaiting the server (popup blockers).
    const opened = window.open("about:blank", "_blank", "popup,width=650,height=760");
    if (!opened) { setError("Allow popups for Vaettir, then select Authorize again."); return; }
    popup.current = opened;
    // Status polling is authoritative; the provider never receives an opener handle.
    opened.opener = null;
    try {
      const result = await begin.mutateAsync({ projectId, configurationId, approveMetadataAccess: true });
      setConnectionId(result.id);
      if (opened.closed) { setError("The authorization window was closed. Cancel this attempt and try again."); return; }
      opened.location.replace(result.url);
    } catch { opened.close(); setError("Authorization could not start. Check your permissions and provider configuration, then try again."); }
  }

  async function load(nextPage = 1, nextSearch = search) {
    setLoading(true); setError("");
    try {
      const result = await utils.repositoryConnections.list.fetch({ id: connectionId, page: nextPage, search: nextSearch });
      if (result.catalogReset) { setSelected([]); setSelectedDetails({}); }
      else setSelectedDetails(details => {
        const next = { ...details };
        for (const repo of result.repositories) if (next[repo.id]) next[repo.id] = repo;
        return next;
      });
      setListing(result); setPage(nextPage); setActiveSearch(nextSearch); setStep("repositories");
    } catch { setError("The repository list could not be verified. Check connection status or reconnect, then try again."); }
    finally { setLoading(false); }
  }

  async function cancelConnection() {
    setError("");
    try {
      await disconnect.mutateAsync({ id: connectionId });
      popup.current?.close(); setConnectionId(""); setListing(null); setSelected([]); setSelectedDetails({}); setConsent(false); setStep("authorize");
    } catch { setError("The connection could not be disconnected. Refresh its status before retrying."); }
  }

  return <div style={{ display: "grid", gap: 16, minWidth: 0 }}>
    <p className="text-muted">{({ instance: `1. Choose your ${providerName} connection`, authorize: "2. Authorize your account", repositories: "3. Choose repositories", review: "4. Review connections", done: "Repositories connected" })[step]}</p>
    {failure && <p role="alert">{failure}</p>}
    {step === "instance" && <>
      {configurations.isLoading && <p role="status">Checking connection availability…</p>}
      {configurations.data && !connectionReady && <section role="alert" style={{ display: "grid", gap: 8 }}>
        <strong>{providerName} connection is not available yet</strong>
        <p style={{ margin: 0 }}>This Vaettir installation cannot securely complete authorization. No {providerName} account or repository was connected. Changing the instance URL will not fix this.</p>
        {configurations.data.canConfigure && <p style={{ margin: 0 }}>Vaettir platform setup needed: {[
          !configurations.data.credentialStorageReady && "enable encrypted credential storage",
          !configurations.data.callbackReady && "configure the public OAuth callback URL",
        ].filter(Boolean).join(" and ")}. Your workspace OAuth application can be registered after that.</p>}
        {!configurations.data.canConfigure && <p style={{ margin: 0 }}>Ask your workspace owner to contact Vaettir support about enabling repository connections.</p>}
        <button type="button" className="btn-secondary" onClick={() => void configurations.refetch()}>Check again</button>
      </section>}
      {connectionReady && <>
      <p>{providerId === "github" ? "Connect GitHub.com, verify your account, then choose the repositories for this project. GitHub’s OAuth permission is broader than those choices; review it before authorizing." : "Connect GitLab.com or a publicly reachable self-hosted GitLab, verify your account, then choose the repositories for this project. No source files are read in this flow."}</p>
      {!!recent.data?.some(connection => connection.provider === providerId) && <details><summary>Resume a recent connection</summary><div style={{ display: "grid", gap: 8, marginTop: 8 }}>
        {recent.data.filter(connection => connection.provider === providerId).map(connection => <button type="button" className="source-connection-chip" key={connection.id} disabled={!configurations.data?.storageReady} onClick={() => {
          const config = configurations.data?.configurations.find(c => c.provider === providerId && c.origin === connection.origin);
          setConfigurationId(config?.id ?? ""); setConnectionId(connection.id); setStep("authorize");
        }}><ProviderMark id={providerId}/><span style={{ overflowWrap: "anywhere" }}><strong>{connection.origin}</strong><small>{connection.accountLabel ?? "Your authorization"} · {statusLabel(connection.status)}</small></span></button>)}
      </div></details>}
      {configurations.data?.canConfigure && Boolean(revocations.data?.length) && <details><summary>Review {providerName} authorizations before removing the application ({revocations.data?.length})</summary><div style={{ display: "grid", gap: 8, marginTop: 8 }}>
        <p className="text-muted">A workspace administrator can cancel pending attempts or retry revocation of an abandoned member grant. Application credentials remain until every grant is cleared.</p>
        {revocations.data?.map(grant => <div key={grant.id} style={{ ...actions, alignItems: "center" }}><span style={{ flex: "1 1 180px", overflowWrap: "anywhere" }}>{grant.projectName} · {new URL(grant.origin).hostname} · {grant.accountLabel ?? "Account not verified"} · {statusLabel(grant.status)}</span><button type="button" className="btn-secondary" disabled={busy || Boolean(revokingId) || grant.status === "VERIFYING"} onClick={async () => {
          setRevokingId(grant.id); setError("");
          try { await disconnect.mutateAsync({ id: grant.id }); await revocations.refetch(); await recent.refetch(); }
          catch { setError(`${providerName} did not confirm revocation. The encrypted grant remains in Vaettir for retry.`); }
          finally { setRevokingId(""); }
        }}>{revokingId === grant.id ? "Clearing…" : grant.status === "VERIFYING" ? "Verification in progress" : grant.status === "PENDING" || grant.status === "EXPIRED" ? "Cancel / revoke" : "Revoke grant"}</button></div>)}
      </div></details>}
      <div className="source-chip-list" role="group" aria-label={`Configured ${providerName} instances`}>
        {availableConfigurations.map(c => <button type="button" key={c.id} className="source-connection-chip" aria-pressed={configurationId === c.id} onClick={() => { setConfigurationId(c.id); setConfigure(false); }}>
          <ProviderMark id={providerId}/><span style={{ overflowWrap: "anywhere" }}><strong>{new URL(c.origin).hostname}</strong><small>OAuth app configured · Select to authorize or resume</small></span>{configurationId === c.id && <span aria-hidden="true">✓</span>}
        </button>)}
      </div>
      {configurations.data?.canConfigure && availableConfigurations.length > 0 && providerId === "gitlab" ? <button type="button" className="btn-secondary" onClick={() => setConfigure(!configure)}>{configure ? "Hide application setup" : "Add another GitLab instance"}</button> : !configurations.data?.canConfigure && !availableConfigurations.length ? <p className="text-muted">A workspace owner or administrator must register the {providerName} OAuth application before you can authorize.</p> : null}
      {showSetup && <form style={{ display: "grid", gap: 12 }} onSubmit={async e => {
        e.preventDefault(); setError("");
        try { const saved = providerId === "github" ? await configureGithub.mutateAsync({ projectId, clientId, clientSecret }) : await configureMutation.mutateAsync({ projectId, origin, clientId, clientSecret }); setClientSecret(""); setConfigurationId(saved.id); setConfigure(false); await configurations.refetch(); }
        catch { setError("Instance setup failed. Check the URL, application credentials and your administrator permissions."); }
      }}>
        {providerId === "gitlab" && <label style={field}>GitLab origin<input style={inputStyle} type="url" required value={origin} onChange={e => setOrigin(e.target.value)} placeholder="https://gitlab.company.com" maxLength={300}/></label>}
        <div style={{ display: "grid", gap: 6 }}><strong>Register an OAuth application in {providerName}</strong><span>{providerId === "github" ? "In GitHub, open Settings → Developer settings → OAuth apps. Use the callback below. GitHub's repo scope grants broad read/write access, even though Vaettir only lists metadata here." : "In your GitLab instance, open Edit profile → Access → Applications. Create an application with read_api and the callback below. A group owner can instead use Settings → Applications. Private-network hosts are not supported."}</span><a href={providerId === "github" ? "https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app" : "https://docs.gitlab.com/integration/oauth_provider/"} target="_blank" rel="noopener noreferrer">{providerName} application setup instructions ↗</a><code style={{ overflowWrap: "anywhere" }}>{providerId === "github" ? configurations.data?.githubRedirectUri : configurations.data?.redirectUri}</code><button type="button" className="btn-secondary" onClick={async () => {
          const callback = providerId === "github" ? configurations.data?.githubRedirectUri : configurations.data?.redirectUri;
          if (!callback) return;
          try { await navigator.clipboard.writeText(callback); setCallbackCopied(true); }
          catch { setError("Could not copy the callback URL. Select the URL above and copy it manually."); }
        }}>Copy callback URL</button>{callbackCopied && <span role="status">Callback URL copied.</span>}</div>
        <label style={field}>Application ID<input style={inputStyle} required value={clientId} onChange={e => setClientId(e.target.value)} maxLength={300} autoComplete="off"/></label>
        <label style={field}>Application secret<input style={inputStyle} type="password" required value={clientSecret} onChange={e => setClientSecret(e.target.value)} maxLength={2000} autoComplete="new-password"/></label>
        <button type="submit" disabled={busy || !configurations.data?.storageReady}>{busy ? "Saving securely…" : "Save application configuration"}</button>
      </form>}
      <div style={actions}><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button type="button" disabled={!provider || busy} onClick={() => setStep("authorize")}>Continue to authorization</button></div>
      </>}
    </>}
    {step === "authorize" && <>
      <p>Authorize your account on <strong>{provider?.origin}</strong>. You will sign in in a separate {providerName} window.</p>
      {!connectionId ? <>
        <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)}/><span>{providerId === "github" ? "I understand GitHub grants this OAuth app full read/write repository access and some organization management permissions, regardless of which repositories I select in Vaettir. I approve account verification and metadata listing only; source processing requires separate approval." : "I understand GitLab’s read_api grant is broader than metadata listing. I approve account verification and metadata listing only; source processing requires separate approval."}</span></label>
        <button type="button" disabled={!consent || busy} onClick={() => void authorize()}>{begin.isPending ? "Opening authorization…" : `Authorize with ${providerName}`}</button>
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => setStep("instance")}>Back</button>
      </> : <>
        <p role="status">{status.data?.status === "VERIFIED" ? `Verified as ${status.data.accountLabel ?? `your ${providerName} account`}. Load the repository list when you are ready.` : ["PENDING", "VERIFYING"].includes(status.data?.status ?? "PENDING") ? `Waiting for ${providerName} authorization. Keep this screen open; the connection status updates automatically.` : status.data?.status === "EXPIRED" || status.data?.status === "REVOCATION_PENDING" ? `This ${providerName} connection cannot be used. Revoke its grant before reconnecting; Vaettir retains the encrypted credential until cleanup is confirmed.` : `Connection ${status.data?.status?.toLowerCase() ?? "status unavailable"}. Start again to authorize.`}</p>
        {status.data?.status === "VERIFIED" && <button type="button" disabled={busy} onClick={() => void load()}>Load repositories</button>}
        <div style={actions}><button type="button" className="btn-secondary" disabled={busy} onClick={() => void status.refetch()}>Refresh status</button><button type="button" className="btn-secondary" disabled={busy} onClick={() => void cancelConnection()}>Revoke token and disconnect</button></div>
        <p className="text-muted">Explicit disconnect asks {providerName} to revoke this token before Vaettir removes the connection. If the provider rejects revocation, Vaettir retains the encrypted grant for retry. Local expiry does not confirm upstream revocation, and application removal is blocked until grants are cleared.</p>
      </>}
    </>}
    {step === "repositories" && <>
      <form style={actions} onSubmit={e => { e.preventDefault(); void load(1, search); }}><label style={{ ...field, flex: "1 1 180px" }}>{providerId === "github" ? "Filter this page" : "Find repositories"}<input style={inputStyle} value={search} onChange={e => setSearch(e.target.value)} maxLength={100}/></label><button type="submit" disabled={busy}>{providerId === "github" ? "Filter" : "Search"}</button></form>
      <p className="text-muted">Page {page}. {providerId === "github" ? "Search filters this page only. Browse other pages to find more repositories. " : ""}Selections stay in place as you browse pages or search. Review up to 100 repositories within this ten-minute verified listing session.</p>
      <div style={actions}><span role="status">{selected.length} selected across visited pages</span><button type="button" className="btn-secondary" disabled={busy || !selected.length} onClick={() => { setSelected([]); setSelectedDetails({}); }}>Clear selection</button></div>
      <div className="source-chip-list" role="group" aria-label="Verified repositories" style={{ maxHeight: 300, overflowY: "auto" }}>
        {listing?.repositories.map(repo => <button type="button" key={repo.id} className="source-connection-chip" aria-pressed={selected.includes(repo.id)} disabled={busy || (selected.length >= 100 && !selected.includes(repo.id))} onClick={() => {
          const chosen = !selected.includes(repo.id);
          setSelected(ids => chosen ? [...ids, repo.id] : ids.filter(id => id !== repo.id));
          setSelectedDetails(details => { const next = { ...details }; if (chosen) next[repo.id] = repo; else delete next[repo.id]; return next; });
        }} style={{ maxWidth: "100%", textAlign: "left" }}><ProviderMark id={providerId}/><span style={{ minWidth: 0, overflowWrap: "anywhere" }}><strong>{repo.name}</strong><small>{repo.defaultBranch ?? "No default branch"} · Metadata only</small></span>{selected.includes(repo.id) && <span aria-hidden="true">✓</span>}</button>)}
      </div>
      {listing && !listing.repositories.length && <p>{providerId === "github" ? "No repositories on this page matched. Change the filter or browse another page." : "No accessible repositories matched. Try a different search."}</p>}
      <div style={actions}><button type="button" className="btn-secondary" disabled={busy || page <= 1} onClick={() => void load(page - 1, activeSearch)}>Previous page</button><button type="button" className="btn-secondary" disabled={busy || !listing?.hasMore || page >= 100} onClick={() => void load(page + 1, activeSearch)}>Next page</button></div>
      <div style={actions}><button type="button" className="btn-secondary" disabled={busy} onClick={() => setStep("authorize")}>Back</button><button type="button" disabled={busy || !selected.length} onClick={() => setStep("review")}>Review {selected.length} selected</button></div>
    </>}
    {step === "review" && <>
      <p>Connect {selectedRepos.length} {selectedRepos.length === 1 ? "repository" : "repositories"} to this project using your verified {providerName} account.</p>
      <ul style={{ overflowWrap: "anywhere", maxHeight: 250, overflowY: "auto" }}>{selectedRepos.map(repo => <li key={repo.id}>{repo.name}</li>)}</ul>
      <p>Existing manual revision references stay unchanged. No source is fetched, no test cases are generated, and no AI credits are used.</p>
      <div style={actions}><button type="button" className="btn-secondary" disabled={busy} onClick={() => setStep("repositories")}>Back</button><button type="button" disabled={busy || !listing || !selected.length} onClick={async () => {
        if (!listing) return; setError("");
        try { await connect.mutateAsync({ id: connectionId, repositoryIds: selected, catalogVersion: listing.catalogVersion, approved: true }); setStep("done"); onConnected(); }
        catch { setError("Connection could not be saved. Your permissions or repository list may have changed. Go back and refresh the list before reviewing again."); }
      }}>{connect.isPending ? "Connecting…" : "Approve and connect"}</button></div>
    </>}
    {step === "done" && <><p role="status">Repository connections saved. Access was verified; source discovery has not run.</p><div style={actions}><button type="button" className="btn-secondary" onClick={() => { setSelected([]); setSelectedDetails({}); setStep("repositories"); }}>Connect more repositories</button><button type="button" onClick={onClose}>Done</button></div></>}
  </div>;
}
