/** Local browser capability, not serializable credentials or server permission. */
export type RepositoryAuthorizationIntent=Readonly<{
  claim:()=>boolean;
  isCancelled:()=>boolean;
  window:()=>Window;
  cancel:()=>void;
}>;
export function createRepositoryAuthorization(popup:Window):RepositoryAuthorizationIntent{
  let consumed=false;
  let cancelled=false;
  return {
    claim(){if(consumed||cancelled)return false;consumed=true;return true;},
    isCancelled:()=>cancelled,
    window:()=>popup,
    cancel(){if(cancelled)return;cancelled=true;popup.close();},
  };
}
export function cancelRepositoryAuthorization(intent?:RepositoryAuthorizationIntent){intent?.cancel();}

export async function authorizeRepositoryAccount({providerName,preopened,begin,onStarted,onError,onPopup}:{
  providerName:string;preopened?:Window;begin:()=>Promise<{id:string;url:string}>;
  onStarted:(id:string)=>void;onError:(message:string)=>void;onPopup:(popup:Window)=>void;
}){
  const opened=preopened??window.open("about:blank","_blank","popup,width=650,height=760");
  if(!opened){onError(`Allow popups for Vaettir, then select Connect ${providerName} again.`);return;}
  if(opened.closed){onError("The authorization window was closed. Select Connect to try again.");return;}
  opened.opener=null;
  onPopup(opened);
  try{
    const result=await begin();
    onStarted(result.id);
    if(opened.closed){onError("The authorization window was closed. Cancel this attempt and try again.");return;}
    opened.location.replace(result.url);
  }catch{
    opened.close();
    onError("Authorization could not start. Check your permissions and provider configuration, then try again.");
  }
}
