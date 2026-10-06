"use client";

import {useId,useState} from "react";
import {repositoryProviders,type RepositoryProvider} from "./RepositoryConnectionContent";
import {createRepositoryAuthorization,cancelRepositoryAuthorization,type RepositoryAuthorizationIntent} from "@/lib/repository-authorization";
export {cancelRepositoryAuthorization,type RepositoryAuthorizationIntent} from "@/lib/repository-authorization";

export function RepositoryProviderPicker({value,onChange,onConnect,disabled=false,authorize=false}:{
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
    let intent:RepositoryAuthorizationIntent|undefined;
    if(authorize&&value==="github"){
      // The click owns the popup; never open it on selection or from an effect.
      const popup=window.open("about:blank","_blank","popup,width=650,height=760");
      if(!popup){setError("Allow popups for Vaettir, then select Connect again.");return;}
      popup.opener=null;
      intent=createRepositoryAuthorization(popup);
    }
    try{onConnect(value,intent);}catch{
      cancelRepositoryAuthorization(intent);
      setError("The connection could not start. Your repository selections are unchanged.");
    }
  }
  return <div style={{display:"grid",gap:12,minWidth:0}}>
    <label htmlFor={id} style={{display:"grid",gap:6}}>Repository source
      <select id={id} value={value} disabled={disabled} onChange={event=>{
        const provider=repositoryProviders.find(([key])=>key===event.target.value)?.[0];
        if(provider&&!disabled){setError("");onChange(provider);}
      }} style={{width:"100%",minWidth:0,boxSizing:"border-box"}}>
        <option value="" disabled>Choose a provider</option>
        {repositoryProviders.map(([provider,label])=><option key={provider} value={provider}>{label}</option>)}
      </select>
    </label>
    {oauth?<p className="text-muted">{value==="github"?"GitHub may grant repository read/write and organization permissions. Connect opens provider authorization.":"Choose your GitLab instance next, including self-hosted GitLab. Account authorization opens only after you select the host. GitLab uses read_api, which is broader than repository listing."} Authorization uses your existing sign-in, or asks you to sign in. Review its permissions. You approve account verification and repository metadata only; no source files or AI processing.</p>:value==="bitbucket"||value==="azure-devops"?<p className="text-muted">Connect opens token verification and repository selection. Native OAuth is not available for this provider yet.</p>:value?<p className="text-muted">Native account authorization is not available yet. Connect opens exported evidence and unverified reference options.</p>:null}
    {error&&<p role="alert">{error}</p>}
    <div><button type="button" disabled={disabled||!value} onClick={connect}>Connect</button></div>
  </div>;
}
