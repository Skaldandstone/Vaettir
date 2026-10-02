"use client";
import {useState} from "react";
import {trpcReact} from "@/lib/trpcReact";
import {RepositoryOAuthConnection} from "./GitlabRepositoryConnection";
import {TokenRepositoryConnection} from "./TokenRepositoryConnection";
import {PopulationDocuments} from "./PopulationDocuments";
import {MigrationWizard} from "./MigrationWizard";
import type {RepositoryAuthorizationIntent} from "./RepositoryProviderPicker";
export const repositoryProviders=[["github","GitHub"],["gitlab","GitLab"],["bitbucket","Bitbucket"],["azure-devops","Azure DevOps"],["git","Self-hosted Git"],["perforce","Perforce"],["svn","SVN"]] as const;
export type RepositoryProvider=typeof repositoryProviders[number][0];

export function RepositoryConnectionContent({projectId,provider,onConnected,onClose,initialAuthorization,active=true}:{projectId:string;provider:RepositoryProvider;onConnected:()=>void;onClose:()=>void;initialAuthorization?:RepositoryAuthorizationIntent;active?:boolean}){
  if(provider==="github"||provider==="gitlab")return <RepositoryOAuthConnection projectId={projectId} providerId={provider} onConnected={onConnected} onClose={onClose} initialAuthorization={initialAuthorization} active={active}/>;
  if(provider==="bitbucket"||provider==="azure-devops")return <TokenRepositoryConnection projectId={projectId} providerId={provider} onConnected={onConnected} onClose={onClose}/>;
  return <RepositoryExportConnection projectId={projectId} provider={provider} onConnected={onConnected} onClose={onClose}/>;
}
function RepositoryExportConnection({projectId,provider,onConnected,onClose}:{projectId:string;provider:RepositoryProvider;onConnected:()=>void;onClose:()=>void}){
  const [step,setStep]=useState<"choose"|"documents"|"tests"|"reference">("choose");
  const [url,setUrl]=useState("");const [revision,setRevision]=useState("");const [saved,setSaved]=useState(false);
  const add=trpcReact.project.addRepository.useMutation();
  const name=repositoryProviders.find(([key])=>key===provider)?.[1];
  const busy=add.isPending;
  return <div style={{display:"grid",gap:16,minWidth:0}}>
    {step==="choose"&&<>
      <p>{name} account verification and native repository browsing are not implemented yet. You can bring exported documents or test cases into this project now.</p>
      <div style={{display:"grid",gap:8}}><button type="button" onClick={()=>setStep("documents")}>Add exported specifications or documentation</button><button type="button" className="btn-secondary" onClick={()=>setStep("tests")}>Import exported test cases</button></div>
      <details><summary>Keep a repository reference for later</summary><p className="text-muted">Save the browser URL and {provider==="perforce"?"changelist":provider==="svn"?"revision":"commit"} you intend to review. This does not verify access.</p><button type="button" className="btn-secondary" onClick={()=>setStep("reference")}>Add reference</button></details>
      <button type="button" className="btn-secondary" onClick={onClose}>Close</button>
    </>}
    {step==="documents"&&<><p>Include the export’s native {provider==="perforce"?"changelist":provider==="svn"?"revision":"commit"} in its evidence title or source key so approved evidence can be traced.</p><PopulationDocuments projectId={projectId}/></>}
    {step==="tests"&&<MigrationWizard projectId={projectId} onCommitted={onConnected}/>}
    {step==="reference"&&<form style={{display:"grid",gap:12}} onSubmit={async event=>{event.preventDefault();try{await add.mutateAsync({projectId,provider,url,revision});setSaved(true);onConnected();}catch{/* Mutation renders the sanitized API error. */}}}>
      <label style={{display:"grid",gap:6}}>Repository browser URL<input type="url" required value={url} onChange={e=>{setUrl(e.target.value);setSaved(false);}} placeholder="https://host/organization/repository" style={{width:"100%",minWidth:0,boxSizing:"border-box"}}/></label>
      <label style={{display:"grid",gap:6}}>{provider==="perforce"?"Changelist":provider==="svn"?"Revision":"Commit"} to review<input value={revision} onChange={e=>{setRevision(e.target.value);setSaved(false);}} maxLength={200} style={{width:"100%",minWidth:0,boxSizing:"border-box"}}/></label>
      {add.error&&<p role="alert">{add.error.message}</p>}
      {saved&&<p role="status">Reference saved. Access has not been verified.</p>}
      <button type="submit" disabled={busy||!url.trim()}>{busy?"Saving…":"Save reference"}</button>
    </form>}
    {step!=="choose"&&<button type="button" className="btn-secondary" disabled={busy} onClick={()=>setStep("choose")}>Back to {name} options</button>}
  </div>;
}
