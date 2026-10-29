"use client";
import {Suspense,useEffect,useRef,useState} from "react";
import {useAuth} from "@clerk/nextjs";
import {useSearchParams} from "next/navigation";
import {trpcReact} from "@/lib/trpcReact";

function AtlassianCallback(){
  const params=useSearchParams(),auth=useAuth(),finish=trpcReact.atlassianConnections.finish.useMutation({retry:false});
  const captured=useRef<{state:string;code?:string;denied?:true}|null>(null),started=useRef(false),[outcome,setOutcome]=useState("Checking sign-in…");
  useEffect(()=>{
    if(!captured.current){captured.current={state:params.get("state")??"",...(params.get("error")?{denied:true as const}:{code:params.get("code")??undefined})};window.history.replaceState(window.history.state,"",window.location.pathname);}
    if(!auth.isLoaded||!auth.isSignedIn||started.current)return;
    started.current=true;const input=captured.current;
    if(!/^[A-Za-z0-9_-]{43}$/.test(input.state)||!input.code&&!input.denied){setOutcome("Connection could not be verified. Return to Vaettir and reconnect.");return;}
    finish.mutate(input,{onSuccess:result=>setOutcome(result.connected?"Signed in. Return to Vaettir to choose projects or spaces.":"Connection cancelled."),onError:()=>setOutcome("Connection unconfirmed. Return to Vaettir and check access. This code will not replay.")});
  },[params,auth.isLoaded,auth.isSignedIn,finish]);
  return <main style={{maxWidth:520,margin:"48px auto",padding:24}}><h1>Atlassian connection</h1><p role="status">{auth.isLoaded&&!auth.isSignedIn?"Sign in to Vaettir, then start the connection again.":outcome}</p><button type="button" onClick={()=>window.close()}>Close</button></main>;
}
export default function Page(){return <Suspense fallback={<p role="status">Checking connection…</p>}><AtlassianCallback/></Suspense>;}
