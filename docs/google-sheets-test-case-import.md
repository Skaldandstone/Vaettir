# Google Sheets test-case import

Customers use Import → Google Sheets → connect Google → choose a spreadsheet
and tabs → review automatically mapped fields → confirm the selected import.
No cases are saved by connection, file selection, reading, or mapping.

## Access and disclosure

This is separate from the existing metadata-only Google Drive source connector.
It does not change or reuse that connector's tokens, scopes, or saved files.
Google Identity Services requests only `drive.file`, with incremental grants
disabled. Google Picker selects the spreadsheet. The Google permission permits
managing app-selected files; Vaettir's implementation makes only Sheets GETs.
It does not request account-wide Sheets or Drive content scopes.

Short-lived tokens remain in browser memory. Tokens are not sent to Vaettir's
API, local/session storage, URLs, logs, or the database. Cancellation, expiry,
unmounting and a completed content read discard the local reference. This does
not revoke Google's app grant; customers can revoke it in their Google account.
Reloading discards the temporary connection and mapping draft.

The customer explicitly approves reading their selected spreadsheet and sending
the selected worksheets to their current Vaettir project for import review.
Only the reviewed content snapshot and source identifiers reach the import API.
This provenance is customer-supplied, not a server attestation of Google content.
Sheets import does not call the AI type-analysis service or grant any plugin
disclosure authority. Existing project/customer AI-sharing controls still apply.

## Provider setup and rollout

The connection defaults unavailable until all three server runtime settings exist:

| Setting | Purpose |
| --- | --- |
| `GOOGLE_SHEETS_CLIENT_ID` | Browser-public Google OAuth web-client ID |
| `GOOGLE_SHEETS_PICKER_API_KEY` | Browser-public, restricted Picker API key |
| `GOOGLE_SHEETS_PROJECT_NUMBER` | Google project number used by Picker |

Use a separate OAuth client from the metadata source connection. The client and
Picker app ID must belong to the same Google Cloud project. Enable the Sheets,
Drive and Picker APIs, configure the consent screen and authorize the exact web
origins that will run the import. Customer subdomains need explicit origin
registration; Google does not support a wildcard web-origin grant. Restrict the
browser API key to the required APIs and documented website referrers, including
Picker's `docs.google.com` frame origin. Never put a client secret in these fields.
The project-scoped configuration endpoint requires Editor access and returns
only these browser-public fields.

Provider registration, key creation/restriction changes, publishing/verification
and real customer consent remain separate owner actions. Do not silently enable
or expand provider access as part of a source deployment. The first real OAuth
and import test must use only an explicitly selected synthetic Skald sandbox
sheet and project. Do not read or mutate aTwist data, grants or provider settings.
An unconfigured deployment offers the existing CSV/Excel export upload fallback.

## Mapping, limits and retry behavior

Read at most 20 selected grid tabs, 1 MiB of combined CSV content, 2,500 case rows
in total and 100 populated columns per tab. Each provider read has a 15-second
deadline and a 1 MiB streaming response cap. The complete selected tab is read;
oversized populated ranges fail rather than silently truncating. Allocated row
counts in the picker are labeled as allocated rows, not case counts. Actual
parsed counts appear during mapping. The first row must contain column names.

Each selected tab needs a title mapping and a unique, non-empty stable case ID
for each imported case. Recognized Case ID/External ID headers are auto-mapped;
the customer can correct the mapping. Missing IDs block with an explanation.
The source namespace includes spreadsheet ID, tab ID and case ID, within the
current project. Renaming a tab does not change identity. Changing IDs creates
different identities. Rows are never identified only by their current position.

The API checks Editor membership, validates every selected tab, then passes all
rows to the existing atomic import transaction. A validation failure before
commit leaves no cases or import history. Exact retries retain the same case
identities. Existing human edits are preserved and conflicts are reported as
skipped; source deletion never deletes Vaettir cases. Database transaction or
uniqueness errors roll back the shared transaction. The preview is an in-memory
manual snapshot; later Google edits require another selection/read.

Unrecognized test types remain OTHER / Unclassified / For review. Field mapping
uses the existing deterministic parser. No functional type, missing procedure,
expected result, paid analysis or continuous synchronization is inferred.

## Validation

- `pnpm --filter @vaettir/web exec vitest run lib/google-sheets-import.test.ts`
- `pnpm --filter @vaettir/api exec vitest run src/services/googleSheetsImport.test.ts src/routers/importJobs.googleSheets.test.ts`
- `pnpm --filter @vaettir/api exec vitest run src/routers/importJobs.integration.test.ts` against disposable synthetic PostgreSQL
- `node apps/web/e2e/google-sheets/run.mjs`

The browser fixture renders the actual components and CSV parser with synthetic
Google and API substitutes. It tests multi-tab selection, mapping, explicit
commit, absence of credential transmission/AI calls, back navigation and both
themes at desktop/mobile sizes. It does not prove real Google consent, provider
configuration, authenticated hosted import or production deployment.

References: [Google token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model),
[Sheets scopes](https://developers.google.com/workspace/sheets/api/scopes),
[Picker setup](https://developers.google.com/workspace/drive/picker/guides/web-picker-sample),
[Sheets values GET](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/get).

## Published data notice

`/google-sheets-privacy` is an exact public notice route; project, child and API routes remain protected. The import disclosure opens the notice in a separate tab so reading it does not discard the draft. The footer also links it. Owner-approved wording describes selected worksheet metadata/content, browser-only tokens, explicit commit, retained history, revocation versus deletion, and separate AI-sharing authority. Provider configuration must use the live notice URL only after hosted verification.


## Historical result columns

The backfill panel accepts an original Google Sheets tab, Excel workbook tab or CSV export. It explains how to find results in old plan columns and how to export a Google Docs/Word table to a worksheet. It does not request Google Docs access or recover unmapped columns from saved case definitions.

Choose one result column per import, map native/display/source case IDs or exact case titles, and explicitly resolve ambiguous matches. A supplied but unknown ID never falls back silently to title matching. Every selected case must belong to the current project. Custom result labels need explicit meanings; blank, Not run and Pending cells are left out. Dates are required, never prefilled, and use an explicit ISO, month/day, day/month or Excel 1900 interpretation. Duplicate case/date observations block review.

After review, the customer confirms the case matches, real dates and historical nature of the observations. The server locks the project, refreshes Editor authority, recomputes matches and verifies the reviewed fingerprint. Every selected date, result and audit entry commits in one transaction. Exact same-source/label/column/date retries reuse existing runs, including concurrent retries; changed prior observations conflict without overwriting history. Changing the source reference or run label denotes a different import identity, not a global duplicate detector.

Runs retain source reference, result column, original day, importing actor and row provenance. Because the schema requires a timestamp, noon UTC is an explicitly marked date-only anchor; finish time, duration and execution-step evidence remain unknown. The run detail explains that historical observations do not reverify current procedures. No case definition, procedure, AI grant, healing action or model analysis is changed by this importer. No schema migration is required.

Additional validation: `src/services/historicalResultsImport.test.ts`, `src/routers/testRuns.historical.test.ts`, `src/routers/testRuns.historical.integration.test.ts` and the historical browser flow in `apps/web/e2e/google-sheets/run.mjs`. Real PostgreSQL tests cover read-only preview, concurrent replay, all-date conflict preflight, later-write rollback including audits, stale digest and revoked authority. The browser fixture uses synthetic transport and does not establish live Google or hosted acceptance.

Historical Excel parsing uses an explicit results mode in the same bounded isolated worker. ID/Result/Date tables do not need a case title/procedure header; case-import recognition is unchanged. Worker caches include the parsing purpose. Physical Excel row references survive preambles and sparse row gaps, are bound to review, and are stored separately from normalized import-table record numbers. Current and reserved project case-key aliases are resolved only within the selected project and organization, so changing a project prefix does not break historical imports. Actual XLSX/isolated-worker, sparse-row and alias regressions cover these boundaries.

The review fingerprint binds the exact CSV snapshot, project, column/date/status/match choices and optional physical row map. Recorded results retain the reviewed source case reference and raw result label as well as the normalized outcome. An identical normalized observation retry reuses its original run and first retained source labels/row references; it does not rewrite provenance.
