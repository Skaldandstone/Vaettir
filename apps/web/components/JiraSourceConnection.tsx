"use client";
import {useEffect,useState} from "react";
import {useAuth} from "@clerk/nextjs";
import {trpcReact,type RouterOutputs} from "@/lib/trpcReact";
import {AtlassianOAuthConnection} from "./AtlassianOAuthConnection";
import {JiraIssueIntake} from "./JiraIssueIntake";
import {IconButton} from "./ui/IconButton";

type Props={projectId:string;onClose:()=>void;purpose?:"requirements"|"defects";onDefectsSaved?:()=>void;onDefectWorkingChange?:(working:boolean)=>void};
type Saved=RouterOutputs["jiraConnections"]["mine"][number];
export function JiraSourceConnection(props:Props){
  const auth=useAuth();
  return <JiraSession key={`${props.projectId}:${auth.userId??""}:${auth.sessionId??""}`} {...props}/>;
}
function JiraSession({projectId,purpose="requirements",onDefectsSaved,onDefectWorkingChange}:Props){
  const auth=useAuth(),[selected,setSelected]=useState<Saved|null>(null),[removing,setRemoving]=useState(""),[message,setMessage]=useState(""),[oauthWorking,setOAuthWorking]=useState(false),[intakeWorking,setIntakeWorking]=useState(false);
  const capabilities=trpcReact.jiraConnections.capabilities.useQuery({projectId},{enabled:auth.isLoaded&&auth.isSignedIn,retry:false,staleTime:0});
  const recent=trpcReact.jiraConnections.mine.useQuery({projectId},{enabled:capabilities.isSuccess&&capabilities.data.canConnect,retry:false,staleTime:0});
  const forget=trpcReact.jiraConnections.forget.useMutation({retry:false});
  const working=oauthWorking||intakeWorking||forget.isPending;
  useEffect(()=>{onDefectWorkingChange?.(working);},[working,onDefectWorkingChange]);
  useEffect(()=>()=>onDefectWorkingChange?.(false),[onDefectWorkingChange]);
  const readable=auth.isLoaded&&auth.isSignedIn&&capabilities.isSuccess&&!capabilities.isFetching&&!capabilities.isPaused&&capabilities.data.canConnect&&recent.isSuccess&&!recent.isFetching&&!recent.isPaused;
  const rows=readable?recent.data??[]:[],active=!!selected&&rows.some(row=>row.id===selected.id&&row.status==="VERIFIED");
  function choices(list:Saved[]){return list.map(row=><div key={row.id} style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
    <span style={{overflowWrap:"anywhere"}}>{row.workspace?.name??row.siteUrl??"Jira"} · {row.approvedProjects.length} projects · {row.status.toLowerCase()}</span>
    <button type="button" className="btn-secondary" disabled={working||row.status!=="VERIFIED"||!row.approvedProjects.length} onClick={()=>setSelected(row)}>Issues</button>
    {row.status!=="DISCONNECTED"&&<IconButton label="Disconnect" icon="close" tooltip="Stop this saved Jira access in Vaettir; imported evidence stays." disabled={working} onClick={()=>setRemoving(row.id)}/>}
  </div>);}
  return <div style={{display:"grid",gap:16,minWidth:0}}>
    <fieldset disabled={working} style={{border:0,padding:0,margin:0,minWidth:0}}><AtlassianOAuthConnection projectId={projectId} product="jira" onWorkingChange={setOAuthWorking} onApproved={async grantId=>{try{const fresh=await recent.refetch();const row=fresh.data?.find(row=>row.oauthConnectionId===grantId);if(row)setSelected(row);}catch{setMessage("Refresh connections to open the approved projects.");}}}/></fieldset>
    {(capabilities.isError||recent.isError)&&<p role="alert">Connections could not be checked. <button type="button" disabled={working} onClick={()=>{void capabilities.refetch();void recent.refetch();}}>Retry</button></p>}
    {message&&<p role="status">{message}</p>}
    {rows.some(row=>row.oauthConnectionId)&&<section aria-label="Approved Jira access"><h3>Approved projects</h3>{choices(rows.filter(row=>row.oauthConnectionId))}</section>}
    {rows.some(row=>!row.oauthConnectionId)&&<details><summary>Previous access</summary><p>Existing access stays until it expires. Use browser sign-in to reconnect.</p>{choices(rows.filter(row=>!row.oauthConnectionId))}</details>}
    {removing&&<section role="group" aria-label="Disconnect Jira"><p>Stop this access? Imported evidence stays. Remove the app or token in Atlassian to revoke provider access.</p><button type="button" disabled={working} onClick={async()=>{try{await forget.mutateAsync({id:removing,confirmed:true});if(selected?.id===removing)setSelected(null);setRemoving("");await recent.refetch();}catch{setMessage("Disconnect unconfirmed. Refresh access and retry.");}}}>Disconnect</button><button type="button" className="btn-secondary" disabled={working} onClick={()=>setRemoving("")}>Cancel</button></section>}
    {selected&&!active&&<p role="status">Retained import hidden until current access is verified.</p>}
    {/* Preserve exact pending receipts through refresh failure without exposing stale scope. */}
    {selected&&<fieldset hidden={!active} disabled={!active} style={{border:0,padding:0,margin:0,minWidth:0}}><JiraIssueIntake connectionId={selected.id} projectId={projectId} purpose={purpose} onDefectsSaved={onDefectsSaved} onDefectWorkingChange={setIntakeWorking} projects={selected.approvedProjects} onBack={()=>setSelected(null)}/></fieldset>}
  </div>;
}
