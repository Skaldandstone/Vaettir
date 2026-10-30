"use client";

import { ActionHelp } from "@/components/ui/ActionHelp";
import { ActionButton } from "@/components/ui/ActionButton";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useSearchParams } from "next/navigation";
import { trpcReact, type RouterInputs, type RouterOutputs } from "@/lib/trpcReact";

type Options = RouterOutputs["atlassianQuality"]["connectionOptions"];
type Request = RouterInputs["atlassianQuality"]["connectProject"];
type Result = RouterOutputs["atlassianQuality"]["connectProject"];
type Selection = { id: string; name: string; organizationId: string; actor: string; digest: string };

export function AtlassianConnectWorkflow() {
  const auth = useAuth(), searchParams = useSearchParams();
  const requestToken = searchParams.get("request") ?? "";
  const options = trpcReact.atlassianQuality.connectionOptions.useMutation();
  const connect = trpcReact.atlassianQuality.connectProject.useMutation();
  const [workspace, setWorkspace] = useState(""), [search, setSearch] = useState(""), [reload, setReload] = useState(0);
  const [catalog, setCatalog] = useState<{ signature: string; base: string; value: Options } | null>(null);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [message, setMessage] = useState(""), [loading, setLoading] = useState(false), [retained, setRetained] = useState(false);
  const [result, setResult] = useState<{ request: Request; value: Result; projectName: string } | null>(null);
  const [pendingActor, setPendingActor] = useState<{ actor: string; token: string } | null>(null);
  const pending = useRef<{ request: Request; projectName: string } | null>(null);
  const signature = JSON.stringify([auth.userId, auth.sessionId, requestToken, workspace, search]);
  const base = JSON.stringify([auth.userId, auth.sessionId, requestToken]);
  const metadata = catalog?.base === base && catalog.value.actorClerkUserId === auth.userId ? catalog.value : null;
  const current = catalog?.signature === signature && catalog.value.actorClerkUserId === auth.userId ? catalog.value : null;
  const ready = auth.isLoaded && auth.isSignedIn && Boolean(auth.userId && auth.sessionId);
  const loadOptions = options.mutateAsync;
  useEffect(() => {
    if (!ready || !/^[A-Za-z0-9_-]{80,4096}$/.test(requestToken)) return;
    let active = true;
    setLoading(true); setMessage("");
    const timer = setTimeout(() => {
      void loadOptions({ requestToken, expectedClerkActorId: auth.userId!, ...(workspace ? { organizationId: workspace } : {}), search })
        .then(value => { if (active) setCatalog({ signature, base, value }); })
        .catch(error => { if (active) { setCatalog(null); setMessage(error instanceof Error ? error.message : "The connection request could not be verified."); } })
        .finally(() => { if (active) setLoading(false); });
    }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [ready, signature, base, requestToken, workspace, search, auth.userId, loadOptions, reload]);

  const chosen = current && selected && selected.actor === auth.userId && selected.digest === current.requestDigest &&
    current.projects.some(p => p.id === selected.id && p.organizationId === selected.organizationId) ? selected : null;
  const acknowledgement = result && ready && result.request.expectedClerkActorId === auth.userId && result.request.requestToken === requestToken ? result : null;
  const pendingMatches = pendingActor?.actor === auth.userId && pendingActor?.token === requestToken;
  async function confirm() {
    if (!ready || !current || connect.isPending) return;
    if (!pending.current) {
      if (!chosen) return;
      pending.current = { request: { requestToken, expectedClerkActorId: auth.userId!, organizationId: chosen.organizationId, projectId: chosen.id, approveConnection: true }, projectName: chosen.name };
    }
    const attempt = pending.current;
    if (attempt.request.expectedClerkActorId !== auth.userId || attempt.request.requestToken !== requestToken) return;
    setPendingActor({ actor: attempt.request.expectedClerkActorId, token: attempt.request.requestToken });
    setRetained(true); setMessage("");
    try {
      const value = await connect.mutateAsync(attempt.request);
      if (value.actorClerkUserId !== attempt.request.expectedClerkActorId || value.projectId !== attempt.request.projectId || value.organizationId !== attempt.request.organizationId || value.requestDigest !== current.requestDigest)
        throw new Error("The connection reply did not match the reviewed project. Keep this request for recovery.");
      setResult({ request: attempt.request, value, projectName: attempt.projectName });
      pending.current = null; setPendingActor(null); setRetained(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Connection save is unconfirmed. Check this same request before starting another connection.");
    }
  }

  if (!/^[A-Za-z0-9_-]{80,4096}$/.test(requestToken)) return <section className="panel connection-workflow" role="alert"><h1>Start this connection in Jira or Confluence</h1><p>Open Quality Intelligence and choose Connect a Vaettir project. Its verified link brings you directly to this setup.</p></section>;
  if (!ready) return <section className="panel connection-workflow" role="status"><h1>Connect a Vaettir project</h1><p>Verifying your Vaettir sign-in…</p></section>;
  if (acknowledgement) return <section className="panel connection-workflow">
    <div className="connection-symbol" aria-hidden="true">{acknowledgement.value.state === "APPROVED" ? "✓" : "—"}</div>
    <h1>{acknowledgement.value.state === "APPROVED" ? "Project connected" : "Connection is stopped"}</h1>
    <p>{acknowledgement.value.state === "APPROVED" ? `${acknowledgement.projectName} is connected. Return to your Jira or Confluence tab; it checks for the connection automatically.` : "The original connection was saved, then revoked. This retry has not restored its permissions."}</p>
    <ActionHelp tooltip={<>Manage this project’s connection</>}><a className="btn-secondary" href={`/projects/${encodeURIComponent(acknowledgement.value.projectId)}/settings/integrations#atlassian-quality`}>Manage connection</a></ActionHelp>
  </section>;
  return <section className="panel connection-workflow">
    <header><p className="eyebrow">Quality Intelligence · Project connection</p><h1>Connect your project</h1><p className="text-muted">Choose a Vaettir project to share with Jira or Confluence. You stay in control of what is visible.</p></header>
    {loading && <p role="status">Checking the destination and your current project permissions…</p>}
    {message && <div role="alert"><p>{message}</p>{!retained && <button type="button" className="btn-secondary" onClick={() => setReload(value => value + 1)}>Check again</button>}</div>}
    {retained && !pendingMatches && <p role="alert">Sign back in with the account that started this request to confirm its outcome. No other account can adopt the pending connection.</p>}
    {metadata && <>
      <div className="connection-destination"><div className="connection-symbol" aria-hidden="true">↗</div><div><p className="connection-caption">Connecting to {metadata.binding.product === "jira" ? "Jira project" : "Confluence space"}</p><h2>{metadata.targetLabel}</h2><p className="text-muted">{new URL(metadata.binding.siteOrigin).hostname}</p></div><span className="status-pill">Read-only</span></div>
      {!metadata.organizations.length && <p role="alert">A current workspace owner or administrator must connect the project. Ask one to open this setup link while signed in to Vaettir.</p>}
      {!!metadata.organizations.length && <div className="connection-layout"><fieldset disabled={connect.isPending || retained} className="connection-projects form-stack">
        <legend>1. Choose your Vaettir project</legend>
        <p className="text-muted">Only projects you can administer are listed.</p>
        {metadata.organizations.length > 1 && <label>Workspace<select value={workspace} onChange={event => setWorkspace(event.target.value)}><option value="">All my administrator workspaces</option>{metadata.organizations.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}</select></label>}
        <label>Find a project<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search project names" /></label>
        <div className="connection-project-list" role="group" aria-label="Vaettir project" aria-busy={loading}>
          {metadata.projects.map(project => <label key={project.id} className={`connection-project${chosen?.id === project.id ? " is-selected" : ""}`}>
            <input type="radio" name="vaettir-project" value={project.id} checked={chosen?.id === project.id} disabled={!current || loading} onChange={() => {
              if (current?.projects.some(p => p.id === project.id && p.organizationId === project.organizationId)) setSelected({ ...project, actor: auth.userId!, digest: current.requestDigest });
            }} />
            <span><strong>{project.name}</strong><span>{metadata.organizations.find(org => org.id === project.organizationId)?.name}</span></span>
          </label>)}
          {current && !current.projects.length && <p className="connection-no-projects">No matching projects. Try another name or workspace.</p>}
        </div>
        {current?.catalogLimited && <p>More projects are available. Choose a workspace or search to narrow this list.</p>}
      </fieldset><aside className="connection-permissions" aria-label="Connection permissions">
        <h2>2. Review access</h2>
        <h3>{chosen ? `Read-only access for ${chosen.name}` : "Approved evidence only"}</h3>
        <p>People who can view {metadata.targetLabel} will be able to see:</p>
        <ul className="connection-scope-list"><li><span aria-hidden="true">✓</span> Approved quality summaries, including future approved captures</li>{metadata.binding.product === "jira" && <li><span aria-hidden="true">✓</span> Verification tests explicitly linked to its Jira tickets</li>}</ul>
        <div className="connection-private"><strong>Stays private in Vaettir</strong><p>Draft reports, test procedures, source code, attachments and architecture mappings.</p></div>
        <p className="connection-caption">No editing tests, running tests, importing data or spending AI credits. Stop sharing anytime in project settings.</p>
      </aside><div className="connection-footer"><p>{chosen ? <>Ready to connect <strong>{chosen.name}</strong></> : "Select a project to continue. Nothing is connected yet."}</p><button type="button" className="btn-primary" disabled={!chosen || loading || connect.isPending || retained} onClick={() => void confirm()}>{connect.isPending ? "Connecting project…" : "Connect project"}</button></div></div>}
      {retained && pendingMatches && <ActionButton type="button" className="btn-primary" disabled={connect.isPending || loading || !current} onClick={() => void confirm()} tooltip={<> {connect.isPending ? "Connecting project…" : "Confirm connection status"} </>}>{connect.isPending ? "Connecting project…" : "Confirm"}</ActionButton>}
    </>}
  </section>;
}
