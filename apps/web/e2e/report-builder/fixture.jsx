import React, {useState} from "react";
import {createRoot} from "react-dom/client";
import {ReportBuilder} from "../../components/ReportBuilder";
import {FrozenReport} from "../../components/FrozenReport";
import {Session,evidence,makePayload} from "./boundary";
function App(){const [actor,setActor]=useState("synthetic-owner"),[allowed,setAllowed]=useState(true),[approved,setApproved]=useState(false),[tick,setTick]=useState(0);
return <Session.Provider value={{actor,allowed}}><main style={{maxWidth:1240,margin:"auto",padding:24}}><p className="eyebrow">Synthetic component verification · No live connection</p><h1>Reports</h1>
 <div hidden><button onClick={()=>setTick(tick+1)}>Refresh fixture evidence</button><button onClick={()=>setActor(actor==="synthetic-owner"?"synthetic-other":"synthetic-owner")}>Switch fixture actor</button><button onClick={()=>setAllowed(!allowed)}>Toggle fixture access</button><button onClick={()=>{evidence.loseNextPreview=true}}>Lose next fixture preview</button><button onClick={()=>setApproved(true)}>Show fixture approved report</button></div>
 <ReportBuilder projectId="synthetic"/>{approved&&<FrozenReport report={{...(evidence.saved?.payload??makePayload()),state:"approved"}} allowExport/>}
 <details><summary>Synthetic transport evidence</summary><pre data-testid="fixture-evidence">{JSON.stringify(evidence)}</pre></details></main></Session.Provider>}
createRoot(document.getElementById("root")).render(<App/>);
