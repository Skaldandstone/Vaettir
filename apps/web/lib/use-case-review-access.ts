"use client";
import { useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { trpcReact } from "./trpcReact";
import { sameReviewReader,type ReviewOrigin,type ReviewPreview } from "./case-review-decision-draft";
export type ReviewAccess={origin:ReviewOrigin|null;fresh:ReviewPreview|null;activation:string;refresh:()=>void;error:string|null};
export function useCaseReviewAccess(projectId:string,caseId:string,active:boolean):ReviewAccess{
  const auth=useAuth(),[origin,setOrigin]=useState<ReviewOrigin|null>(null),[refresh,setRefresh]=useState(0),clerk=origin?.clerkActorId??auth.userId??"";
  const ready=active&&!!projectId&&!!caseId&&auth.isLoaded&&auth.isSignedIn&&!!auth.sessionId&&auth.userId===clerk&&(!origin||origin.projectId===projectId&&origin.caseId===caseId);
  const binding=JSON.stringify([!!ready,active,projectId,caseId,origin,auth.sessionId,refresh]),[cycle,setCycle]=useState({binding:"",requestId:crypto.randomUUID()});
  if(cycle.binding!==binding)setCycle({binding,requestId:crypto.randomUUID()});
  const query=trpcReact.caseReview.preview.useQuery({projectId,caseId,requestId:cycle.requestId,...(origin?{originalOrganizationId:origin.organizationId,expectedClerkActorId:origin.clerkActorId,expectedNativeActorId:origin.nativeActorId}:{})},{enabled:!!ready&&cycle.binding===binding,retry:false,staleTime:0,refetchOnWindowFocus:false});
  const candidate=ready&&cycle.binding===binding&&query.isFetchedAfterMount&&!query.error&&!query.isFetching&&!query.isPaused&&query.data?.requestId===cycle.requestId&&query.data.projectId===projectId&&query.data.caseId===caseId&&query.data.readScope.projectId===projectId&&query.data.readScope.actorClerkUserId===clerk&&!!query.data.readScope.actorId&&!!query.data.readScope.organizationId?query.data:null;
  if(!origin&&candidate)setOrigin(Object.freeze({projectId,caseId,organizationId:candidate.readScope.organizationId,clerkActorId:candidate.readScope.actorClerkUserId,nativeActorId:candidate.readScope.actorId}));
  return {origin,fresh:origin&&candidate&&sameReviewReader(candidate.readScope,origin)?candidate:null,activation:cycle.requestId,refresh:()=>setRefresh(value=>value+1),error:query.error?.message??null};
}
