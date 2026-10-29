// Owner-approved Google Sheets notice, extended for the requested historical-results workflow.
// Keep the published wording aligned with the import and credential controls.
const sections = [
  {
    "title": "What Google access permits",
    "paragraphs": [
      "Vaettir requests Google's selected-file permission, drive.file. Google describes this as permission to view and manage files selected for the app. Vaettir's Sheets importer uses that permission to read the spreadsheet you choose; it does not edit, delete or continuously synchronize your Google spreadsheet. This connection is separate from Vaettir's metadata-only Google Drive source connection."
    ]
  },
  {
    "title": "What the importer reads and sends",
    "paragraphs": [
      "After you approve access and select a spreadsheet, your browser reads its title, identifier, worksheet names and identifiers, and worksheet dimensions. It reads formatted cell values from the worksheets you select. Google supplies the account selection, permission and file-picker interfaces. The isolated file picker sends Google the Vaettir site origin to validate the restricted browser key; its referrer does not include your project path, query parameters or worksheet content.",
      "Before reading worksheet content, Vaettir asks you to approve sending selected worksheets to your current Vaettir project for import review. Those worksheet contents and source identifiers are sent to Vaettir to parse fields and prepare the preview. No test cases, historical run results or import-history records are saved until you explicitly confirm the import. Choose only content you are authorized to share with that project and its members."
    ]
  },
  {
    "title": "Credentials and drafts",
    "paragraphs": [
      "The temporary Google access token stays in browser memory; it is not sent to Vaettir's API or saved in browser local/session storage or Vaettir's database. The importer discards its token reference after the content read, cancellation, expiry or closing the import. Reloading discards the temporary connection and preview draft. Discarding that reference does not revoke Google's app permission."
    ]
  },
  {
    "title": "After you confirm an import",
    "paragraphs": [
      "Vaettir stores imported test-case fields, stable source identifiers, field mappings and import history in your project. Re-import uses stable case IDs; existing human edits can be reported as conflicts instead of silently overwritten. Project access permissions govern who can use the imported cases. If you choose historical results import, Vaettir stores the reviewed case links, results, notes, original run dates, source references and importing actor as historical observations. Case versions, run history and audit records can retain historical information. Vaettir uses its hosted application and database infrastructure to process and retain these records.",
      "The Sheets import does not automatically send worksheet content to an AI analysis service. Importing does not grant an AI plugin permission to read your project. Any later analysis or sharing is a separate action governed by the applicable Vaettir controls; do not treat import approval as approval for those actions."
    ]
  },
  {
    "title": "Optional smart import and organization suggestions",
    "paragraphs": [
      "Where smart suggestions are enabled, a separate approval is required before analysis. Column suggestions send column names and the first 25 data rows to Vaettir's configured Anthropic AI provider. Case suggestions send the selected complete mapped case definitions, tags, current classification, priority and placement, together with the project's suite names. Google access tokens are never sent to the AI provider. Only select content authorized for this analysis.",
      "Analysis produces temporary, editable suggestions; it does not import, move or update cases. A separate review and confirmation applies selected changes. Saved changes retain versions and audit history. AI-provider processing is governed by the provider's applicable terms; this notice does not promise zero provider retention or automatic removal of previously processed data. Declining analysis leaves manual import and organization available."
    ]
  },
  {
    "title": "Limited use of Google data",
    "paragraphs": [
      "Vaettir follows the Google Workspace User Data and Developer Policy, including its Limited Use requirements. Google-derived data is used only for the selected import and organization features. Vaettir does not sell it, use it for advertising, or use it to develop, train or improve general-purpose AI models. The smart-suggestion integration does not submit your content as provider feedback or training examples."
    ]
  },
  {
    "title": "Your controls and deletion",
    "paragraphs": [
      "You can cancel before import, select different worksheets or use a CSV/Excel export instead of connecting Google. You can revoke Vaettir's Google permission from your Google account's third-party connections. Revocation stops future authorized Google access; it does not delete cases or results already imported into Vaettir or their retained history.",
      "Use Vaettir's existing content-management controls or contact james@skaldandstone.com for access or deletion requests. We must review associated versions, source mappings, run and import history, audit records and backups when handling a deletion request; this notice does not promise that every retained copy is removed immediately. Your original Google spreadsheet remains under your Google account's controls."
    ]
  },
  {
    "title": "Questions",
    "paragraphs": [
      "Contact james@skaldandstone.com about this import, permissions or retained Google-derived data. Any change in how this feature uses Google data must be reflected in its disclosures before that changed use begins."
    ]
  }
] as const;

export function GoogleSheetsPrivacyNotice() {
  return <article className="workspace-panel" style={{ maxWidth: 800, margin: "24px auto", padding: "clamp(20px, 4vw, 48px)", lineHeight: 1.7, overflowWrap: "anywhere" }}>
    <header>
      <p className="eyebrow">Vaettir · Google data</p>
      <h1>Google Sheets import privacy</h1>
      <p className="text-muted">Effective 28 October 2026</p>
      <p>Vaettir is operated by Skald and Stone LLC. This notice explains the optional Google Sheets import: connect Google, select a spreadsheet and worksheets, review fields and rows, then confirm an import into your Vaettir project.</p>
    </header>
    {sections.map(section => <section key={section.title} style={{ marginTop: 28 }}>
      <h2>{section.title}</h2>
      {section.paragraphs.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
    </section>)}
    <p><a href="mailto:james@skaldandstone.com?subject=Vaettir%20Google%20data%20question">Contact us about Google data</a></p>
    <p><a href="https://myaccount.google.com/connections" target="_blank" rel="noopener noreferrer">Manage Google account connections</a></p>
    <p><a href="https://developers.google.com/workspace/workspace-api-user-data-developer-policy" target="_blank" rel="noopener noreferrer">Google Workspace data policy</a>{" · "}<a href="https://privacy.claude.com/en/articles/7996868-is-my-data-used-for-model-training" target="_blank" rel="noopener noreferrer">Anthropic commercial data use</a>{" · "}<a href="https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data" target="_blank" rel="noopener noreferrer">Anthropic data retention</a></p>
  </article>;
}
