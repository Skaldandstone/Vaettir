"use client";
import { useState } from "react";
import { trpcReact } from "@/lib/trpcReact";
import { useCaseFieldAccess } from "@/lib/use-case-field-access";
import { repositoryDisplayName } from "@/lib/repository-display";

export function RepositoryReleaseDiscovery({projectId}:{projectId:string}) {
  return <RepositoryReleaseWorkspace key={projectId} projectId={projectId}/>;
}
function RepositoryReleaseWorkspace({projectId}:{projectId:string}) {
  const [offset,setOffset]=useState(0);
  const [selected,setSelected]=useState<{id:string;label:string}|null>(null);
  return <section className="panel" aria-label="Repository releases" style={{minWidth:0}}>
    <h2>Repository releases</h2>
    {selected ? <>
      <button type="button" className="btn-secondary" onClick={()=>setSelected(null)}>Back to project releases</button>
      <ReleaseList key={projectId+":"+selected.id} projectId={projectId} repositoryId={selected.id} label={selected.label}/>
    </> : <ProjectReleaseBatch projectId={projectId} offset={offset} onOffsetChange={setOffset} onBrowse={(id,label)=>setSelected({id,label})}/>}
  </section>;
}
function ProjectReleaseBatch({projectId,offset,onOffsetChange,onBrowse}:{projectId:string;offset:number;onOffsetChange:(offset:number)=>void;onBrowse:(id:string,label:string)=>void}) {
  const access=useCaseFieldAccess(projectId);
  const query=trpcReact.repositoryIntelligence.projectReleases.useQuery({projectId,offset},{enabled:access.readable&&access.canEdit,retry:false,staleTime:0,refetchOnWindowFocus:false});
  const ready=access.readable&&access.canEdit&&query.isSuccess&&!query.error&&!query.isFetching&&!query.isPaused&&query.data.projectId===projectId&&query.data.offset===offset;
  function current(){return ready&&!!access.origin&&access.owns(access.origin,"edit");}
  return <div style={{display:"grid",gap:8,minWidth:0}}>
    <details><summary>About repository releases</summary><p className="text-muted">Checks connected repositories in batches of five. Provider releases are not verified deployments or automatically created release goals. No source files or AI processing.</p></details>
    {!access.readable||!access.canEdit?<p role="status">Current full editor access is required for provider metadata.</p>:query.error?<p role="alert">Repository releases could not be verified. No empty result is inferred.</p>:!ready?<p role="status">Checking connected repository releases…</p>:<>
      {!query.data.repositories.length&&<p>No connected repositories in this batch.</p>}
      {query.data.repositories.map(repo=><div key={repo.repositoryId} style={{overflowWrap:"anywhere",borderBottom:"1px solid var(--line)",paddingBlock:8}}>
        <div style={{display:"flex",flexWrap:"wrap",gap:8,alignItems:"center",justifyContent:"space-between"}}>
          <a href={repo.url} target="_blank" rel="noopener noreferrer">{repositoryDisplayName(repo.url)}</a>
          {repo.status==="CHECKED"&&<button type="button" className="btn-secondary" onClick={()=>{if(current())onBrowse(repo.repositoryId,repositoryDisplayName(repo.url));}}>Browse releases</button>}
        </div>
        {repo.status==="CHECKED"?<>
          {!repo.releases.length&&<p className="text-muted">No provider releases returned on the first page.</p>}
          {repo.releases.map(release=><div key={release.tag}><a href={release.url} target="_blank" rel="noopener noreferrer">{release.name||release.tag}</a>{" · "}{release.tag}<small style={{display:"block"}}>Commit {release.commitSha}{" · "}{new Date(release.releasedAt).toLocaleString()}</small></div>)}
          {repo.hasMore&&<small>More releases exist. Browse releases for later pages.</small>}
        </>:<p role="status">{repo.status==="UNSUPPORTED"?"Native release discovery for this provider is not enabled yet.":repo.status==="NOT_INSPECTED"?"Batch time limit reached. This repository was not inspected.":<>Release access could not be verified. <a href={"/projects/"+encodeURIComponent(projectId)+"/settings/integrations"}>Review its saved connection</a>.</>}</p>}
      </div>)}
      <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
        <button type="button" className="btn-secondary" disabled={offset===0} onClick={()=>{if(current())onOffsetChange(Math.max(0,offset-5));}}>Previous repositories</button>
        <button type="button" className="btn-secondary" disabled={query.data.nextOffset===null||query.data.nextOffset>1000} onClick={()=>{if(current()&&query.data.nextOffset!==null&&query.data.nextOffset<=1000)onOffsetChange(query.data.nextOffset);}}>Next repositories</button>
      </div>
    </>}
    <button type="button" className="btn-secondary" disabled={!access.readable||!access.canEdit||query.isFetching||query.isPaused} onClick={()=>{if(access.origin&&access.owns(access.origin,"edit"))void query.refetch();}}>Refresh repository releases</button>
  </div>;
}
function ReleaseList({projectId,repositoryId,label}:{projectId:string;repositoryId:string;label:string}) {
  const [page,setPage]=useState(1);
  const access=useCaseFieldAccess(projectId);
  const query=trpcReact.repositoryIntelligence.releases.useQuery({projectId,repositoryId,page},{enabled:access.readable&&access.canEdit,retry:false,staleTime:0,refetchOnWindowFocus:false});
  const ready=access.readable&&access.canEdit&&query.isSuccess&&!query.error&&!query.isFetching&&!query.isPaused&&query.data.projectId===projectId&&query.data.repositoryId===repositoryId&&query.data.page===page;
  function current(){return ready&&!!access.origin&&access.owns(access.origin,"edit");}
  return <div style={{display:"grid",gap:8,marginTop:12}}>
    <details><summary>About repository releases</summary><p className="text-muted">Uses the existing GitLab connection. These are provider releases, not verified deployments or automatically created release goals.</p></details>
    {!access.readable||!access.canEdit?<p role="status">Current full editor access is required for provider metadata.</p>:query.error?<><p role="alert">Repository releases could not be verified. No empty result is inferred.</p><button className="btn-secondary" type="button" onClick={()=>{if(access.origin&&access.owns(access.origin,"edit"))void query.refetch();}}>Retry repository releases</button></>:!ready?<p role="status">Checking repository releases…</p>:<>
      <h3 style={{fontSize:16,margin:"4px 0"}}>{label}</h3>
      {!query.data.releases.length&&<p>No releases returned on this page.</p>}
      {query.data.releases.map(release=><div key={release.tag} style={{overflowWrap:"anywhere"}}><a href={release.url} target="_blank" rel="noopener noreferrer">{release.name||release.tag}</a>{" · "}{release.tag}<small style={{display:"block"}}>Commit {release.commitSha}{" · "}{new Date(release.releasedAt).toLocaleString()}</small></div>)}
      {query.data.pageLimitReached&&<p role="status">Page limit reached. This is not a complete release list.</p>}
      <div style={{display:"flex",gap:8}}>
        <button type="button" className="btn-secondary" disabled={page===1} onClick={()=>{if(current())setPage(page-1);}}>Previous releases</button>
        <button type="button" className="btn-secondary" disabled={!query.data.hasMore||page>=10} onClick={()=>{if(current()&&page<10)setPage(page+1);}}>More releases</button>
      </div>
    </>}
  </div>;
}
