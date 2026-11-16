import React,{createContext,useContext,useState} from "react";
import {useQuery,useMutation,useQueryClient} from "@tanstack/react-query";
const Actor=createContext("actor-a");
let rows=[],version=0,lost=true,statusFailure=false;
const writes=[],receipts=new Map();
const site={id:"01234567-89ab-cdef-0123-456789abcdef",url:"https://synthetic.atlassian.net",name:"Synthetic site",products:["jira","confluence"]};
const resources=[{id:"123",key:"QA",name:"Synthetic QA",url:site.url+"/browse/QA"},{id:"124",key:"API",name:"Synthetic API",url:site.url+"/browse/API"}];
export const useAuth=()=>{const userId=useContext(Actor);return {userId,sessionId:userId+"-session",isLoaded:true,isSignedIn:true};};
export function FixtureActor({children}){const[actor,setActor]=useState("actor-a"),[,render]=useState(0),client=useQueryClient();return <Actor.Provider value={actor}>{children}<aside aria-label="Synthetic controls"><button onClick={()=>{rows=rows.map(row=>({...row,status:"VERIFIED"}));void client.invalidateQueries();}}>Finish sign-in</button><button onClick={()=>{setActor(actor==="actor-a"?"actor-b":"actor-a");}}>Switch actor</button><button onClick={()=>{statusFailure=!statusFailure;void client.invalidateQueries();}}>Toggle outage</button><button onClick={()=>render(n=>n+1)}>Read evidence</button><pre data-testid="writes" style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere",maxWidth:"100%"}}>{JSON.stringify(writes)}</pre></aside></Actor.Provider>;}
const wait=async()=>new Promise(resolve=>setTimeout(resolve,20));
function query(name,resolve){return {useQuery(input,options={}){const actor=useContext(Actor);return useQuery({queryKey:[name,input],queryFn:async()=>{await wait();return resolve(input,actor);},retry:false,...options});}};}
function mutation(resolve){return {useMutation(){const actor=useContext(Actor);return useMutation({mutationFn:async input=>{await wait();return resolve(input,actor);},retry:false});}};}
const own=(id,actor)=>{const row=rows.find(row=>row.id===id&&row.actor===actor);if(!row||statusFailure)throw Error("Synthetic access unavailable");return row;};
const status=(input,actor)=>structuredClone(own(input.id,actor));
const catalog=(input,actor)=>{const row=own(input.id,actor);if(row.status!=="VERIFIED"||!row.selectedSite)throw Error("Synthetic scope missing");row.version=++version;return {resources,next:null,version:row.version,reset:input.after===null};};
export const trpcReact={
 useUtils(){const actor=useContext(Actor);return {atlassianConnections:{catalog:{fetch:async input=>{await wait();return catalog(input,actor);}}}};},
 atlassianConnections:{
  capabilities:query("capabilities",(_,actor)=>{if(statusFailure)throw Error("Synthetic access unavailable");return {available:!location.search.includes("unavailable"),canConnect:true,organizationId:"synthetic-org",clerkActorId:actor};}),
  mine:query("mine",(input,actor)=>{if(statusFailure)throw Error("Synthetic access unavailable");return structuredClone(rows.filter(row=>row.actor===actor&&row.product===input.product));}),
  status:query("status",status),
  begin:mutation((input,actor)=>{if(input.expectedClerkActorId!==actor||!input.approveMetadataAccess)throw Error("Missing approval");const row={id:"synthetic-grant-"+rows.length,actor,projectId:input.projectId,product:input.product,status:"PENDING",version:++version,accountName:"Synthetic tester",sites:[site],selectedSite:null,approvedResources:[],canRefresh:true};rows.push(row);return {id:row.id,url:location.origin+"/provider"};}),
  selectSite:mutation((input,actor)=>{const row=own(input.id,actor);if(row.version!==input.version||input.siteId!==site.id)throw Error("Wrong selection");row.selectedSite=site;row.version=++version;return structuredClone(row);}),
  approve:mutation((input,actor)=>{const row=own(input.id,actor);writes.push(structuredClone(input));const prior=receipts.get(input.requestId);if(prior)return prior;if(!input.approved||row.version!==input.version||input.resourceIds.some(id=>!resources.some(resource=>resource.id===id)))throw Error("Unreviewed choices");row.approvedResources=resources.filter(resource=>input.resourceIds.includes(resource.id));row.version=++version;const result={saved:row.approvedResources.length};receipts.set(input.requestId,result);if(lost){lost=false;throw Error("Synthetic lost response");}return result;}),
  refresh:mutation((input,actor)=>{const row=own(input.id,actor);row.version=++version;return {connected:true};}),
  disconnect:mutation((input,actor)=>{if(!input.confirmed)throw Error("Missing confirmation");const row=own(input.id,actor);row.status="DISCONNECTED";row.canRefresh=false;row.version=++version;return {disconnected:true,providerRevocationRequired:true};}),
 },
};
