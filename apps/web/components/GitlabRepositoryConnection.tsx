"use client";

import { useRef, useState } from "react";
import { trpcReact, type RouterOutputs } from "@/lib/trpcReact";
import { ProviderMark } from "./SourceConnectionChips";

type Listing = RouterOutputs["repositoryConnections"]["list"];
const field = { display: "grid", gap: 6 } as const;
const inputStyle = { width: "100%", minWidth: 0, boxSizing: "border-box" } as const;
const actions = { display: "flex", gap: 8, flexWrap: "wrap" } as const;

/** Render inside the existing Modal. Provider credentials never enter browser storage. */
export function GitlabRepositoryConnection({ projectId, onConnected, onClose }: {
  projectId: string; onConnected: () => void; onClose: () => void;
}) {
  const utils = trpcReact.useUtils();
  const configurations = trpcReact.repositoryConnections.configurations.useQuery({ projectId });
  const recent = trpcReact.repositoryConnections.mine.useQuery({ projectId });
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const popup = useRef<Window | null>(null);
  const configureMutation = trpcReact.repositoryConnections.configureGitlab.useMutation();
  const begin = trpcReact.repositoryConnections.begin.useMutation();
  const connect = trpcReact.repositoryConnections.connectSelected.useMutation();
  const disconnect = trpcReact.repositoryConnections.disconnect.useMutation();
  const status = trpcReact.repositoryConnections.status.useQuery({ id: connectionId }, {
    enabled: Boolean(connectionId), retry: false,
    refetchInterval: query => !query.state.error && (!query.state.data || ["PENDING", "VERIFYING"].includes(query.state.data.status)) ? 2000 : false,
  });
  const provider = configurations.data?.configurations.find(c => c.id === configurationId);
  const busy = begin.isPending || configureMutation.isPending || connect.isPending || disconnect.isPending || loading;
  const failure = error || configurations.error?.message || status.error?.message;
  const selectedRepos = listing?.repositories.filter(repo => selected.includes(repo.id)) ?? [];

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
    setLoading(true); setError(""); setSelected([]); setListing(null);
    try {
      const result = await utils.repositoryConnections.list.fetch({ id: connectionId, page: nextPage, search: nextSearch });
      setListing(result); setPage(nextPage); setActiveSearch(nextSearch); setStep("repositories");
    } catch { setError("The repository list could not be verified. Check connection status or reconnect, then try again."); }
    finally { setLoading(false); }
  }

  async function cancelConnection() {
    setError("");
    try {
      await disconnect.mutateAsync({ id: connectionId });
      popup.current?.close(); setConnectionId(""); setListing(null); setSelected([]); setConsent(false); setStep("authorize");
    } catch { setError("The connection could not be disconnected. Refresh its status before retrying."); }
  }

  return <div style={{ display: "grid", gap: 16, minWidth: 0 }}>
    <p className="text-muted">{({ instance: "1. Choose your GitLab instance", authorize: "2. Authorize your account", repositories: "3. Choose repositories", review: "4. Review connections", done: "Repositories connected" })[step]}</p>
    {failure && <p role="alert">{failure}</p>}
    {step === "instance" && <>
      {configurations.isLoading && <p role="status">Checking connection availability…</p>}
      {configurations.data && !configurations.data.storageReady && <p role="alert">Secure credential storage or the callback URL is not configured. A platform administrator must enable it before GitLab authorization is available.</p>}
      <p>Use GitLab.com or your organization’s publicly reachable self-hosted GitLab. Each instance needs its own registered OAuth application.</p>
      {!!recent.data?.length && <details><summary>Resume a recent connection</summary><div style={{ display: "grid", gap: 8, marginTop: 8 }}>
        {recent.data.map(connection => <button type="button" className="source-connection-chip" key={connection.id} disabled={!configurations.data?.storageReady || connection.status === "EXPIRED"} onClick={() => {
          const config = configurations.data?.configurations.find(c => c.origin === connection.origin);
          setConfigurationId(config?.id ?? ""); setConnectionId(connection.id); setStep("authorize");
        }}><ProviderMark id="gitlab"/><span style={{ overflowWrap: "anywhere" }}><strong>{connection.origin}</strong><small>{connection.accountLabel ?? "Your authorization"} · {connection.status.toLowerCase()}</small></span></button>)}
      </div></details>}
      <div className="source-chip-list" role="group" aria-label="Configured GitLab instances">
        {configurations.data?.configurations.filter(c => c.provider === "gitlab").map(c => <button type="button" key={c.id} className="source-connection-chip" aria-pressed={configurationId === c.id} onClick={() => { setConfigurationId(c.id); setConfigure(false); }}>
          <ProviderMark id="gitlab"/><span style={{ overflowWrap: "anywhere" }}><strong>{new URL(c.origin).hostname}</strong><small>Application configured · Account not yet authorized</small></span>{configurationId === c.id && <span aria-hidden="true">✓</span>}
        </button>)}
      </div>
      {configurations.data?.canConfigure ? <button type="button" className="btn-secondary" onClick={() => setConfigure(!configure)}>{configure ? "Hide instance setup" : "Set up another GitLab instance"}</button> : <p className="text-muted">Ask a workspace owner or administrator to configure a missing instance.</p>}
      {configure && <form style={{ display: "grid", gap: 12 }} onSubmit={async e => {
        e.preventDefault(); setError("");
        try { const saved = await configureMutation.mutateAsync({ projectId, origin, clientId, clientSecret }); setClientSecret(""); setConfigurationId(saved.id); setConfigure(false); await configurations.refetch(); }
        catch { setError("Instance setup failed. Check the URL, application credentials and your administrator permissions."); }
      }}>
        <label style={field}>GitLab origin<input style={inputStyle} type="url" required value={origin} onChange={e => setOrigin(e.target.value)} placeholder="https://gitlab.company.com" maxLength={300}/></label>
        <details><summary>Register the GitLab OAuth application</summary><p>In this GitLab instance, create an OAuth application with the <code>read_api</code> scope and this exact redirect URL. Keep the application secret private.</p><code style={{ overflowWrap: "anywhere" }}>{configurations.data?.redirectUri ?? "Callback not configured"}</code><p>Private-network hosts are not supported by this connector. No source files are read in this flow.</p></details>
        <label style={field}>Application ID<input style={inputStyle} required value={clientId} onChange={e => setClientId(e.target.value)} maxLength={300} autoComplete="off"/></label>
        <label style={field}>Application secret<input style={inputStyle} type="password" required value={clientSecret} onChange={e => setClientSecret(e.target.value)} maxLength={2000} autoComplete="new-password"/></label>
        <button type="submit" disabled={busy || !configurations.data?.storageReady}>{configureMutation.isPending ? "Saving securely…" : "Save instance configuration"}</button>
      </form>}
      <div style={actions}><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button type="button" disabled={!provider || !configurations.data?.storageReady || busy} onClick={() => setStep("authorize")}>Continue</button></div>
    </>}
    {step === "authorize" && <>
      <p>Authorize your account on <strong>{provider?.origin}</strong>. You will sign in in a separate GitLab window.</p>
      {!connectionId ? <>
        <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)}/><span>I authorize account verification and repository metadata listing. This does not authorize reading source files or sending anything to AI.</span></label>
        <button type="button" disabled={!consent || busy} onClick={() => void authorize()}>{begin.isPending ? "Opening authorization…" : "Authorize with GitLab"}</button>
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => setStep("instance")}>Back</button>
      </> : <>
        <p role="status">{status.data?.status === "VERIFIED" ? `Verified as ${status.data.accountLabel ?? "your GitLab account"}. Load the repository list when you are ready.` : ["PENDING", "VERIFYING"].includes(status.data?.status ?? "PENDING") ? "Waiting for GitLab authorization. Keep this screen open; the connection status updates automatically." : `Connection ${status.data?.status?.toLowerCase() ?? "status unavailable"}. Start again to authorize.`}</p>
        {status.data?.status === "VERIFIED" && <button type="button" disabled={busy} onClick={() => void load()}>Load repositories</button>}
        <div style={actions}><button type="button" className="btn-secondary" disabled={busy} onClick={() => void status.refetch()}>Refresh status</button><button type="button" className="btn-secondary" disabled={busy} onClick={() => void cancelConnection()}>Disconnect / start again</button></div>
      </>}
    </>}
    {step === "repositories" && <>
      <form style={actions} onSubmit={e => { e.preventDefault(); void load(1, search); }}><label style={{ ...field, flex: "1 1 180px" }}>Find repositories<input style={inputStyle} value={search} onChange={e => setSearch(e.target.value)} maxLength={100}/></label><button type="submit" disabled={busy}>Search</button></form>
      <p className="text-muted">Page {page}. Select repositories on this page, then connect them. Changing pages or searching clears this selection.</p>
      <div className="source-chip-list" role="group" aria-label="Verified repositories" style={{ maxHeight: 300, overflowY: "auto" }}>
        {listing?.repositories.map(repo => <button type="button" key={repo.id} className="source-connection-chip" aria-pressed={selected.includes(repo.id)} disabled={busy} onClick={() => setSelected(ids => ids.includes(repo.id) ? ids.filter(id => id !== repo.id) : [...ids, repo.id])} style={{ maxWidth: "100%", textAlign: "left" }}><ProviderMark id="gitlab"/><span style={{ minWidth: 0, overflowWrap: "anywhere" }}><strong>{repo.name}</strong><small>{repo.defaultBranch ?? "No default branch"} · Metadata only</small></span>{selected.includes(repo.id) && <span aria-hidden="true">✓</span>}</button>)}
      </div>
      {listing && !listing.repositories.length && <p>No accessible repositories matched. Try a different search.</p>}
      <div style={actions}><button type="button" className="btn-secondary" disabled={busy || page <= 1} onClick={() => void load(page - 1, activeSearch)}>Previous page</button><button type="button" className="btn-secondary" disabled={busy || !listing?.hasMore || page >= 100} onClick={() => void load(page + 1, activeSearch)}>Next page</button></div>
      <div style={actions}><button type="button" className="btn-secondary" disabled={busy} onClick={() => setStep("authorize")}>Back</button><button type="button" disabled={busy || !selected.length} onClick={() => setStep("review")}>Review {selected.length} selected</button></div>
    </>}
    {step === "review" && <>
      <p>Connect {selectedRepos.length} {selectedRepos.length === 1 ? "repository" : "repositories"} to this project using your verified GitLab account.</p>
      <ul style={{ overflowWrap: "anywhere", maxHeight: 250, overflowY: "auto" }}>{selectedRepos.map(repo => <li key={repo.id}>{repo.name}</li>)}</ul>
      <p>Existing manual revision references stay unchanged. No source is fetched, no test cases are generated, and no AI credits are used.</p>
      <div style={actions}><button type="button" className="btn-secondary" disabled={busy} onClick={() => setStep("repositories")}>Back</button><button type="button" disabled={busy || !listing || !selected.length} onClick={async () => {
        if (!listing) return; setError("");
        try { await connect.mutateAsync({ id: connectionId, repositoryIds: selected, catalogVersion: listing.catalogVersion, approved: true }); setStep("done"); onConnected(); }
        catch { setError("Connection could not be saved. Your permissions or repository list may have changed. Go back and refresh the list before reviewing again."); }
      }}>{connect.isPending ? "Connecting…" : "Approve and connect"}</button></div>
    </>}
    {step === "done" && <><p role="status">Repository connections saved. Access was verified; source discovery has not run.</p><div style={actions}><button type="button" className="btn-secondary" onClick={() => { setSelected([]); setStep("repositories"); }}>Connect more repositories</button><button type="button" onClick={onClose}>Done</button></div></>}
  </div>;
}
