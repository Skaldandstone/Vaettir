"use client";
import { useState } from "react";
import Link from "next/link";
import { trpcReact, type RouterInputs, type RouterOutputs } from "@/lib/trpcReact";
import { useCaseFieldAccess } from "@/lib/use-case-field-access";
import { ConnectedRepositoryPicker } from "./ConnectedRepositoryPicker";

type Scope=RouterInputs["repositoryCoverageChecks"]["preview"]["scope"];
export function RepositoryCoverageReview({projectId}:{projectId:string}) {
  return <Review key={projectId} projectId={projectId}/>;
}
function Review({projectId}:{projectId:string}) {
  const access=useCaseFieldAccess(projectId);
  const [repositoryId,setRepositoryId]=useState("");const [provider,setProvider]=useState("");
  const [ref,setRef]=useState("HEAD");const [paths,setPaths]=useState("");const [maxItems,setMaxItems]=useState(25);
  const [scope,setScope]=useState<Scope|null>(null);const [allowed,setAllowed]=useState(false);
  const [requestId,setRequestId]=useState(()=>crypto.randomUUID());const [attempted,setAttempted]=useState(false);
  const [result,setResult]=useState<RouterOutputs["repositoryCoverageChecks"]["compare"]|null>(null);
  const preview=trpcReact.repositoryCoverageChecks.preview.useQuery({projectId,scope:scope??{repositoryId:"",ref:"HEAD",pathPrefixes:["."],maxItems:25}},{enabled:!!scope&&access.readable&&access.canEdit,retry:false,staleTime:0,refetchOnWindowFocus:false});
  const mutation=trpcReact.repositoryCoverageChecks.compare.useMutation();
  const ready=access.readable&&access.canEdit&&preview.isSuccess&&!preview.error&&!preview.isFetching&&!preview.isPaused;
  async function compare(){
    const original=access.origin;
    if(!scope||!original||!access.owns(original,"edit")||!ready||!allowed||attempted||mutation.isPending)return;
    setAttempted(true);
    try{const value=await mutation.mutateAsync({projectId,scope,consent:{requestId,expectedScopeHash:preview.data.scopeHash,approveSourceRead:true}});if(access.owns(original,"edit"))setResult(value);}
    catch{/* The durable start/failure receipt remains; never automatically reread. */}
  }
  return <section className="panel" aria-label="Compare repository test files" style={{minWidth:0,overflowWrap:"anywhere"}}>
    <h2>Compare existing cases with repository tests</h2>
    <p className="text-muted">Compare pinned test-file hashes with approved case source links. No AI, credits, imported-code execution, or case edits. This is source traceability, not functional or code-coverage measurement.</p>
    {!access.readable&&<p role="status">Checking project access… The original repository selection and comparison draft remain retained and withheld.</p>}
    {/* Keep the picker mounted through fresh access reads. Remounting its
        staleTime:0 access observer would trigger another parent refresh. */}
    <fieldset hidden={!access.readable||!!scope} disabled={!access.readable||!access.canEdit||!!scope} style={{border:0,padding:0,margin:0,marginBottom:12,minWidth:0}}>
      <ConnectedRepositoryPicker projectId={projectId} selectedId={repositoryId} disabled={!access.readable||!access.canEdit||!!scope} onSelect={repo=>{const original=access.origin;if(!original||!access.owns(original,"edit"))return;setRepositoryId(repo?.id??"");setProvider(repo?.provider??"");setRef(repo?.revision??"HEAD");}}/>
    </fieldset>
    {access.readable&&(!scope?<div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr)",gap:12}}>
      {repositoryId&&provider!=="gitlab"&&<p>Private file comparison for this provider is not enabled yet.</p>}
      <label>Branch, tag or commit<input style={{width:"100%"}} value={ref} onChange={e=>setRef(e.target.value)}/></label>
      <label>Test files or folders, one per line<textarea style={{width:"100%"}} value={paths} rows={3} onChange={e=>setPaths(e.target.value)} placeholder="tests\nsrc/tests"/></label>
      <label>Maximum test files<input type="number" min={1} max={25} value={maxItems} onChange={e=>setMaxItems(Number(e.target.value))}/></label>
      <button type="button" className="btn-primary" disabled={!access.canEdit||!repositoryId||provider!=="gitlab"||!ref.trim()||!paths.trim()||!Number.isInteger(maxItems)||maxItems<1||maxItems>25} onClick={()=>{
        const original=access.origin;if(!original||!access.owns(original,"edit"))return;
        setScope({repositoryId,ref:ref.trim(),pathPrefixes:paths.split(/[,\n]/).map(path=>path.trim()).filter(Boolean),maxItems});setRequestId(crypto.randomUUID());setAllowed(false);setAttempted(false);setResult(null);mutation.reset();
      }}>Review source comparison</button>
    </div>:<div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr)",gap:12}}>
      <p>{ready?preview.data.repositoryUrl:"Verifying the selected repository…"} · revision {scope.ref}</p>
      <p>Allowed paths: {scope.pathPrefixes.join(", ")} · up to {scope.maxItems} test files. GitLab tree and eligible file contents are read using the existing grant only after approval.</p>
      {preview.error&&<><p role="alert">{preview.error.message}</p><button type="button" className="btn-secondary" onClick={()=>void preview.refetch()}>Refresh comparison access</button></>}
      <label><input type="checkbox" checked={allowed} disabled={attempted||mutation.isPending||!access.canEdit} onChange={e=>setAllowed(e.target.checked)}/> Allow this scoped source read for file comparison. No files will be sent to AI.</label>
      {mutation.error&&<p role="alert">{mutation.error.message}</p>}
      <button type="button" className="btn-primary" disabled={!ready||!allowed||attempted||mutation.isPending} onClick={()=>void compare()}>{mutation.isPending?"Comparing approved scope…":"Compare source links"}</button>
      <button type="button" className="btn-secondary" disabled={mutation.isPending} onClick={()=>setScope(null)}>Back to scope</button>
      {result&&<section role="status">
        <p>Commit {result.commitSha} · observed {new Date(result.observedAt).toLocaleString()}</p>
        <p>{result.inspectedFileCount} of {result.eligibleFileCount} eligible test files inspected. {result.truncated?"Partial file scope, not complete repository coverage.":"Bounded candidate listing completed."}</p>
        {result.files.length===0&&<p>No eligible, safe text files returned in this scope. This does not establish that the repository has no tests or requirements.</p>}
        {result.files.map(file=><div key={file.path} style={{marginBlock:12,overflowWrap:"anywhere"}}><strong>{file.path}</strong><p>{file.state==="CURRENT_SOURCE_LINKS"?"Approved cases link to this exact file content.":file.state==="STALE_SOURCE_LINKS"?"Existing case source links reference older file content.":file.state==="UNKNOWN_SOURCE_HASH"?"Case source links exist, but their file hash is unknown.":"No approved case source links for this file. Manual cases may still test the same behavior."}</p>{file.cases.map(row=><p key={row.id}><Link href={`/projects/${encodeURIComponent(projectId)}/test-cases/${encodeURIComponent(row.id)}`}>{row.title}</Link> · {row.currentHash?"hash matches":"hash not current"}</p>)}</div>)}
      </section>}
    </div>)}
    <p><Link href={`/projects/${encodeURIComponent(projectId)}/requirement-coverage`}>View requirement-to-case coverage and recorded results</Link></p>
  </section>;
}
