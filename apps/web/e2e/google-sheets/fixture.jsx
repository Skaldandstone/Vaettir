import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { MigrationWizard } from "../../components/MigrationWizard";
import { GoogleSheetsPrivacyNotice } from "../../components/GoogleSheetsPrivacyNotice";
import { HistoricalResultsImport } from "../../components/HistoricalResultsImport";
window.sheetFixture = { commits: [], ai: 0, tokens: 0, previews: [] };
window.gapi = { load: (_name, options) => options.callback() };
window.google = {
  accounts: { oauth2: { initTokenClient: config => ({ requestAccessToken() {
    window.sheetFixture.tokens++;
    if (window.sheetFixture.cancel) { config.error_callback(); return; }
    if (config.include_granted_scopes !== false) throw new Error("Combined grant");
    config.callback({ access_token: "synthetic-browser-only-token", expires_in: 3600, scope: config.scope });
  } }) } },
  picker: {
    DocsView: class { setMimeTypes() { return this; } },
    PickerBuilder: class {
      addView() { return this; } setOAuthToken() { return this; } setDeveloperKey() { return this; }
      setAppId() { return this; } setOrigin() { return this; } setCallback(callback) { this.callback = callback; return this; }
      build() { return { dispose() {}, setVisible: () => this.callback({ action: "picked", docs: [{ id: "synthetic_book", mimeType: "application/vnd.google-apps.spreadsheet" }] }) }; }
    },
  },
};
function App() {
  const [theme, setTheme] = useState("dark");
  if (window.location.pathname === "/google-sheets-privacy") return <main><GoogleSheetsPrivacyNotice /></main>;
  if (window.location.pathname === "/historical") return <main style={{ maxWidth: 1100, padding: 16, margin: "auto" }}><button onClick={() => { const next = theme === "dark" ? "light" : "dark"; document.documentElement.dataset.theme = next; setTheme(next); }}>Switch theme</button><HistoricalResultsImport projectId="synthetic-project" /></main>;
  return <main style={{ maxWidth: 1100, padding: 16, margin: "auto" }}><button onClick={() => { const next = theme === "dark" ? "light" : "dark"; document.documentElement.dataset.theme = next; setTheme(next); }}>Switch theme</button><h1>Import cases · Synthetic sandbox</h1><p>Local component fixture. Google authorization and the API are simulated.</p><MigrationWizard projectId="synthetic-project" onCommitted={() => {}} /></main>;
}
createRoot(document.getElementById("root")).render(<App />);
