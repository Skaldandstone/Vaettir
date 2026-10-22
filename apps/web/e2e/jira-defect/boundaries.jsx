// Only transport, identity and adjacent unrelated panels are synthetic.
import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { buildDefectMap, emptyDefectDocument, defectRecordKey } from "@vaettir/core";
const project={id:"synthetic-project",organizationId:"synthetic-org"};
const source={id:"10001",key:"SYN",name:"Synthetic tracker",url:"https://synthetic.atlassian.net/browse/SYN"};
const issues=[1,2].map(n=>({id:String(20000+n),projectId:source.id,key:`SYN-${n}`,title:`Synthetic defect ${n}`,status:n===1?"To do":"Done",updatedAt:"2026-10-20T00:00:00Z",url:`https://synthetic.atlassian.net/browse/SYN-${n}`,classification:n===1?"new":"unchanged",requirementId:n===1?null:"existing-requirement"}));
let run=null,readCount=0,requirements=0,pending=null,loseFirst=true,getError=false,conflictNext=false,sourceWrites=0;
const writes=[],receipts=new Map();
const reject=()=>{requirements++;throw Error("Requirement writes and unrelated provider calls are forbidden in this fixture");};
export const useAuth=()=>({userId:"synthetic-owner",sessionId:"synthetic-session",isLoaded:true,isSignedIn:true});
export const useParams=()=>({projectId:project.id});
export const useProjectPermissions=()=>({loaded:true,canEdit:true,retryAccess:()=>{},accessError:null});
export const useCaseFieldAccess=()=>({readable:true,canEdit:true,canConfigure:true,authReady:true,origin:{organizationId:project.organizationId,clerkActorId:"synthetic-owner"},query:{isFetching:false,error:null,refetch:async()=>{}}});
export const ProviderMark=()=> <span aria-hidden="true">J</span>;
export const PopulationDocuments=()=>null;
export const CoveredTestCasesPanel=()=>null;
export const ProjectRepositories=()=>null;
export const AiDisclosureSettings=()=>null;
export const AtlassianQualitySettings=()=> <p>Outgoing quality-sharing panel is outside this local fixture.</p>;
function query(key,resolve){return{useQuery(input,options={}){return useQuery({queryKey:[key,input],queryFn:()=>resolve(input),retry:false,...options});}};}
function mutation(key,resolve){return{useMutation(){return useMutation({mutationKey:[key],mutationFn:resolve});}};}
export const trpcReact={
 useUtils(){const client=useQueryClient();return{jiraConnections:{list:{fetch:reject}},defectMap:{get:{invalidate:()=>client.invalidateQueries({queryKey:[["defectMap","get"]]})}}};},
 project:{byId:query(["project","byId"],()=>project)},
 jiraConnections:{
  capabilities:query(["jiraConnections","capabilities"],()=>({canConnect:true,credentialStorageReady:true,tokenImplemented:true,issueImportAvailable:true})),
  mine:query(["jiraConnections","mine"],()=>[{id:"synthetic-connection",status:"VERIFIED",workspace:{name:"Synthetic Jira"},approvedProjects:[source]}]),
  verify:mutation(["jiraConnections","verify"],reject),approve:mutation(["jiraConnections","approve"],reject),forget:mutation(["jiraConnections","forget"],reject),
 },
 jiraIssueIntake:{
  mine:query(["jiraIssueIntake","mine"],()=>run?[{id:run.id,status:run.status,issueCount:run.issues.length,completedCount:0}]:[]),
  get:query(["jiraIssueIntake","get"],()=>{if(getError)throw Error("Synthetic status outage");return structuredClone(run);}),
  start:mutation(["jiraIssueIntake","start"],input=>{if(!input.approveIssueRead)throw Error("Read approval missing");run={id:"synthetic-run",version:1,status:"PREVIEW",projects:[source],issues:[],readInFlight:false,nextPageAvailable:true,pageCount:0,bounded:false,results:[]};return{id:run.id};}),
  nextPage:mutation(["jiraIssueIntake","nextPage"],()=>{readCount++;run={...run,version:2,issues,status:"PREVIEW",nextPageAvailable:false,pageCount:1};return{id:run.id};}),
  finishPreview:mutation(["jiraIssueIntake","finishPreview"],()=>{run={...run,status:"REVIEW",version:3};return{id:run.id};}),
  approve:mutation(["jiraIssueIntake","approve"],reject),processBatch:mutation(["jiraIssueIntake","processBatch"],reject),cancel:mutation(["jiraIssueIntake","cancel"],reject),
 },
 defectMap:{
  get:query(["defectMap","get"],()=>{const document=emptyDefectDocument();return{version:0,document,map:buildDefectMap(document,()=>"a".repeat(64)),capabilities:{ingestion:"reviewed_metadata_export_and_jira_snapshot",liveSync:"unavailable",aiUsed:false,credits:0}};}),
  previewJira:mutation(["defectMap","previewJira"],input=>{const tasks=issues.filter(issue=>input.issueIds.includes(issue.id)).map(issue=>({provider:"jira",scope:"synthetic-site:10001",externalId:issue.id,title:issue.title,url:issue.url,status:"unknown"}));return{version:0,previewHash:"a".repeat(64),changes:tasks.map(task=>({kind:receipts.size?"unchanged":"new",record:"task",key:defectRecordKey(task),title:task.title})),tasks,credits:0};}),
  approveJira:mutation(["defectMap","approveJira"],async input=>{
   writes.push(structuredClone(input));
   if(conflictNext){conflictNext=false;const error=Error("Synthetic map conflict");error.data={code:"CONFLICT"};throw error;}
   if(receipts.has(input.requestId))return{...receipts.get(input.requestId),retried:true};
   const result={appliedVersion:1,retried:false};receipts.set(input.requestId,result);sourceWrites++;
   if(loseFirst){loseFirst=false;return new Promise((resolve,reject)=>{pending={resolve:()=>resolve(result),reject:()=>reject(Error("Synthetic lost acknowledgement"))};});}
   return result;
  }),
  previewImport:mutation(["defectMap","previewImport"],reject),approveImport:mutation(["defectMap","approveImport"],reject),decideLink:mutation(["defectMap","decideLink"],reject),
 },
};
export function Evidence(){const[,refresh]=useState(0);return <details><summary onClick={()=>refresh(v=>v+1)}>Synthetic transport evidence</summary><pre data-testid="evidence" style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{JSON.stringify({readCount,requirements,sourceWrites,writes})}</pre></details>;}
export function Controls(){return <div aria-label="Synthetic transport controls"><button onClick={()=>{pending?.reject();pending=null;}}>Lose synthetic acknowledgement</button><button onClick={()=>{getError=true;}}>Fail saved status</button><button onClick={()=>{getError=false;}}>Restore saved status</button><button onClick={()=>{conflictNext=true;}}>Reject next write</button></div>;}
