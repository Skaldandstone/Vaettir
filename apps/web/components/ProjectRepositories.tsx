"use client";
import { useState } from "react";
import { trpcReact } from "@/lib/trpcReact";
import { ProviderMark } from "./SourceConnectionChips";
import { Modal } from "./Modal";
const providers = [["github","GitHub"],["gitlab","GitLab"],["bitbucket","Bitbucket"],["azure-devops","Azure DevOps"],["git","Self-hosted Git"],["perforce","Perforce"],["svn","SVN"]] as const;
type Provider = typeof providers[number][0];
export function ProjectRepositories({projectId,canEdit}:{projectId:string;canEdit:boolean}) {
 const query=trpcReact.project.repositories.useQuery({projectId});
 const add=trpcReact.project.addRepository.useMutation({onSuccess:()=>{void query.refetch();setProvider(null);setUrl("");setRevision("");}});
 const [provider,setProvider]=useState<Provider|null>(null);
 const [url,setUrl]=useState(""); const [revision,setRevision]=useState("");
 return <section aria-label="Project repositories">
   <h2>Repositories</h2><p className="text-muted">Register all repositories in this project. Registration does not authenticate, fetch source, or prove which revision is deployed.</p>
   {query.error && <p role="alert">{query.error.message}</p>}
   <div className="source-chip-list">{query.data?.map(repo=><span className="source-connection-chip" key={repo.id}><ProviderMark id={repo.provider}/><span><strong>{repo.url}</strong><small>Registered · Access unverified{repo.revision ? ` · ${repo.revision}` : ""}</small></span></span>)}</div>
   {canEdit && <div className="source-chip-list">{providers.map(([id,label])=><button type="button" className="source-connection-chip" key={id} onClick={()=>{add.reset();setProvider(id);}}><ProviderMark id={id}/><span><strong>{label}</strong><small>Add repository</small></span><span aria-hidden="true">+</span></button>)}</div>}
   <Modal open={!!provider} onClose={()=>setProvider(null)} title={`Add ${providers.find(([id])=>id===provider)?.[1] ?? "repository"}`} dismissible={!add.isPending}>
    <p>Add its web URL and an optional commit, changelist or revision reference. Credentials are not collected here. Source discovery for registered repositories is not yet available.</p>
    <label>Repository web URL<input type="url" value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://host/organization/repository" /></label>
    <label>Revision to review (optional)<input value={revision} onChange={e=>setRevision(e.target.value)} maxLength={200}/></label>
    {add.error && <p role="alert">{add.error.message}</p>}
    <button className="btn-primary" disabled={!url.trim() || add.isPending} onClick={()=>provider && add.mutate({projectId,provider,url,revision})}>{add.isPending ? "Saving…" : "Register repository"}</button>
   </Modal>
 </section>;
}
