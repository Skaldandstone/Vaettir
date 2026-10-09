"use client";
import { useState } from "react";
import { trpcReact } from "@/lib/trpcReact";
import { useCaseFieldAccess } from "@/lib/use-case-field-access";
import { ConnectedRepositoryPicker } from "./ConnectedRepositoryPicker";

export function RepositoryReleaseDiscovery({projectId}:{projectId:string}) {
  const [repositoryId,setRepositoryId]=useState("");
  const [provider,setProvider]=useState("");
  return <section className="panel" aria-label="Repository releases" style={{minWidth:0}}>
    <h2>Repository releases</h2>
    <ProjectReleaseBatch key={projectId} projectId={projectId}/>
    <details style={{marginTop:12}}><summary>Browse one repository</summary>
    <ConnectedRepositoryPicker projectId={projectId} selectedId={repositoryId} onSelect={repo=>{setRepositoryId(repo?.id??"");setProvider(repo?.provider??"");}}/>
    {repositoryId&&provider==="gitlab"&&<ReleaseList key={`${projectId}:${repositoryId}`} projectId={projectId} repositoryId={repositoryId}/>}
    {repositoryId&&provider!=="gitlab"&&<p className="text-muted">Native release discovery for this provider is not enabled yet. Its project connection remains available.</p>}
    </details>
  </section>;
}
function ProjectReleaseBatch({projectId}:{projectId:string}) {
  const [offset,setOffset]=useState(0);
  const access=useCaseFieldAccess(projectId);
  const query=trpcReact.repositoryIntelligence.projectReleases.useQuery({projectId,offset},{enabled:access.readable&&access.canEdit,retry:false,staleTime:0,refetchOnWindowFocus:false});
  const ready=access.readable&&access.canEdit&&query.isSuccess&&!query.error&&!query.isFetching&&!query.isPaused&&query.data.projectId===projectId&&query.data.offset===offset;
  return <div style={{display:"grid",gap:8,minWidth:0}}>
    <p className="text-muted">Checks connected repositories in batches of five. Provider releases are not verified deployments or automatically created release goals. No source files or AI processing.</p>
    {!access.readable||!access.canEdit?<p role="status">Current full editor access is required for provider metadata.</p>:query.error?<p role="alert">Repository releases could not be verified. No empty result is inferred.</p>:!ready?<p role="status">Checking connected repository releases…</p>:<>
      {!query.data.repositories.length&&<p>No connected repositories in this batch.</p>}
      {query.data.repositories.map(repo=><div key={repo.repositoryId} style={{overflowWrap:"anywhere",borderBottom:"1px solid var(--border)",paddingBlock:8}}>
        <a href={repo.url} target="_blank" rel="noopener noreferrer">{repo.url.split("/").slice(3).join("/")}</a>
        {repo.status==="CHECKED"?<>
          {!repo.releases.length&&<p className="text-muted">No provider releases returned on the first page.</p>}
          {repo.releases.map(release=><div key={release.tag}><a href={release.url} target="_blank" rel="noopener noreferrer">{release.name||release.tag}</a> · {release.tag}<small style={{display:"block"}}>Commit {release.commitSha} · {new Date(release.releasedAt).toLocaleString()}</small></div>)}
          {repo.hasMore&&<small>More releases exist. Browse this repository for later pages.</small>}
        </>:<p role="status">{repo.status==="UNSUPPORTED"?"Native release discovery for this provider is not enabled yet.":repo.status==="NOT_INSPECTED"?"Batch time limit reached. This repository was not inspected.":"Release access could not be verified. Review its saved connection."}</p>}
      </div>)}
      <div style={{display:"flex",flexWrap:"wrap",gap:8}}><button type="button" className="btn-secondary" disabled={offset===0} onClick={()=>setOffset(Math.max(0,offset-5))}>Previous repositories</button><button type="button" className="btn-secondary" disabled={query.data.nextOffset===null} onClick={()=>query.data.nextOffset!==null&&setOffset(query.data.nextOffset)}>Next repositories</button></div>
    </>}
    <button type="button" className="btn-secondary" disabled={!access.readable||!access.canEdit||query.isFetching||query.isPaused} onClick={()=>{if(access.origin&&access.owns(access.origin,"edit"))void query.refetch();}}>Refresh repository releases</button>
  </div>;
}
function ReleaseList({projectId,repositoryId}:{projectId:string;repositoryId:string}) {
  const [page,setPage]=useState(1);
  const access=useCaseFieldAccess(projectId);
  const query=trpcReact.repositoryIntelligence.releases.useQuery({projectId,repositoryId,page},{enabled:access.readable&&access.canEdit,retry:false,staleTime:0,refetchOnWindowFocus:false});
  const ready=access.readable&&access.canEdit&&query.isSuccess&&!query.error&&!query.isFetching&&!query.isPaused&&query.data.projectId===projectId&&query.data.repositoryId===repositoryId&&query.data.page===page;
  return <div style={{display:"grid",gap:8,marginTop:12}}>
    <p className="text-muted">Uses the existing GitLab connection. These are provider releases, not verified deployments or automatically created release goals.</p>
    {!access.readable||!access.canEdit?<p role="status">Current full editor access is required for provider metadata.</p>:query.error?<><p role="alert">{query.error.message}</p><button className="btn-secondary" type="button" onClick={()=>void query.refetch()}>Retry repository releases</button></>:!ready?<p role="status">Checking repository releases…</p>:<>
      {!query.data.releases.length&&<p>No releases returned on this page.</p>}
      {query.data.releases.map(release=><div key={release.tag} style={{overflowWrap:"anywhere"}}><a href={release.url} target="_blank" rel="noopener noreferrer">{release.name||release.tag}</a> · {release.tag}<small style={{display:"block"}}>Commit {release.commitSha} · {new Date(release.releasedAt).toLocaleString()}</small></div>)}
      {query.data.pageLimitReached&&<p role="status">Page limit reached. This is not a complete release list.</p>}
      <div style={{display:"flex",gap:8}}><button type="button" className="btn-secondary" disabled={page===1} onClick={()=>setPage(page-1)}>Previous releases</button><button type="button" className="btn-secondary" disabled={!query.data.hasMore||page>=10} onClick={()=>setPage(page+1)}>More releases</button></div>
    </>}
  </div>;
}
