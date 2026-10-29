"use client";
import {useEffect,useRef,useState} from "react";
import {useAuth} from "@clerk/nextjs";
import {trpcReact,type RouterInputs,type RouterOutputs} from "@/lib/trpcReact";
import {IconButton} from "./ui/IconButton";

type Product="jira"|"confluence";
type Listing=RouterOutputs["atlassianConnections"]["catalog"];
type Resource=Listing["resources"][number];
type Props={projectId:string;product:Product;onApproved?:(grantId:string)=>void;onWorkingChange?:(working:boolean)=>void};
export function AtlassianOAuthConnection(props:Props){
  const auth=useAuth();
  return <AtlassianOAuthSession key={`${props.projectId}:${props.product}:${auth.userId??"signed-out"}:${auth.sessionId??"no-session"}`} {...props}/>;
}
function AtlassianOAuthSession({projectId,product,onApproved,onWorkingChange}:Props){
  const {userId,isLoaded,isSignedIn}=useAuth(),utils=trpcReact.useUtils();
  const capabilities=trpcReact.atlassianConnections.capabilities.useQuery({projectId},{enabled:isLoaded&&isSignedIn,retry:false,staleTime:0});
  const mine=trpcReact.atlassianConnections.mine.useQuery({projectId,product},{enabled:capabilities.isSuccess&&capabilities.data.canConnect,retry:false,staleTime:0});
  const begin=trpcReact.atlassianConnections.begin.useMutation({retry:false}),selectSite=trpcReact.atlassianConnections.selectSite.useMutation({retry:false}),approve=trpcReact.atlassianConnections.approve.useMutation({retry:false}),renew=trpcReact.atlassianConnections.refresh.useMutation({retry:false}),disconnect=trpcReact.atlassianConnections.disconnect.useMutation({retry:false});
  const [id,setId]=useState(""),[metadataConsent,setMetadataConsent]=useState(false),[scopeConsent,setScopeConsent]=useState(false),[selected,setSelected]=useState<Record<string,Resource>>({}),[listing,setListing]=useState<Listing|null>(null),[message,setMessage]=useState(""),[loading,setLoading]=useState(false),[removing,setRemoving]=useState("");
  const [startHeld,setStartHeld]=useState(false),[pendingHeld,setPendingHeld]=useState(false);
  const startAttempt=useRef<RouterInputs["atlassianConnections"]["begin"]|null>(null);
  const alive=useRef(true),pending=useRef<{requestId:string;version:number;resourceIds:string[]}|null>(null);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const current=trpcReact.atlassianConnections.status.useQuery({id},{enabled:!!id&&isLoaded&&isSignedIn,retry:false,refetchInterval:q=>q.state.data&&["PENDING","EXCHANGING","REFRESHING"].includes(q.state.data.status)?3000:false});
  const busy=loading||begin.isPending||selectSite.isPending||approve.isPending||renew.isPending||disconnect.isPending;
  useEffect(()=>{onWorkingChange?.(busy);},[busy,onWorkingChange]);
  useEffect(()=>()=>onWorkingChange?.(false),[onWorkingChange]);
  const title=product==="jira"?"Jira":"Confluence",unit=product==="jira"?"projects":"spaces";
  const access=capabilities.isSuccess&&!capabilities.isFetching&&capabilities.data.clerkActorId===userId?capabilities.data:null;
  const readable=!!access?.canConnect&&mine.isSuccess&&!mine.isFetching&&!mine.isPaused;
  const row=readable&&current.isSuccess&&!current.isFetching&&!current.isPaused?current.data:null;
  async function load(after:number|string|null=null){
    if(!id||busy)return;setLoading(true);setMessage("");
    try{const result=await utils.atlassianConnections.catalog.fetch({id,after});if(!alive.current)return;setListing(result);if(result.reset)setSelected({});pending.current=null;setPendingHeld(false);setMetadataConsent(false);setScopeConsent(false);await current.refetch();}
    catch{if(alive.current)setMessage("Could not load choices. Refresh access and retry.");}finally{if(alive.current)setLoading(false);}
  }
  return <section aria-label={`${title} browser connection`} style={{display:"grid",gap:12,minWidth:0}}>
    <h3>{title} <IconButton label="Connection help" icon="help" tooltip="Sign in with Atlassian, choose a site, then approve projects or spaces for this Vaettir project."/></h3>
    {message&&<p role="status">{message}</p>}
    {capabilities.isError||mine.isError||current.isError?<p role="alert">Access could not be checked. <button type="button" disabled={busy} onClick={()=>{void capabilities.refetch();void mine.refetch();if(id)void current.refetch();}}>Retry</button></p>:null}
    {!isLoaded?<p role="status">Checking sign-in…</p>:!isSignedIn?<p role="alert">Sign in to connect.</p>:!access?<p role="status">Checking access…</p>:!access.canConnect?<p>A full editor seat is required.</p>:!access.available?<p role="status">Browser sign-in needs administrator setup.</p>:<>
      <p>Sign in, choose a site, then approve {unit}.</p>
      <label><input type="checkbox" checked={metadataConsent} disabled={busy||pendingHeld} onChange={e=>setMetadataConsent(e.target.checked)}/>Allow account, site and {unit} metadata.</label>
      <button type="button" disabled={busy||!metadataConsent||!mine.isSuccess||mine.isFetching||pendingHeld} onClick={async()=>{
        const popup=window.open("about:blank","_blank","popup,width=600,height=760");
        if(!popup){setMessage("Allow this connection window, then retry.");return;}
        popup.opener=null;setMessage("");
        try{const attempt=startAttempt.current??{projectId,product,originalOrganizationId:access.organizationId,expectedClerkActorId:access.clerkActorId!,requestId:crypto.randomUUID(),approveMetadataAccess:true as const};startAttempt.current=attempt;setStartHeld(true);const result=await begin.mutateAsync(attempt);startAttempt.current=null;setStartHeld(false);if(!alive.current){popup.close();return;}setId(result.id);setListing(null);setSelected({});setMetadataConsent(false);setScopeConsent(false);popup.location.href=result.url;await mine.refetch();}
        catch{popup.close();if(alive.current){setMessage("Connection unconfirmed. Retry the same sign-in.");await mine.refetch();}}
      }}>{startHeld?"Retry sign-in":`Connect ${title}`}</button>
      <details><summary>Permissions</summary><p>Atlassian authorizes read access to Jira and Confluence for this Vaettir app. Only approved projects or spaces are available here. Issue summaries require a separate reviewed import. No page bodies are read by this setup.</p></details>
    </>}
    {readable&&mine.data&&mine.data.length>0&&<div aria-label="Saved connections">{mine.data.filter(saved=>saved.id!==id).map(saved=><div key={saved.id} style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
      <span>{saved.selectedSite?.name??saved.accountName??title} · {saved.status.toLowerCase().replaceAll("_"," ")}</span>
      <button type="button" className="btn-secondary" disabled={busy} onClick={()=>{setId(saved.id);setListing(null);setSelected({});pending.current=null;setPendingHeld(false);setMetadataConsent(false);setScopeConsent(false);}}>Open</button>
    </div>)}</div>}
    {row&&<>
      {["PENDING","EXCHANGING","REFRESHING"].includes(row.status)&&<p role="status">Finish sign-in in the connection window.</p>}
      {["EXPIRED","RECOVERY_REQUIRED"].includes(row.status)&&<p role="alert">Reconnect to verify access. This attempt will not replay.</p>}
      {row.status==="VERIFIED"&&!row.selectedSite&&<fieldset disabled={busy}><legend>Choose site</legend>{row.sites.filter(site=>site.products.includes(product)).map(site=><button key={site.id} type="button" className="btn-secondary" onClick={async()=>{try{await selectSite.mutateAsync({id,siteId:site.id,version:row.version});setListing(null);setSelected({});pending.current=null;setPendingHeld(false);setMetadataConsent(false);setScopeConsent(false);await current.refetch();await mine.refetch();}catch{setMessage("Site selection changed. Refresh and retry.");}}}>{site.name}</button>)}</fieldset>}
      {row.status==="VERIFIED"&&row.selectedSite&&<>
        <p>{row.selectedSite.name} · {row.approvedResources.length} approved</p>
        <button type="button" className="btn-secondary" disabled={busy||pendingHeld} onClick={()=>void load()}>Choose {unit}</button>
        {listing&&<fieldset disabled={busy||pendingHeld}><legend>Approve {unit}</legend>{listing.resources.map(resource=><label key={resource.id} style={{display:"block"}}><input type="checkbox" checked={!!selected[resource.id]} onChange={e=>{setSelected(prior=>{const next={...prior};if(e.target.checked)next[resource.id]=resource;else delete next[resource.id];return next;});setMetadataConsent(false);setScopeConsent(false);}}/>{resource.key} · {resource.name}</label>)}{listing.next!==null&&<button type="button" className="btn-secondary" onClick={()=>void load(listing.next)}>Next</button>}</fieldset>}
        {!!Object.keys(selected).length&&listing&&<>
          <p>{Object.values(selected).map(resource=>resource.key).join(", ")}</p>
          <label><input type="checkbox" checked={scopeConsent} disabled={busy||pendingHeld} onChange={e=>setScopeConsent(e.target.checked)}/>Approve these {unit} for this project.</label>
          <button type="button" disabled={busy||!scopeConsent&&!pendingHeld} onClick={async()=>{
            const attempt=pending.current??{requestId:crypto.randomUUID(),version:listing.version,resourceIds:Object.keys(selected).sort()};pending.current=attempt;setPendingHeld(true);
            try{const result=await approve.mutateAsync({id,...attempt,approved:true});if(!alive.current)return;pending.current=null;setPendingHeld(false);setMetadataConsent(false);setScopeConsent(false);setListing(null);setSelected({});setMessage(`${result.saved} ${unit} approved.`);await current.refetch();await mine.refetch();onApproved?.(id);}
            catch{if(alive.current)setMessage("Save unconfirmed. Check the same approval before changing choices.");}
          }}>{pendingHeld?"Check save":"Approve"}</button>
        </>}
      </>}
      {row.canRefresh&&<IconButton label="Refresh access" tooltip="Renew this Atlassian sign-in without adding projects or spaces." icon="refresh" disabled={busy||pendingHeld} onClick={async()=>{try{await renew.mutateAsync({id});setListing(null);setSelected({});setMetadataConsent(false);setScopeConsent(false);await current.refetch();}catch{setMessage("Refresh unconfirmed. Check access before reconnecting.");await current.refetch();}}}/>}
      {!["DISCONNECTED","DISCONNECTING","CANCELLED"].includes(row.status)&&<button type="button" className="btn-secondary" disabled={busy} onClick={()=>setRemoving(id)}>Disconnect</button>}
      {removing===id&&<div role="group" aria-label="Disconnect Atlassian"><p>Stop Vaettir access? Saved evidence stays. Remove the app in Atlassian to revoke its provider permission.</p><button type="button" disabled={busy} onClick={async()=>{try{await disconnect.mutateAsync({id,confirmed:true});pending.current=null;setPendingHeld(false);setListing(null);setSelected({});setMetadataConsent(false);setScopeConsent(false);setRemoving("");await current.refetch();await mine.refetch();}catch{setMessage("Disconnect unconfirmed. Check access and retry.");}}}>Disconnect</button><button type="button" className="btn-secondary" disabled={busy} onClick={()=>setRemoving("")}>Cancel</button></div>}
      {["DISCONNECTED","RECOVERY_REQUIRED"].includes(row.status)&&<a href="https://id.atlassian.com/manage-profile/apps" target="_blank" rel="noopener noreferrer">Manage access</a>}
    </>}
  </section>;
}
