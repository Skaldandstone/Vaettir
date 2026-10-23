"use client";
import { useLayoutEffect,useRef,useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { trpcReact,type RouterOutputs } from "./trpcReact";
type QueuePage=RouterOutputs["caseReview"]["page"];
type Origin=Readonly<{projectId:string;organizationId:string;clerkActorId:string;nativeActorId:string}>;
export function useCaseReviewQueue(projectId:string){
  const auth=useAuth(),[origin,setOrigin]=useState<Origin|null>(null),[refresh,setRefresh]=useState(0),[filter,setFilter]=useState({search:"",sort:"confidence" as "confidence"|"case-id"|"title",offset:0,populationHash:undefined as string|undefined}),[notice,setNotice]=useState("");
  const clerk=origin?.clerkActorId??auth.userId??"",ready=!!projectId&&auth.isLoaded&&auth.isSignedIn&&!!auth.sessionId&&auth.userId===clerk&&(!origin||origin.projectId===projectId);
  const binding=JSON.stringify([!!ready,projectId,origin,auth.sessionId,refresh]),[cycle,setCycle]=useState({binding:"",requestId:crypto.randomUUID()});if(cycle.binding!==binding)setCycle({binding,requestId:crypto.randomUUID()});
  const pins=origin?{originalOrganizationId:origin.organizationId,expectedClerkActorId:origin.clerkActorId,expectedNativeActorId:origin.nativeActorId}:{};
  const access=trpcReact.caseReview.access.useQuery({projectId,requestId:cycle.requestId,...pins},{enabled:!!ready&&cycle.binding===binding,retry:false,staleTime:0,refetchOnWindowFocus:false});
  const same=(scope:QueuePage["readScope"])=>!!origin&&scope.projectId===origin.projectId&&scope.organizationId===origin.organizationId&&scope.actorId===origin.nativeActorId&&scope.actorClerkUserId===origin.clerkActorId;
  const candidate=ready&&cycle.binding===binding&&access.isFetchedAfterMount&&!access.error&&!access.isFetching&&!access.isPaused&&access.data?.requestId===cycle.requestId&&access.data.projectId===projectId&&access.data.readScope.projectId===projectId&&access.data.readScope.actorClerkUserId===clerk&&!!access.data.readScope.organizationId&&!!access.data.readScope.actorId?access.data:null;
  if(!origin&&candidate)setOrigin(Object.freeze({projectId,organizationId:candidate.readScope.organizationId,clerkActorId:clerk,nativeActorId:candidate.readScope.actorId}));
  const freshAccess=origin&&candidate&&same(candidate.readScope)?candidate:null;
  const pageBinding=JSON.stringify([cycle.requestId,filter,!!freshAccess]),[pageCycle,setPageCycle]=useState({binding:"",requestId:crypto.randomUUID()});if(pageCycle.binding!==pageBinding)setPageCycle({binding:pageBinding,requestId:crypto.randomUUID()});
  const page=trpcReact.caseReview.page.useQuery({projectId,requestId:pageCycle.requestId,...pins,...filter},{enabled:!!freshAccess&&pageCycle.binding===pageBinding,retry:false,staleTime:0,refetchOnWindowFocus:false});
  const fresh=freshAccess&&pageCycle.binding===pageBinding&&page.isFetchedAfterMount&&!page.error&&!page.isFetching&&!page.isPaused&&page.data?.requestId===pageCycle.requestId&&page.data.projectId===projectId&&same(page.data.readScope)&&page.data.offset===filter.offset?page.data:null;
  const authority=JSON.stringify([cycle.requestId,pageCycle.requestId,!!freshAccess,!!fresh,fresh?.populationHash]),[generation,setGeneration]=useState({authority,value:0});if(generation.authority!==authority)setGeneration({authority,value:generation.value+1});const epoch=generation.value;
  const frame=useRef<{epoch:number;access:typeof freshAccess;page:typeof fresh}|null>(null);
  useLayoutEffect(()=>{frame.current={epoch,access:freshAccess,page:fresh};return()=>{frame.current=null;};},[epoch,freshAccess,fresh]);
  const currentFilter=()=>frame.current?.epoch===epoch&&frame.current.access===freshAccess&&!!freshAccess;
  const currentPage=()=>currentFilter()&&frame.current?.page===fresh&&!!fresh;
  function setSearch(search:string){if(!currentFilter())return;if(search.length>200){setNotice("Search is limited to 200 characters; the last exact filter was retained.");return;}setFilter(current=>({...current,search,offset:0,populationHash:undefined}));setNotice("");}
  function setSort(sort:typeof filter.sort){if(!currentFilter()||!["confidence","case-id","title"].includes(sort))return;setFilter(current=>({...current,sort,offset:0,populationHash:undefined}));setNotice("");}
  function next(){if(!currentPage()||fresh?.nextOffset==null)return;setFilter(current=>({...current,offset:fresh.nextOffset!,populationHash:fresh.populationHash}));}
  function previous(){if(!currentPage()||!fresh||fresh.offset===0)return;setFilter(current=>({...current,offset:Math.max(0,fresh.offset-25),populationHash:fresh.populationHash}));}
  function first(){if(!currentFilter())return;setFilter(current=>({...current,offset:0,populationHash:undefined}));setRefresh(value=>value+1);}
  return{origin,fresh,freshAccess,filter,notice,error:access.error?.message??page.error?.message??null,setSearch,setSort,next,previous,first,refresh:()=>setRefresh(value=>value+1),canOpen:(caseId:string)=>currentPage()&&!!fresh?.items.some(item=>item.id===caseId)};
}
