"use client";

import {Suspense,useEffect,useRef,useState} from "react";
import {useAuth} from "@clerk/nextjs";
import {useSearchParams} from "next/navigation";
import {trpcReact} from "@/lib/trpcReact";

function DriveCallback(){
  const params=useSearchParams();const {isLoaded,isSignedIn}=useAuth();
  const captured=useRef<{state:string;code?:string;denied:boolean}|null>(null);const started=useRef(false);
  const [outcome,setOutcome]=useState<"pending"|"verified"|"canceled"|"error">("pending");
  const complete=trpcReact.driveConnections.complete.useMutation();
  useEffect(()=>{
    if(!captured.current){captured.current={state:params.get("state")??"",code:params.get("code")??undefined,denied:!!params.get("error")};window.history.replaceState(window.history.state,"",window.location.pathname);}
    if(!isLoaded||!isSignedIn||started.current)return;
    started.current=true;const input=captured.current;
    if(!input.state||(!input.code&&!input.denied)){setOutcome("error");return;}
    complete.mutate(input,{onSuccess:result=>{setOutcome(input.denied?"canceled":"verified");window.opener?.postMessage({channel:"vaettir-drive-authorization",status:input.denied?"error":"success",id:result.id},window.location.origin);},onError:()=>{setOutcome(input.denied?"canceled":"error");window.opener?.postMessage({channel:"vaettir-drive-authorization",status:"error"},window.location.origin);}});
  },[params,isLoaded,isSignedIn,complete]);
  return <main style={{maxWidth:520,margin:"48px auto",padding:24}}><h1>Google Drive authorization</h1>{!isLoaded?<p role="status">Checking your Vaettir session…</p>:!isSignedIn?<p role="alert">Your Vaettir session is unavailable. Close this window, sign in to Vaettir and start the connection again.</p>:<p role={outcome==="error"?"alert":"status"}>{outcome==="verified"?"Google account verified. Return to Vaettir to choose individual files. No file contents were read.":outcome==="canceled"?"Authorization canceled. No files were approved.":outcome==="error"?"Authorization could not be verified. Return to Vaettir and start again.":"Verifying your Google account…"}</p>}<button type="button" className="btn-secondary" onClick={()=>window.close()}>Close this window</button><p className="text-muted">If this tab stays open, close it manually. The original Vaettir window checks saved authorization status independently.</p></main>;
}
export default function DriveCallbackPage(){return <Suspense fallback={<p role="status">Loading authorization result…</p>}><DriveCallback/></Suspense>;}
