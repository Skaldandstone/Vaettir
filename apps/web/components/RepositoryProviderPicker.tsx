"use client";

import {useId,useState} from "react";
import {repositoryProviders,type RepositoryProvider} from "./RepositoryConnectionContent";
import type {RepositoryAuthorizationIntent} from "@/lib/repository-authorization";
export {cancelRepositoryAuthorization,type RepositoryAuthorizationIntent} from "@/lib/repository-authorization";

export function RepositoryProviderPicker({value,onChange,onConnect,disabled=false}:{
  value:RepositoryProvider|"";onChange:(provider:RepositoryProvider)=>void;
  onConnect:(provider:RepositoryProvider,intent?:RepositoryAuthorizationIntent)=>void;
  disabled?:boolean;authorize?:boolean;
}){
  const id=useId();
  const [error,setError]=useState("");
  const oauth=value==="gitlab"||value==="github";
  function connect(){
    if(disabled||!value||!repositoryProviders.some(([provider])=>provider===value))return;
    setError("");
    // Provider selection opens the setup screen only. The explicit provider
    // Connect button opens authorization after current configuration/access checks.
    try{onConnect(value);}catch{
      setError("The connection could not start. Your repository selections are unchanged.");
    }
  }
  return <div className="repository-connection-panel" style={{display:"grid",gap:16,minWidth:0}}>
    <label htmlFor={id} style={{display:"grid",gap:6}}>Repository source
      <select id={id} value={value} disabled={disabled} onChange={event=>{
        const provider=repositoryProviders.find(([key])=>key===event.target.value)?.[0];
        if(provider&&!disabled){setError("");onChange(provider);}
      }} style={{width:"100%",minWidth:0,boxSizing:"border-box"}}>
        <option value="" disabled>Choose a provider</option>
        {repositoryProviders.map(([provider,label])=><option key={provider} value={provider}>{label}</option>)}
      </select>
    </label>
    {oauth?<p className="repository-connection-notice">{value==="github"?"GitHub may grant repository read/write and organization permissions. Connect opens setup; authorization starts from the next screen after access and configuration checks.":"Choose your GitLab instance next, including self-hosted GitLab. GitLab uses read_api, which is broader than repository listing."} Review the provider’s permissions. You approve account verification and repository metadata only; no source files or AI processing.</p>:value==="bitbucket"||value==="azure-devops"?<p className="repository-connection-notice">Connect opens token verification and repository selection. Native OAuth is not available for this provider yet.</p>:value?<p className="repository-connection-notice">Native account authorization is not available yet. Connect opens exported evidence and unverified reference options.</p>:null}
    {oauth&&<details className="connection-options"><summary>How authorization works</summary><p className="text-muted">Authorization uses your existing sign-in, or asks you to sign in. GitLab supports self-hosted instances. Account authorization opens only after you select the host. Connecting does not authorize source discovery or AI processing.</p></details>}
    {error&&<p role="alert">{error}</p>}
    <footer className="connection-footer"><button type="button" className="btn-primary" disabled={disabled||!value} onClick={connect}>Connect</button></footer>
  </div>;
}
