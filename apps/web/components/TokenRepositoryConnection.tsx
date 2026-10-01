"use client";
import {useState} from "react";
import {trpcReact,type RouterOutputs} from "@/lib/trpcReact";
import {ProviderMark} from "./SourceConnectionChips";
import {connectionAccessState} from "@/lib/connection-access";
import {ConnectionAccessGate} from "./ConnectionAccessGate";

type Listing=RouterOutputs["repositoryConnections"]["list"];
const field={display:"grid",gap:6} as const;
const inputStyle={width:"100%",minWidth:0,boxSizing:"border-box"} as const;
const actions={display:"flex",gap:8,flexWrap:"wrap"} as const;

export function TokenRepositoryConnection({projectId,providerId,onConnected,onClose}:{projectId:string;providerId:"bitbucket"|"azure-devops";onConnected:()=>void;onClose:()=>void}){
  const name=providerId==="bitbucket"?"Bitbucket":"Azure DevOps";
  const utils=trpcReact.useUtils();
  const capabilities=trpcReact.repositoryConnections.configurations.useQuery({projectId});
  const recent=trpcReact.repositoryConnections.mine.useQuery({projectId},{enabled:capabilities.isSuccess&&capabilities.data.canConnect});
  const verify=trpcReact.repositoryConnections.connectToken.useMutation();
  const forget=trpcReact.repositoryConnections.forgetToken.useMutation();
  const connect=trpcReact.repositoryConnections.connectSelected.useMutation();
  const [step,setStep]=useState<"access"|"repositories"|"review"|"done">("access");
  const [email,setEmail]=useState("");const [workspace,setWorkspace]=useState("");
  const [organizationUrl,setOrganizationUrl]=useState("");
  const [token,setToken]=useState("");const [consent,setConsent]=useState(false);
  const [requestId,setRequestId]=useState<string|null>(null);
  const [connectionId,setConnectionId]=useState("");const [accountLabel,setAccountLabel]=useState("");
  const [listing,setListing]=useState<Listing|null>(null);
  const [selected,setSelected]=useState<Record<string,Listing["repositories"][number]>>({});
  const [page,setPage]=useState(1);const [search,setSearch]=useState("");const [activeSearch,setActiveSearch]=useState("");
  const [loading,setLoading]=useState(false);const [error,setError]=useState("");const [removing,setRemoving]=useState("");
  const busy=loading||verify.isPending||connect.isPending||forget.isPending;
  const choices=Object.values(selected);
  async function load(id:string,nextPage=1,query=search){
    setLoading(true);setError("");
    try{
      const result=await utils.repositoryConnections.list.fetch({id,page:nextPage,search:query});
      setSelected(previous=>{
        if(result.catalogReset)return {};
        const updated={...previous};
        for(const repo of result.repositories)if(updated[repo.id])updated[repo.id]=repo;
        return updated;
      });
      setListing(result);setConnectionId(id);setPage(nextPage);setActiveSearch(query);setStep("repositories");
    }catch{setError("Could not refresh repository access. Check your saved connection or verify a new token.");}
    finally{setLoading(false);}
  }
  const accessState=connectionAccessState(capabilities,recent);
  if(accessState!=="ready")return <ConnectionAccessGate state={accessState} busy={busy||capabilities.isFetching||recent.isFetching} onClose={onClose} onRetry={()=>void (async()=>{const refreshed=await capabilities.refetch();if(refreshed.isSuccess&&refreshed.data.canConnect)await recent.refetch();})()}/>;
  return <div style={{display:"grid",gap:16,minWidth:0}}>
    <p role="status">{{access:"1. Verify repository access",repositories:"2. Choose repositories",review:"3. Review connections",done:"Connections saved"}[step]}</p>
    {(error||capabilities.error) && <p role="alert">{error||capabilities.error?.message}</p>}
    {step==="access" && <>
      <p>{providerId==="bitbucket"?"Connect a Bitbucket Cloud workspace using an account API token with repository and user read permissions.":"Connect an Azure DevOps organization using a personal access token limited to Code (Read)."} Source files are not read in this flow.</p>
      {capabilities.isLoading && <p role="status">Checking connection availability…</p>}
      {capabilities.data&&!capabilities.data.credentialStorageReady && <p role="alert">Secure credential storage is unavailable on this installation. Contact Vaettir support to enable connections.</p>}
      {recent.data?.some(c=>c.provider===providerId) && <section style={{display:"grid",gap:8}}><h3>Saved access</h3>
        {recent.data.filter(c=>c.provider===providerId).map(c=><div key={c.id} style={actions}><button type="button" className="source-connection-chip" disabled={busy||c.status!=="VERIFIED"} onClick={()=>{setAccountLabel(c.accountLabel??c.origin);void load(c.id);}}><ProviderMark id={providerId}/><span style={{overflowWrap:"anywhere"}}><strong>{c.accountLabel??c.origin}</strong><small>{c.status==="VERIFIED"?"Resume repository selection":c.status.toLowerCase()}</small></span></button><button type="button" className="btn-secondary" disabled={busy||c.status==="VERIFYING"} onClick={()=>setRemoving(c.id)}>Remove saved access</button></div>)}
      </section>}
      {removing && <section role="group" aria-label="Remove saved token access"><p>Remove this token from Vaettir? Repository references and reviewed revisions stay in the project. Revoke the token in {name} to stop all uses outside Vaettir.</p><div style={actions}><button type="button" className="btn-secondary" disabled={busy} onClick={()=>setRemoving("")}>Keep access</button><button type="button" disabled={busy} onClick={async()=>{try{await forget.mutateAsync({id:removing,confirmed:true});setRemoving("");await recent.refetch();onConnected();}catch{setError("Saved access could not be removed. Check your permissions and try again.");}}}>Remove from Vaettir</button></div></section>}
      {capabilities.data?.credentialStorageReady && <form style={{display:"grid",gap:12}} onSubmit={async event=>{
        event.preventDefault();setError("");
        const id=requestId??crypto.randomUUID();setRequestId(id);
        try{
          const result=await verify.mutateAsync({projectId,provider:providerId,requestId:id,email,workspace,organizationUrl,token,approveMetadataAccess:true});
          setToken("");setConsent(false);setAccountLabel(result.accountLabel??name);setConnectionId(result.id);
          await recent.refetch();await load(result.id);
        }catch{setRequestId(null);setError("Access could not be verified. Check the token's read permissions and the selected workspace or organization.");}
      }}>
        {providerId==="bitbucket"?<>
          <label style={field}>Bitbucket workspace<input style={inputStyle} required value={workspace} onChange={e=>{setWorkspace(e.target.value);setRequestId(null);}} maxLength={100} placeholder="workspace-slug"/></label>
          <label style={field}>Atlassian account email<input style={inputStyle} type="email" required value={email} onChange={e=>{setEmail(e.target.value);setRequestId(null);}} maxLength={320}/></label>
          <a target="_blank" rel="noopener noreferrer" href="https://support.atlassian.com/bitbucket-cloud/docs/using-api-tokens/">Create a Bitbucket API token ↗</a>
          <p className="text-muted">Select read:user:bitbucket and read:repository:bitbucket. Limit the token expiry and avoid write permissions.</p>
        </>:<>
          <label style={field}>Organization URL<input style={inputStyle} type="url" required value={organizationUrl} onChange={e=>{setOrganizationUrl(e.target.value);setRequestId(null);}} maxLength={300} placeholder="https://dev.azure.com/your-organization"/></label>
          <a target="_blank" rel="noopener noreferrer" href="https://learn.microsoft.com/en-us/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate?view=azure-devops">Create a scoped Azure DevOps token ↗</a>
          <p className="text-muted">Choose this organization and Code (Read). Use a short expiry. Azure DevOps Server instances require a separate adapter.</p>
        </>}
        <label style={field}>API token<input style={inputStyle} type="password" required value={token} onChange={e=>{setToken(e.target.value);setRequestId(null);}} maxLength={10000} autoComplete="new-password"/></label>
        <p className="text-muted">Saved access is encrypted and used for up to eight hours before you verify again. Removing it here does not revoke your provider token.</p>
        <label style={{display:"flex",gap:8,alignItems:"flex-start"}}><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/><span>I approve checking access and listing repository metadata in this workspace or organization.</span></label>
        <button type="submit" disabled={busy||!consent||!token.trim()}>{verify.isPending?"Verifying access…":"Verify and choose repositories"}</button>
      </form>}
      <button type="button" className="btn-secondary" disabled={busy} onClick={onClose}>Cancel</button>
    </>}
    {step==="repositories" && <>
      <p>Repository metadata available for <strong>{accountLabel}</strong>. Choose what belongs to this project.</p>
      <form style={actions} onSubmit={e=>{e.preventDefault();void load(connectionId,1,search);}}><label style={{...field,flex:"1 1 160px"}}>Search repositories<input style={inputStyle} value={search} onChange={e=>setSearch(e.target.value)} maxLength={100}/></label><button type="submit" className="btn-secondary" disabled={busy}>Search</button></form>
      <span role="status">{choices.length} selected across visited pages</span>
      <div className="source-chip-list" role="group" aria-label="Verified repository choices" style={{maxHeight:300,overflowY:"auto"}}>
        {listing?.repositories.map(repo=><button type="button" key={repo.id} className="source-connection-chip" aria-pressed={!!selected[repo.id]} disabled={busy||choices.length>=100&&!selected[repo.id]} style={{maxWidth:"100%",textAlign:"left"}} onClick={()=>setSelected(previous=>{const next={...previous};if(next[repo.id])delete next[repo.id];else next[repo.id]=repo;return next;})}><ProviderMark id={providerId}/><span style={{minWidth:0,overflowWrap:"anywhere"}}><strong>{repo.name}</strong><small>{repo.defaultBranch??"No default branch"} · Metadata</small></span>{selected[repo.id]&&<span aria-hidden="true">✓</span>}</button>)}
      </div>
      {!listing?.repositories.length&&<p>No accessible repositories match this search.</p>}
      {providerId==="bitbucket"&&page===10&&<p className="text-muted">This listing is limited to ten pages. Narrow the search to find other repositories.</p>}
      <div style={actions}><button type="button" className="btn-secondary" disabled={busy||page<=1} onClick={()=>void load(connectionId,page-1,activeSearch)}>Previous page</button><button type="button" className="btn-secondary" disabled={busy||!listing?.hasMore} onClick={()=>void load(connectionId,page+1,activeSearch)}>Next page</button></div>
      <div style={actions}><button type="button" className="btn-secondary" disabled={busy} onClick={()=>setStep("access")}>Back</button><button type="button" disabled={busy||!choices.length} onClick={()=>setStep("review")}>Review {choices.length} selected</button></div>
    </>}
    {step==="review"&&<><p>Connect {choices.length} {name} repositories to this project?</p><ul style={{overflowWrap:"anywhere",maxHeight:250,overflowY:"auto"}}>{choices.map(repo=><li key={repo.id}>{repo.name}</li>)}</ul><p>Existing revision references stay in place. Source discovery can be approved after these connections are saved.</p><div style={actions}><button type="button" className="btn-secondary" disabled={busy} onClick={()=>setStep("repositories")}>Back</button><button type="button" disabled={busy||!listing} onClick={async()=>{if(!listing)return;try{await connect.mutateAsync({id:connectionId,repositoryIds:choices.map(c=>c.id),catalogVersion:listing.catalogVersion,approved:true});setStep("done");onConnected();}catch{setError("Could not save. Refresh the repository list and review your choices again.");}}}>{connect.isPending?"Saving…":"Approve and connect"}</button></div></>}
    {step==="done"&&<><p role="status">Repository connections saved. Source files have not been read.</p><div style={actions}><button type="button" className="btn-secondary" onClick={()=>{setSelected({});void load(connectionId);}}>Connect more repositories</button><button type="button" onClick={onClose}>Done</button></div></>}
  </div>;
}
