"use client";
import {useState} from "react";
import {trpcReact,type RouterInputs} from "@/lib/trpcReact";

type Scope=RouterInputs["agent"]["scanRepo"]["scope"];
type Consent=RouterInputs["agent"]["scanRepo"]["consent"];
export function RepositoryProcessingReview({projectId,purpose,initialUrl,initialRef="main",onApprove,onRecovered}:{
  projectId:string;purpose:"TEST_CASES"|"REQUIREMENTS";initialUrl?:string;initialRef?:string;
  onApprove:(scope:Scope,consent:Consent)=>Promise<void>;onRecovered?:(results:unknown)=>void;
}){
  const repositories=trpcReact.project.repositories.useQuery({projectId});
  const runs=trpcReact.agent.repositoryProcessingRuns.useQuery({projectId,purpose});
  const [repoUrl,setUrl]=useState(initialUrl??"");const [ref,setRef]=useState(initialRef);
  const [paths,setPaths]=useState("");const [maxItems,setMaxItems]=useState(purpose==="REQUIREMENTS"?10:25);
  const [scope,setScope]=useState<Scope|null>(null);const [requestId,setRequestId]=useState(()=>crypto.randomUUID());
  const [source,setSource]=useState(false);const [ai,setAi]=useState(false);const [cost,setCost]=useState(false);
  const [busy,setBusy]=useState(false);const [attempted,setAttempted]=useState(false);const [error,setError]=useState<string|null>(null);
  const preview=trpcReact.agent.previewRepoProcessing.useQuery({projectId,purpose,scope:scope??{repoUrl:"",ref:"",pathPrefixes:["."],maxItems}},{enabled:!!scope,retry:false});
  const status=trpcReact.agent.repositoryProcessingStatus.useQuery({projectId,requestId},{enabled:attempted,refetchInterval:busy?2000:false,retry:false});
  const cancel=trpcReact.agent.cancelRepositoryProcessing.useMutation({onSuccess:()=>void status.refetch()});
  function review(){setError(null);setScope({repoUrl:repoUrl.trim(),ref:ref.trim(),pathPrefixes:paths.split(/[,\n]/).map(p=>p.trim()).filter(Boolean),maxItems});setRequestId(crypto.randomUUID());setAttempted(false);setSource(false);setAi(false);setCost(false);}
  async function approve(){
    if(!scope||!preview.isSuccess||!preview.data||busy||!source||!ai||!cost||!preview.data.canSpend||preview.data.balance<preview.data.estimatedCredits)return;setBusy(true);setError(null);setAttempted(true);
    try{await onApprove(scope,{requestId,expectedScopeHash:preview.data.scopeHash,approveSourceRead:true,approveAiProcessing:true,approveVariableCredits:true});}
    catch(e){setError(e instanceof Error?e.message:"Source processing failed. Paid results remain in the saved run.");}
    finally{setBusy(false);void status.refetch();}
  }
  if(!scope)return <div style={{display:"grid",gap:12}}>
    <p>Choose a repository and the files to process. Connecting an account only verifies metadata access; it does not authorize reading source or using AI.</p>
    {runs.isSuccess&&runs.data.length>0&&<label>Previous approved runs<select value="" onChange={event=>{if(event.target.value){setRequestId(event.target.value);setAttempted(true);}}}><option value="">Select a saved run to recover or inspect</option>{runs.data.map(run=><option key={run.requestId} value={run.requestId}>{new Date(run.createdAt).toLocaleString()} · {run.status.toLowerCase()} · {run.repositoryUrl} · {run.ref}</option>)}</select></label>}
    {runs.error&&<><p role="alert">Saved runs could not be loaded.</p><button type="button" className="btn-secondary" onClick={()=>void runs.refetch()}>Retry saved runs</button></>}
    {attempted&&status.error&&<><p role="alert">Saved run access could not be confirmed.</p><button type="button" className="btn-secondary" onClick={()=>void status.refetch()}>Retry saved run access</button></>}
    {attempted&&status.isSuccess&&status.data&&<p role="status">Saved run: {status.data.status.toLowerCase()}{status.data.resolvedCommitSha?` · Commit ${status.data.resolvedCommitSha}`:""}</p>}
    {attempted&&status.isSuccess&&Boolean(status.data?.results)&&onRecovered&&<button type="button" className="btn-secondary" onClick={()=>onRecovered(status.data!.results)}>Recover retained drafts without another AI charge</button>}
    {repositories.error&&<><p role="alert">Registered repositories could not be loaded. Retry before selecting a saved reference.</p><button type="button" className="btn-secondary" onClick={()=>void repositories.refetch()}>Retry registered repositories</button></>}
    {repositories.isSuccess&&!!repositories.data?.length&&<label>Registered repository<select value={repositories.data.find(repo=>repo.url===repoUrl)?.id??""} onChange={event=>{const repo=repositories.data?.find(item=>item.id===event.target.value);if(repo){setUrl(repo.url);setRef(repo.revision??"main");}}}><option value="">Choose a registered repository</option>{repositories.data.map(repo=><option key={repo.id} value={repo.id}>{repo.provider} · {repo.url}{repo.revision?` · ${repo.revision}`:""}</option>)}</select></label>}
    <label>Repository HTTPS URL<input value={repoUrl} onChange={event=>setUrl(event.target.value)} style={{width:"100%"}} placeholder="https://github.com/organization/repository"/></label>
    <label>Branch, tag or exact commit<input value={ref} onChange={event=>setRef(event.target.value)} style={{width:"100%"}}/></label>
    <p className="text-muted">This reader supports credential-free public repositories on GitHub.com, GitLab.com, Bitbucket.org and dev.azure.com only. OAuth or token verification does not enable private source discovery here. For self-hosted or private repositories, export selected documents or test files and use the upload flow instead.</p>
    <label>Files or folder prefixes, one per line<textarea value={paths} onChange={event=>setPaths(event.target.value)} placeholder={purpose==="REQUIREMENTS"?"README.md\ndocs/requirements":"tests\nsrc/tests"} rows={3} style={{width:"100%"}}/></label>
    <p className="text-muted">Enter . only if you intend to allow all eligible paths. Secrets, binaries, generated dependencies and symlinks are excluded. No imported code is executed.</p>
    <label>Maximum {purpose==="REQUIREMENTS"?"documents":"test files"}<input type="number" min={1} max={purpose==="REQUIREMENTS"?10:25} value={maxItems} onChange={event=>setMaxItems(Number(event.target.value))}/></label>
    <button type="button" className="btn-primary" disabled={!repoUrl.trim()||!ref.trim()||!paths.trim()||maxItems<1||maxItems>(purpose==="REQUIREMENTS"?10:25)} onClick={review}>Review scope and credits</button>
  </div>;
  return <div style={{display:"grid",gap:12}}>
    <h3>Approve source processing</h3><dl><dt>Repository</dt><dd style={{overflowWrap:"anywhere"}}>{scope.repoUrl}</dd><dt>Selected revision</dt><dd>{scope.ref}</dd><dt>Allowed file paths</dt><dd>{scope.pathPrefixes.join(", ")}</dd><dt>Purpose</dt><dd>{purpose==="REQUIREMENTS"?"Draft requirements for your review":"Draft test cases for review, preserving existing edits and approvals"}</dd></dl>
    <p>Cloning downloads the selected repository revision. The path selection limits files read and sent to AI, not the Git network transfer. The exact resolved commit is retained with this run. A branch or tag does not establish what is deployed.</p>
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
