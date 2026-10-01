"use client";
import {useState} from "react";
import {trpcReact} from "@/lib/trpcReact";
import {ProviderMark} from "./SourceConnectionChips";

type ProjectChoice={id:string;name:string;url:string};
type Listing={workspace:{id:string;name:string};account:{id:string;name:string};projects:ProjectChoice[];version:number;catalogReset:boolean;nextCursor:string|null;bounded:boolean};
const field={display:"grid",gap:6} as const;
const actions={display:"flex",gap:8,flexWrap:"wrap"} as const;
const inputStyle={width:"100%",minWidth:0,boxSizing:"border-box"} as const;

export function LinearSourceConnection({projectId,onClose}:{projectId:string;onClose:()=>void}){
  const utils=trpcReact.useUtils();
  const capabilities=trpcReact.linearConnections.capabilities.useQuery({projectId});
  const recent=trpcReact.linearConnections.mine.useQuery({projectId},{enabled:capabilities.data?.canConnect===true});
  const verify=trpcReact.linearConnections.verify.useMutation();
  const approve=trpcReact.linearConnections.approve.useMutation();
  const forget=trpcReact.linearConnections.forget.useMutation();
  const [step,setStep]=useState<"access"|"projects"|"review"|"done">("access");
  const [apiKey,setApiKey]=useState("");const [consent,setConsent]=useState(false);
  const [requestId,setRequestId]=useState<string|null>(null);const [approvalId,setApprovalId]=useState<string|null>(null);
  const [id,setId]=useState("");const [listing,setListing]=useState<Listing|null>(null);
  const [selected,setSelected]=useState<Record<string,ProjectChoice>>({});
  const [existing,setExisting]=useState<ProjectChoice[]>([]);const [search,setSearch]=useState("");
  const [loading,setLoading]=useState(false);const [error,setError]=useState("");const [removing,setRemoving]=useState("");
  const busy=loading||verify.isPending||approve.isPending||forget.isPending;
  const choices=Object.values(selected);
  async function load(connectionId:string,after:string|null=null){
    setLoading(true);setError("");
    try{
      const result=await utils.linearConnections.list.fetch({id:connectionId,after});
      setSelected(prior=>{const next=result.catalogReset?{}:{...prior};for(const p of result.projects)if(next[p.id])next[p.id]=p;return next;});
      setListing(result);setId(connectionId);setApprovalId(null);setStep("projects");
    }catch{setError("Could not refresh Linear projects. Check access and retry. Previously approved scope is retained.");}
    finally{setLoading(false);}
  }
  return <div style={{display:"grid",gap:16,minWidth:0}}>
    <p role="status">{{access:"1. Verify Linear access",projects:"2. Choose Linear projects",review:"3. Review source scope",done:"Source scope saved"}[step]}</p>
    {(error||capabilities.error)&&<p role="alert">{error||"Connection availability could not be checked. Retry before entering a key."}</p>}
    {step==="access"&&<>
      <p>Connect a Linear workspace, then choose the projects that belong here. This checks account and project metadata only; it does not read issues, import requirements or use AI credits.</p>
      {capabilities.isLoading&&<p role="status">Checking connection availability…</p>}
      {capabilities.data&&!capabilities.data.canConnect&&<p role="alert">A full editor seat is required. Ask a workspace owner or admin to connect Linear.</p>}
      {capabilities.data&&!capabilities.data.credentialStorageReady&&<p role="alert">Secure credential storage is unavailable. Ask Vaettir support to enable Linear connections.</p>}
      <details><summary>Browser authorization</summary><p>Linear OAuth is not available in this version. No registered application is used by this flow. Use an approved read-only personal API key below.</p></details>
      {recent.data?.length? <section style={{display:"grid",gap:8}}><h3>Previous connections</h3>{recent.data.map(c=><div key={c.id} style={{display:"grid",gap:8}}><div style={actions}><button type="button" className="source-connection-chip" disabled={busy||c.status!=="VERIFIED"} onClick={()=>{setExisting(c.approvedProjects);setSelected({});void load(c.id);}}><ProviderMark id="linear"/><span style={{overflowWrap:"anywhere"}}><strong>{c.workspace?.name??"Linear verification"}</strong><small>{c.status==="VERIFIED"?"Resume project selection":c.status.toLowerCase()} · {c.approvedProjects.length} approved</small></span></button>{c.status!=="DISCONNECTED"&&<button type="button" className="btn-secondary" disabled={busy} onClick={()=>setRemoving(c.id)}>Remove saved access</button>}</div>{c.approvedProjects.length>0&&<p className="text-muted">Approved scope retained: {c.approvedProjects.map(p=>p.name).join(", ")}</p>}</div>)}</section>:null}
      {removing&&<section role="group" aria-label="Remove Linear access"><p>Remove this key from Vaettir? Approved project scope and existing requirements stay in place. Revoke the key in Linear to stop its use elsewhere.</p><div style={actions}><button type="button" className="btn-secondary" disabled={busy} onClick={()=>setRemoving("")}>Keep access</button><button type="button" disabled={busy} onClick={async()=>{try{await forget.mutateAsync({id:removing,confirmed:true});setRemoving("");await recent.refetch();}catch{setError("Could not remove saved access. Refresh your permissions and retry.");}}}>Remove from Vaettir</button></div></section>}
      {capabilities.data?.credentialStorageReady&&capabilities.data.canConnect&&<form style={{display:"grid",gap:12}} onSubmit={async event=>{
        event.preventDefault();setError("");const attempt=requestId??crypto.randomUUID();setRequestId(attempt);
        try{const result=await verify.mutateAsync({projectId,requestId:attempt,apiKey,approveMetadataAccess:true});setApiKey("");setConsent(false);setId(result.id);setExisting([]);setSelected({});await recent.refetch();await load(result.id);}catch{await recent.refetch();setError("Linear access could not be verified. Check key permissions and retry, or start a new attempt. No project scope was saved.");}
      }}>
        <a target="_blank" rel="noopener noreferrer" href="https://linear.app/settings/account/security">Open Linear Security & access ↗</a>
        <p className="text-muted">Choose read-only permissions and the required teams when creating the key. Vaettir sends only metadata read queries; it cannot prove a supplied key has no write permissions.</p>
        <label style={field}>Linear API key<input style={inputStyle} disabled={busy} type="password" autoComplete="new-password" required maxLength={10000} value={apiKey} onChange={e=>{setApiKey(e.target.value);setRequestId(null);}}/></label>
        <p className="text-muted">Access is encrypted and expires in Vaettir after eight hours. Do not paste a key into project documents.</p>
        <label style={{display:"flex",gap:8,alignItems:"flex-start"}}><input type="checkbox" disabled={busy} checked={consent} onChange={e=>setConsent(e.target.checked)}/><span>I approve checking this key's account, workspace and project metadata.</span></label>
        <button type="submit" disabled={busy||!consent||!apiKey.trim()}>{verify.isPending?"Verifying…":"Verify and choose projects"}</button>
        {requestId&&error&&<button type="button" className="btn-secondary" disabled={busy} onClick={()=>{setRequestId(null);setError("");}}>Start new verification attempt</button>}
      </form>}
      <button type="button" className="btn-secondary" disabled={busy} onClick={onClose}>Cancel</button>
    </>}
    {step==="projects"&&listing&&<>
      <p>Workspace: <strong>{listing.workspace.name}</strong><br/>Verified account: {listing.account.name}</p>
      <label style={field}>Filter this page<input style={inputStyle} value={search} maxLength={100} onChange={e=>setSearch(e.target.value)} placeholder="Project name"/></label>
      <span role="status">{choices.length} selected across visited pages</span>
      <div className="source-chip-list" role="group" aria-label="Verified Linear projects" style={{maxHeight:300,overflowY:"auto"}}>{listing.projects.filter(p=>p.name.toLowerCase().includes(search.toLowerCase())).map(p=><button key={p.id} type="button" className="source-connection-chip" aria-pressed={!!selected[p.id]} disabled={busy||choices.length>=100&&!selected[p.id]} style={{maxWidth:"100%",textAlign:"left"}} onClick={()=>{setApprovalId(null);setSelected(prior=>{const next={...prior};if(next[p.id])delete next[p.id];else next[p.id]=p;return next;});}}><ProviderMark id="linear"/><span style={{minWidth:0,overflowWrap:"anywhere"}}><strong>{p.name}</strong><small>{existing.some(x=>x.id===p.id)?"Already approved":"Metadata only"}</small></span>{selected[p.id]&&<span aria-hidden="true">✓</span>}</button>)}</div>
      {!listing.projects.length&&<p>No accessible projects were returned. Check team access in Linear.</p>}
      {listing.bounded&&<p role="status">This catalog reached its page limit. Review this batch; it is not the entire workspace.</p>}
      <div style={actions}><button type="button" className="btn-secondary" disabled={busy} onClick={()=>void load(id)}>Refresh first page</button><button type="button" className="btn-secondary" disabled={busy||!listing.nextCursor} onClick={()=>void load(id,listing.nextCursor)}>Next page</button></div>
      <div style={actions}><button type="button" className="btn-secondary" disabled={busy} onClick={()=>setStep("access")}>Back</button><button type="button" disabled={busy||!choices.length} onClick={()=>setStep("review")}>Review {choices.length} selected</button></div>
    </>}
    {step==="review"&&listing&&<>
      <p>Add {choices.length} selected project{choices.length===1?"":"s"} from <strong>{listing.workspace.name}</strong> to this project's source scope?</p>
      <ul style={{maxHeight:240,overflowY:"auto",overflowWrap:"anywhere"}}>{choices.map(p=><li key={p.id}><a href={p.url} target="_blank" rel="noopener noreferrer">{p.name}</a>{existing.some(x=>x.id===p.id)?" · already approved":" · new"}</li>)}</ul>
      <p>{existing.length} previously approved project{existing.length===1?"":"s"} will be retained. Nothing is removed when an input disappears or access fails.</p>
      <p>Save scope only. Issue import and automatic sync are not implemented by this connection flow; no requirements or test cases will be created or changed. Cost: 0 AI credits.</p>
      <div style={actions}><button type="button" className="btn-secondary" disabled={busy} onClick={()=>setStep("projects")}>Back</button><button type="button" disabled={busy} onClick={async()=>{const request=approvalId??crypto.randomUUID();setApprovalId(request);try{await approve.mutateAsync({id,version:listing.version,projectIds:choices.map(p=>p.id),requestId:request,approved:true});await recent.refetch();setStep("done");}catch{setError("Scope could not be saved. Retry, or refresh the list and review if access or choices changed.");}}}>{approve.isPending?"Saving…":"Approve and save source scope"}</button></div>
    </>}
    {step==="done"&&<><p role="status">Linear source scope saved. Issues have not been read or imported.</p><button type="button" onClick={onClose}>Done</button></>}
  </div>;
}
