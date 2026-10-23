"use client";
import {useLayoutEffect,useMemo,useRef,useState} from "react";
import {useAuth} from "@clerk/nextjs";
import {repositoryDisplayName} from "@/lib/repository-display";
import {useIsMutating} from "@tanstack/react-query";
import {isConnectionMutation} from "@/lib/connection-mutation";
import {trpcReact,type RouterInputs,type RouterOutputs} from "@/lib/trpcReact";
import {useCaseFieldAccess} from "@/lib/use-case-field-access";
import {currentSessionScope,sameAuthScope} from "@/lib/auth-query-cache";
import {retainAnalysisRequest} from "@/lib/analysis-request-recovery";
import {ProviderMark} from "./SourceConnectionChips";
import {Modal} from "./Modal";
import {RepositoryConnectionContent,repositoryProviders,type RepositoryProvider} from "./RepositoryConnectionContent";
import {RepositoryProviderPicker,cancelRepositoryAuthorization,type RepositoryAuthorizationIntent} from "./RepositoryProviderPicker";
export function ProjectRepositories({projectId,canEdit}:{projectId:string;canEdit:boolean}){
  const query=trpcReact.project.repositories.useQuery({projectId});
  const ready=query.isSuccess&&!query.error&&!query.isFetching&&!query.isPaused&&query.data.every(repo=>repo.projectId===projectId);
  const repositories=ready?query.data:undefined;
  const [provider,setProvider]=useState<RepositoryProvider|null>(null);
  const [providerChoice,setProviderChoice]=useState<RepositoryProvider|"">("");
  const [authorizations,setAuthorizations]=useState<Partial<Record<RepositoryProvider,RepositoryAuthorizationIntent>>>({});
  const [open,setOpen]=useState(false);
  const [visited,setVisited]=useState<RepositoryProvider[]>([]);
  const screenHeading=useRef<HTMLHeadingElement>(null);
  const busy=useIsMutating({predicate:mutation=>{
    const key=mutation.options.mutationKey;
    const route=key?.[0];
    return isConnectionMutation(key)||(Array.isArray(route)&&route[0]==="project"&&route[1]==="addRepository");
  }})>0;
  useLayoutEffect(()=>{
    if(!open)return;
    const dialog=screenHeading.current?.closest("dialog");
    dialog?.scrollTo({top:0});
    // Leave initial focus and opener capture to the native dialog. Focus the
    // screen heading only when navigating within an already open dialog.
    if(dialog?.open)screenHeading.current?.focus();
  },[provider,open]);
  function chooseProvider(next:RepositoryProvider,intent?:RepositoryAuthorizationIntent){
    if(busy||!canEdit||!ready){cancelRepositoryAuthorization(intent);return;}
    if(intent)setAuthorizations(previous=>({...previous,[next]:intent}));
    setProvider(next);
    setVisited(previous=>previous.includes(next)?previous:[...previous,next]);
    setOpen(true);
  }
  function close(){
    if(busy)return;
    setOpen(false);
    Object.values(authorizations).forEach(cancelRepositoryAuthorization);
    setAuthorizations({});
    setProvider(null);
    setProviderChoice("");
    setVisited([]);
  }
  return <section id="project-repositories" aria-label="Project repositories">
    <h2>Repositories</h2><p className="text-muted">Connect repositories, then choose what belongs to this project.</p>
    {query.error&&<><p role="alert">Saved repositories could not be refreshed. Existing references and connection drafts are retained.</p><button type="button" className="btn-secondary" onClick={()=>void query.refetch()}>Retry repository access</button></>}
    {repositories?.length===0&&<p className="text-muted">No repositories registered for this project yet.</p>}
    {query.isLoading&&<p role="status">Loading registered repositories…</p>}
    <SavedRepositoryAccessCheck projectId={projectId} repositories={repositories??null} canEdit={canEdit&&ready} onChecked={()=>query.refetch()}/>
    <div className="source-chip-list">{repositories?.map(repo=>{
      const knownProvider=repositoryProviders.find(([id])=>id===repo.provider)?.[0];
      const name=repositoryDisplayName(repo.url);
      const content=<><ProviderMark id={repo.provider}/><span style={{overflowWrap:"anywhere",minWidth:0}}><strong>{name}</strong><small>{repo.accessVerified?"Registered · Access verified":"Registered · Access unverified"}{repo.revision?` · ${repo.revision}`:""}</small></span></>;
      return canEdit&&knownProvider?<button type="button" className="source-connection-chip" aria-haspopup="dialog" key={repo.id} style={{textAlign:"left",maxWidth:"100%"}} aria-label={`Review ${name} connection options`} onClick={()=>chooseProvider(knownProvider)}>{content}<span aria-hidden="true">→</span></button>:<span className="source-connection-chip" key={repo.id} style={{maxWidth:"100%"}}>{content}</span>;
    })}</div>
    {canEdit&&ready&&<button type="button" className="source-connection-chip" aria-haspopup="dialog" disabled={busy} onClick={()=>{setProvider(null);setOpen(true);}}>
      <ProviderMark id="git"/><strong>Connect repo</strong><span aria-hidden="true">+</span>
    </button>}
    <Modal open={open} onClose={close} title="Connect repository" dismissible={!busy}>
      {open&&<>
        <h3 ref={screenHeading} tabIndex={-1}>{provider?repositoryProviders.find(([id])=>id===provider)?.[1]:"Choose a repository provider"}</h3>
        <div hidden={!canEdit||!ready}>
          <div hidden={provider!==null}>
            <RepositoryProviderPicker value={providerChoice} onChange={setProviderChoice} onConnect={chooseProvider} disabled={busy} authorize/>
          </div>
          {visited.map(id=><div key={id} hidden={provider!==id}><RepositoryConnectionContent projectId={projectId} provider={id} initialAuthorization={authorizations[id]} active={provider===id&&canEdit&&ready} onConnected={()=>{void query.refetch();}} onClose={close}/></div>)}
          {provider&&<button type="button" className="btn-secondary" style={{marginTop:16}} disabled={busy} onClick={()=>{cancelRepositoryAuthorization(authorizations[provider]);setProviderChoice(provider);setProvider(null);}}>Back to providers</button>}
        </div>
        {(!canEdit||!ready)&&<><p role="alert">{!canEdit?"A full editor seat is required to connect repositories.":"Repository access could not be confirmed. Your connection selections and saved references remain unchanged."}</p>{canEdit&&<button type="button" className="btn-secondary" onClick={()=>void query.refetch()}>Retry repository access</button>}</>}
      </>}
    </Modal>
  </section>;
}

type SavedAccessInput=RouterInputs["repositoryIntelligence"]["savedAccess"];
type SavedRepository=RouterOutputs["project"]["repositories"][number];
function SavedRepositoryAccessCheck({projectId,repositories,canEdit,onChecked}:{projectId:string;repositories:SavedRepository[]|null;canEdit:boolean;onChecked:()=>Promise<unknown>}){
  const access=useCaseFieldAccess(projectId),auth=useAuth();
  const check=trpcReact.repositoryIntelligence.savedAccess.useMutation();
  const [selectedId,setSelectedId]=useState("");
  const [notice,setNotice]=useState("");
  const [retained,setRetained]=useState<{input:SavedAccessInput;sessionId:string;unknown:boolean}|null>(null);
  const [pending,setPending]=useState(false);
  const [epoch,publishEpoch]=useState(0);
  const ownershipEpoch=useRef(0);
  const generation=useRef(0),inFlight=useRef(false);
  const held=useRef<typeof retained>(null);
  const selected=repositories?.find(repo=>repo.id===selectedId);
  const sdkScope=typeof window==="undefined"?null:currentSessionScope(window.Clerk?.loaded?window.Clerk.session:null);
  const sdkCurrent=sameAuthScope({userId:auth.userId??"",sessionId:auth.sessionId??""},sdkScope);
  const frame=useMemo(()=>({projectId,organizationId:access.origin?.organizationId??"",nativeActorId:access.fresh?.readScope?.actorId??"",clerkActorId:auth.userId??"",sessionId:auth.sessionId??"",connectionId:selected?.connectionId??"",repositoryId:selectedId,
    eligible:canEdit&&access.canEdit&&access.readable&&auth.isLoaded&&!!auth.isSignedIn&&sdkCurrent&&!!selected?.connectionId&&selected.provider==="gitlab",
  }),[projectId,access.origin?.organizationId,access.fresh?.readScope?.actorId,auth.userId,auth.sessionId,auth.isLoaded,auth.isSignedIn,sdkCurrent,selected?.connectionId,selected?.provider,selectedId,canEdit,access.canEdit,access.readable]);
  const committed=useRef<{frame:typeof frame;epoch:number}|null>(null);
  useLayoutEffect(()=>{const owner={frame,epoch:++ownershipEpoch.current};committed.current=owner;publishEpoch(owner.epoch);return()=>{if(committed.current===owner){committed.current=null;ownershipEpoch.current=owner.epoch+1;}};},[frame]);
  function ownsReader(original:typeof frame){const current=committed.current?.frame;return ownershipEpoch.current===epoch&&committed.current?.epoch===epoch&&!!current&&current.projectId===original.projectId&&current.organizationId===original.organizationId&&!!current.nativeActorId&&current.nativeActorId===original.nativeActorId&&current.clerkActorId===original.clerkActorId&&current.sessionId===original.sessionId&&sameAuthScope({userId:original.clerkActorId,sessionId:original.sessionId},typeof window==="undefined"?null:currentSessionScope(window.Clerk?.loaded?window.Clerk.session:null));}
  function owns(original:typeof frame){const current=committed.current?.frame;return ownsReader(original)&&!!current?.eligible&&current.repositoryId===original.repositoryId&&current.connectionId===original.connectionId;}
  const event=generation.current;
  async function checkConnection(){
    if(event!==generation.current||inFlight.current||held.current||!owns(frame))return;
    const input:SavedAccessInput=Object.freeze({projectId,repositoryId:frame.repositoryId,originalOrganizationId:frame.organizationId,expectedNativeActorId:frame.nativeActorId,expectedClerkActorId:frame.clerkActorId,expectedConnectionId:frame.connectionId});
    const attempt={input,sessionId:frame.sessionId,unknown:false};held.current=attempt;setRetained(attempt);inFlight.current=true;setPending(true);setNotice("");
    try{
      const result=await check.mutateAsync(input);
      const keys=["projectId","repositoryId","connectionId","originalOrganizationId","expectedNativeActorId","expectedClerkActorId","status","accessMethod","reused","renewed"];
      if(!result||Object.keys(result).length!==keys.length||keys.some(key=>!Object.hasOwn(result,key))||result.projectId!==input.projectId||result.repositoryId!==input.repositoryId||result.connectionId!==input.expectedConnectionId||result.originalOrganizationId!==input.originalOrganizationId||result.expectedNativeActorId!==input.expectedNativeActorId||result.expectedClerkActorId!==input.expectedClerkActorId||result.status!=="VERIFIED"||result.reused!==true||typeof result.renewed!=="boolean"||!(result.accessMethod==="token"||result.accessMethod==="oauth"))throw Error("Unmatched saved-access acknowledgement");
      if(!owns(frame)){attempt.unknown=true;setRetained({...attempt});return;}
      held.current=null;setRetained(null);generation.current++;
      setNotice("Saved account connection verified for this repository reference. This does not verify every repository permission, source read or deployment.");
      try{await onChecked();}catch{if(owns(frame))setNotice("Saved account connection was verified, but its displayed status could not be refreshed. Refresh saved status; do not resubmit the check to repair this display.");}
    }catch(cause){
      attempt.unknown=retainAnalysisRequest(attempt.unknown||!owns(frame),cause);
      if(attempt.unknown){held.current=attempt;setRetained({...attempt});if(owns(frame))setNotice("Connection check was not acknowledged. Its original account, repository and saved grant are retained. No automatic retry will be made; refresh saved status before reviewing that original grant.");}
      else{held.current=null;setRetained(null);generation.current++;if(owns(frame))setNotice("Saved access could not be verified. Review the original saved grant or reconnect deliberately; no repository references were removed.");}
    }finally{inFlight.current=false;setPending(false);}
  }
  const sessionCurrent=auth.isLoaded&&!!auth.isSignedIn&&sameAuthScope({userId:frame.clerkActorId,sessionId:frame.sessionId},typeof window==="undefined"?null:currentSessionScope(window.Clerk?.loaded?window.Clerk.session:null));
  const originalVisible=sessionCurrent&&(!retained||(frame.projectId===retained.input.projectId&&frame.organizationId===retained.input.originalOrganizationId&&frame.nativeActorId===retained.input.expectedNativeActorId&&frame.clerkActorId===retained.input.expectedClerkActorId&&frame.sessionId===retained.sessionId&&frame.connectionId===retained.input.expectedConnectionId&&access.readable));
  return <section aria-label="Check saved repository connection" style={{display:"grid",gap:8,marginBlock:16,minWidth:0}}>
    <h3 style={{fontSize:16,margin:0}}>Saved connection</h3>
    <details><summary>What does this check?</summary><p className="text-muted">Checks one saved GitLab account connection and may renew its originally approved metadata access. It does not read source files, run AI or verify every repository permission.</p></details>
    {!originalVisible?<p role="status">Restore the original account, session, project and saved grant to inspect the retained check. No check is submitted in this scope.</p>:<>
      <label style={{display:"grid",gap:6}}>Saved repository reference<select style={{maxWidth:"100%",minWidth:0}} value={selectedId} disabled={!canEdit||!access.canEdit||!access.readable||pending||!!retained} onChange={change=>{if(event!==generation.current||!ownsReader(frame)||!canEdit||!access.canEdit||!access.origin||!access.owns(access.origin,"edit")||inFlight.current||held.current)return;generation.current++;setSelectedId(change.target.value);setNotice("");}}><option value="">Choose a saved GitLab reference</option>{access.readable&&repositories?.filter(repo=>repo.provider==="gitlab"&&repo.connectionId).map(repo=><option key={repo.id} value={repo.id}>{repositoryDisplayName(repo.url)}</option>)}</select></label>
      <div style={{display:"flex",flexWrap:"wrap",gap:8}}><button type="button" className="btn-secondary" disabled={!frame.eligible||pending||!!retained} onClick={checkConnection}>{pending?"Checking connection…":"Check connection"}</button><button type="button" className="btn-secondary" disabled={!access.readable||pending} onClick={async()=>{if(!ownsReader(frame)||!access.origin||!access.owns(access.origin)||inFlight.current)return;try{await onChecked();}catch{if(ownsReader(frame)&&access.owns(access.origin))setNotice("Saved status could not be refreshed. The original check outcome is unchanged.");}}}>Refresh saved status</button></div>
      {notice&&<p role={retained?.unknown?"alert":"status"}>{notice}</p>}
      {retained?.unknown&&!notice&&<p role="alert">The original connection check was not acknowledged. It remains retained; no automatic retry or replacement check will be made.</p>}
    </>}
  </section>;
}
