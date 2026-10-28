import React, {createContext, useContext, useState} from "react";
export const Session = createContext({actor:"synthetic-owner",allowed:true});
export const evidence = {calls:[], saved:null, loseNextPreview:false};
const stableRefresh = async () => {};
export const useAuth = () => { const session=useContext(Session); return {isLoaded:true,isSignedIn:true,userId:session.actor}; };
export function makePayload(definition = {audience:"stakeholders",sections:["inventory","execution","traceability","automation"],summary:"Synthetic release review",risks:"No production evidence",nextActions:"Review the remaining checks"},title="Synthetic quality review") {
return {scope:definition.executionScope?{kind:"recorded-execution",filters:definition.executionScope,planName:"Synthetic smoke plan",contributingRunIds:[],cohortBasis:"Synthetic tests selected from the smoke plan"}:undefined,state:"preview",projectName:"Synthetic QA",title,asOf:"2026-10-27T10:00:00Z",windowStart:definition.dateInterval?definition.dateInterval.start+"T00:00:00.000Z":"2026-09-27T10:00:00Z",windowEnd:definition.dateInterval?definition.dateInterval.end+"T23:59:59.999Z":"2026-10-27T10:00:00Z",definition,
 inventory:{active:10,archived:1,riskAssessed:5,flaky:1,priority:[{key:"HIGH",count:4},{key:"MEDIUM",count:6}],automation:[{key:"AUTOMATED",count:7},{key:"MANUAL",count:3}]},
 execution:{runs:2,results:12,matchedResults:12,unmatchedResults:0,distinctCases:8,highPriorityCases:4,highPriorityExecuted:3,plannedCaseRunPairs:15,notRecordedCaseRunPairs:3,outcomes:[{key:"PASS",count:8},{key:"FAIL",count:3},{key:"BLOCKED",count:1}]},
 traceability:{requirements:8,coveredRequirements:6,casesWithLinks:6,links:6},defects:null,automationChange:null,limitations:["Synthetic records only. No production or physical-device acceptance."]}; }
const ledger=new Map();
function useFixtureQuery(path,input,options) {
 const session=useContext(Session); const enabled=options?.enabled!==false;
 let data;
 if(path==="project.byId")data={id:"synthetic",organizationId:"synthetic-org",name:"Synthetic QA"};
 else if(path==="organization.mine")data=session.allowed?[{id:"synthetic-org",role:"OWNER",seatType:"FULL"}]:[];
 else if(path==="reportSnapshots.scopeOptions")data={projectId:"synthetic",organizationId:"synthetic-org",releases:[{id:"release-synthetic",name:"Synthetic release"}],plans:[{id:"plan-synthetic",name:"Synthetic smoke plan"}],runs:[],releasesLimited:false};
 else if(path==="reportSnapshots.definitions"||path==="reportSnapshots.drafts")data=[];
 else if(path==="reportSnapshots.catalog")data={projectId:"synthetic",organizationId:"synthetic-org",requestKey:JSON.stringify([input.projectId,input.page,input.search,input.audience,input.purpose,input.sort,null,null]),items:[],total:0,page:input.page,pageSize:20,hasMore:false,limitations:[]};
 else if(path==="reportSnapshots.definitionCatalog")data={projectId:"synthetic",page:0,includeArchived:false,items:[],total:0,limitations:[]};
 return {data:enabled?data:undefined,error:null,isFetching:false,isPending:false,isPaused:false,refetch:stableRefresh};
}
function useFixtureMutation(path) {
 const [isPending,setPending]=useState(false);
 return {isPending,reset:()=>{},mutateAsync:async input=>{setPending(true);try{
 evidence.calls.push({path,input:structuredClone(input)});
 if(path==="reportSnapshots.preview") {
  if(!ledger.has(input.requestId))ledger.set(input.requestId,{id:"preview-synthetic",projectId:"synthetic",organizationId:"synthetic-org",payload:makePayload(input.definition,input.title)});
  evidence.saved=ledger.get(input.requestId);
  if(evidence.loseNextPreview){evidence.loseNextPreview=false;throw Error("Synthetic lost response");}
  return evidence.saved;
 }
 if(path==="reportSnapshots.approve"){
  if(!input.approveSharing||input.previewId!==evidence.saved?.id)throw Error("Synthetic approval boundary");
  evidence.saved={...evidence.saved,payload:{...evidence.saved.payload,state:"approved"}};return evidence.saved;
 }
 if(path==="reportSnapshots.saveDefinition")return {id:"settings-synthetic"};
 throw Error("Unexpected fixture mutation: "+path);
 }finally{setPending(false)}}};
}
const nodes=new Map();function node(path="") {if(nodes.has(path))return nodes.get(path);const result=new Proxy({}, {get(_,key){if(key==="useUtils")return ()=>node();if(key==="invalidate"||key==="refetch")return stableRefresh;if(key==="useQuery")return(input,options)=>useFixtureQuery(path,input,options);if(key==="useMutation")return()=>useFixtureMutation(path);return node(path?path+"."+key:key);}});nodes.set(path,result);return result;}
export const trpcReact=node();
