"use client";
import {useState} from "react";
import {useIsMutating} from "@tanstack/react-query";
import {trpcReact} from "@/lib/trpcReact";
import {ProviderMark} from "./SourceConnectionChips";
import {Modal} from "./Modal";
import {RepositoryConnectionContent,repositoryProviders,type RepositoryProvider} from "./RepositoryConnectionContent";
export function ProjectRepositories({projectId,canEdit}:{projectId:string;canEdit:boolean}){
  const query=trpcReact.project.repositories.useQuery({projectId});
  const [provider,setProvider]=useState<RepositoryProvider|null>(null);
  const busy=useIsMutating()>0;
  return <section id="project-repositories" aria-label="Project repositories">
    <h2>Repositories</h2><p className="text-muted">Connect repositories, then choose what belongs to this project.</p>
    {query.error&&<p role="alert">{query.error.message}</p>}
    {query.data?.length===0&&<p className="text-muted">No repositories registered for this project yet.</p>}
    {query.isLoading&&<p role="status">Loading registered repositories…</p>}
    <div className="source-chip-list">{query.data?.map(repo=>{
      const knownProvider=repositoryProviders.find(([id])=>id===repo.provider)?.[0];
      const content=<><ProviderMark id={repo.provider}/><span style={{overflowWrap:"anywhere",minWidth:0}}><strong>{repo.url}</strong><small>{repo.accessVerified?"Registered · Access verified":"Registered · Access unverified"}{repo.revision?` · ${repo.revision}`:""}</small></span></>;
      return canEdit&&knownProvider?<button type="button" className="source-connection-chip" key={repo.id} style={{textAlign:"left",maxWidth:"100%"}} aria-label={`Review ${repo.url} connection options`} onClick={()=>setProvider(knownProvider)}>{content}<span aria-hidden="true">→</span></button>:<span className="source-connection-chip" key={repo.id} style={{maxWidth:"100%"}}>{content}</span>;
    })}</div>
    {canEdit&&<div className="source-chip-list">{repositoryProviders.map(([id,label])=><button type="button" className="source-connection-chip" key={id} onClick={()=>setProvider(id)}><ProviderMark id={id}/><span><strong>{label}</strong><small>{id==="github"||id==="gitlab"?"Authorize and choose repositories":id==="bitbucket"||id==="azure-devops"?"Verify access and choose repositories":"Add exported evidence"}</small></span><span aria-hidden="true">+</span></button>)}</div>}
    <Modal open={!!provider} onClose={()=>setProvider(null)} title={`Add ${repositoryProviders.find(([id])=>id===provider)?.[1]??"repository"}`} dismissible={!busy}>
      {provider&&<RepositoryConnectionContent key={provider} projectId={projectId} provider={provider} onConnected={()=>{void query.refetch();}} onClose={()=>setProvider(null)}/>}
    </Modal>
  </section>;
}
