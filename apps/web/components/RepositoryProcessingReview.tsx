"use client";
import {useState} from "react";
import {trpcReact,type RouterInputs} from "@/lib/trpcReact";
import { ConnectedRepositoryPicker } from "./ConnectedRepositoryPicker";
import { useCaseFieldAccess } from "@/lib/use-case-field-access";

type Scope=RouterInputs["agent"]["scanRepo"]["scope"];
type Consent=RouterInputs["agent"]["scanRepo"]["consent"];
export function RepositoryProcessingReview({projectId,purpose,initialUrl,initialRef="main",initialRepositoryId,onApprove,onRecovered}:{
  projectId:string;purpose:"TEST_CASES"|"REQUIREMENTS";initialUrl?:string;initialRef?:string;initialRepositoryId?:string;
  onApprove:(scope:Scope,consent:Consent)=>Promise<void>;onRecovered?:(results:unknown)=>void;
}){
  const access=useCaseFieldAccess(projectId);
  const repositories=trpcReact.project.repositories.useQuery({projectId});
  const runs=trpcReact.agent.repositoryProcessingRuns.useQuery({projectId,purpose});
  const [repoUrl,setUrl]=useState(initialUrl??"");const [ref,setRef]=useState(initialRef);
  const [repositoryId,setRepositoryId]=useState(initialRepositoryId??"");
  const [paths,setPaths]=useState("");const [maxItems,setMaxItems]=useState(purpose==="REQUIREMENTS"?10:25);
  const [scope,setScope]=useState<Scope|null>(null);const [requestId,setRequestId]=useState(()=>crypto.randomUUID());
  const [source,setSource]=useState(false);const [ai,setAi]=useState(false);const [cost,setCost]=useState(false);
  const [busy,setBusy]=useState(false);const [attempted,setAttempted]=useState(false);const [error,setError]=useState<string|null>(null);
  const preview=trpcReact.agent.previewRepoProcessing.useQuery({projectId,purpose,scope:scope??{repoUrl:"",ref:"",pathPrefixes:["."],maxItems}},{enabled:!!scope,retry:false});
  const status=trpcReact.agent.repositoryProcessingStatus.useQuery({projectId,requestId},{enabled:attempted,refetchInterval:busy?2000:false,retry:false});
  const cancel=trpcReact.agent.cancelRepositoryProcessing.useMutation({onSuccess:()=>void status.refetch()});
  const selectedRepository=repositories.isSuccess&&!repositories.error&&!repositories.isFetching&&!repositories.isPaused?repositories.data.find(repo=>repo.id===repositoryId):undefined;
  function review(){
    if(repositoryId&&!selectedRepository){setError("Refresh the original project repository before reviewing source.");return;}
    setError(null);setScope({repoUrl:selectedRepository?.url??repoUrl.trim(),ref:ref.trim(),pathPrefixes:paths.split(/[,\n]/).map(p=>p.trim()).filter(Boolean),maxItems,...(selectedRepository?.provider==="gitlab"?{repositoryId:selectedRepository.id}:{})});setRequestId(crypto.randomUUID());setAttempted(false);setSource(false);setAi(false);setCost(false);
  }
  async function approve(){
    const original=access.origin;
    if(!original||!access.owns(original,"edit")||!scope||!preview.isSuccess||preview.isFetching||preview.isPaused||!preview.data||busy||!source||!ai||!cost||!preview.data.canSpend||preview.data.balance<preview.data.estimatedCredits)return;setBusy(true);setError(null);setAttempted(true);
    try{await onApprove(scope,{requestId,expectedScopeHash:preview.data.scopeHash,approveSourceRead:true,approveAiProcessing:true,approveVariableCredits:true});}
    catch(e){setError(e instanceof Error?e.message:"Source processing failed. Paid results remain in the saved run.");}
    finally{setBusy(false);void status.refetch();}
  }
  if(!access.readable)return <p role="status">Restore the original signed-in account and project access. Repository scope and saved attempts remain retained and withheld here.</p>;
  if(!scope)return <div style={{display:"grid",gap:12}}>
    <p>Choose a repository and the files to process. Connecting an account only verifies metadata access; it does not authorize reading source or using AI.</p>
    {runs.isSuccess&&runs.data.length>0&&<label>Previous approved runs<select value="" onChange={event=>{if(event.target.value){setRequestId(event.target.value);setAttempted(true);}}}><option value="">Select a saved run to recover or inspect</option>{runs.data.map(run=><option key={run.requestId} value={run.requestId}>{new Date(run.createdAt).toLocaleString()} · {run.status.toLowerCase()} · {run.repositoryUrl} · {run.ref}</option>)}</select></label>}
    {runs.error&&<><p role="alert">Saved runs could not be loaded.</p><button type="button" className="btn-secondary" onClick={()=>void runs.refetch()}>Retry saved runs</button></>}
    {attempted&&status.error&&<><p role="alert">Saved run access could not be confirmed.</p><button type="button" className="btn-secondary" onClick={()=>void status.refetch()}>Retry saved run access</button></>}
    {attempted&&status.isSuccess&&status.data&&<p role="status">Saved run: {status.data.status.toLowerCase()}{status.data.resolvedCommitSha?` · Commit ${status.data.resolvedCommitSha}`:""}</p>}
    {attempted&&status.isSuccess&&Boolean(status.data?.results)&&onRecovered&&<button type="button" className="btn-secondary" onClick={()=>onRecovered(status.data!.results)}>Recover retained drafts without another AI charge</button>}
    {repositories.error&&<><p role="alert">Registered repositories could not be loaded. Retry before selecting a saved reference.</p><button type="button" className="btn-secondary" onClick={()=>void repositories.refetch()}>Retry registered repositories</button></>}
    <ConnectedRepositoryPicker projectId={projectId} selectedId={repositoryId} disabled={!access.canEdit} onSelect={repo=>{setRepositoryId(repo?.id??"");setUrl(repo?.url??"");setRef(repo?.revision??(repo?.provider==="gitlab"?"HEAD":"main"));}}/>
    {!repositoryId&&<label>Public repository HTTPS URL<input value={repoUrl} onChange={event=>setUrl(event.target.value)} style={{width:"100%"}} placeholder="https://github.com/organization/repository"/></label>}
    <label>Branch, tag or exact commit<input value={ref} onChange={event=>setRef(event.target.value)} style={{width:"100%"}}/></label>
    <p className="text-muted">Connected GitLab repositories use your existing verified grant after approval, including publicly reachable self-hosted instances. Other providers currently support public hosted source reads; private adapters must be available before scanning. No source is fetched when selecting a repository.</p>
    <label>Files or folder prefixes, one per line<textarea value={paths} onChange={event=>setPaths(event.target.value)} placeholder={purpose==="REQUIREMENTS"?"README.md\ndocs/requirements":"tests\nsrc/tests"} rows={3} style={{width:"100%"}}/></label>
    <p className="text-muted">Enter . only if you intend to allow all eligible paths. Secrets, binaries, generated dependencies and symlinks are excluded. No imported code is executed.</p>
    <label>Maximum {purpose==="REQUIREMENTS"?"documents":"test files"}<input type="number" min={1} max={purpose==="REQUIREMENTS"?10:25} value={maxItems} onChange={event=>setMaxItems(Number(event.target.value))}/></label>
    <button type="button" className="btn-primary" disabled={!repoUrl.trim()||!ref.trim()||!paths.trim()||maxItems<1||maxItems>(purpose==="REQUIREMENTS"?10:25)} onClick={review}>Review scope and credits</button>
  </div>;
  return <div style={{display:"grid",gap:12}}>
    <h3>Approve source processing</h3><dl><dt>Repository</dt><dd style={{overflowWrap:"anywhere"}}>{scope.repoUrl}</dd><dt>Selected revision</dt><dd>{scope.ref}</dd><dt>Allowed file paths</dt><dd>{scope.pathPrefixes.join(", ")}</dd><dt>Purpose</dt><dd>{purpose==="REQUIREMENTS"?"Draft requirements for your review":"Draft test cases for review, preserving existing edits and approvals"}</dd></dl>
    <p>{scope.repositoryId?"GitLab resolves the selected revision, lists its pinned tree, and reads eligible files within your selected scope using the saved connection. No clone or imported code is executed.":"Cloning downloads the selected repository revision. The path selection limits files read and sent to AI, not the Git network transfer."} The exact resolved commit is retained with this run. A branch or tag does not establish what is deployed.</p>
    {preview.isLoading&&<p role="status">Checking current credit balance…</p>}
    {preview.error&&<><p role="alert">{preview.error.message}</p><button type="button" className="btn-secondary" onClick={()=>void preview.refetch()}>Retry credit preview</button></>}
    {preview.isSuccess&&preview.data&&<><p>Estimated {preview.data.estimatedCredits} credits for up to {scope.maxItems} files ({preview.data.unitCreditEstimate} per file). Current balance: {preview.data.balance} credits.</p><p className="text-muted">Actual token usage is reconciled per file and can cost more or less than this estimate. This is not a spending cap. Unchanged paid files are skipped, and paid outputs are retained if later steps fail.</p>
      {!preview.data.canSpend&&<p role="alert">A full-seat editor, administrator or owner must approve credit use. Ask your workspace administrator to authorize the appropriate role and credits. No permission request has been sent.</p>}
      <label><input type="checkbox" checked={source} disabled={busy||attempted} onChange={event=>setSource(event.target.checked)}/> I permit Vaettir to fetch this repository and read only the selected file scope.</label>
      <label><input type="checkbox" checked={ai} disabled={busy||attempted} onChange={event=>setAi(event.target.checked)}/> I permit sending these files to the configured AI provider for the stated purpose.</label>
      <label><input type="checkbox" checked={cost} disabled={busy||attempted} onChange={event=>setCost(event.target.checked)}/> I approve the estimate and usage-based credit reconciliation.</label>
    </>}
    {error&&<p role="alert">{error}</p>}
    {status.isSuccess&&status.data&&<p role="status">Saved run: {status.data.status.toLowerCase()}{status.data.resolvedCommitSha?` · Commit ${status.data.resolvedCommitSha}`:""}</p>}
    {status.error&&<><p role="alert">Saved run access could not be confirmed.</p><button type="button" className="btn-secondary" onClick={()=>void status.refetch()}>Retry saved run access</button></>}
    {status.isSuccess&&Boolean(status.data?.results)&&onRecovered&&<button type="button" className="btn-secondary" disabled={busy} onClick={()=>onRecovered(status.data!.results)}>Recover retained drafts without another AI charge</button>}
    {attempted&&<button type="button" className="btn-secondary" disabled={cancel.isPending} onClick={()=>cancel.mutate({projectId,requestId})}>Cancel remaining source processing</button>}
    <div style={{display:"flex",flexWrap:"wrap",gap:8}}><button type="button" className="btn-secondary" disabled={busy} onClick={()=>setScope(null)}>Back to scope</button><button type="button" className="btn-primary" disabled={busy||attempted||!source||!ai||!cost||!preview.isSuccess||!preview.data?.canSpend||preview.data.balance<preview.data.estimatedCredits} onClick={()=>void approve()}>{busy?"Processing approved scope…":"Approve and process"}</button></div>
  </div>;
}
