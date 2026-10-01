"use client";
import {useState} from "react";
import {trpcReact} from "@/lib/trpcReact";

type ProjectChoice={id:string;key:string;name:string;url:string};
const actions={display:"flex",gap:8,flexWrap:"wrap"} as const;

/** Metadata-only intake. Provider reads and writes always require their own approval. */
export function JiraIssueIntake({connectionId,projects,onBack}:{connectionId:string;projects:ProjectChoice[];onBack:()=>void}){
  const history=trpcReact.jiraIssueIntake.mine.useQuery({connectionId});
  const [runId,setRunId]=useState("");
  const run=trpcReact.jiraIssueIntake.get.useQuery({runId},{enabled:!!runId});
  const start=trpcReact.jiraIssueIntake.start.useMutation();
  const next=trpcReact.jiraIssueIntake.nextPage.useMutation();
  const finish=trpcReact.jiraIssueIntake.finishPreview.useMutation();
  const approve=trpcReact.jiraIssueIntake.approve.useMutation();
  const process=trpcReact.jiraIssueIntake.processBatch.useMutation();
  const cancel=trpcReact.jiraIssueIntake.cancel.useMutation();
  const [chosenProjects,setChosenProjects]=useState<string[]>([]);
  const [permission,setPermission]=useState(false);
  const [selected,setSelected]=useState<string[]>([]);
  const [error,setError]=useState("");
  const [confirmCancel,setConfirmCancel]=useState(false);
  const [startRequest,setStartRequest]=useState<string|null>(null);
  const [pageRequest,setPageRequest]=useState<{id:string;version:number}|null>(null);
  const [approvalRequest,setApprovalRequest]=useState<{id:string;version:number;ids:string[]}|null>(null);
  const busy=start.isPending||next.isPending||finish.isPending||approve.isPending||process.isPending||cancel.isPending;
  const cancelBusy=start.isPending||finish.isPending||approve.isPending||process.isPending||cancel.isPending;
  const current=run.isSuccess?run.data:undefined;
  const canRead=current&&(current.status==="PREVIEW"||current.status==="PARTIAL"||current.status==="READING"&&!current.readInFlight);
  async function refresh(){await Promise.all([run.refetch(),history.refetch()]);}
  function resetAttempt(){setStartRequest(null);setPermission(false);}
  async function loadPage(){
    if(!current)return;
    const request=pageRequest??{id:crypto.randomUUID(),version:current.version};setPageRequest(request);setError("");
    try{await next.mutateAsync({runId,version:request.version,requestId:request.id});setPageRequest(null);await refresh();}
    catch{setError("This issue page could not be read. Retry the same request, or refresh to check its saved status. Previously staged evidence is retained.");await refresh();}
  }
  return <div style={{display:"grid",gap:16,minWidth:0}}>
    <h3>Import Jira issue summaries</h3>
    <p className="text-muted">Cost: 0 AI credits. No AI service is used. Only issue identity, title, status, updated time and source link are read; descriptions, comments, attachments and code are excluded.</p>
    {(error||history.error||run.error)&&<p role="alert">{error||"Saved intake state could not be loaded. Refresh before continuing; no success is assumed."}</p>}
    {!runId&&<>
      <p>Choose from the approved project scope, then allow issue reads for this run. Saving connection scope did not grant this permission.</p>
      {history.isLoading&&<p role="status">Loading previous runs…</p>}
      {history.error&&<button type="button" className="btn-secondary" disabled={busy} onClick={()=>void history.refetch()}>Retry saved runs</button>}
      {!!history.data?.length&&<details><summary>Previous intake runs ({history.data.length})</summary><ul style={{paddingLeft:20,overflowWrap:"anywhere"}}>{history.data.map(item=><li key={item.id} style={{marginTop:8}}><button type="button" className="btn-secondary" onClick={()=>{setRunId(item.id);setSelected([]);setError("");}}>{item.status.toLowerCase()} · {item.issueCount} staged · {item.completedCount} processed</button>{item.lastError&&<span> · Last attempt needs attention</span>}</li>)}</ul></details>}
      <div className="source-chip-list" role="group" aria-label="Approved Jira projects for issue intake">{projects.map(p=><button key={p.id} type="button" className="source-connection-chip" aria-pressed={chosenProjects.includes(p.id)} disabled={busy||chosenProjects.length>=20&&!chosenProjects.includes(p.id)} style={{maxWidth:"100%",overflowWrap:"anywhere"}} onClick={()=>{resetAttempt();setChosenProjects(prior=>prior.includes(p.id)?prior.filter(x=>x!==p.id):[...prior,p.id]);}}><span><strong>{p.key}</strong><small>{p.name}</small></span>{chosenProjects.includes(p.id)&&<span aria-hidden="true">✓</span>}</button>)}</div>
      {!projects.length&&<p>No approved projects are available. Return to connection scope and approve projects first.</p>}
      <p>Up to 20 projects, five pages and 100 issue summaries per run. You choose each page to read. This is a bounded snapshot, not an exhaustive import or automatic sync.</p>
      <label style={{display:"flex",gap:8,alignItems:"flex-start"}}><input type="checkbox" checked={permission} disabled={busy} onChange={event=>setPermission(event.target.checked)}/><span>I approve reading issue summaries only from these {chosenProjects.length} selected Jira projects for this run.</span></label>
      <div style={actions}><button type="button" className="btn-secondary" disabled={busy} onClick={onBack}>Back to connection</button><button type="button" disabled={busy||!permission||!chosenProjects.length||!history.isSuccess} onClick={async()=>{
        if(!permission||!chosenProjects.length)return;const request=startRequest??crypto.randomUUID();setStartRequest(request);setError("");
        try{const result=await start.mutateAsync({connectionId,projectIds:chosenProjects,requestId:request,approveIssueRead:true});setRunId(result.id);setPermission(false);setStartRequest(null);setSelected([]);await history.refetch();}
        catch{setError("Could not save this read approval. Retry the same request. No issue read or import success is assumed.");await history.refetch();}
      }}>{start.isPending?"Saving permission…":"Approve issue reads and start preview"}</button></div>
    </>}
    {runId&&<>
      {run.isLoading&&<p role="status">Loading saved intake run…</p>}
      <button type="button" className="btn-secondary" disabled={busy} onClick={()=>{setError("");setPageRequest(null);void refresh();}}>Refresh saved status</button>
      {current&&<>
        <p role="status">{current.status.toLowerCase()} · {current.issues.length} summaries staged · {current.pageCount}/5 pages · {current.results.length} processed</p>
        <p style={{overflowWrap:"anywhere"}}>Selected scope: {current.projects.map(p=>p.key).join(", ")}</p>
        {current.lastError&&<p role="alert">Last attempt could not finish. Saved evidence and completed imports remain available. Retry the relevant action or cancel this run.</p>}
        {current.bounded&&<p role="status">The run reached its intake limit. Unread Jira issues have not been removed or imported.</p>}
        {current.status==="READING"&&<p role="status">{current.readInFlight?"A page read is in progress. Refresh its saved status; do not start a second read.":"The previous read lease expired. Retry this page or finish the saved partial preview."}</p>}
        {canRead&&<>
          <p>Read another page or finish this snapshot for review. No requirements have been written.</p>
          <div style={actions}><button type="button" disabled={busy||!current.nextPageAvailable&&!pageRequest} onClick={()=>void loadPage()}>{next.isPending?"Reading summaries…":pageRequest?"Retry issue page":"Read next issue page"}</button><button type="button" className="btn-secondary" disabled={busy||!!pageRequest} onClick={async()=>{setError("");try{await finish.mutateAsync({runId,version:current.version});setSelected(current.issues.filter(i=>i.classification==="new").map(i=>i.id));await refresh();}catch{setError("Could not finish preview. Refresh and retry; staged summaries are retained.");await refresh();}}}>Finish preview and review</button></div>
        </>}
        {!!current.issues.length&&<div style={{maxHeight:320,overflow:"auto",minWidth:0}}><table style={{width:"100%",tableLayout:"fixed"}}><caption>Issue summary preview</caption><thead><tr>{current.status==="REVIEW"&&<th scope="col" style={{width:40}}>Add</th>}<th scope="col" style={{overflowWrap:"anywhere"}}>Issue</th><th scope="col" style={{overflowWrap:"anywhere"}}>Status / evidence</th></tr></thead><tbody>{current.issues.map(issue=><tr key={issue.id}>{current.status==="REVIEW"&&<td><input type="checkbox" aria-label={`Import ${issue.key}`} checked={selected.includes(issue.id)} disabled={busy||!!approvalRequest||issue.classification!=="new"} onChange={event=>setSelected(prior=>event.target.checked?[...prior,issue.id]:prior.filter(id=>id!==issue.id))}/></td>}<td style={{overflowWrap:"anywhere"}}><a href={issue.url} target="_blank" rel="noopener noreferrer">{issue.key}</a><div>{issue.title}</div></td><td style={{overflowWrap:"anywhere"}}>{issue.status}<div>{issue.classification==="conflicting"?"Conflict: retained for human review":issue.classification==="unchanged"?"Unchanged: no duplicate":"New: addition available"}</div><small>Updated: <time dateTime={issue.updatedAt} title={issue.updatedAt}>{issue.updatedAt.slice(0,10)}</time></small></td></tr>)}</tbody></table></div>}
        {current.status==="REVIEW"&&<>
          <p>Add {selected.length} selected issue summaries as requirements? Existing records, approvals and human edits stay unchanged. Conflicting evidence is retained for review, never silently applied.</p>
          <p>Approval locks this selection. Import then proceeds in batches of up to 10, with progress saved after every batch. Cost: 0 AI credits.</p>
          <button type="button" disabled={busy||!selected.length} onClick={async()=>{
            const request=approvalRequest??{id:crypto.randomUUID(),version:current.version,ids:[...selected]};setApprovalRequest(request);setError("");
            try{await approve.mutateAsync({runId,version:request.version,issueIds:request.ids,requestId:request.id,approved:true});setApprovalRequest(null);await refresh();}
            catch{setError("Import approval could not be confirmed. Retry the same selection or refresh its saved status; no completed import is assumed.");await refresh();}
          }}>{approve.isPending?"Saving import approval…":approvalRequest?"Retry import approval":"Approve selected additions"}</button>
        </>}
        {current.status==="IMPORTING"&&<>
          <p>Process the next approved batch. You can close this module and resume later. A failed batch can be retried without duplicating completed additions.</p>
          <button type="button" disabled={busy} onClick={async()=>{setError("");try{await process.mutateAsync({runId});await refresh();}catch{setError("This batch did not complete. Refresh its saved progress, then retry. Completed records are preserved.");await refresh();}}}>{process.isPending?"Processing batch…":"Process next batch (up to 10)"}</button>
        </>}
        {current.status==="COMPLETE"&&<p role="status">This approved batch is complete. Saved results and source identities remain attached to this run. Other Jira issues were not imported. No ongoing sync is enabled.</p>}
        {current.status==="CANCELLED"&&<p role="status">Run cancelled. Completed requirements and staged source evidence are preserved. Start a new run for further reads.</p>}
        {!!current.results.length&&<details><summary>Saved import results ({current.results.length})</summary><ul style={{overflowWrap:"anywhere"}}>{current.results.map(result=><li key={result.issueId}>{current.issues.find(i=>i.id===result.issueId)?.key??result.issueId}: {result.kind}{result.kind==="conflicting"?"; existing record retained":""}</li>)}</ul></details>}
        {current.status!=="CANCELLED"&&current.status!=="COMPLETE"&&!confirmCancel&&<button type="button" className="btn-secondary" disabled={cancelBusy} onClick={()=>setConfirmCancel(true)}>Cancel this run</button>}
        {confirmCancel&&<section role="group" aria-label="Confirm intake cancellation"><p>Stop further reads and imports? This keeps every completed requirement and all staged evidence.</p><div style={actions}><button type="button" className="btn-secondary" disabled={cancelBusy} onClick={()=>setConfirmCancel(false)}>Keep this run</button><button type="button" disabled={cancelBusy} onClick={async()=>{setError("");try{await cancel.mutateAsync({runId,confirmed:true});setConfirmCancel(false);await refresh();}catch{setError("Cancellation could not be confirmed. Refresh the saved run and retry.");await refresh();}}}>Confirm cancellation</button></div></section>}
      </>}
      <div style={actions}><button type="button" className="btn-secondary" disabled={busy} onClick={()=>{setRunId("");setPageRequest(null);setApprovalRequest(null);setConfirmCancel(false);setError("");}}>Back to intake runs</button><button type="button" className="btn-secondary" disabled={busy} onClick={onBack}>Save state and return to connection</button></div>
    </>}
  </div>;
}
