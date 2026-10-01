"use client";
import {useState} from "react";
import {trpcReact} from "@/lib/trpcReact";
import {ProviderMark} from "./SourceConnectionChips";
import {PopulationDocuments} from "./PopulationDocuments";
import {JiraIssueIntake} from "./JiraIssueIntake";
import {connectionAccessState} from "@/lib/connection-access";
import {ConnectionAccessGate} from "./ConnectionAccessGate";

type ProjectChoice={id:string;key:string;name:string;url:string};
type Listing={workspace:{id:string;name:string};account:{id:string;name:string};projects:ProjectChoice[];version:number;catalogReset:boolean;nextCursor:number|null;bounded:boolean};
const field={display:"grid",gap:6} as const;
const actions={display:"flex",gap:8,flexWrap:"wrap"} as const;
const inputStyle={width:"100%",minWidth:0,boxSizing:"border-box"} as const;

export function JiraSourceConnection({projectId,onClose}:{projectId:string;onClose:()=>void}){
  const utils=trpcReact.useUtils();
  const capabilities=trpcReact.jiraConnections.capabilities.useQuery({projectId});
  const recent=trpcReact.jiraConnections.mine.useQuery({projectId},{enabled:capabilities.isSuccess&&capabilities.data.canConnect});
  const verify=trpcReact.jiraConnections.verify.useMutation();
  const approve=trpcReact.jiraConnections.approve.useMutation();
  const forget=trpcReact.jiraConnections.forget.useMutation();
  const [step,setStep]=useState<"access"|"projects"|"review"|"done"|"exports"|"issues">("access");
  const [siteUrl,setSiteUrl]=useState("");const [email,setEmail]=useState("");const [apiToken,setApiToken]=useState("");const [consent,setConsent]=useState(false);
  const [requestId,setRequestId]=useState<string|null>(null);const [approvalId,setApprovalId]=useState<string|null>(null);
  const [id,setId]=useState("");const [listing,setListing]=useState<Listing|null>(null);
  const [selected,setSelected]=useState<Record<string,ProjectChoice>>({});
  const [existing,setExisting]=useState<ProjectChoice[]>([]);const [search,setSearch]=useState("");
  const [loading,setLoading]=useState(false);const [error,setError]=useState("");const [removing,setRemoving]=useState("");
  const busy=loading||verify.isPending||approve.isPending||forget.isPending;
  const choices=Object.values(selected);
  function changed(){setRequestId(null);setConsent(false);}
  async function load(connectionId:string,after:number|null=null){
    setLoading(true);setError("");
    try{
      const result=await utils.jiraConnections.list.fetch({id:connectionId,after});
      setSelected(prior=>{const next=result.catalogReset?{}:{...prior};for(const p of result.projects)if(next[p.id])next[p.id]=p;return next;});
      setListing(result);setId(connectionId);setApprovalId(null);setSearch("");setStep("projects");
    }catch{setError("Could not refresh Jira projects. Check access and retry. Previously approved scope is retained.");}
    finally{setLoading(false);}
  }
  const accessState=connectionAccessState(capabilities,recent);
  if(accessState!=="ready")return <ConnectionAccessGate state={accessState} busy={busy||capabilities.isFetching||recent.isFetching} onClose={onClose} onRetry={()=>void (async()=>{const refreshed=await capabilities.refetch();if(refreshed.isSuccess&&refreshed.data.canConnect)await recent.refetch();})()}/>;
  return <div style={{display:"grid",gap:16,minWidth:0}}>
    <p role="status">{{access:"1. Verify Jira Cloud access",projects:"2. Choose Jira projects",review:"3. Review source scope",done:"Source scope saved",exports:"Add exported Jira evidence",issues:"Review Jira issue intake"}[step]}</p>
    {(error||capabilities.error)&&<p role="alert">{error||"Connection availability could not be checked. Retry before entering a token."}</p>}
    {step==="access"&&<>
      <p>Verify your Jira Cloud account, then choose projects. This checks account and project metadata only; it does not read issues, import requirements or use AI credits.</p>
      {capabilities.isLoading&&<p role="status">Checking connection availability…</p>}
      {capabilities.error&&<button type="button" disabled={busy} onClick={()=>void capabilities.refetch()}>Retry availability check</button>}
      {capabilities.data&&!capabilities.data.canConnect&&<p role="alert">A full editor seat is required. Ask a workspace owner or admin to connect Jira.</p>}
      {capabilities.data&&!capabilities.data.credentialStorageReady&&<p role="alert">Secure credential storage is unavailable. Ask Vaettir support to enable Jira connections.</p>}
      {recent.error&&<p role="alert">Previous connections could not be loaded. Retry before verifying another token.</p>}
      {recent.data?.length? <section style={{display:"grid",gap:8}}><h3>Previous connections</h3>{recent.data.map(c=><div key={c.id} style={{display:"grid",gap:8}}><div style={actions}><button type="button" className="source-connection-chip" disabled={busy||c.status!=="VERIFIED"} onClick={()=>{setExisting(c.approvedProjects);setSelected({});void load(c.id);}}><ProviderMark id="jira"/><span style={{overflowWrap:"anywhere"}}><strong>{c.workspace?.name??c.siteUrl??"Jira verification"}</strong><small>{c.status==="VERIFIED"?"Resume project selection":c.status.toLowerCase()} · {c.approvedProjects.length} approved</small></span></button>{c.approvedProjects.length>0&&<button type="button" className="btn-secondary" disabled={busy||!recent.isSuccess} onClick={()=>{setId(c.id);setStep("issues");}}>Preview or resume Jira issues</button>}{c.status!=="DISCONNECTED"&&<button type="button" className="btn-secondary" disabled={busy} onClick={()=>setRemoving(c.id)}>Remove saved access</button>}</div>{c.approvedProjects.length>0&&<p className="text-muted">Approved scope retained: {c.approvedProjects.map(p=>`${p.key}: ${p.name}`).join(", ")}</p>}</div>)}</section>:null}
      {removing&&<section role="group" aria-label="Remove Jira access"><p>Remove this token from Vaettir? Approved project scope and existing requirements stay in place. Revoke the token in Atlassian to stop its use elsewhere.</p><div style={actions}><button type="button" className="btn-secondary" disabled={busy} onClick={()=>setRemoving("")}>Keep access</button><button type="button" disabled={busy} onClick={async()=>{try{await forget.mutateAsync({id:removing,confirmed:true});setRemoving("");await recent.refetch();}catch{setError("Could not remove saved access. Refresh your permissions and retry.");}}}>Remove from Vaettir</button></div></section>}
      {capabilities.data?.credentialStorageReady&&capabilities.data.canConnect&&<form style={{display:"grid",gap:12}} onSubmit={async event=>{
        event.preventDefault();if(!consent)return;setError("");const attempt=requestId??crypto.randomUUID();setRequestId(attempt);
        try{const result=await verify.mutateAsync({projectId,requestId:attempt,siteUrl,email,apiToken,approveMetadataAccess:true});setApiToken("");setConsent(false);setId(result.id);setExisting([]);setSelected({});await recent.refetch();await load(result.id);}catch{await recent.refetch();setError("Jira verification failed. Check your Cloud site, account email and a standard API token without scopes; retry or start a new attempt. No project scope was saved.");}
      }}>
        <label style={field}>Jira Cloud site<input style={inputStyle} disabled={busy} type="url" required maxLength={300} value={siteUrl} placeholder="https://your-team.atlassian.net" onChange={e=>{setSiteUrl(e.target.value);changed();}}/></label>
        <label style={field}>Atlassian account email<input style={inputStyle} disabled={busy} type="email" required maxLength={254} autoComplete="email" value={email} onChange={e=>{setEmail(e.target.value);changed();}}/></label>
        <label style={field}>Standard API token (without scopes)<input style={inputStyle} disabled={busy} type="password" autoComplete="new-password" required maxLength={10000} value={apiToken} onChange={e=>{setApiToken(e.target.value);changed();}}/></label>
        <a target="_blank" rel="noopener noreferrer" href="https://id.atlassian.com/manage-profile/security/api-tokens">Open Atlassian API token settings ↗</a>
        <details><summary>Which tokens work?</summary><p>Use a standard token created without scopes for your Jira Cloud site. Scoped tokens, browser OAuth and self-hosted Jira are not supported by this connector yet. Verification reads account and project metadata; issue summaries require separate permission and import review. Vaettir cannot prove a supplied token has no write permissions. Use an account limited to the projects you approve.</p></details>
        <p className="text-muted">Saved access is encrypted and expires in Vaettir after eight hours. Do not paste a token into project documents.</p>
        <label style={{display:"flex",gap:8,alignItems:"flex-start"}}><input type="checkbox" disabled={busy} checked={consent} onChange={e=>setConsent(e.target.checked)}/><span>I approve checking this site&apos;s account and project metadata.</span></label>
        <button type="submit" disabled={busy||!consent||!siteUrl.trim()||!email.trim()||!apiToken.trim()}>{verify.isPending?"Verifying…":"Verify and choose projects"}</button>
        {requestId&&error&&<button type="button" className="btn-secondary" disabled={busy} onClick={()=>{setRequestId(null);setError("");}}>Start new verification attempt</button>}
      </form>}
      <button type="button" className="btn-secondary" disabled={busy||capabilities.data?.canConnect!==true} onClick={()=>{setApiToken("");setConsent(false);setStep("exports");}}>Use an export instead</button>
      <button type="button" className="btn-secondary" disabled={busy} onClick={onClose}>Cancel</button>
    </>}
    {step==="projects"&&listing&&<>
      <p>Site: <strong style={{overflowWrap:"anywhere"}}>{listing.workspace.name}</strong><br/>Verified account: {listing.account.name}</p>
      <label style={field}>Filter this page<input style={inputStyle} value={search} maxLength={100} onChange={e=>setSearch(e.target.value)} placeholder="Project name or key"/></label>
      <span role="status">{choices.length} selected across visited pages</span>
      <div className="source-chip-list" role="group" aria-label="Verified Jira projects" style={{maxHeight:300,overflowY:"auto"}}>{listing.projects.filter(p=>`${p.name} ${p.key}`.toLowerCase().includes(search.toLowerCase())).map(p=><button key={p.id} type="button" className="source-connection-chip" aria-pressed={!!selected[p.id]} disabled={busy||choices.length>=100&&!selected[p.id]} style={{maxWidth:"100%",textAlign:"left"}} onClick={()=>{setApprovalId(null);setSelected(prior=>{const next={...prior};if(next[p.id])delete next[p.id];else next[p.id]=p;return next;});}}><ProviderMark id="jira"/><span style={{minWidth:0,overflowWrap:"anywhere"}}><strong>{p.name}</strong><small>{p.key} · {existing.some(x=>x.id===p.id)?"Already approved":"Metadata only"}</small></span>{selected[p.id]&&<span aria-hidden="true">✓</span>}</button>)}</div>
      {!listing.projects.length&&<p>No accessible projects were returned. Check Browse Projects access in Jira.</p>}
      {listing.bounded&&<p role="status">This catalog reached its page limit. Review this batch; it is not the entire site.</p>}
      <div style={actions}><button type="button" className="btn-secondary" disabled={busy} onClick={()=>void load(id)}>Refresh first page</button><button type="button" className="btn-secondary" disabled={busy||listing.nextCursor===null} onClick={()=>void load(id,listing.nextCursor)}>Next page</button></div>
      <div style={actions}><button type="button" className="btn-secondary" disabled={busy} onClick={()=>setStep("access")}>Back</button><button type="button" disabled={busy||!choices.length} onClick={()=>setStep("review")}>Review {choices.length} selected</button></div>
    </>}
    {step==="review"&&listing&&<>
      <p>Add {choices.length} selected project{choices.length===1?"":"s"} from <strong style={{overflowWrap:"anywhere"}}>{listing.workspace.name}</strong> to this project&apos;s source scope?</p>
      <ul style={{maxHeight:240,overflowY:"auto",overflowWrap:"anywhere"}}>{choices.map(p=><li key={p.id}><a href={p.url} target="_blank" rel="noopener noreferrer">{p.key}: {p.name}</a>{existing.some(x=>x.id===p.id)?" · already approved":" · new"}</li>)}</ul>
      <p>{existing.length} previously approved project{existing.length===1?"":"s"} will be retained. Nothing is removed when an input disappears or access fails.</p>
      <p>Save scope only. No requirements or test cases will be created or changed. Issue summaries require a separate read permission and reviewed import; automatic sync is not available. Cost: 0 AI credits.</p>
      <div style={actions}><button type="button" className="btn-secondary" disabled={busy} onClick={()=>setStep("projects")}>Back</button><button type="button" disabled={busy} onClick={async()=>{const request=approvalId??crypto.randomUUID();setApprovalId(request);try{await approve.mutateAsync({id,version:listing.version,projectIds:choices.map(p=>p.id),requestId:request,approved:true});await recent.refetch();setStep("done");}catch{setError("Scope could not be saved. Retry, or refresh the list and review if access or choices changed.");}}}>{approve.isPending?"Saving…":"Approve and save source scope"}</button></div>
    </>}
    {step==="done"&&<><p role="status">Jira source scope saved. Issues have not been read or imported.</p><button type="button" disabled={busy||!recent.isSuccess||!recent.data?.find(c=>c.id===id)?.approvedProjects.length} onClick={()=>setStep("issues")}>Preview Jira issues</button><button type="button" className="btn-secondary" onClick={onClose}>Done</button></>}
    {step==="issues"&&<JiraIssueIntake connectionId={id} projects={recent.data?.find(c=>c.id===id)?.approvedProjects??[]} onBack={()=>setStep("access")}/>}
    {step==="exports"&&<><p>Add an exported specification or ticket as text, then review its evidence. This does not connect a Jira account.</p><PopulationDocuments projectId={projectId}/><button type="button" className="btn-secondary" onClick={()=>setStep("access")}>Back to connection</button></>}
  </div>;
}
