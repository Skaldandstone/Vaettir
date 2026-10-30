import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { MigrationWizard } from "../../components/MigrationWizard";
import { GoogleSheetsPrivacyNotice } from "../../components/GoogleSheetsPrivacyNotice";
import { HistoricalResultsImport } from "../../components/HistoricalResultsImport";
import ImportPage from "../../app/projects/[projectId]/import/page";
window.sheetFixture = { commits: [], prepares: [], ai: 0, tokens: 0, previews: [] };
window.google = {
  accounts: { oauth2: { initTokenClient: config => ({ requestAccessToken() {
    window.sheetFixture.tokens++;
    if (window.sheetFixture.cancel) { config.error_callback(); return; }
    if (config.include_granted_scopes !== false) throw new Error("Combined grant");
    config.callback({ access_token: "synthetic-browser-only-token", expires_in: 3600, scope: config.scope });
  } }) } },
};
function App() {
  const [theme, setTheme] = useState("dark");
  const [historyProject, setHistoryProject] = useState("synthetic-project"), [historyActor, setHistoryActor] = useState("synthetic-actor");
  if (window.location.pathname === "/page") return <main style={{ maxWidth: 1100, padding: 16, margin: "auto" }}><button onClick={() => { const next = theme === "dark" ? "light" : "dark"; document.documentElement.dataset.theme = next; setTheme(next); }}>Switch theme</button><ImportPage /></main>;
  if (window.location.pathname === "/google-sheets-privacy") return <main><GoogleSheetsPrivacyNotice /></main>;
  if (window.location.pathname === "/historical") return <main style={{ maxWidth: 1100, padding: 16, margin: "auto" }}><button onClick={() => { const next = theme === "dark" ? "light" : "dark"; document.documentElement.dataset.theme = next; setTheme(next); }}>Switch theme</button><button onClick={() => setHistoryProject(value => value + "-next")}>Switch synthetic project</button><button onClick={() => setHistoryActor(value => value + "-next")}>Switch synthetic actor</button><HistoricalResultsImport projectId={historyProject} actorScope={historyActor} /></main>;
  return <main style={{ maxWidth: 1100, padding: 16, margin: "auto" }}><button onClick={() => { const next = theme === "dark" ? "light" : "dark"; document.documentElement.dataset.theme = next; setTheme(next); }}>Switch theme</button><h1>Import cases · Synthetic sandbox</h1><p>Local component fixture. Google authorization and the API are simulated.</p><MigrationWizard projectId="synthetic-project" onCommitted={() => {}} /></main>;
}
createRoot(document.getElementById("root")).render(<App />);
