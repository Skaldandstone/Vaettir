"use client";
import { useLayoutEffect,useRef,useState } from "react";
import { useParams } from "next/navigation";
import { trpcReact } from "@/lib/trpcReact";
import { useCaseReviewQueue } from "@/lib/use-case-review-queue";
import { CaseReviewDecision } from "@/components/CaseReviewDecision";
export default function ReviewQueuePage(){const {projectId}=useParams<{projectId:string}>();return <ReviewQueueSession projectId={projectId}/>;}
function ReviewQueueSession({projectId}:{projectId:string}){
  const queue=useCaseReviewQueue(projectId),utils=trpcReact.useUtils(),[selected,setSelected]=useState<string|null>(null),[opened,setOpened]=useState<Array<{projectId:string;caseId:string}>>([]),[notice,setNotice]=useState("");
  const openedRef=useRef(opened);useLayoutEffect(()=>{openedRef.current=opened;},[opened]);
  const refresh=async()=>{queue.refresh();await Promise.all([utils.testCases.list.invalidate({projectId}),utils.caseReview.count.invalidate({projectId})]);};
  function open(caseId:string){if(!queue.canOpen(caseId))return;if(!openedRef.current.some(item=>item.projectId===projectId&&item.caseId===caseId)){if(openedRef.current.length>=10){setNotice("Ten retained review editors are already open in this page instance. Recover any uncertain requests before navigating; nothing was discarded.");return;}const next=[...openedRef.current,{projectId,caseId}];openedRef.current=next;setOpened(next);}setSelected(caseId);setNotice("");}
  function releaseAcknowledged(item:{projectId:string;caseId:string}){
    // Child invokes this ONLY after its synchronous authoritative release check.
    // Parent never guesses from cached mutation/draft state or auto-evicts rows.
    const next=openedRef.current.filter(current=>current.projectId!==item.projectId||current.caseId!==item.caseId);openedRef.current=next;setOpened(next);setSelected(current=>current===item.caseId?null:current);setNotice("The explicitly released editor slot is available. Other retained decisions were not discarded.");
  }
  const page=queue.fresh;
  return <main style={{maxWidth:1100}}>
    <a className="btn-secondary" href={`/projects/${projectId}/test-cases`}>← Test cases</a><h1>Review queue</h1>
    <p>Active pending cases only. Approved cases belong in the repository; rejected and archived cases remain retained outside this queue. Browsing pages never selects or approves hidden cases.</p>
    <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
      <label>Search pending cases<input type="search" maxLength={200} value={queue.freshAccess?queue.filter.search:""} disabled={!queue.freshAccess} onChange={event=>queue.setSearch(event.target.value)} placeholder="Case ID, title or source path"/></label>
      <label>Sort<select value={queue.filter.sort} disabled={!queue.freshAccess} onChange={event=>queue.setSort(event.target.value as typeof queue.filter.sort)}><option value="confidence">Lowest known confidence</option><option value="case-id">Case ID</option><option value="title">Title</option></select></label>
      <button type="button" onClick={queue.refresh}>Refresh current reader</button><button type="button" disabled={!queue.freshAccess} onClick={queue.first}>Return to first page</button>
    </div>
    {!page&&<p role="status">Verifying the current original workspace, native actor and pending page. Cached queue details are withheld.</p>}
    {queue.error&&<p role="alert">{queue.error}</p>}{(queue.notice||notice)&&<p role="status">{queue.notice||notice}</p>}
    {page&&<><p role="status">{page.matching} matching of {page.totalPending} pending cases · Showing {page.items.length?`${page.offset+1}–${page.offset+page.items.length}`:"0"}. Counts cover the admitted current pending population, not just visible cards.</p>
      {page.items.length===0&&<p>No pending cases match this filter.</p>}
      <ul style={{listStyle:"none",padding:0}}>{page.items.map(item=><li key={item.id} style={{border:"1px solid var(--line)",padding:16,marginBottom:12,borderRadius:8}}>
        <code>{item.displayId}</code><h2 style={{fontSize:18,whiteSpace:"pre-wrap"}}>{item.title}</h2><p>{item.confidence===null?"Confidence not supplied":`${(item.confidence*100).toFixed(0)}% model confidence, not human approval`}</p>{item.sourceFilePath&&<p style={{overflowWrap:"anywhere"}}>{item.sourceFilePath}</p>}
        <button type="button" onClick={()=>open(item.id)}>Open supported review snapshot</button>
      </li>)}</ul>
      <nav aria-label="Current pending queue pages"><button type="button" disabled={page.offset===0} onClick={queue.previous}>Previous</button><button type="button" disabled={page.nextOffset===null} onClick={queue.next}>Next</button></nav>
    </>}
    {selected&&<button type="button" onClick={()=>setSelected(null)}>Close review view (retain decision)</button>}
    {/* Editors stay mounted when closed or their current reader disappears. No
        request is silently rebased, discarded or recreated by another page. */}
    {opened.map(item=>{const active=item.projectId===projectId&&selected===item.caseId&&!!queue.freshAccess;return <div key={`${item.projectId}:${item.caseId}`} hidden={!active} ref={node=>{if(node)node.inert=!active;}}><CaseReviewDecision projectId={item.projectId} caseId={item.caseId} active={active} readOnly={!queue.freshAccess?.canRecover} onSaved={refresh} onRelease={()=>releaseAcknowledged(item)}/></div>;})}
    <p className="text-muted">Retained requests survive closing this mounted view and temporary access changes. Reload/route-away recovery, bulk decisions and additional relationship review contexts are not provided by this slice.</p>
  </main>;
}
