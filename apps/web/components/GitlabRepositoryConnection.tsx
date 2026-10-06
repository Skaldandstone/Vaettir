"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { trpcReact, type RouterOutputs } from "@/lib/trpcReact";
import { ProviderMark } from "./SourceConnectionChips";
import { connectionAccessState } from "@/lib/connection-access";
import { ConnectionAccessGate } from "./ConnectionAccessGate";
import {cancelRepositoryAuthorization,type RepositoryAuthorizationIntent} from "./RepositoryProviderPicker";
import {authorizeRepositoryAccount} from "@/lib/repository-authorization";
import {gitlabInstanceOrigin} from "@/lib/gitlab-instance-selection";

type Listing = RouterOutputs["repositoryConnections"]["list"];
const field = { display: "grid", gap: 6 } as const;
const inputStyle = { width: "100%", minWidth: 0, boxSizing: "border-box" } as const;
const actions = { display: "flex", gap: 8, flexWrap: "wrap" } as const;
const statusLabel = (status: string) => status.replaceAll("_", " ").toLowerCase();

/** Render inside the existing Modal. Provider credentials never enter browser storage. */
export function RepositoryOAuthConnection({ projectId, providerId, onConnected, onClose, initialAuthorization, active=true }: {
  projectId: string; providerId: "github" | "gitlab"; onConnected: () => void; onClose: () => void;
  initialAuthorization?:RepositoryAuthorizationIntent;active?:boolean;
}) {
  const providerName = providerId === "github" ? "GitHub" : "GitLab";
  const utils = trpcReact.useUtils();
  const configurations = trpcReact.repositoryConnections.configurations.useQuery({ projectId });
  const recent = trpcReact.repositoryConnections.mine.useQuery({ projectId }, { enabled: configurations.isSuccess && configurations.data.canConnect });
  const [step, setStep] = useState<"authorize" | "repositories" | "review" | "done">("authorize");
  const [configurationId, setConfigurationId] = useState("");
  const [instanceUrl, setInstanceUrl] = useState("");
  const [connectionId, setConnectionId] = useState("");
  const [search, setSearch] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [page, setPage] = useState(1);
  const [listing, setListing] = useState<Listing | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [selectedDetails, setSelectedDetails] = useState<Record<string, Listing["repositories"][number]>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const popup = useRef<Window | null>(null);
  const automaticallyLoaded = useRef("");
  const screenHeading = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => {
    const heading = screenHeading.current;
    const dialog = heading?.closest("dialog");
    // Do not steal opener focus on mount or focus a retained, hidden provider.
    if (dialog?.open && heading?.getClientRects().length) {
      dialog.scrollTo({ top: 0 });
      heading.focus();
    }
  }, [step]);
  const begin = trpcReact.repositoryConnections.begin.useMutation();
  const connect = trpcReact.repositoryConnections.connectSelected.useMutation();
  const disconnect = trpcReact.repositoryConnections.disconnect.useMutation();
  const status = trpcReact.repositoryConnections.status.useQuery({ id: connectionId }, {
    enabled: Boolean(connectionId) && configurations.isSuccess && configurations.data.canConnect, retry: false,
    refetchInterval: query => !query.state.error && (!query.state.data || ["PENDING", "VERIFYING"].includes(query.state.data.status)) ? 2000 : false,
  });
  const availableConfigurations = configurations.data?.configurations.filter(c => c.provider === providerId) ?? [];
  const instanceOrigin = gitlabInstanceOrigin(instanceUrl);
  const provider = availableConfigurations.find(c => c.id === configurationId)
    ?? availableConfigurations.find(c => c.origin === (providerId === "gitlab" ? instanceOrigin : "https://github.com"));
  const applicationSettings = `/settings/integrations/repositories?projectId=${encodeURIComponent(projectId)}&provider=${providerId}${instanceOrigin ? `&origin=${encodeURIComponent(instanceOrigin)}` : ""}`;
  const connectionReady = configurations.data?.storageReady ?? false;
  const busy = begin.isPending || connect.isPending || disconnect.isPending || loading;
  const failure = error || configurations.error?.message || status.error?.message;
  const selectedRepos = Object.values(selectedDetails).filter(repo => selected.includes(repo.id));

  const accessState = connectionAccessState(configurations, recent);
  const providerConfigurationId=provider?.id;
  const canConnect=configurations.isSuccess&&configurations.data?.canConnect===true;
  const beginAuthorization=begin.mutateAsync;
  function authorize() {
    if (!providerConfigurationId || !connectionReady || busy || !canConnect) return;
    setError("");
    void authorizeRepositoryAccount({providerName,
      begin:()=>beginAuthorization({projectId,configurationId:providerConfigurationId,approveMetadataAccess:true}),
      onStarted:setConnectionId,onError:setError,onPopup:opened=>{popup.current=opened;},
    });
  }

  // Consume the explicit Connect click only after fresh access/configuration checks.
  // Closure-owned one-use capability prevents starts after retries/remounts/StrictMode.
  useEffect(()=>{
    if(!initialAuthorization)return;
    if(!active||initialAuthorization.isCancelled()){cancelRepositoryAuthorization(initialAuthorization);return;}
    // The provider click does not identify a self-hosted instance. Never infer GitLab.com.
    if(providerId === "gitlab"){cancelRepositoryAuthorization(initialAuthorization);return;}
    if(accessState==="checking-permissions"||accessState==="checking-connections"||busy)return;
    if(!initialAuthorization.claim())return;
    if(accessState!=="ready"||!connectionReady||!providerConfigurationId||connectionId){
      cancelRepositoryAuthorization(initialAuthorization);
      return;
    }
    void authorizeRepositoryAccount({providerName,preopened:initialAuthorization.window(),
      begin:()=>beginAuthorization({projectId,configurationId:providerConfigurationId,approveMetadataAccess:true}),
      onStarted:setConnectionId,onError:setError,onPopup:opened=>{popup.current=opened;},
    });
  },[initialAuthorization,active,accessState,busy,connectionReady,providerConfigurationId,connectionId,providerName,providerId,beginAuthorization,projectId]);

  const load = useCallback(async (nextPage = 1, nextSearch = "") => {
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
  }, [connectionId, utils]);

  // One automatic metadata listing per verified attempt. Failed requests stay retryable,
  // not an effect loop. Back/review never restarts authorization or writes repositories.
  useEffect(() => {
    if (step !== "authorize" || !connectionId || automaticallyLoaded.current === connectionId
      || !configurations.isSuccess || !configurations.data.canConnect || !recent.isSuccess
      || !status.isSuccess || status.data.status !== "VERIFIED") return;
    automaticallyLoaded.current = connectionId;
    popup.current?.close();
    void load(1, "");
  }, [step, connectionId, configurations.isSuccess, configurations.data?.canConnect, recent.isSuccess, status.isSuccess, status.data?.status, load]);

  async function cancelConnection() {
    setError("");
    try {
      await disconnect.mutateAsync({ id: connectionId });
      popup.current?.close(); setConnectionId(""); setListing(null); setSelected([]); setSelectedDetails({}); setStep("authorize");
      await recent.refetch();
    } catch { setError("The connection could not be disconnected. Refresh its status before retrying."); }
  }

  if (accessState !== "ready") return <ConnectionAccessGate state={accessState} busy={busy || configurations.isFetching || recent.isFetching} onClose={onClose} onRetry={() => void (async () => { const refreshed = await configurations.refetch(); if (refreshed.isSuccess && refreshed.data.canConnect) await recent.refetch(); })()}/>;
  return <div style={{ display: "grid", gap: 16, minWidth: 0 }}>
    <p ref={screenHeading} tabIndex={-1} className="text-muted" role="status" aria-live="polite">{({ authorize: "1. Connect your account", repositories: "2. Choose repositories", review: "3. Review connections", done: "Repositories connected" })[step]}</p>
    {failure && <p role="alert">{failure}</p>}
    {step === "authorize" && <>
      {!connectionId ? <>
        {providerId === "gitlab" && <>
          <label style={field}>GitLab instance or project URL<input style={inputStyle} type="url" maxLength={300} value={instanceUrl} placeholder="https://your-gitlab.example.org/dashboard/projects" disabled={busy} onChange={e => { setInstanceUrl(e.target.value); setConfigurationId(""); setError(""); }}/></label>
          <p className="text-muted">Paste the page you already use, or choose a configured instance below. This only selects the host; it does not connect your account or read repositories.</p>
          {instanceUrl && !instanceOrigin && <p role="alert">Use a public HTTPS GitLab URL without credentials, a query, a fragment or a custom port.</p>}
          {instanceOrigin && !provider && <section role="status"><strong>This GitLab instance needs one-time setup</strong><p>An OAuth application must be configured for this exact host before account authorization. Your existing GitLab sign-in is not a Vaettir connection.</p>{configurations.data?.canConfigure ? <Link href={applicationSettings}>Set up this GitLab instance</Link> : <p>Ask a workspace Owner or Admin to configure this instance.</p>}</section>}
          {!!availableConfigurations.length && <div role="group" aria-label="Choose GitLab instance" style={{display:"grid",gap:8}}>{availableConfigurations.map(c => <button type="button" key={c.id} className="btn-secondary" aria-pressed={provider?.id === c.id} disabled={busy} onClick={() => {setConfigurationId(c.id);setInstanceUrl(c.origin);}}>{new URL(c.origin).hostname}</button>)}</div>}
        </>}
        {!connectionReady ? <section role="alert">
          <strong>{providerName} authorization is unavailable</strong>
          <p>Vaettir platform setup is incomplete. No account or repository was connected.</p>
          <button type="button" className="btn-secondary" onClick={() => void configurations.refetch()}>Check again</button>
        </section> : !availableConfigurations.length ? <section role="status">
          <strong>{providerName} authorization is not enabled yet</strong>
          <p>The application must be enabled once before users can connect. You do not need to enter application credentials here.</p>
          <button type="button" className="btn-secondary" onClick={() => void configurations.refetch()}>Check again</button>
        </section> : <>
          {providerId !== "gitlab" && availableConfigurations.length > 1 && <div role="group" aria-label={`Choose ${providerName} instance`} style={{ display: "grid", gap: 8 }}>
            {availableConfigurations.map(c => <button type="button" key={c.id} className="btn-secondary" aria-pressed={provider?.id === c.id} disabled={busy} onClick={() => setConfigurationId(c.id)}>{new URL(c.origin).hostname}</button>)}
          </div>}
          <p>{provider ? <>Connect to <strong>{new URL(provider.origin).hostname}</strong>.</> : "Choose your GitLab instance above."} {providerName} opens in a separate window and uses your existing sign-in, or asks you to sign in there.</p>
          <p className="text-muted">{providerId === "github" ? "GitHub grants broad repository read/write and some organization management permissions." : "GitLab’s read_api permission is broader than repository listing."} Review the provider’s authorization screen. By connecting, you approve account verification and repository metadata listing only. No source files are read or sent to AI.</p>
          <button type="button" disabled={!provider || busy} onClick={() => void authorize()}>{begin.isPending ? "Opening authorization…" : `Connect ${providerName}`}</button>
        </>}
        {!!recent.data?.some(connection => connection.provider === providerId) && <details><summary>Resume saved access</summary><div style={{ display: "grid", gap: 8, marginTop: 8 }}>
          {recent.data.filter(connection => connection.provider === providerId).map(connection => <button type="button" className="btn-secondary" key={connection.id} disabled={busy || !connectionReady} onClick={() => {
            const config = configurations.data?.configurations.find(c => c.provider === providerId && c.origin === connection.origin);
            setConfigurationId(config?.id ?? ""); setConnectionId(connection.id); setStep("authorize");
          }}><strong>{new URL(connection.origin).hostname}</strong> · {connection.accountLabel ?? "Your authorization"} · {statusLabel(connection.status)}</button>)}
        </div></details>}
        {configurations.data?.canConfigure && <Link className="text-muted" href={applicationSettings}>Manage workspace applications and saved grants</Link>}
        <div style={actions}><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button></div>
      </> : <>
        {!status.isSuccess ? <p role={status.error ? "alert" : "status"}>{status.error ? "Connection status could not be refreshed. Retry before loading repositories." : "Checking authorization status…"}</p> : <p role="status">{status.data.status === "VERIFIED" ? `Verified as ${status.data.accountLabel ?? `your ${providerName} account`}. ${loading ? "Loading repositories…" : "Choose repositories next."}` : ["PENDING", "VERIFYING"].includes(status.data.status) ? `Waiting for ${providerName} authorization. Complete it in the popup; this screen updates automatically.` : status.data.status === "EXPIRED" || status.data.status === "REVOCATION_PENDING" ? `This ${providerName} connection cannot be used. Revoke its grant before reconnecting; the encrypted credential is retained until cleanup is confirmed.` : `Connection ${status.data.status.toLowerCase()}. Start again to authorize.`}</p>}
        {status.isSuccess && status.data.status === "VERIFIED" && <button type="button" disabled={busy} onClick={() => void load(1, "")}>{listing ? "Choose repositories" : "Retry repository list"}</button>}
        <div style={actions}><button type="button" className="btn-secondary" disabled={busy} onClick={() => void status.refetch()}>Refresh status</button><button type="button" className="btn-secondary" disabled={busy} onClick={() => void cancelConnection()}>Revoke token and disconnect</button><button type="button" className="btn-secondary" onClick={onClose}>Close</button></div>
        <p className="text-muted">Disconnect revokes the provider grant before removing saved access. If revocation fails, Vaettir retains it for retry.</p>
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
