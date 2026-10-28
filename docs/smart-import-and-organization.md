# Reviewed smart import and organization

Smart assistance reads case content to propose column roles, test types, execution priorities and suite/subsuite placement. It is available in the import wizard for CSV, Excel and Google Sheets, and in the case library for selected or filtered existing cases. Manual import and editing remain available without AI analysis.

## Customer controls

Connection, file selection and parsing do not approve provider analysis. A current full-seat Owner or Admin must separately approve sending the displayed source scope to Vaettir's configured Anthropic API. The project must currently be classified Synthetic or Customer proprietary in AI sharing. Unclassified and Regulated projects are refused. Labels do not detect or redact sensitive information; only content authorized for this processing may be selected.

Analysis requests pin the original project, organization, independently authenticated Clerk subject and classification version. Authority and policy are refreshed before each provider request and before returning its result. API/service tokens do not substitute for the human identity. Updating classification invalidates earlier analysis admission. This flow neither issues nor reuses a Codex disclosure grant and never broadens Google OAuth scopes.

The previous upload-triggered type-analysis RPC now refuses provider work and asks older clients to refresh into this explicitly approved flow. Existing source parsing, row-layout suggestions and manual classification remain independent of AI processing.

## Proposals and review

Column analysis sends the headers and first 25 complete data rows. It handles unfamiliar labels using the supplied values, distinguishes observed run results from expected behavior, and requires exact supporting excerpts. Every proposed source column must exist uniquely and can have only one target role. The review shows the entire mapping diff, including implied unmapping. Accepted mappings update the preview only. Seeded empty repair buffers do not override a corrected mapping; actual inline edits are retained.

Case analysis sends complete selected definitions, tags, current metadata and current project suite paths. Existing source-derived placement is included. Existing suites are preferred; new paths may contain up to eight named levels under the existing 240-character path limit. Priority is a reasoned execution recommendation, not a risk-score or severity fact. Missing priority is identified as a default when no source column was mapped. There is no forced Medium or Functional recommendation and no invented procedure or assertion.

Each returned case identity must match exactly once, evidence must occur in the supplied definition, and low-confidence proposals become no-change values. The reviewer can select or discard suite, priority and type changes separately, or select/clear all proposed changes. An import still requires its final explicit commit. Existing-case changes require a separate Apply selected changes action.

## Bounds, persistence and retry

- Analysis runs sequential batches of at most 20 cases. One import review supports 2,500 selected cases; existing-case writes support 200 selected cases in one atomic save. Larger scopes require an explicit narrower selection rather than silent truncation.
- A provider batch contains at most 90,000 serialized characters. Oversized or shared-library procedures are refused before partial analysis. Existing case bodies/step counts are bounded in SQL before materialization. Project hierarchy is bounded by the existing 500-folder contract.
- At most two provider calls run concurrently. Per-original-scope request/capacity bounds, retained request identities and scoped caching limit retries. Platform-funded suggestions do not deduct customer AI credits; provider usage is still measured by the shared tracing/usage capture.
- Model proposals are temporary process-local previews with 30-minute admission expiry, not a durable background queue. Process restart requires a new review; source and approval are never silently reconstructed. Stop or scope changes prevent later batches; in-flight processing may already have completed.
- Applying existing-case proposals rechecks current editor membership, original human/workspace, the hierarchy revision, full case content revision, update time and source-derived placement. Every selected change is preflighted before any writes.
- Suite ancestors, changed case metadata, versions, priority decisions and audits commit together. Execution results, source provenance, steps, expected outcomes and unrelated fields are not rewritten. The durable actor/project/request-bound audit receipt makes exact retries acknowledgements rather than duplicate writes.
- The UI keeps an uncertain save and its exact selections locked for retry. A definite first-attempt server refusal permits a fresh review; a later refusal cannot erase an earlier unknown outcome. Reloading discards browser drafts; committed case versions and audit receipts remain durable.

## Rollout and acceptance

`VAETTIR_SMART_SUGGESTIONS_PROJECTS` is closed by default. A JSON array of exact project IDs enables the sandbox pilot. Set it to `*` only after sandbox acceptance for the authorized all-instance rollout. This rollout flag grants no customer processing authority: native roles, classification, per-operation disclosure approval and final review remain required.

Source validation includes real PostgreSQL current-authority, tenant, classification, stale-edit, concurrent retry and transaction-rollback tests, model-contract tests and actual-component browser fixtures. Synthetic providers are used by those tests. They do not establish real model quality, Google consent, hosted import persistence or customer acceptance; those require a distinct authorized sandbox receipt for the deployed source and images.

Google-derived content is used for the selected user-facing feature, never advertising, general model training or provider feedback. Preserve the commercial API's non-training configuration; do not enable provider training/feedback opt-ins for this content. Provider retention is not represented as zero. References: [Google Workspace data policy](https://developers.google.com/workspace/workspace-api-user-data-developer-policy), [Anthropic commercial model training policy](https://privacy.claude.com/en/articles/7996868-is-my-data-used-for-model-training), [Anthropic retention](https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data). The published Sheets notice and in-product approvals describe the separate analysis scope.
