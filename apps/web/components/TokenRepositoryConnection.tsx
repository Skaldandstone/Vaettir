"use client";
import {useLayoutEffect,useMemo,useRef,useState} from "react";
import {useAuth} from "@clerk/nextjs";
import {trpcReact,type RouterInputs,type RouterOutputs} from "@/lib/trpcReact";
import {ProviderMark} from "./SourceConnectionChips";
import {connectionAccessState} from "@/lib/connection-access";
import {ConnectionAccessGate} from "./ConnectionAccessGate";
import {gitlabInstanceOrigin} from "@/lib/gitlab-instance-selection";
import {retainAnalysisRequest} from "@/lib/analysis-request-recovery";
import {currentSessionScope,sameAuthScope} from "@/lib/auth-query-cache";

type Listing=RouterOutputs["repositoryConnections"]["list"];
const field={display:"grid",gap:6} as const;
const inputStyle={width:"100%",minWidth:0,boxSizing:"border-box"} as const;
const actions={display:"flex",gap:8,flexWrap:"wrap"} as const;
type Verification=RouterInputs["repositoryConnections"]["connectToken"];
function liveSession(){return typeof window==="undefined"?null:currentSessionScope(window.Clerk?.loaded?window.Clerk.session:null);}

export function TokenRepositoryConnection({projectId,providerId,onConnected,onClose,active=true,initialInstanceUrl}:{projectId:string;providerId:"bitbucket"|"azure-devops"|"gitlab";onConnected:()=>void;onClose:()=>void;active?:boolean;initialInstanceUrl?:string}){
  const name=providerId==="bitbucket"?"Bitbucket":providerId==="gitlab"?"GitLab":"Azure DevOps";
  const auth=useAuth();
  const utils=trpcReact.useUtils();
  const capabilities=trpcReact.repositoryConnections.configurations.useQuery({projectId});
  const recent=trpcReact.repositoryConnections.mine.useQuery({projectId},{enabled:capabilities.isSuccess&&capabilities.data.canConnect});
  const verify=trpcReact.repositoryConnections.connectToken.useMutation();
  const forget=trpcReact.repositoryConnections.forgetToken.useMutation();
  const connect=trpcReact.repositoryConnections.connectSelected.useMutation();
  const [step,setStep]=useState<"access"|"repositories"|"review"|"done">("access");
  const [email,setEmail]=useState("");const [workspace,setWorkspace]=useState("");
  const [organizationUrl,setOrganizationUrl]=useState(()=>providerId==="gitlab"?gitlabInstanceOrigin(initialInstanceUrl??"")??"":"");
  const [token,setToken]=useState("");const [consent,setConsent]=useState(false);
  const [requestId,setRequestId]=useState<string|null>(null);
  const [connectionId,setConnectionId]=useState("");const [accountLabel,setAccountLabel]=useState("");
  const [listing,setListing]=useState<Listing|null>(null);
  const [selected,setSelected]=useState<Record<string,Listing["repositories"][number]>>({});
  const [page,setPage]=useState(1);const [search,setSearch]=useState("");const [activeSearch,setActiveSearch]=useState("");
  const [groupPath,setGroupPath]=useState("");const [includeSubgroups,setIncludeSubgroups]=useState(true);const [includeShared,setIncludeShared]=useState(false);const [groupPage,setGroupPage]=useState(1);
  const [appliedScope,setAppliedScope]=useState<RouterInputs["repositoryConnections"]["list"]["gitlabScope"]>();
  const [unconfirmedSave,setUnconfirmedSave]=useState(false);
  const saveOutcome=useRef({uncertain:false,inFlight:false});
  const [loading,setLoading]=useState(false);const [error,setError]=useState("");const [removing,setRemoving]=useState("");
  const busy=loading||verify.isPending||connect.isPending||forget.isPending;
  const choices=Object.values(selected);
  const accessState=connectionAccessState(capabilities,recent);
  const instanceOrigin=providerId==="gitlab"?gitlabInstanceOrigin(organizationUrl):null;
  const frame=useMemo(()=>({projectId,providerId,organizationId:capabilities.data?.organizationId??"",actorId:auth.userId??"",sessionId:auth.sessionId??"",
    eligible:active&&accessState==="ready"&&!!capabilities.data?.canConnect&&auth.isLoaded&&!!auth.isSignedIn&&!!auth.userId&&!!auth.sessionId,
  }),[projectId,providerId,capabilities.data?.organizationId,capabilities.data?.canConnect,active,accessState,auth.isLoaded,auth.isSignedIn,auth.userId,auth.sessionId]);
  const committed=useRef<typeof frame|null>(null);
  const verification=useRef<{input:Verification;frame:typeof frame;inFlight:boolean;unknown:boolean}|null>(null);
  const draftOrigin=useRef<typeof frame|null>(null);
  const [privateOrigin,publishPrivateOrigin]=useState<typeof frame|null>(null);
  const listingOwner=useRef(0);
  const eventGeneration=useRef(0);
  const [generation,publishGeneration]=useState(0);
  useLayoutEffect(()=>{committed.current=frame;return()=>{if(committed.current===frame)committed.current=null;};},[frame]);
  const continuationOwner=useRef(false);
  const continuationView=useMemo(()=>({frame,listing,page,activeSearch,step}),[frame,listing,page,activeSearch,step]);
  const committedContinuation=useRef<typeof continuationView|null>(null);
  useLayoutEffect(()=>{committedContinuation.current=continuationView;return()=>{if(committedContinuation.current===continuationView)committedContinuation.current=null;};},[continuationView]);
  function current(attemptFrame:typeof frame){return committed.current===attemptFrame&&attemptFrame.eligible&&sameAuthScope({userId:attemptFrame.actorId,sessionId:attemptFrame.sessionId},liveSession());}
  function sameOrigin(origin:typeof frame){return origin.projectId===frame.projectId&&origin.providerId===frame.providerId&&origin.organizationId===frame.organizationId&&origin.actorId===frame.actorId;}
  function canEditDraft(){if(!current(frame)||saveOutcome.current.uncertain||saveOutcome.current.inFlight||verification.current||draftOrigin.current&&!sameOrigin(draftOrigin.current))return false;if(!draftOrigin.current){draftOrigin.current=frame;publishPrivateOrigin(frame);}return true;}
  function canEditSelection(){return current(frame)&&!saveOutcome.current.uncertain&&!saveOutcome.current.inFlight;}
  const draftLocked=busy||!!requestId;
  const savedAccess=recent.data?.filter(c=>c.provider===providerId&&(providerId!=="gitlab"||c.accessMethod==="token"))??[];
  const groups=trpcReact.repositoryConnections.groups.useQuery({id:connectionId,page:groupPage},{enabled:providerId==="gitlab"&&step==="repositories"&&!!connectionId&&frame.eligible,retry:false});
  async function load(id:string,nextPage=1,query=search,restartCatalogue=false,scope:RouterInputs["repositoryConnections"]["list"]["gitlabScope"]|null=appliedScope??null){
    if(!current(frame)||saveOutcome.current.uncertain||saveOutcome.current.inFlight)return;
    const owner=++listingOwner.current;
    setLoading(true);setError("");
    try{
      const result=await utils.repositoryConnections.list.fetch({id,page:nextPage,search:query,...(scope?{gitlabScope:scope}:{}),...(restartCatalogue?{restartCatalogue:true}:{})});
      if(owner!==listingOwner.current||!current(frame)||saveOutcome.current.uncertain||saveOutcome.current.inFlight)return;
      const expectedScope=scope?JSON.parse(result.scopeKey??"null") as unknown:null;
      if(scope? !Array.isArray(expectedScope)||expectedScope.length!==5||JSON.stringify(expectedScope.slice(0,4))!==JSON.stringify(["gitlab-group/v1",scope.groupPath,scope.includeSubgroups,scope.includeShared])||typeof expectedScope[4]!=="string"||!/^[1-9][0-9]*$/.test(expectedScope[4]):result.scopeKey!==null)throw Error("Scope acknowledgement did not match.");
      if(result.repositories.some(repo=>(repo.scopeKey??null)!==(result.scopeKey??null)))throw Error("Repository scope acknowledgement did not match.");
      if(JSON.stringify(scope??null)!==JSON.stringify(appliedScope??null)&&result.catalogReset!==true)throw Error("Changed scope reset acknowledgement required.");
      if(restartCatalogue&&!result.catalogReset)throw Error("Fresh selection was not acknowledged.");
      setSelected(previous=>{
        if(result.catalogReset)return {};
        const updated={...previous};
        for(const repo of result.repositories)if(updated[repo.id])updated[repo.id]=repo;
        return updated;
      });
      setListing(result);setConnectionId(id);setPage(nextPage);setActiveSearch(query);setAppliedScope(scope??undefined);if(restartCatalogue)setSearch(query);setStep("repositories");
    }catch{if(owner===listingOwner.current&&current(frame))setError(restartCatalogue?"Could not start a fresh selection batch. Your existing choices are retained; retry with the same saved connection.":"Could not refresh repository access. Check your saved connection or verify a new token.");}
    finally{if(owner===listingOwner.current)setLoading(false);}
  }
  async function continueGitlabBatch(){
    if(providerId!=="gitlab"||committedContinuation.current!==continuationView||(step!=="repositories"&&step!=="done")||continuationOwner.current||busy||requestId||!listing?.hasMore||page>=100||!current(frame))return;
    continuationOwner.current=true;
    try{await load(connectionId,page+1,activeSearch,true);}finally{continuationOwner.current=false;}
  }
  if(privateOrigin&&(!sameOrigin(privateOrigin)||!sameAuthScope({userId:frame.actorId,sessionId:frame.sessionId},liveSession())))return <section role="status"><p>This connection draft belongs to another original account or workspace. Restore that access to continue; its token, repository choices and original request are withheld here.</p><button type="button" className="btn-secondary" onClick={()=>void capabilities.refetch()}>Refresh original access</button></section>;
  if(accessState!=="ready")return <ConnectionAccessGate state={accessState} busy={draftLocked||capabilities.isFetching||recent.isFetching} onClose={()=>{if(!verification.current)onClose();}} onRetry={()=>void (async()=>{const refreshed=await capabilities.refetch();if(refreshed.isSuccess&&refreshed.data.canConnect)await recent.refetch();})()}/>;
  return <div style={{display:"grid",gap:16,minWidth:0}}>
    <p role="status">{{access:"1. Verify repository access",repositories:"2. Choose repositories",review:"3. Review connections",done:"Connections saved"}[step]}</p>
    {(error||capabilities.error) && <p role="alert">{error||capabilities.error?.message}</p>}
    {step==="access" && <>
      <p>{providerId==="bitbucket"?"Connect a Bitbucket Cloud workspace using an account API token with repository and user read permissions.":providerId==="gitlab"?"Connect your GitLab instance using a short-lived personal or group access token with read_api. No OAuth application registration is required.":"Connect an Azure DevOps organization using a personal access token limited to Code (Read)."} Source files are not read in this flow.</p>
      {capabilities.isLoading && <p role="status">Checking connection availability…</p>}
      {capabilities.data&&!capabilities.data.credentialStorageReady && <p role="alert">Secure credential storage is unavailable on this installation. Contact Vaettir support to enable connections.</p>}
      {savedAccess.length>0 && <section style={{display:"grid",gap:8}}><h3>Saved access</h3>
        {savedAccess.map(c=><div key={c.id} style={actions}><button type="button" className="source-connection-chip" disabled={draftLocked||c.status!=="VERIFIED"} onClick={()=>{if(!canEditDraft())return;setAccountLabel(c.accountLabel??c.origin);void load(c.id);}}><ProviderMark id={providerId}/><span style={{overflowWrap:"anywhere"}}><strong>{c.accountLabel??c.origin}</strong><small>{c.status==="VERIFIED"?"Resume repository selection":c.status.toLowerCase()}</small></span></button><button type="button" className="btn-secondary" disabled={draftLocked||c.status==="VERIFYING"} onClick={()=>{if(canEditDraft())setRemoving(c.id);}}>Remove saved access</button></div>)}
      </section>}
      {removing && <section role="group" aria-label="Remove saved token access"><p>Remove this token from Vaettir? Repository references and reviewed revisions stay in the project. Revoke the token in {name} to stop all uses outside Vaettir.</p><div style={actions}><button type="button" className="btn-secondary" disabled={busy} onClick={()=>setRemoving("")}>Keep access</button><button type="button" disabled={busy} onClick={async()=>{try{await forget.mutateAsync({id:removing,confirmed:true});setRemoving("");await recent.refetch();onConnected();}catch{setError("Saved access could not be removed. Check your permissions and try again.");}}}>Remove from Vaettir</button></div></section>}
      {capabilities.data?.credentialStorageReady && <form style={{display:"grid",gap:12}} onSubmit={async event=>{
        event.preventDefault();setError("");
        if(generation!==eventGeneration.current||!current(frame)||verification.current?.inFlight)return;
        const retained=verification.current;
        if(retained&&(retained.frame.projectId!==frame.projectId||retained.frame.providerId!==frame.providerId||retained.frame.organizationId!==frame.organizationId||retained.frame.actorId!==frame.actorId))return;
        if(!retained&&(!consent||!token.trim()||providerId==="gitlab"&&(!instanceOrigin||!frame.organizationId)))return;
        const input=retained?.input??Object.freeze({projectId,provider:providerId,requestId:crypto.randomUUID(),email,workspace,organizationUrl,
          ...(providerId==="gitlab"?{instanceUrl:instanceOrigin!,originalOrganizationId:frame.organizationId,expectedClerkActorId:frame.actorId}:{}),token,approveMetadataAccess:true as const});
        const attempt=retained??{input,frame,inFlight:false,unknown:false};
        if(!draftOrigin.current){draftOrigin.current=frame;publishPrivateOrigin(frame);}verification.current=attempt;attempt.inFlight=true;setRequestId(input.requestId);
        try{
          const result=await verify.mutateAsync(input);
          if(providerId==="gitlab"&&(result.requestId!==input.requestId||result.projectId!==input.projectId||result.originalOrganizationId!==input.originalOrganizationId||result.expectedClerkActorId!==input.expectedClerkActorId))throw Error("Verification acknowledgement did not match the original request.");
          if(!current(frame)){attempt.unknown=true;return;}
          verification.current=null;publishGeneration(++eventGeneration.current);setRequestId(null);setToken("");setConsent(false);setAccountLabel(result.accountLabel??name);setConnectionId(result.id);
          await recent.refetch();await load(result.id);
        }catch(cause){
          attempt.unknown=retainAnalysisRequest(attempt.unknown||!current(frame),cause);
          if(!attempt.unknown&&verification.current===attempt){verification.current=null;if(current(frame)){publishGeneration(++eventGeneration.current);setRequestId(null);}}
          if(current(frame))setError(attempt.unknown?"Verification was not acknowledged. The original account, instance, token and request are retained. Retry that verification before editing or closing this draft.":"Access could not be verified. Check the token's read permissions and the selected workspace or organization.");
        }finally{attempt.inFlight=false;}
      }}>
        {providerId==="bitbucket"?<>
          <label style={field}>Bitbucket workspace<input style={inputStyle} required disabled={draftLocked} value={workspace} onChange={e=>{if(canEditDraft())setWorkspace(e.target.value);}} maxLength={100} placeholder="workspace-slug"/></label>
          <label style={field}>Atlassian account email<input style={inputStyle} type="email" required disabled={draftLocked} value={email} onChange={e=>{if(canEditDraft())setEmail(e.target.value);}} maxLength={320}/></label>
          <a target="_blank" rel="noopener noreferrer" href="https://support.atlassian.com/bitbucket-cloud/docs/using-api-tokens/">Create a Bitbucket API token ↗</a>
          <p className="text-muted">Select read:user:bitbucket and read:repository:bitbucket. Limit the token expiry and avoid write permissions.</p>
        </>:providerId==="gitlab"?<>
          <label style={field}>GitLab instance or project URL<input style={inputStyle} type="url" required disabled={draftLocked} value={organizationUrl} onChange={e=>{if(canEditDraft())setOrganizationUrl(e.target.value);}} maxLength={300} placeholder="https://your-gitlab.example.org/dashboard/projects"/></label>
          {organizationUrl&&!instanceOrigin&&<p role="alert">Use a public HTTPS GitLab URL without credentials, a query, a fragment or a custom port.</p>}
          {instanceOrigin&&<p>Connecting to <strong>{new URL(instanceOrigin).hostname}</strong>.</p>}
          <a target="_blank" rel="noopener noreferrer" href="https://docs.gitlab.com/user/profile/personal_access_tokens/">GitLab read-only token instructions ↗</a>
          <p className="text-muted">Use read_api and a short expiry. That scope permits broader repository read access than metadata; this flow only verifies account identity and lists metadata. Do not paste your GitLab password.</p>
        </>:<>
          <label style={field}>Organization URL<input style={inputStyle} type="url" required disabled={draftLocked} value={organizationUrl} onChange={e=>{if(canEditDraft())setOrganizationUrl(e.target.value);}} maxLength={300} placeholder="https://dev.azure.com/your-organization"/></label>
          <a target="_blank" rel="noopener noreferrer" href="https://learn.microsoft.com/en-us/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate?view=azure-devops">Create a scoped Azure DevOps token ↗</a>
          <p className="text-muted">Choose this organization and Code (Read). Use a short expiry. Azure DevOps Server instances require a separate adapter.</p>
        </>}
        <label style={field}>API token<input style={inputStyle} type="password" required disabled={draftLocked} value={token} onChange={e=>{if(canEditDraft())setToken(e.target.value);}} maxLength={10000} autoComplete="new-password"/></label>
        <p className="text-muted">Saved access is encrypted and used for up to eight hours before you verify again. Removing it here does not revoke your provider token.</p>
        <label style={{display:"flex",gap:8,alignItems:"flex-start"}}><input type="checkbox" disabled={draftLocked} checked={consent} onChange={e=>{if(canEditDraft())setConsent(e.target.checked);}}/><span>I approve checking access and listing repository metadata in this workspace or organization.</span></label>
        <button type="submit" disabled={busy||!frame.eligible||!requestId&&(!consent||!token.trim()||providerId==="gitlab"&&(!instanceOrigin||!frame.organizationId))}>{verify.isPending?"Verifying access…":requestId?"Retry original verification":"Verify and choose repositories"}</button>
      </form>}
      <button type="button" className="btn-secondary" disabled={draftLocked} onClick={()=>{if(!verification.current)onClose();}}>Cancel</button>
    </>}
    {step==="repositories" && <>
      {providerId==="gitlab"&&<fieldset disabled={busy||!frame.eligible} style={{display:"grid",gap:8}}><legend>Repository scope</legend>
        <label style={field}>Group or subgroup<select style={inputStyle} value={groupPath} onChange={e=>{if(canEditSelection())setGroupPath(e.target.value);}}><option value="">All accessible memberships</option>{groups.data?.groups.map(group=><option key={group.id} value={group.path}>{group.path}</option>)}{groupPath&&!groups.data?.groups.some(group=>group.path===groupPath)&&<option value={groupPath}>{groupPath}</option>}</select></label>
        {groups.error&&<p role="alert">Groups could not be verified. Retry or enter a group path.</p>}
        <div style={actions}><button type="button" className="btn-secondary" disabled={groupPage<=1} onClick={()=>{if(canEditSelection())setGroupPage(page=>page-1);}}>Previous groups</button><button type="button" className="btn-secondary" disabled={!groups.data?.hasMore} onClick={()=>{if(canEditSelection())setGroupPage(page=>page+1);}}>More groups</button>{groups.error&&<button type="button" onClick={()=>{if(canEditSelection())void groups.refetch();}}>Retry groups</button>}</div>
        <details><summary>Enter a group path</summary><label style={field}>Exact group/subgroup path<input style={inputStyle} value={groupPath} onChange={e=>{if(canEditSelection())setGroupPath(e.target.value);}} maxLength={400} placeholder="team/product"/></label></details>
        <label><input type="checkbox" checked={includeSubgroups} onChange={e=>{if(canEditSelection())setIncludeSubgroups(e.target.checked);}}/> Include subgroups</label><label><input type="checkbox" checked={includeShared} onChange={e=>{if(canEditSelection())setIncludeShared(e.target.checked);}}/> Include projects shared with this group</label>
        <p className="text-muted">Apply scope to refresh its verified repository list. Choices are cleared only after the new scope is acknowledged.</p>
        <button type="button" onClick={()=>void load(connectionId,1,search,false,groupPath.trim()?{groupPath:groupPath.trim(),includeSubgroups,includeShared}:null)}>Browse this scope</button>
      </fieldset>}
      <p>Repository metadata available for <strong>{accountLabel}</strong>. Choose what belongs to this project.</p>
      <form style={actions} onSubmit={e=>{e.preventDefault();void load(connectionId,1,search);}}><label style={{...field,flex:"1 1 160px"}}>Search repositories<input style={inputStyle} value={search} onChange={e=>{if(canEditSelection())setSearch(e.target.value);}} maxLength={100}/></label><button type="submit" className="btn-secondary" disabled={busy}>Search</button></form>
      <span role="status">{choices.length} selected across visited pages</span>
      {listing?.limitReached&&<p role="alert">Provider listing limit reached. This is not the complete scope; narrow the group or search.</p>}
      {listing?.listingStatus==="end-of-scope"&&<p role="status">{activeSearch?"End of matching results in this scope. This is not an unfiltered group catalogue.":"End of this scope’s pages."} Only repositories you selected will be connected.</p>}
      <div style={actions}><button type="button" className="btn-secondary" disabled={busy||!listing?.repositories.length} onClick={()=>{if(!canEditSelection())return;setSelected(previous=>{
        const next={...previous};for(const repo of listing?.repositories??[]){if(Object.keys(next).length>=100&&!next[repo.id])break;next[repo.id]=repo;}return next;
      });}}>Select this page (up to 100 total)</button><button type="button" className="btn-secondary" disabled={busy||!choices.length} onClick={()=>{if(canEditSelection())setSelected({});}}>Clear selection</button></div>
      <div className="source-chip-list" role="group" aria-label="Verified repository choices" style={{maxHeight:300,overflowY:"auto"}}>
        {listing?.repositories.map(repo=><button type="button" key={repo.id} className="source-connection-chip" aria-pressed={!!selected[repo.id]} disabled={busy||choices.length>=100&&!selected[repo.id]} style={{maxWidth:"100%",textAlign:"left"}} onClick={()=>{if(!canEditSelection())return;setSelected(previous=>{const next={...previous};if(next[repo.id])delete next[repo.id];else if(Object.keys(next).length<100)next[repo.id]=repo;return next;});}}><ProviderMark id={providerId}/><span style={{minWidth:0,overflowWrap:"anywhere"}}><strong>{repo.name}</strong><small>{repo.projectName&&<>{repo.projectName} · </>}{repo.defaultBranch??"No default branch"} · Metadata</small></span>{selected[repo.id]&&<span aria-hidden="true">✓</span>}</button>)}
      </div>
      {!listing?.repositories.length&&<p>No accessible repositories match this search.</p>}
      {providerId==="bitbucket"&&page===10&&<p className="text-muted">This listing is limited to ten pages. Narrow the search to find other repositories.</p>}
      <div style={actions}><button type="button" className="btn-secondary" disabled={busy||page<=1} onClick={()=>void load(connectionId,page-1,activeSearch)}>Previous page</button><button type="button" className="btn-secondary" disabled={busy||!listing?.hasMore||providerId==="gitlab"&&page>=100} onClick={()=>{if(providerId==="gitlab"&&page>=100)return;void load(connectionId,page+1,activeSearch);}}>Next page</button></div>
      <div><p className="text-muted">Each selection batch can browse 500 repositories and connect up to 100. Starting a fresh batch clears unsaved choices after a successful refresh; saved connections stay in the project.</p><button type="button" className="btn-secondary" disabled={busy} onClick={()=>void load(connectionId,1,search,true)}>Start a new selection batch</button></div>
      {providerId==="gitlab"&&<div><p className="text-muted">Continue from the next page in a fresh selection batch to browse beyond the current 500-repository batch. This keeps the last applied search and clears unsaved choices only after a successful refresh; saved connections stay in the project.</p><button type="button" className="btn-secondary" disabled={busy||!!requestId||!frame.eligible||!listing?.hasMore||page>=100} onClick={()=>void continueGitlabBatch()}>Continue from page {page+1} in a fresh batch</button></div>}
      <div style={actions}><button type="button" className="btn-secondary" disabled={busy} onClick={()=>{if(canEditSelection())setStep("access");}}>Back</button><button type="button" disabled={busy||!choices.length} onClick={()=>{if(canEditSelection())setStep("review");}}>Review {choices.length} selected</button></div>
    </>}
    {step==="review"&&<><p>Connect {choices.length} {name} repositories to this project?</p><ul style={{overflowWrap:"anywhere",maxHeight:250,overflowY:"auto"}}>{choices.map(repo=><li key={repo.id}>{repo.name}</li>)}</ul><p>Existing revision references stay in place. Source discovery can be approved after these connections are saved.</p><div style={actions}><button type="button" className="btn-secondary" disabled={busy||unconfirmedSave} onClick={()=>{if(canEditSelection())setStep("repositories");}}>Back</button><button type="button" disabled={busy||!listing||!frame.eligible} onClick={async()=>{if(!listing||!current(frame)||saveOutcome.current.inFlight)return;saveOutcome.current.inFlight=true;try{await connect.mutateAsync({id:connectionId,repositoryIds:choices.map(c=>c.id),catalogVersion:listing.catalogVersion,approved:true});if(!current(frame)){saveOutcome.current.uncertain=true;setUnconfirmedSave(true);return;}saveOutcome.current.uncertain=false;setUnconfirmedSave(false);setStep("done");onConnected();}catch(cause){const uncertain=retainAnalysisRequest(saveOutcome.current.uncertain,cause);saveOutcome.current.uncertain=uncertain;setUnconfirmedSave(uncertain);if(current(frame))setError(uncertain?"Save was not acknowledged. Your original scope, choices and approval are retained. Retry the original approval before changing scope.":"Could not save. Refresh the repository list and review your choices again.");}finally{saveOutcome.current.inFlight=false;}}}>{connect.isPending?"Saving…":"Approve and connect"}</button></div></>}
    {step==="done"&&<><p role="status">Repository connections saved. Source files have not been read.</p>{providerId==="gitlab"&&<div><p className="text-muted">Continue from the next page in a fresh selection batch. This keeps the last applied search and clears unsaved choices only after a successful refresh; saved connections stay in the project.</p><button type="button" className="btn-secondary" disabled={busy||!!requestId||!frame.eligible||!listing?.hasMore||page>=100} onClick={()=>void continueGitlabBatch()}>Continue from page {page+1} in a fresh batch</button></div>}<div style={actions}><button type="button" className="btn-secondary" disabled={busy} onClick={()=>void load(connectionId,1,"",true)}>Connect more repositories</button><button type="button" disabled={busy} onClick={onClose}>Done</button></div></>}
  </div>;
}
