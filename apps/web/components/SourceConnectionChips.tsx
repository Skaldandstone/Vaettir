"use client";

import { useState } from "react";
import {useIsMutating} from "@tanstack/react-query";
import {Modal} from "./Modal";
import {PopulationDocuments} from "./PopulationDocuments";
import {RepositoryConnectionContent,type RepositoryProvider} from "./RepositoryConnectionContent";
import {trpcReact} from "@/lib/trpcReact";
import {LinearSourceConnection} from "./LinearSourceConnection";

const sources = [
  ["github", "GitHub"], ["gitlab", "GitLab"], ["bitbucket", "Bitbucket"],
  ["azure-devops", "Azure DevOps"], ["git", "Self-hosted Git"],
  ["perforce", "Perforce"], ["svn", "SVN"], ["jira", "Jira"],
  ["linear", "Linear"], ["document", "Documents"],
  ["drive", "Google Drive"],
] as const;

export function ProviderMark({ id }: { id: string }) {
  const paths: Record<string, string> = {
    github: "M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.86c-2.78.6-3.37-1.18-3.37-1.18-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.89 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.64-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.99 1.03-2.69-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.03a9.6 9.6 0 0 1 5 0c1.91-1.3 2.75-1.03 2.75-1.03.55 1.38.2 2.4.1 2.65.64.7 1.03 1.6 1.03 2.69 0 3.84-2.34 4.69-4.57 4.94.36.31.68.92.68 1.85v2.75c0 .27.18.58.69.48A10 10 0 0 0 12 2Z",
    gitlab: "M12 22 2 14 5 2l3 8h8l3-8 3 12Z",
    bitbucket: "M2 3h20l-3 18H5Zm6 6 1 6h6l1-6Z",
    "azure-devops": "M3 7 8 3v4l8-3 5 2v13l-5 2-8-3v3l-5-5 3-3Z",
    git: "m12 1 11 11-11 11L1 12Zm-3 6v7h2V9l5 5v3h2v-4l-7-7Z",
    jira: "m12 1 11 11-11 11L1 12Zm0 7-4 4 4 4 4-4Z",
    linear: "M12 2a10 10 0 0 1 10 10c0 2-.6 4-1.7 5.6L6.4 3.7A10 10 0 0 1 12 2ZM4.7 5.1l14.2 14.2-1.6 1.2L3.5 6.7ZM2.6 9l12.4 12.4-3 .6L2 12ZM3 16l5 5a10 10 0 0 1-5-5Z",
    document: "M5 2h9l5 5v15H5Zm9 2v4h4ZM8 12v2h8v-2Zm0 4v2h8v-2Z",
    drive: "M8 2h8l8 14-4 7H4l-4-7Zm4 5-5 9h10Z",
  };
  return <span className={`source-provider-mark provider-${id}`} aria-hidden="true">
    {paths[id] ? <svg viewBox="0 0 24 24" fill="currentColor"><path fillRule="evenodd" d={paths[id]} /></svg> : <span>{{perforce: "P4", svn: "SVN", pagerduty: "PD", datadog: "DD"}[id] ?? id.slice(0, 2).toUpperCase()}</span>}
  </span>;
}

export function ConnectionLink({ href, provider, label, status }: { href: string; provider: string; label: string; status: string }) {
  return <a className="source-connection-chip" href={href}><ProviderMark id={provider} /><span><strong>{label}</strong><small>{status}</small></span><span aria-hidden="true">→</span></a>;
}

export function SourceConnectionChips({documentsHref,only,onDocuments,onGitlab,onGithub,onRepository,projectId}:{documentsHref?:string;only?:string[];onDocuments?:()=>void;onGitlab?:()=>void;onGithub?:()=>void;onRepository?:(provider:RepositoryProvider)=>void;projectId?:string}){
  const [active,setActive]=useState<string|null>(null);
  const utils=trpcReact.useUtils();
  const busy=useIsMutating()>0;
  const filtered=sources.filter(([id])=>!only||only.includes(id));
  const repoIds=["github","gitlab","bitbucket","azure-devops","git","perforce","svn"];
  function open(id:string){
    if(repoIds.includes(id)&&onRepository){onRepository(id as RepositoryProvider);return;}
    if(id==="github"&&onGithub){onGithub();return;}
    if(id==="gitlab"&&onGitlab){onGitlab();return;}
    if(id==="document"&&onDocuments){onDocuments();return;}
    setActive(id);
  }
  const name=sources.find(([id])=>id===active)?.[1];
  return <div className="source-connections">
    <div className="source-chip-list" role="group" aria-label="Available source actions">{filtered.map(([id,label])=><button key={id} type="button" className="source-connection-chip" onClick={()=>open(id)}>
      <ProviderMark id={id}/><span><strong>{label}</strong><small>{id==="document"?"Add file or text":(id==="github"&&(projectId||onRepository||onGithub)||id==="gitlab"&&(projectId||onRepository||onGitlab))?"Authorize and select":((id==="bitbucket"||id==="azure-devops")&&(projectId||onRepository)||id==="linear"&&projectId)?"Verify access and select":id==="jira"||id==="linear"?"Add exported tickets":"Add exported evidence"}</small></span><span aria-hidden="true">+</span>
    </button>)}</div>
    <Modal open={!!active} dismissible={!busy} title={active==="linear"&&projectId?"Connect Linear":active==="document"?"Add document evidence":active&&repoIds.includes(active)?`Add ${name}`:`Add ${name??"source"} evidence`} onClose={()=>setActive(null)}>
      {active==="linear"&&projectId?<LinearSourceConnection key={active} projectId={projectId} onClose={()=>setActive(null)}/>:active&&projectId&&repoIds.includes(active)?<RepositoryConnectionContent key={active} projectId={projectId} provider={active as RepositoryProvider} onConnected={()=>{void utils.project.repositories.invalidate({projectId});void utils.project.byId.invalidate({id:projectId});}} onClose={()=>setActive(null)}/>:<>
        {active&&active!=="document"&&<p>{name} account discovery is not available in this intake. Add an exported specification or ticket as Markdown or text, then review the proposed changes.</p>}
        {projectId&&active?<PopulationDocuments projectId={projectId}/>:onDocuments?<button type="button" onClick={onDocuments}>Add file or text</button>:documentsHref?<a className="btn-primary" href={documentsHref}>Add document evidence</a>:<p>Open project evidence to add a file.</p>}
      </>}
    </Modal>
  </div>;
}
