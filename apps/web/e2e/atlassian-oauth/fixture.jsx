import React from "react";
import {createRoot} from "react-dom/client";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {AtlassianOAuthConnection} from "../../components/AtlassianOAuthConnection";
import {FixtureActor} from "./boundaries";
const client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:0,refetchOnWindowFocus:false},mutations:{retry:false}}});
createRoot(document.getElementById("root")).render(<QueryClientProvider client={client}><FixtureActor><main style={{maxWidth:760,margin:"auto",padding:16}}><p>Synthetic transport only. No live provider permission is issued.</p><AtlassianOAuthConnection projectId="synthetic-project" product={location.search.includes("confluence")?"confluence":"jira"}/></main></FixtureActor></QueryClientProvider>);
