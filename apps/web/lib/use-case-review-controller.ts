"use client";
import { useLayoutEffect,useRef,useState } from "react";
import { useCaseReviewAccess,type ReviewAccess } from "./use-case-review-access";
import { assertReviewAck,freezeReviewInput,freezeReviewSnapshot,reviewDecisionHash,sameReviewReader,type ReviewAck,type ReviewDraft,type ReviewInput,type ReviewPending } from "./case-review-decision-draft";
import { manualStartDefinitivelyRejected } from "./manual-run-start";
import { currentSessionScope,sameAuthScope } from "./auth-query-cache";
export type ReviewController={reads:ReviewAccess;draft:ReviewDraft|null;pending:ReviewPending|null;settled:boolean;busy:boolean;readable:boolean;projectReadable:boolean;canSave:boolean;canRelease:boolean;notice:string;change:(decision:ReviewInput["decision"],note:ReviewInput["note"])=>void;reviewCurrent:()=>void;save:()=>Promise<void>;release:()=>boolean};
export function useCaseReviewController(projectId:string,caseId:string,active:boolean,readOnly:boolean,mutation:{isPending:boolean;mutateAsync:(input:ReviewInput)=>Promise<ReviewAck>},onSaved:()=>void|Promise<void>):ReviewController{
  const reads=useCaseReviewAccess(projectId,caseId,active);
  const[draft,setDraft]=useState<ReviewDraft|null>(null),[pending,setPending]=useState<ReviewPending|null>(null),[settledIdentity,setSettledIdentity]=useState<string|null>(null),[notice,setNotice]=useState(""),[noticePrivate,setNoticePrivate]=useState(false),[preparing,setPreparing]=useState(false),[released,setReleased]=useState(false),[blockedActivation,setBlockedActivation]=useState<string|null>(null);
  const draftRef=useRef(draft),pendingRef=useRef(pending),settledRef=useRef(settledIdentity),busyRef=useRef(false),releasedRef=useRef(false),blockedActivationsRef=useRef(new Set<string>());
  const liveScope=typeof window==="undefined"?null:currentSessionScope(window.Clerk?.loaded?window.Clerk.session:null);
  const observedScope=reads.origin&&reads.observedSessionId?{userId:reads.origin.clerkActorId,sessionId:reads.observedSessionId}:null;
  if(reads.projectAccess&&observedScope&&!sameAuthScope(observedScope,liveScope)&&blockedActivation!==reads.activation)setBlockedActivation(reads.activation);
  const sdkReadable=blockedActivation!==reads.activation&&sameAuthScope(observedScope,liveScope);
  const authority=JSON.stringify([active,readOnly,projectId,caseId,reads.activation,reads.previewActivation,reads.observedSessionId,sdkReadable,blockedActivation,!!reads.projectAccess,reads.projectAccess?.readScope,reads.projectAccess?.canRecover,!!reads.fresh,reads.fresh?.supported,reads.fresh?.readScope,reads.fresh?.contentHash,reads.fresh?.reviewStateHash,reads.fresh?.canDecide,reads.fresh?.canRecover]);
  const[epochState,setEpochState]=useState({authority,epoch:0});if(epochState.authority!==authority)setEpochState({authority,epoch:epochState.epoch+1});const epoch=epochState.epoch;
  const frame=useRef<{active:boolean;readOnly:boolean;projectId:string;caseId:string;activation:string;previewActivation:string;observedSessionId:string|null;epoch:number;projectAccess:ReviewAccess["projectAccess"];fresh:ReviewAccess["fresh"]}|null>(null);
  useLayoutEffect(()=>{frame.current={active:active&&!released&&sdkReadable,readOnly,projectId,caseId,activation:reads.activation,previewActivation:reads.previewActivation,observedSessionId:reads.observedSessionId,epoch,projectAccess:reads.projectAccess,fresh:reads.fresh};
    // Clerk's installed SDK listener emits current resources immediately by
    // default. This also catches SDK movement between render and commit before
    // the auth hook publishes its replacement context; it performs no RPC.
    // The workspace's Window declaration intentionally describes only token
    // transport fields. Narrowly probe the optional installed SDK capability.
    const clerk=(typeof window==="undefined"?null:window.Clerk) as {addListener?:(callback:()=>void)=>()=>void}|null|undefined;
    const unsubscribe=reads.projectAccess&&reads.origin&&reads.observedSessionId&&typeof clerk?.addListener==="function"?clerk.addListener(()=>currentSdkFor(reads.activation,reads.observedSessionId,reads.origin!.clerkActorId)):undefined;
    return()=>{unsubscribe?.();frame.current=null;};},[active,readOnly,projectId,caseId,reads.activation,reads.previewActivation,reads.observedSessionId,reads.origin,epoch,reads.projectAccess,reads.fresh,released,sdkReadable]);
  function currentSdkFor(activation:string,sessionId:string|null,clerkActorId:string){
    if(blockedActivationsRef.current.has(activation))return false;
    const sdk=typeof window==="undefined"?null:currentSessionScope(window.Clerk?.loaded?window.Clerk.session:null);
    if(sameAuthScope(sessionId?{userId:clerkActorId,sessionId}:null,sdk))return true;
    // SDK loss can precede React auth commit. Latch this activation revoked;
    // returning SDK A alone cannot reactivate its old admitted native reads.
    blockedActivationsRef.current.add(activation);
    if(frame.current?.activation===activation){frame.current=null;setBlockedActivation(activation);}
    return false;
  }
  const projectReadable=!released&&sdkReadable&&!!reads.projectAccess&&!!reads.origin&&sameReviewReader(reads.projectAccess.readScope,reads.origin)&&(!draft||sameReviewReader(reads.projectAccess.readScope,draft.origin))&&(!pending||sameReviewReader(reads.projectAccess.readScope,pending.draft.origin));
  const readable=projectReadable&&!!reads.fresh?.supported&&!!reads.fresh.snapshot&&reads.fresh.projectId===projectId&&reads.fresh.caseId===caseId&&sameReviewReader(reads.fresh.readScope,reads.origin!);
  const currentReadHandler=()=>{const current=frame.current;return !releasedRef.current&&projectReadable&&!!current?.active&&current.projectId===projectId&&current.caseId===caseId&&current.activation===reads.activation&&current.previewActivation===reads.previewActivation&&current.epoch===epoch&&current.projectAccess===reads.projectAccess&&!!current.projectAccess&&!!reads.origin&&sameReviewReader(current.projectAccess.readScope,reads.origin)&&currentSdkFor(reads.activation,reads.observedSessionId,reads.origin.clerkActorId);};
  const currentReceiptHandler=()=>currentReadHandler()&&!frame.current?.readOnly&&!!frame.current?.projectAccess?.canRecover;
  const currentHandler=()=>currentReceiptHandler()&&readable&&frame.current?.fresh===reads.fresh&&!!frame.current?.fresh?.canRecover;
  const tell=(message:string,privateContents=false)=>{setNotice(message);setNoticePrivate(privateContents);};
  function change(decision:ReviewInput["decision"],note:ReviewInput["note"]){
    const fresh=reads.fresh;if(!currentHandler()||!fresh?.canDecide||!fresh.snapshot||!fresh.contentHash||!fresh.reviewStateHash||!reads.origin||busyRef.current||pendingRef.current||draftRef.current?.identity!==draft?.identity)return;
    const held=draftRef.current,changed=!!held&&(held.contentHash!==fresh.contentHash||held.reviewStateHash!==fresh.reviewStateHash);
    if(settledRef.current&&(!held||!changed))return;
    if(held&&changed&&!settledRef.current){tell("The shown case changed. Retain this choice and explicitly review the new snapshot before saving.");return;}
    const next=Object.freeze({identity:crypto.randomUUID(),origin:reads.origin,decision,note:Object.freeze({...note}),contentHash:fresh.contentHash,reviewStateHash:fresh.reviewStateHash,snapshot:freezeReviewSnapshot(fresh.snapshot)});draftRef.current=next;setDraft(next);settledRef.current=null;setSettledIdentity(null);tell("");
  }
  function reviewCurrent(){
    const fresh=reads.fresh,held=draftRef.current;if(!held||!currentHandler()||!fresh?.canDecide||!fresh.snapshot||!fresh.contentHash||!fresh.reviewStateHash||!reads.origin||busyRef.current||pendingRef.current||settledRef.current||held.identity!==draft?.identity)return;
    const next=Object.freeze({...held,identity:crypto.randomUUID(),origin:reads.origin,contentHash:fresh.contentHash,reviewStateHash:fresh.reviewStateHash,snapshot:freezeReviewSnapshot(fresh.snapshot)});draftRef.current=next;setDraft(next);tell("Current supported snapshot reviewed with your retained choice. This is a case review decision, not a risk, execution, compliance or release approval.");
  }
  async function save(){
    const held=pendingRef.current,captured=held?.draft??draftRef.current;if(!captured||busyRef.current||!(held?currentReceiptHandler():currentHandler())||settledRef.current===captured.identity||captured.identity!==draft?.identity)return;
    const activation=frame.current!.activation,previewActivation=frame.current!.previewActivation,observedSessionId=frame.current!.observedSessionId,startedEpoch=frame.current!.epoch,hadPrivatePreview=readable;
    const sdkCurrent=()=>currentSdkFor(activation,observedSessionId,captured.origin.clerkActorId);
    const owns=()=>{const current=frame.current;return !releasedRef.current&&!!current?.active&&!current.readOnly&&current.projectId===captured.origin.projectId&&current.caseId===captured.origin.caseId&&current.activation===activation&&current.previewActivation===previewActivation&&current.epoch===startedEpoch&&!!current.projectAccess?.canRecover&&sameReviewReader(current.projectAccess.readScope,captured.origin)&&sdkCurrent();};
    const ownsPrivate=()=>owns()&&hadPrivatePreview&&!!frame.current?.fresh?.supported&&!!frame.current.fresh.snapshot&&frame.current.fresh.projectId===captured.origin.projectId&&frame.current.fresh.caseId===captured.origin.caseId&&sameReviewReader(frame.current.fresh.readScope,captured.origin);
    if(!owns())return;busyRef.current=true;let retained=held;
    try{
      if(!retained){const fresh=frame.current!.fresh!;if(!ownsPrivate()||!fresh.canDecide||captured.contentHash!==fresh.contentHash||captured.reviewStateHash!==fresh.reviewStateHash)return;const input=freezeReviewInput(captured,crypto.randomUUID());setPreparing(true);const requestHash=await reviewDecisionHash(input);if(!ownsPrivate()||draftRef.current?.identity!==captured.identity||pendingRef.current)return;retained=Object.freeze({input,draft:captured,requestHash,everAmbiguous:false});pendingRef.current=retained;setPending(retained);}
      const ack=await mutation.mutateAsync(retained.input);sdkCurrent();assertReviewAck(ack,retained);if(pendingRef.current!==retained)return;
      pendingRef.current=null;setPending(current=>current===retained?null:current);settledRef.current=captured.identity;setSettledIdentity(captured.identity);
      if(!owns()||draftRef.current?.identity!==captured.identity)return;
      if(!ownsPrivate()){tell("The exact retained receipt is acknowledged. Historical case details remain withheld until a supported current case preview completes.");return;}
      // Keep the explicit known-receipt marker until a new current snapshot.
      tell(`Case review ${ack.decision.toLowerCase()} saved. No procedure, import baseline, paid draft or frozen run evidence was changed.`);
      const failed=()=>{if(ownsPrivate())tell("Review saved, but refreshing failed. Refresh reads only; do not submit another decision.");};try{void Promise.resolve(onSaved()).catch(failed);}catch{failed();}if(ownsPrivate())reads.refresh();
    }catch(cause){sdkCurrent();if(retained&&pendingRef.current===retained){const next=owns()&&manualStartDefinitivelyRejected(cause,retained.everAmbiguous)?null:Object.freeze({...retained,everAmbiguous:true});pendingRef.current=next;setPending(current=>current===retained?next:current);}if(owns())tell(ownsPrivate()&&cause instanceof Error?cause.message:"The exact receipt recovery was refused or remains uncertain. Retain the original request; historical case details are withheld.",ownsPrivate());}
    finally{sdkCurrent();busyRef.current=false;setPreparing(false);}
  }
  function release(){
    // Parent may remove this instance ONLY after this synchronous current-frame
    // acknowledgement. UI state/disabled buttons are not release authority.
    const held=draftRef.current;
    if(!currentReadHandler()||busyRef.current||mutation.isPending||pendingRef.current||held&&settledRef.current!==held.identity)return false;
    releasedRef.current=true;frame.current=null;setReleased(true);return true;
  }
  const busy=preparing||mutation.isPending,settled=!!draft&&settledIdentity===draft.identity;
  return{reads,draft,pending,settled,busy,readable,projectReadable,notice:projectReadable&&(!noticePrivate||readable)?notice:"",change,reviewCurrent,save,release,canRelease:projectReadable&&active&&!busy&&!pending&&(!draft||settled),canSave:projectReadable&&active&&!readOnly&&!!reads.projectAccess?.canRecover&&!busy&&!settled&&(!!pending||readable&&!!draft&&!!reads.fresh?.canRecover&&!!reads.fresh.canDecide&&reads.fresh.contentHash===draft.contentHash&&reads.fresh.reviewStateHash===draft.reviewStateHash)};
}
