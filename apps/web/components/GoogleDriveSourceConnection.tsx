"use client";

import {useEffect,useRef,useState} from "react";
import {trpcReact} from "@/lib/trpcReact";
import {ProviderMark} from "./SourceConnectionChips";
import {PopulationDocuments} from "./PopulationDocuments";

type DriveFile={id:string;name:string;mimeType:string;url:string;modifiedTime:string|null;parents:string[]};
type Catalog={account:{id:string;name:string;email:string|null}|null;files:DriveFile[];version:number;nextCursor:string|null;bounded:boolean};
const folderMime="application/vnd.google-apps.folder";
const actions={display:"flex",gap:8,flexWrap:"wrap"} as const;
const field={display:"grid",gap:6} as const;
const inputStyle={width:"100%",minWidth:0,boxSizing:"border-box"} as const;

export function GoogleDriveSourceConnection({projectId,onClose}:{projectId:string;onClose:()=>void}){
  const capabilities=trpcReact.driveConnections.capabilities.useQuery({projectId});
  const recent=trpcReact.driveConnections.mine.useQuery({projectId},{enabled:capabilities.data?.canConnect===true});
  const begin=trpcReact.driveConnections.begin.useMutation();
  const list=trpcReact.driveConnections.list.useMutation();
  const approve=trpcReact.driveConnections.approve.useMutation();
  const forget=trpcReact.driveConnections.forget.useMutation();
  const [step,setStep]=useState<"authorize"|"files"|"review"|"done"|"exports">("authorize");
  const [id,setId]=useState("");const [consent,setConsent]=useState(false);
  const [catalog,setCatalog]=useState<Catalog|null>(null);
  const [selected,setSelected]=useState<Record<string,DriveFile>>({});
  const [existing,setExisting]=useState<DriveFile[]>([]);
  const [folderId,setFolderId]=useState<string|null>(null);const [folderName,setFolderName]=useState("My Drive");
  const [search,setSearch]=useState("");const [activeSearch,setActiveSearch]=useState("");
  const [error,setError]=useState("");const [removing,setRemoving]=useState("");
  const [beginRequest,setBeginRequest]=useState<string|null>(null);const [approvalRequest,setApprovalRequest]=useState<string|null>(null);
  const [pageRequest,setPageRequest]=useState<{requestId:string;folderId:string|null;search:string;after:string|null;version?:number}|null>(null);
  const popup=useRef<Window|null>(null);const alive=useRef(true);const generation=useRef(0);const connection=useRef("");
  const snapshot=trpcReact.driveConnections.snapshot.useQuery({id},{enabled:!!id,refetchInterval:step==="authorize"&&!!id?2000:false});
  const busy=begin.isPending||list.isPending||approve.isPending||forget.isPending;
  const choices=Object.values(selected);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;popup.current?.close();};},[]);
  useEffect(()=>{connection.current=id;},[id]);
  useEffect(()=>{
    function received(event:MessageEvent){
      if(event.origin!==window.location.origin||event.source!==popup.current||event.data?.channel!=="vaettir-drive-authorization")return;
      if(event.data.id&&event.data.id!==connection.current)return;
      if(event.data.status==="success")void snapshot.refetch();
      else if(event.data.status==="error")setError("Google authorization was canceled or could not be verified. Start a new authorization attempt.");
    }
    window.addEventListener("message",received);return()=>window.removeEventListener("message",received);
  },[snapshot]);
  useEffect(()=>{
    const saved=snapshot.data;if(!saved)return;
    // Reconcile external authorization/polling on the next task; cleanup cancels stale snapshots.
    const timer=setTimeout(()=>{
      if(!alive.current||saved.id!==connection.current)return;
      if(saved.status==="VERIFIED"&&step==="authorize"){
        setExisting(saved.approvedFiles);setCatalog(saved);setFolderId(saved.folderId);setFolderName(saved.folderId?"saved folder":"My Drive");setSearch(saved.search);setActiveSearch(saved.search);setStep("files");popup.current?.close();
      }else if(["FAILED","CANCELED","DISCONNECTED","EXPIRED"].includes(saved.status)&&step==="authorize"){
        setError("Authorization is no longer available. Start a new attempt; previously approved files are retained.");
      }
    },0);
    return()=>clearTimeout(timer);
  },[snapshot.data,step]);
  async function load(connectionId:string,targetFolder:string|null,query:string,after:string|null=null,retry=false){
    const attempt=retry&&pageRequest?pageRequest:{requestId:crypto.randomUUID(),folderId:targetFolder,search:query,after,...(catalog?{version:catalog.version}:{})};
    const current=++generation.current;setPageRequest(attempt);setError("");
    try{
      const result=await list.mutateAsync({id:connectionId,...attempt});
      if(!alive.current||current!==generation.current)return;
      setSelected(prior=>{const next=result.catalogReset?{}:{...prior};for(const f of result.files)if(next[f.id])next[f.id]=f;return next;});
      setCatalog(result);setId(connectionId);setFolderId(attempt.folderId);setActiveSearch(attempt.search);setApprovalRequest(null);setPageRequest(null);setStep("files");
    }catch{if(alive.current&&current===generation.current)setError("Drive files could not be loaded. Retry this page or refresh saved status. Approved scope stays unchanged.");}
  }
  async function refreshSaved(){
    const current=++generation.current;const result=await snapshot.refetch();
    if(!alive.current||current!==generation.current||!result.data)return;
    if(result.data.status!=="VERIFIED"){setError("Saved access is no longer verified. Remove access and authorize again; approved files are retained.");return;}
    setCatalog(result.data);setExisting(result.data.approvedFiles);setFolderId(result.data.folderId);setFolderName(result.data.folderId?"saved folder":"My Drive");setSearch(result.data.search);setActiveSearch(result.data.search);setSelected({});setPageRequest(null);setApprovalRequest(null);setError("");
  }
  async function authorize(){
    if(!consent)return;
    // Open within the click event before awaiting the server so popup blockers do not hide authorization.
    popup.current?.close();
    const opened=window.open("about:blank","vaettir-drive-authorization","popup,width=600,height=720");
    if(!opened){setError("Allow this site's authorization popup, then try again. Nothing was connected.");return;}
    popup.current=opened;setError("");const current=++generation.current;
    const requestId=beginRequest??crypto.randomUUID();setBeginRequest(requestId);
    try{
      const result=await begin.mutateAsync({projectId,requestId,approveMetadataAccess:true});
      if(!alive.current||current!==generation.current){opened.close();return;}
      const url=new URL(result.authorizationUrl);
      if(url.protocol!=="https:"||url.hostname!=="accounts.google.com"||url.pathname!=="/o/oauth2/v2/auth")throw new Error("Unexpected authorization destination");
      connection.current=result.id;setId(result.id);setExisting([]);setSelected({});setCatalog(null);opened.location.href=url.href;
    }catch{opened.close();if(alive.current&&current===generation.current){setError("Authorization could not start. Check saved connections and retry, or cancel a pending attempt. No files were selected.");await recent.refetch();}}
  }
  return <div style={{display:"grid",gap:16,minWidth:0}}>
    <p role="status">{{authorize:"1. Authorize Google Drive",files:"2. Choose files",review:"3. Review file scope",done:"File scope saved",exports:"Add exported documents"}[step]}</p>
    {(error||capabilities.error)&&<p role="alert">{error||"Connection availability could not be checked. Retry before authorizing."}</p>}
    {snapshot.error&&<p role="alert">Saved authorization status could not be checked. Retry the status check; do not assume the account is connected.</p>}
    {step==="authorize"&&<>
      <p>Verify your Google account and choose individual files. Vaettir lists file names and folder metadata only. File contents, document import and AI processing are not enabled.</p>
      <details><summary>Metadata access and launch requirements</summary><p>Google&apos;s metadata read-only grant covers Drive metadata, not just the files you select in Vaettir. Vaettir saves only the reviewed individual-file scope. Shared drives and shortcuts are not supported. The restricted <code>drive.metadata.readonly</code> scope requires Google app verification and a security assessment when applicable before public production launch; registering OAuth credentials alone does not prove approval.</p><a href="https://developers.google.com/workspace/drive/api/guides/api-specific-auth" target="_blank" rel="noopener noreferrer">Google&apos;s scope and verification requirements ↗</a></details>
      {capabilities.isLoading&&<p role="status">Checking connection availability…</p>}
      {capabilities.error&&<button type="button" disabled={busy} onClick={()=>void capabilities.refetch()}>Retry availability check</button>}
      {capabilities.data&&!capabilities.data.canConnect&&<p role="alert">A full editor seat is required. Ask a workspace owner or admin to connect Drive.</p>}
      {capabilities.data&&(!capabilities.data.credentialStorageReady||!capabilities.data.oauthAvailable)&&<section role="group" aria-label="Drive setup required"><p>Google authorization is not configured for this Vaettir environment. No account can be connected yet.</p><details><summary>Platform administrator setup</summary><p>Register a Google OAuth web application and configure GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET and WEB_APP_URL in the API environment, with encrypted credential storage enabled. WEB_APP_URL must be this Vaettir HTTPS origin. Register that origin followed by <code>/connections/drive/callback</code> as the exact Google redirect URL. Use Google&apos;s Drive metadata read-only scope; do not grant content or write scopes.</p></details></section>}
      {recent.error&&<p role="alert">Saved connections could not be loaded. Retry before creating another connection.</p>}
      {!!recent.data?.length&&<section style={{display:"grid",gap:8}}><h3>Saved connections</h3>{recent.data.map(c=><div key={c.id} style={{display:"grid",gap:8}}><div style={actions}><button type="button" className="source-connection-chip" disabled={busy||!["VERIFIED","PENDING","VERIFYING"].includes(c.status)} onClick={()=>{generation.current++;setSelected({});setCatalog(null);setExisting(c.approvedFiles);setId(c.id);setError("");setBeginRequest(null);}}><ProviderMark id="drive"/><span style={{minWidth:0,overflowWrap:"anywhere"}}><strong>{c.account?.name??"Google Drive authorization"}</strong><small>{c.status==="VERIFIED"?"Resume file selection":["PENDING","VERIFYING"].includes(c.status)?"Check pending authorization":c.status.toLowerCase()} · {c.approvedFiles.length} approved</small></span></button>{c.status!=="DISCONNECTED"&&<button type="button" className="btn-secondary" disabled={forget.isPending} onClick={()=>setRemoving(c.id)}>Remove saved access</button>}</div>{!!c.approvedFiles.length&&<p style={{overflowWrap:"anywhere"}} className="text-muted">Approved files retained: {c.approvedFiles.map(f=>f.name).join(", ")}</p>}</div>)}</section>}
      {capabilities.data?.canConnect&&capabilities.data.credentialStorageReady&&capabilities.data.oauthAvailable&&<><label style={{display:"flex",gap:8,alignItems:"flex-start"}}><input type="checkbox" disabled={busy} checked={consent} onChange={e=>setConsent(e.target.checked)}/><span>I approve verifying my Google account and listing file and folder metadata.</span></label><button type="button" disabled={busy||!consent||recent.isLoading||!!recent.error} onClick={()=>void authorize()}>{begin.isPending?"Opening authorization…":"Authorize with Google"}</button><p className="text-muted">Google opens in a separate window. Access is encrypted; approval here does not permit content reading.</p></>}
      {id&&snapshot.data?.status!=="VERIFIED"&&<div style={actions}><button type="button" className="btn-secondary" disabled={busy} onClick={()=>void snapshot.refetch()}>Check authorization status</button><button type="button" className="btn-secondary" disabled={forget.isPending} onClick={()=>setRemoving(id)}>Cancel pending authorization</button></div>}
      {beginRequest&&<button type="button" className="btn-secondary" disabled={busy} onClick={()=>{if(id&&["PENDING","VERIFYING"].includes(snapshot.data?.status??"PENDING")){setRemoving(id);return;}popup.current?.close();setBeginRequest(null);setId("");setError("");setConsent(false);}}>Start a new authorization attempt</button>}
      <button type="button" className="btn-secondary" disabled={busy||capabilities.data?.canConnect!==true} onClick={()=>setStep("exports")}>Use an export instead</button>
      <button type="button" className="btn-secondary" onClick={onClose}>Close and resume later</button>
    </>}
    {step==="files"&&catalog&&<>
      <p>Verified account: <strong style={{overflowWrap:"anywhere"}}>{catalog.account?.name}</strong>{catalog.account?.email&&<small style={{display:"block",overflowWrap:"anywhere"}}>{catalog.account.email}</small>}</p>
      <form style={{display:"grid",gap:8}} onSubmit={e=>{e.preventDefault();void load(id,folderId,search.trim());}}><label style={field}>Search names in {folderId?folderName:"My Drive"}<input style={inputStyle} disabled={busy} maxLength={100} value={search} onChange={e=>setSearch(e.target.value)} placeholder="File or folder name"/></label><div style={actions}><button type="submit" disabled={busy}>Search Drive metadata</button><button type="button" className="btn-secondary" disabled={busy} onClick={()=>{setFolderName("My Drive");setSearch("");void load(id,null,"");}}>Browse My Drive</button></div></form>
      <p role="status">{choices.length} files selected across visited pages. Opening a folder lists its children; it does not approve all of them.</p>
      <div role="group" aria-label="Verified Drive files" style={{display:"grid",gap:8,maxHeight:300,overflowY:"auto",minWidth:0}}>{catalog.files.map(f=>f.mimeType===folderMime?<button type="button" className="source-connection-chip" style={{textAlign:"left",maxWidth:"100%"}} key={f.id} disabled={busy} onClick={()=>{setFolderName(f.name);setSearch("");void load(id,f.id,"");}}><ProviderMark id="drive"/><span style={{minWidth:0,overflowWrap:"anywhere"}}><strong>{f.name}</strong><small>Folder · open to choose individual files</small></span><span aria-hidden="true">→</span></button>:<button type="button" key={f.id} className="source-connection-chip" style={{textAlign:"left",maxWidth:"100%"}} aria-pressed={!!selected[f.id]} disabled={busy||f.mimeType==="application/vnd.google-apps.shortcut"||choices.length>=100&&!selected[f.id]} onClick={()=>{setApprovalRequest(null);setSelected(prior=>{const next={...prior};if(next[f.id])delete next[f.id];else next[f.id]=f;return next;});}}><ProviderMark id="drive"/><span style={{minWidth:0,overflowWrap:"anywhere"}}><strong>{f.name}</strong><small>{f.mimeType==="application/vnd.google-apps.shortcut"?"Shortcut · choose the original file instead":existing.some(x=>x.id===f.id)?"Already approved":"Metadata only"}{f.modifiedTime&&` · ${f.modifiedTime.slice(0,10)}`}</small></span>{selected[f.id]&&<span aria-hidden="true">✓</span>}</button>)}</div>
      {!catalog.files.length&&<p>No files are listed yet. Search or browse metadata to choose files; inaccessible files are not removed from existing scope.</p>}
      {catalog.bounded&&<p role="status">This catalog reached its limit. Review this batch; it is not a complete inventory.</p>}
      {pageRequest&&error&&<button type="button" disabled={busy} onClick={()=>void load(id,pageRequest.folderId,pageRequest.search,pageRequest.after,true)}>Retry this page</button>}
      <div style={actions}><button type="button" className="btn-secondary" disabled={busy} onClick={()=>void load(id,folderId,activeSearch)}>Refresh first page</button><button type="button" className="btn-secondary" disabled={busy||!catalog.nextCursor} onClick={()=>void load(id,folderId,activeSearch,catalog.nextCursor)}>Next page</button><button type="button" className="btn-secondary" title="Refresh the saved catalog and reset unapproved selections" disabled={busy||snapshot.isFetching} onClick={()=>void refreshSaved()}>Refresh saved status</button></div>
      <div style={actions}><button type="button" className="btn-secondary" disabled={busy} onClick={()=>{setId("");setStep("authorize");}}>Back</button><button type="button" disabled={busy||!choices.length} onClick={()=>setStep("review")}>Review {choices.length} selected</button><button type="button" className="btn-secondary" disabled={forget.isPending} onClick={()=>setRemoving(id)}>Remove saved access</button></div>
    </>}
    {step==="review"&&catalog&&<>
      <p>Add {choices.length} individual file{choices.length===1?"":"s"} to this project&apos;s source scope?</p>
      <ul style={{maxHeight:240,overflowY:"auto",overflowWrap:"anywhere"}}>{choices.map(f=><li key={f.id}><a href={f.url} target="_blank" rel="noopener noreferrer">{f.name}</a>{existing.some(x=>x.id===f.id)?" · already approved":" · new"}</li>)}</ul>
      <p>{existing.length} previously approved files will be retained. No recursive folder scope, file contents, document import, AI processing or ongoing sync is approved. Cost: 0 AI credits.</p>
      <div style={actions}><button type="button" className="btn-secondary" disabled={busy} onClick={()=>setStep("files")}>Back</button><button type="button" disabled={busy} onClick={async()=>{const requestId=approvalRequest??crypto.randomUUID();setApprovalRequest(requestId);const current=++generation.current;setError("");try{await approve.mutateAsync({id,version:catalog.version,fileIds:choices.map(f=>f.id),requestId,approved:true});if(!alive.current||current!==generation.current)return;await recent.refetch();if(alive.current&&current===generation.current)setStep("done");}catch{if(alive.current&&current===generation.current)setError("File scope could not be saved. Retry this approval or refresh metadata and review if access changed. Existing scope stays unchanged.");}}}>{approve.isPending?"Saving…":"Approve and save file scope"}</button></div>
    </>}
    {step==="done"&&<><p role="status">Drive file scope saved. No contents were read or imported.</p><button type="button" onClick={onClose}>Done</button></>}
    {step==="exports"&&<><p>Add exported document evidence for review. This does not connect Google Drive.</p><PopulationDocuments projectId={projectId}/><button type="button" className="btn-secondary" onClick={()=>setStep("authorize")}>Back to connection</button></>}
    {removing&&<section role="group" aria-label="Remove Drive access"><p>Remove saved access from Vaettir? Previously approved files and existing project records stay in place. To revoke Google&apos;s grant, also remove Vaettir from your Google account&apos;s third-party connections.</p><a href="https://myaccount.google.com/connections" target="_blank" rel="noopener noreferrer">Open Google account connections ↗</a><div style={actions}><button type="button" className="btn-secondary" disabled={forget.isPending} onClick={()=>setRemoving("")}>Keep access</button><button type="button" disabled={forget.isPending} onClick={async()=>{const removedId=removing;generation.current++;setError("");try{await forget.mutateAsync({id:removedId,confirmed:true});if(!alive.current)return;popup.current?.close();setRemoving("");if(id===removedId){setId("");setCatalog(null);setSelected({});setConsent(false);setBeginRequest(null);setStep("authorize");}await recent.refetch();}catch{if(alive.current)setError("Saved access could not be removed. Refresh permissions and retry.");}}}>Remove from Vaettir</button></div></section>}
  </div>;
}
