"use client";
import {useLayoutEffect,useRef,useState} from "react";
import {useIsMutating} from "@tanstack/react-query";
import {isConnectionMutation} from "@/lib/connection-mutation";
import {trpcReact} from "@/lib/trpcReact";
import {ProviderMark} from "./SourceConnectionChips";
import {Modal} from "./Modal";
import {RepositoryConnectionContent,repositoryProviders,type RepositoryProvider} from "./RepositoryConnectionContent";
export function ProjectRepositories({projectId,canEdit}:{projectId:string;canEdit:boolean}){
  const query=trpcReact.project.repositories.useQuery({projectId});
  const repositories=query.isSuccess?query.data:undefined;
  const [provider,setProvider]=useState<RepositoryProvider|null>(null);
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
  function chooseProvider(next:RepositoryProvider){
    if(busy||!canEdit||!query.isSuccess)return;
    setProvider(next);
    setVisited(previous=>previous.includes(next)?previous:[...previous,next]);
    setOpen(true);
  }
  function close(){
    if(busy)return;
    setOpen(false);
    setProvider(null);
    setVisited([]);
  }
  return <section id="project-repositories" aria-label="Project repositories">
    <h2>Repositories</h2><p className="text-muted">Connect repositories, then choose what belongs to this project.</p>
    {query.error&&<><p role="alert">{query.error.message}</p><button type="button" className="btn-secondary" onClick={()=>void query.refetch()}>Retry repository access</button></>}
    {repositories?.length===0&&<p className="text-muted">No repositories registered for this project yet.</p>}
    {query.isLoading&&<p role="status">Loading registered repositories…</p>}
    <div className="source-chip-list">{repositories?.map(repo=>{
      const knownProvider=repositoryProviders.find(([id])=>id===repo.provider)?.[0];
      const content=<><ProviderMark id={repo.provider}/><span style={{overflowWrap:"anywhere",minWidth:0}}><strong>{repo.url}</strong><small>{repo.accessVerified?"Registered · Access verified":"Registered · Access unverified"}{repo.revision?` · ${repo.revision}`:""}</small></span></>;
      return canEdit&&knownProvider?<button type="button" className="source-connection-chip" aria-haspopup="dialog" key={repo.id} style={{textAlign:"left",maxWidth:"100%"}} aria-label={`Review ${repo.url} connection options`} onClick={()=>chooseProvider(knownProvider)}>{content}<span aria-hidden="true">→</span></button>:<span className="source-connection-chip" key={repo.id} style={{maxWidth:"100%"}}>{content}</span>;
    })}</div>
    {canEdit&&query.isSuccess&&<button type="button" className="source-connection-chip" aria-haspopup="dialog" disabled={busy} onClick={()=>{setProvider(null);setOpen(true);}}>
      <ProviderMark id="git"/><strong>Connect repo</strong><span aria-hidden="true">+</span>
    </button>}
    <Modal open={open} onClose={close} title="Connect repository" dismissible={!busy}>
      {open&&<>
        <h3 ref={screenHeading} tabIndex={-1}>{provider?repositoryProviders.find(([id])=>id===provider)?.[1]:"Choose a repository provider"}</h3>
        <div hidden={!canEdit||!query.isSuccess}>
          <div hidden={provider!==null}>
            <div role="group" aria-label="Repository providers" style={{display:"grid",gap:8}}>{repositoryProviders.map(([id,label])=><button type="button" className="source-connection-chip" key={id} disabled={busy} style={{width:"100%",maxWidth:"100%",textAlign:"left",justifyContent:"flex-start",boxSizing:"border-box"}} onClick={()=>chooseProvider(id)}>
              <ProviderMark id={id}/><span style={{minWidth:0,overflowWrap:"anywhere"}}><strong>{label}</strong><small>{id==="github"||id==="gitlab"?"Authorize account, then choose repositories":id==="bitbucket"||id==="azure-devops"?"Verify a token, then choose repositories":"Import exports · native connection unavailable"}</small></span><span aria-hidden="true" style={{marginLeft:"auto"}}>→</span>
            </button>)}</div>
          </div>
          {visited.map(id=><div key={id} hidden={provider!==id}><RepositoryConnectionContent projectId={projectId} provider={id} onConnected={()=>{void query.refetch();}} onClose={close}/></div>)}
          {provider&&<button type="button" className="btn-secondary" style={{marginTop:16}} disabled={busy} onClick={()=>setProvider(null)}>Back to providers</button>}
        </div>
        {(!canEdit||!query.isSuccess)&&<><p role="alert">{!canEdit?"A full editor seat is required to connect repositories.":"Repository access could not be confirmed. Your connection selections and saved references remain unchanged."}</p>{canEdit&&<button type="button" className="btn-secondary" onClick={()=>void query.refetch()}>Retry repository access</button>}</>}
      </>}
    </Modal>
  </section>;
}
