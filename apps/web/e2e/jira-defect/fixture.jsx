import React,{useState}from"react";
import{createRoot}from"react-dom/client";
import{QueryClient,QueryClientProvider}from"@tanstack/react-query";
import ProjectIntegrationsPage from"../../app/projects/[projectId]/settings/integrations/page";
import DefectMapPanel from"../../components/DefectMapPanel";
import{Controls,Evidence}from"./boundaries";
const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
function App(){const[theme,setTheme]=useState("dark");return <QueryClientProvider client={client}><main style={{maxWidth:1200,margin:"auto",padding:16}}><p>Local synthetic transport; no live provider acceptance.</p><button onClick={()=>{const next=theme==="dark"?"light":"dark";document.documentElement.dataset.theme=next;setTheme(next);}}>Switch theme</button>{new URLSearchParams(location.search).get("screen")==="map"?<DefectMapPanel projectId="synthetic-project"/>:<ProjectIntegrationsPage/>}<Controls/><Evidence/></main></QueryClientProvider>;}
createRoot(document.getElementById("root")).render(<App/>);
