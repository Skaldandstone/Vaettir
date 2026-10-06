"use client";
import { useLayoutEffect,useRef,useState } from "react";
import { useCaseReviewAccess,type ReviewAccess } from "./use-case-review-access";
import { assertReviewAck,freezeReviewInput,freezeReviewSnapshot,reviewDecisionHash,sameReviewReader,type ReviewAck,type ReviewDraft,type ReviewInput,type ReviewPending } from "./case-review-decision-draft";
import { manualStartDefinitivelyRejected } from "./manual-run-start";
export type ReviewController={reads:ReviewAccess;draft:ReviewDraft|null;pending:ReviewPending|null;settled:boolean;busy:boolean;readable:boolean;canSave:boolean;canRelease:boolean;notice:string;change:(decision:ReviewInput["decision"],note:ReviewInput["note"])=>void;reviewCurrent:()=>void;save:()=>Promise<void>;release:()=>boolean};
export function useCaseReviewController(projectId:string,caseId:string,active:boolean,readOnly:boolean,mutation:{isPending:boolean;mutateAsync:(input:ReviewInput)=>Promise<ReviewAck>},onSaved:()=>void|Promise<void>):ReviewController{
  const reads=useCaseReviewAccess(projectId,caseId,active);
  const[draft,setDraft]=useState<ReviewDraft|null>(null),[pending,setPending]=useState<ReviewPending|null>(null),[settledIdentity,setSettledIdentity]=useState<string|null>(null),[notice,setNotice]=useState(""),[preparing,setPreparing]=useState(false),[released,setReleased]=useState(false);
  const draftRef=useRef(draft),pendingRef=useRef(pending),settledRef=useRef(settledIdentity),busyRef=useRef(false),releasedRef=useRef(false);
  const authority=JSON.stringify([active,readOnly,projectId,caseId,reads.activation,!!reads.fresh,reads.fresh?.readScope,reads.fresh?.contentHash,reads.fresh?.reviewStateHash,reads.fresh?.canDecide,reads.fresh?.canRecover]);
  const[epochState,setEpochState]=useState({authority,epoch:0});if(epochState.authority!==authority)setEpochState({authority,epoch:epochState.epoch+1});const epoch=epochState.epoch;
  const frame=useRef<{active:boolean;readOnly:boolean;projectId:string;caseId:string;activation:string;epoch:number;fresh:ReviewAccess["fresh"]}|null>(null);
  useLayoutEffect(()=>{frame.current={active:active&&!released,readOnly,projectId,caseId,activation:reads.activation,epoch,fresh:reads.fresh};return()=>{frame.current=null;};},[active,readOnly,projectId,caseId,reads.activation,epoch,reads.fresh,released]);
  const readable=!released&&!!reads.fresh&&(!draft||sameReviewReader(reads.fresh.readScope,draft.origin))&&(!pending||sameReviewReader(reads.fresh.readScope,pending.draft.origin));
  const currentReadHandler=()=>{const current=frame.current;return !releasedRef.current&&readable&&!!current?.active&&current.projectId===projectId&&current.caseId===caseId&&current.activation===reads.activation&&current.epoch===epoch&&current.fresh===reads.fresh&&!!current.fresh&&!!reads.origin&&sameReviewReader(current.fresh.readScope,reads.origin);};
  const currentHandler=()=>currentReadHandler()&&!frame.current?.readOnly&&!!frame.current?.fresh?.canRecover;
  function change(decision:ReviewInput["decision"],note:ReviewInput["note"]){
    const fresh=reads.fresh;if(!currentHandler()||!fresh?.canDecide||!fresh.snapshot||!fresh.contentHash||!fresh.reviewStateHash||!reads.origin||busyRef.current||pendingRef.current||draftRef.current?.identity!==draft?.identity)return;
    const held=draftRef.current,changed=!!held&&(held.contentHash!==fresh.contentHash||held.reviewStateHash!==fresh.reviewStateHash);
    if(settledRef.current&&(!held||!changed))return;
    if(held&&changed&&!settledRef.current){setNotice("The shown case changed. Retain this choice and explicitly review the new snapshot before saving.");return;}
    const next=Object.freeze({identity:crypto.randomUUID(),origin:reads.origin,decision,note:Object.freeze({...note}),contentHash:fresh.contentHash,reviewStateHash:fresh.reviewStateHash,snapshot:freezeReviewSnapshot(fresh.snapshot)});draftRef.current=next;setDraft(next);settledRef.current=null;setSettledIdentity(null);setNotice("");
  }
  function reviewCurrent(){
    const fresh=reads.fresh,held=draftRef.current;if(!held||!currentHandler()||!fresh?.canDecide||!fresh.snapshot||!fresh.contentHash||!fresh.reviewStateHash||!reads.origin||busyRef.current||pendingRef.current||settledRef.current||held.identity!==draft?.identity)return;
    const next=Object.freeze({...held,identity:crypto.randomUUID(),origin:reads.origin,contentHash:fresh.contentHash,reviewStateHash:fresh.reviewStateHash,snapshot:freezeReviewSnapshot(fresh.snapshot)});draftRef.current=next;setDraft(next);setNotice("Current supported snapshot reviewed with your retained choice. This is a case review decision, not a risk, execution, compliance or release approval.");
  }
  async function save(){
    const held=pendingRef.current,captured=held?.draft??draftRef.current;if(!captured||busyRef.current||!currentHandler()||settledRef.current===captured.identity||captured.identity!==draft?.identity)return;
    const activation=frame.current?.activation,startedEpoch=frame.current?.epoch;
    const owns=()=>{const current=frame.current;return !!current?.active&&!current.readOnly&&current.projectId===captured.origin.projectId&&current.caseId===captured.origin.caseId&&current.activation===activation&&current.epoch===startedEpoch&&!!current.fresh?.canRecover&&sameReviewReader(current.fresh.readScope,captured.origin);};
    if(!owns())return;busyRef.current=true;let retained=held;
    try{
      if(!retained){const fresh=frame.current!.fresh!;if(!fresh.canDecide||captured.contentHash!==fresh.contentHash||captured.reviewStateHash!==fresh.reviewStateHash)return;const input=freezeReviewInput(captured,crypto.randomUUID());setPreparing(true);const requestHash=await reviewDecisionHash(input);if(!owns()||draftRef.current?.identity!==captured.identity||pendingRef.current)return;retained=Object.freeze({input,draft:captured,requestHash,everAmbiguous:false});pendingRef.current=retained;setPending(retained);}
      const ack=await mutation.mutateAsync(retained.input);assertReviewAck(ack,retained);if(pendingRef.current!==retained)return;
      pendingRef.current=null;setPending(current=>current===retained?null:current);settledRef.current=captured.identity;setSettledIdentity(captured.identity);
      if(!owns()||draftRef.current?.identity!==captured.identity)return;
      // Keep the explicit known-receipt marker until a new current snapshot.
      setNotice(`Case review ${ack.decision.toLowerCase()} saved. No procedure, import baseline, paid draft or frozen run evidence was changed.`);
      const failed=()=>{if(owns())setNotice("Review saved, but refreshing failed. Refresh reads only; do not submit another decision.");};try{void Promise.resolve(onSaved()).catch(failed);}catch{failed();}reads.refresh();
    }catch(cause){if(retained&&pendingRef.current===retained){const next=owns()&&manualStartDefinitivelyRejected(cause,retained.everAmbiguous)?null:Object.freeze({...retained,everAmbiguous:true});pendingRef.current=next;setPending(current=>current===retained?next:current);}if(owns())setNotice(cause instanceof Error?cause.message:"The review response is uncertain. Keep the exact scoped decision for recovery.");}
    finally{busyRef.current=false;setPreparing(false);}
  }
  function release(){
    // Parent may remove this instance ONLY after this synchronous current-frame
    // acknowledgement. UI state/disabled buttons are not release authority.
    const held=draftRef.current;
    if(!currentReadHandler()||busyRef.current||mutation.isPending||pendingRef.current||held&&settledRef.current!==held.identity)return false;
    releasedRef.current=true;frame.current=null;setReleased(true);return true;
  }
  const busy=preparing||mutation.isPending,settled=!!draft&&settledIdentity===draft.identity;
  return{reads,draft,pending,settled,busy,readable,notice,change,reviewCurrent,save,release,canRelease:readable&&active&&!busy&&!pending&&(!draft||settled),canSave:readable&&active&&!readOnly&&!!reads.fresh?.canRecover&&!busy&&!settled&&(!!pending||!!draft&&!!reads.fresh?.canDecide&&reads.fresh.contentHash===draft.contentHash&&reads.fresh.reviewStateHash===draft.reviewStateHash)};
}
