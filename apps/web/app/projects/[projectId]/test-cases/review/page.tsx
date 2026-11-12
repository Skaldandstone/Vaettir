"use client";

import { ActionButton } from "@/components/ui/ActionButton";
import { useEffect,useLayoutEffect,useRef,useState } from "react";
import { useParams } from "next/navigation";
import { trpcReact } from "@/lib/trpcReact";
import { useCaseReviewQueue } from "@/lib/use-case-review-queue";
import { CaseReviewDecision } from "@/components/CaseReviewDecision";
export default function ReviewQueuePage(){const {projectId}=useParams<{projectId:string}>();return <ReviewQueueSession projectId={projectId}/>;}
function ReviewQueueSession({projectId}:{projectId:string}){
  const queue=useCaseReviewQueue(projectId),utils=trpcReact.useUtils(),[selected,setSelected]=useState<string|null>(null),[opened,setOpened]=useState<Array<{projectId:string;caseId:string}>>([]),[notice,setNotice]=useState(""),[selectedIds,setSelectedIds]=useState<string[]>([]),[allMatching,setAllMatching]=useState(false),[bulkOpen,setBulkOpen]=useState(false),[bulkReviewed,setBulkReviewed]=useState(false),bulk=trpcReact.caseReview.decideBulk.useMutation();
  const openedRef=useRef(opened);useLayoutEffect(()=>{openedRef.current=opened;},[opened]);
  const refresh=async()=>{queue.refresh();await Promise.all([utils.testCases.list.invalidate({projectId}),utils.caseReview.count.invalidate({projectId})]);};
  function open(caseId:string){if(!queue.canOpen(caseId))return;if(!openedRef.current.some(item=>item.projectId===projectId&&item.caseId===caseId)){if(openedRef.current.length>=10){setNotice("Ten retained review editors are already open in this page instance. Recover any uncertain requests before navigating; nothing was discarded.");return;}const next=[...openedRef.current,{projectId,caseId}];openedRef.current=next;setOpened(next);}setSelected(caseId);setNotice("");}
  function releaseAcknowledged(item:{projectId:string;caseId:string}){
    // Child invokes this ONLY after its synchronous authoritative release check.
    // Parent never guesses from cached mutation/draft state or auto-evicts rows.
    const next=openedRef.current.filter(current=>current.projectId!==item.projectId||current.caseId!==item.caseId);openedRef.current=next;setOpened(next);setSelected(current=>current===item.caseId?null:current);setNotice("The explicitly released editor slot is available. Other retained decisions were not discarded.");
  }
  const page=queue.fresh;
  useEffect(()=>{setSelectedIds([]);setAllMatching(false);setBulkOpen(false);setBulkReviewed(false);},[page?.populationHash]);
  const selectedCount=page?(allMatching?page.matching:selectedIds.length):0;
  const toggle=(caseId:string)=>{if(!page||allMatching)return;setSelectedIds(current=>current.includes(caseId)?current.filter(id=>id!==caseId):[...current,caseId]);};
  const selectPage=()=>{if(!page||allMatching)return;setSelectedIds(current=>page.items.every(item=>current.includes(item.id))?[]:page.items.map(item=>item.id));};
  async function approveSelected(){
    if(!page||!queue.origin||!bulkReviewed||selectedCount===0||bulk.isPending)return;
    try { const result=await bulk.mutateAsync({projectId,originalOrganizationId:queue.origin.organizationId,expectedClerkActorId:queue.origin.clerkActorId,expectedNativeActorId:queue.origin.nativeActorId,search:queue.filter.search,sort:queue.filter.sort,populationHash:page.populationHash,selection:allMatching?{mode:"ALL_MATCHING"}:{mode:"SELECTED",caseIds:selectedIds},requestId:crypto.randomUUID(),confirmed:true});setNotice(`${result.approvedCount} cases approved.`);setSelectedIds([]);setAllMatching(false);setBulkOpen(false);setBulkReviewed(false);await refresh(); }
    catch(error){setNotice(error instanceof Error?error.message:"Could not approve the selected cases.");}
  }
  return <main style={{maxWidth:1100}}>
    <a className="btn-secondary" href={`/projects/${projectId}/test-cases`}>← Test cases</a><h1>Review queue</h1>
    <p>Review pending cases here. <a className="inline-help" href="/guide#cases" target="_blank" rel="noopener noreferrer" title="Open the guide in a new tab">Help</a></p>
    <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
      <label>Search pending cases<input type="search" maxLength={200} value={queue.freshAccess?queue.filter.search:""} disabled={!queue.freshAccess} onChange={event=>queue.setSearch(event.target.value)} placeholder="Case ID, title or source path"/></label>
      <label>Sort<select value={queue.filter.sort} disabled={!queue.freshAccess} onChange={event=>queue.setSort(event.target.value as typeof queue.filter.sort)}><option value="confidence">Lowest known confidence</option><option value="case-id">Case ID</option><option value="title">Title</option></select></label>
      <ActionButton type="button" onClick={queue.refresh} tooltip={<> Refresh current reader </>}> Refresh </ActionButton><ActionButton type="button" disabled={!queue.freshAccess} onClick={queue.first} tooltip={<> Return to first page </>}> First page </ActionButton>
    </div>
    {!page&&<p role="status">Verifying the current original workspace, native actor and pending page. Cached queue details are withheld.</p>}
    {queue.error&&<p role="alert">{queue.error}</p>}{(queue.notice||notice)&&<p role="status">{queue.notice||notice}</p>}
    {page&&<><p role="status">{page.matching} pending · {page.items.length?`${page.offset+1}–${page.offset+page.items.length}`:"0"} shown</p>
      <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap",margin:"12px 0"}}>
        <label><input type="checkbox" checked={allMatching} disabled={!queue.freshAccess||page.matching>250} onChange={event=>{setAllMatching(event.target.checked);setSelectedIds([]);}}/> Select all {page.matching} matching</label>
        <label><input type="checkbox" checked={!allMatching&&page.items.length>0&&page.items.every(item=>selectedIds.includes(item.id))} disabled={!queue.freshAccess||allMatching} onChange={selectPage}/> Page</label>
        <ActionButton type="button" disabled={!queue.freshAccess||selectedCount===0||bulk.isPending} onClick={()=>{setBulkOpen(true);setBulkReviewed(false);}} tooltip={<> Review and approve selected current cases </>}>Approve ({selectedCount})</ActionButton>
      </div>
      {page.matching>250&&<p className="text-muted">Select up to 250 cases at a time.</p>}
      {bulkOpen&&<section aria-label="Bulk approval review" style={{border:"1px solid var(--line)",borderRadius:8,padding:12,marginBottom:12}}><strong>Approve {selectedCount} cases?</strong><p className="text-muted">If any case changed or needs individual review, none are approved.</p><label><input type="checkbox" checked={bulkReviewed} onChange={event=>setBulkReviewed(event.target.checked)}/> I reviewed these cases</label><div style={{display:"flex",gap:8,marginTop:10}}><ActionButton type="button" disabled={!bulkReviewed||bulk.isPending} onClick={()=>void approveSelected()} tooltip={<> Approve selected current cases </>}>{bulk.isPending?"Approving…":"Approve"}</ActionButton><ActionButton type="button" disabled={bulk.isPending} onClick={()=>setBulkOpen(false)} tooltip={<> Keep current selection without approving </>}>Cancel</ActionButton></div></section>}
      {page.items.length===0&&<p>No pending cases match this filter.</p>}
      <ul style={{listStyle:"none",padding:0}}>{page.items.map(item=><li key={item.id} style={{borderBottom:"1px solid var(--line)",padding:"10px 4px"}}>
        <div style={{display:"grid",gridTemplateColumns:"auto minmax(0,1fr) auto",gap:10,alignItems:"center"}}><input aria-label={`Select ${item.displayId}`} type="checkbox" checked={!allMatching&&selectedIds.includes(item.id)} disabled={!queue.freshAccess||allMatching} onChange={()=>toggle(item.id)}/><button type="button" className="case-title-button" style={{minWidth:0}} onClick={()=>open(item.id)} title={item.title}><code className="case-id">{item.displayId}</code><strong style={{minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.title}</strong></button><ActionButton type="button" onClick={()=>open(item.id)} tooltip={<> Open supported review snapshot </>}>Review</ActionButton></div>
        <details style={{marginLeft:28,marginTop:6}}><summary>Details</summary><span className="text-muted">{item.confidence===null?"No confidence supplied":`${(item.confidence*100).toFixed(0)}% confidence`}{item.sourceFilePath?` · ${item.sourceFilePath}`:""}</span></details>
      </li>)}</ul>
      <nav aria-label="Current pending queue pages"><button type="button" disabled={page.offset===0} onClick={queue.previous}>Previous</button><button type="button" disabled={page.nextOffset===null} onClick={queue.next}>Next</button></nav>
    </>}
    {selected&&<ActionButton type="button" onClick={()=>setSelected(null)} tooltip={<> Close review view (retain decision) </>}> Close review </ActionButton>}
    {/* Editors stay mounted when closed or their current reader disappears. No
        request is silently rebased, discarded or recreated by another page. */}
    {opened.map(item=>{const active=item.projectId===projectId&&selected===item.caseId&&!!queue.freshAccess;return <div key={`${item.projectId}:${item.caseId}`} hidden={!active} ref={node=>{if(node)node.inert=!active;}}><CaseReviewDecision projectId={item.projectId} caseId={item.caseId} active={active} readOnly={!queue.freshAccess?.canRecover} onSaved={refresh} onRelease={()=>releaseAcknowledged(item)}/></div>;})}
    <details><summary>Details</summary><p className="text-muted">Keep this page open until your review is saved. <a className="inline-help" href="/guide#cases" target="_blank" rel="noopener noreferrer" title="Open the guide in a new tab">Help</a></p></details>
  </main>;
}
