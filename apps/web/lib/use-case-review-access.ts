"use client";
import { useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { trpcReact,type RouterOutputs } from "./trpcReact";
import { sameReviewReader,type ReviewOrigin,type ReviewPreview } from "./case-review-decision-draft";
import { currentSessionScope,sameAuthScope } from "./auth-query-cache";
export type ReviewProjectAccess=RouterOutputs["caseReview"]["access"];
export type ReviewAccess={origin:ReviewOrigin|null;projectAccess:ReviewProjectAccess|null;fresh:ReviewPreview|null;observedSessionId:string|null;activation:string;previewActivation:string;refresh:()=>void;error:string|null};
export function useCaseReviewAccess(projectId:string,caseId:string,active:boolean):ReviewAccess{
  const auth=useAuth(),[origin,setOrigin]=useState<ReviewOrigin|null>(null),[refresh,setRefresh]=useState(0),clerk=origin?.clerkActorId??auth.userId??"";
  const sdkScope=typeof window==="undefined"?null:currentSessionScope(window.Clerk?.loaded?window.Clerk.session:null);
  const hookScope=auth.userId&&auth.sessionId?{userId:auth.userId,sessionId:auth.sessionId}:null;
  const ready=active&&!!projectId&&!!caseId&&auth.isLoaded&&auth.isSignedIn&&!!auth.sessionId&&auth.userId===clerk&&sameAuthScope(hookScope,sdkScope)&&(!origin||origin.projectId===projectId&&origin.caseId===caseId);
  const binding=JSON.stringify([!!ready,active,projectId,caseId,origin,auth.sessionId,sdkScope,refresh]),[cycle,setCycle]=useState({binding:"",requestId:crypto.randomUUID()});
  if(cycle.binding!==binding)setCycle({binding,requestId:crypto.randomUUID()});
  const pins=origin?{originalOrganizationId:origin.organizationId,expectedClerkActorId:origin.clerkActorId,expectedNativeActorId:origin.nativeActorId}:{};
  // Project access is a genuine separate native read. It grants no case-body
  // read or new decision, but an original FULL reviewer may retry an exact UUID.
  const access=trpcReact.caseReview.access.useQuery({projectId,requestId:cycle.requestId,...pins},{enabled:!!ready&&cycle.binding===binding,retry:false,staleTime:0,refetchOnWindowFocus:false});
  const candidate=ready&&cycle.binding===binding&&access.isFetchedAfterMount&&!access.error&&!access.isFetching&&!access.isPaused&&access.data?.requestId===cycle.requestId&&access.data.projectId===projectId&&access.data.readScope.projectId===projectId&&access.data.readScope.actorClerkUserId===clerk&&!!access.data.readScope.actorId&&!!access.data.readScope.organizationId?access.data:null;
  if(!origin&&candidate)setOrigin(Object.freeze({projectId,caseId,organizationId:candidate.readScope.organizationId,clerkActorId:candidate.readScope.actorClerkUserId,nativeActorId:candidate.readScope.actorId}));
  const projectAccess=origin&&candidate&&sameReviewReader(candidate.readScope,origin)?candidate:null;
  const previewBinding=JSON.stringify([cycle.requestId,caseId,!!projectAccess]),[previewCycle,setPreviewCycle]=useState({binding:"",requestId:crypto.randomUUID()});
  if(previewCycle.binding!==previewBinding)setPreviewCycle({binding:previewBinding,requestId:crypto.randomUUID()});
  const query=trpcReact.caseReview.preview.useQuery({projectId,caseId,requestId:previewCycle.requestId,...pins},{enabled:!!projectAccess&&previewCycle.binding===previewBinding,retry:false,staleTime:0,refetchOnWindowFocus:false});
  const fresh=projectAccess&&previewCycle.binding===previewBinding&&query.isFetchedAfterMount&&!query.error&&!query.isFetching&&!query.isPaused&&query.data?.requestId===previewCycle.requestId&&query.data.projectId===projectId&&query.data.caseId===caseId&&origin&&sameReviewReader(query.data.readScope,origin)?query.data:null;
  return {origin,projectAccess,fresh,observedSessionId:projectAccess?auth.sessionId??null:null,activation:cycle.requestId,previewActivation:previewCycle.requestId,refresh:()=>{const current=typeof window==="undefined"?null:currentSessionScope(window.Clerk?.loaded?window.Clerk.session:null);if(sameAuthScope(hookScope,current))setRefresh(value=>value+1);},error:access.error?.message??query.error?.message??null};
}
