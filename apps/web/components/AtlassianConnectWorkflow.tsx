"use client";
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

  if (!/^[A-Za-z0-9_-]{80,4096}$/.test(requestToken)) return <section className="panel" role="alert"><h1>Start this connection in Jira or Confluence</h1><p>Open Quality Intelligence and choose Connect a Vaettir project. Its verified link brings you directly to this setup.</p></section>;
  if (!ready) return <section className="panel" role="status"><h1>Connect a Vaettir project</h1><p>Verifying your Vaettir sign-in…</p></section>;
  if (acknowledgement) return <section className="panel" style={{ maxWidth: 760 }}>
    <h1>{acknowledgement.value.state === "APPROVED" ? "Project connected" : "Connection is stopped"}</h1>
    <p>{acknowledgement.value.state === "APPROVED" ? `${acknowledgement.projectName} is connected. Return to your Jira or Confluence tab; it checks for the connection automatically.` : "The original connection was saved, then revoked. This retry has not restored its permissions."}</p>
    <a className="btn-secondary" href={`/projects/${encodeURIComponent(acknowledgement.value.projectId)}/settings/integrations#atlassian-quality`}>Manage this project’s connection</a>
  </section>;
  return <section className="panel" style={{ maxWidth: 760, display: "grid", gap: 20 }}>
    <header><p className="text-muted">PROJECT CONNECTION</p><h1>Connect a Vaettir project</h1><p>Choose the project you want linked. Nothing is connected until you confirm.</p></header>
    {loading && <p role="status">Checking the destination and your current project permissions…</p>}
    {message && <div role="alert"><p>{message}</p>{!retained && <button type="button" className="btn-secondary" onClick={() => setReload(value => value + 1)}>Check again</button>}</div>}
    {retained && !pendingMatches && <p role="alert">Sign back in with the account that started this request to confirm its outcome. No other account can adopt the pending connection.</p>}
    {metadata && <>
      <div style={{ padding: 16, border: "1px solid var(--line)", borderRadius: 8 }}><h2>{metadata.targetLabel}</h2><p>{new URL(metadata.binding.siteOrigin).hostname} · {metadata.binding.product === "jira" ? "Jira project" : "Confluence space"}</p></div>
      {!metadata.organizations.length && <p role="alert">A current workspace owner or administrator must connect the project. Ask one to open this setup link while signed in to Vaettir.</p>}
      {!!metadata.organizations.length && <fieldset disabled={connect.isPending || retained} style={{ border: 0, padding: 0, display: "grid", gap: 16 }}>
        <label style={{ display: "grid", gap: 8 }}>Workspace<select value={workspace} onChange={event => setWorkspace(event.target.value)}><option value="">All my administrator workspaces</option>{metadata.organizations.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}</select></label>
        <label style={{ display: "grid", gap: 8 }}>Find a project<input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search project names" /></label>
        <label style={{ display: "grid", gap: 8 }}>Vaettir project<select value={chosen?.id ?? ""} disabled={!current || loading} onChange={event => {
          const project = current?.projects.find(p => p.id === event.target.value);
          setSelected(project && current ? { ...project, actor: auth.userId!, digest: current.requestDigest } : null);
        }}><option value="">Choose the project to connect</option>{current?.projects.map(project => <option key={project.id} value={project.id}>{project.name} · {current.organizations.find(org => org.id === project.organizationId)?.name}</option>)}</select></label>
        {current?.catalogLimited && <p>More projects are available. Choose a workspace or search to narrow this list.</p>}
        {chosen && <div style={{ padding: 16, border: "1px solid var(--line)", borderRadius: 8 }}><h2>Read-only access for {chosen.name}</h2>
          <p>People who can view {metadata.targetLabel} can see this Vaettir project’s approved quality summaries{metadata.binding.product === "jira" ? " and verification tests explicitly linked to its Jira tickets" : ""}. Newly approved quality captures appear without reconnecting.</p>
          <p>Draft reports, test procedures, source code, attachments and architecture mappings stay private. This does not allow Jira or Confluence to edit tests, run them, import data or spend AI credits.</p>
          <p>You can stop this connection in the project’s integration settings.</p>
        </div>}
        <button type="button" className="btn-primary" disabled={!chosen || loading} onClick={() => void confirm()}>Connect project</button>
      </fieldset>}
      {retained && pendingMatches && <button type="button" className="btn-primary" disabled={connect.isPending || loading || !current} onClick={() => void confirm()}>{connect.isPending ? "Connecting project…" : "Confirm connection status"}</button>}
    </>}
  </section>;
}
