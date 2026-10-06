# Functional test-management acceptance audit, October 3, 2026

## Outcome and evidence boundary

Current continuation, October 5 Pacific: the October 3 baseline below is
historical, not a current source inventory. Later checkpoint sections record
signed-in Qase/TestRail/Testmo trial observations and implementation. They do
not establish exhaustive parity, an equivalent-task performance comparison or
deployment. The active scope is all James's reported workflows, not only
release gates. Latest fully integrated workflow checkpoint: `97fde98`; later
bounded increments and separately unvalidated drafts are identified below.

The standard case-management baseline is not yet met end to end. The most important gaps are preserving imported procedures, stable human-readable references, lossless export, complete history and safe edits. More AI actions or a different layout do not compensate for those gaps.

This audit refreshed official vendor documentation and inspected actual Vaettir source, initially at `b3e5004` and then the release checkpoint `8b6bd2e`. Concurrent case-identity, import-step and run-history repairs are explicitly identified below as in progress, not accepted. Root owns release validation. This document does not establish deployment, provider acceptance, exhaustive market parity or superiority over competitors. No paid competitor tenant was used, so vendor workflows are documented baselines rather than comparative hands-on measurements.

Existing compact work selection remains SSE-135/P9-00, SSE-127, SSE-131, SSE-133, SSE-136 and SSE-137. A fresh SSE-135 read returned `UNAUTHORIZED` requiring Studio Linear reconnection. No tracker record was changed or duplicated. Customer records, source-processing permissions, credits and provider grants were not changed by this audit.

## Immediate defects and acceptance gates

Priority is ordered by customer safety and successful completion, not by visual novelty. Source line numbers may move during the named concurrent repairs; router/component names are the durable implementation pointers.

### FPA-01: preserve every imported procedure and distinguish conditions

**P1, observed customer failure; repair in progress.** James's screenshot shows a case displaying only a Then outcome. The screenshot does not alone prove database erasure or that the prerequisite editor caused it. The case view must display all retained Given/When/Then instructions, and import mapping must not interpret setup conditions as a replacement for the procedure. Preconditions describe required state; prerequisite cases are optional executable dependencies. Neither replaces original steps. Separate preconditions and postconditions are not first-class general case fields in the inspected schema; `background` and physical-profile safety text are not substitutes for every domain.

Pointers: `csvFieldMapping.ts`, `xlsxImport.ts`, `importCommit.ts`, `TestCaseDetailContent.tsx`, `TestCaseForm.tsx`, `TestCasePrerequisites.tsx`. The import-step writer owns the immediate reproduction and correction. The new source already humanizes enum labels and places procedure first; James's deployed screenshot is not proof those source changes have reached production.

Accept only when synthetic imports preserve every original cell, line and order across Given/When/Then, multiline action/result and mapped preconditions; an identical rerun is a no-op; source changes never silently replace human edits. Inspect the affected customer's retained source/version evidence read-only before proposing any repair. No inferred reconstruction may be written without approval. Show conditions separately from steps and dependency selection. Editing or saving dependencies must not mutate procedure arrays.

Documented baseline: [Qase cases and conditions](https://docs.qase.io/en/articles/5563704-test-cases), [TestRail templates](https://support.testrail.com/hc/en-us/articles/14927678348052-Test-case-templates).

### FPA-02: stable project-key case references everywhere

**P1, absent in baseline; source repair in progress.** The inspected baseline stored only an opaque `TestCase.id`; human-readable project key and case sequence were absent. The prerequisite picker searched title/internal ID. The concurrent identity writer is adding `displayId`, sequence allocation and project-key configuration; an uncommitted field or migration is not acceptance.

Pointers: `Project`/`TestCase` schema, identity migration, `project.ts`, `testCases.ts`, `testCaseStructure.ts`, prerequisite and case inspector helpers. References must be stable through rename, suite movement, archive/restore, retry and concurrent creation; internal immutable identity remains the relational key. Existing cases need deterministic additive numbering, never destructive identity replacement.

Accept when a user can search, select, deep-link, export and discuss `atwist-01` without knowing an internal ID; duplicates are impossible under concurrent creation/import; prerequisite, result, history and traceability references display the same stable label. Test project-key changes explicitly rather than assuming issued IDs can be renamed harmlessly.

Documented baseline: [Qase permanent project-code IDs](https://docs.qase.io/en/articles/5563704-test-cases), [Allure TestOps test management and test-key navigation](https://docs.qameta.io/use-testops/test-management/).

### FPA-03: relation authorization and atomic creation

**P0 acceptance blocker if reproduced; source paths require repair.** The inspected legacy `testCases.importCsv` authorized the destination project but passed optional `testPlanId` directly into creation. `create` similarly accepted plan and shared-step-group IDs without an explicit same-project lookup. These are ordinary foreign keys, not database-enforced project-composite relationships. `byId` resolves a referenced shared library's content. A foreign identifier must never link or expose another tenant's plan/library. This is source evidence of a missing relation gate, not a claim of production exploitation.

The baseline generic CSV route also completed its creation transaction before audit/version writes. An error afterward can leave created records despite a failed response; naive retry can duplicate them. The concurrent import writer now reports a shared atomic writer, current full-seat and same-project plan checks, and a durable request receipt. Those changes require the fresh regression gate before acceptance. General creation and dataset/shared-step editing also need current role/seat checks and consistent revision/receipt contracts, not merely a hidden UI button.

Pointers: `testCases.ts` create/import/update, `testCaseVersion.ts`, `testCaseDatasets.ts`, `sharedStepGroups.ts`, current full-editor authorization helpers. Identity writer and root were notified before any release.

Accept with isolated two-tenant fixtures: foreign/missing/archived plan or shared-library IDs produce no case or disclosed content; a changed role/seat/suspension rejects writes; injected audit/history failure rolls back creation; response loss and identical retries recover one record; altered retries conflict. Preserve server-side gates, not only client controls.

### FPA-04: stop calling the current CSV round-trippable

**P1, reproduced with the actual pure parser.** `testCases.exportCsv` omits structured/shared steps, background, domain/profile, datasets, media and dependencies. The page serializes Given/When/Then with `join("|")`; the parser splits on `|`. `importCsv` recognizes only title/Given/When/Then/priority/tags and creates FUNCTIONAL cases. It ignores exported suite, type and automation values. Repeated imports have no stable external identity in this legacy route.

Synthetic reproduction on the actual parser:

- A structured-only case's exported row is skipped because all three BDD phases are required.
- A row containing UNIT/AUTOMATED/suite values parses without those values; the writer hardcodes FUNCTIONAL.
- One original instruction containing literal `a|b` becomes two instructions.

Pointers: `testCases.exportCsv/importCsv`, `testCaseCsvImport.ts`, case-page export handler and `test-case-export.ts`. The source comment asserting genuine round-trip is incorrect for supported case formats. Spreadsheet formula protection must remain; it is not a reason to describe a human spreadsheet export as an archival interchange format.

Accept a versioned, schema-validated lossless content format with exact arrays, multiline text, Unicode, literals, conditions, structured steps, metadata and stable identities. Label exports precisely: spreadsheet summary, case procedure interchange, or full backup. References and attachment bytes need explicit handling; never imply exported IDs alone recreate them. Identical approved reimports must not duplicate cases or overwrite human changes. Until a complete reviewed importer exists, a procedure export must explicitly say that it is not a full backup or an automatically reimportable bundle.

**Implemented local increment, not full closure:** `testCases.exportProcedure` now captures explicitly selected/filtered identities in a project-authorized repeatable-read transaction. The versioned JSON preserves literal BDD arrays and background, authored structured steps, resolved same-project shared steps, case metadata, stable prerequisite references and project-bound media labels. It omits storage URLs and attachment bytes. Missing/foreign cases, shared libraries or media references fail the whole capture instead of producing a partial file. It is bounded to 2,000 cases and 8 MiB of UTF-8 JSON, has a strict schema/decoder, and explicitly declares `importSupported: false` plus excluded datasets, histories, paid drafts and document/attachment bytes. The decoder validates the format; it does not create or update customer records. CSV now exposes stable public case references but remains a spreadsheet summary with the limitations above.

Local proof so far: six core format tests and six API-service synthetic tests passed; core build, API typecheck and owned TypeScript ESLint checks passed. Four real-router integration tests were added for a migrated disposable loopback database; the root's full-suite run owns their acceptance. Root owns selected/filtered export controls and rendered/download verification. No production deployment, full backup, importer, attachment integrity or browser-download acceptance is implied by these source checks.

### FPA-05: complete history, safe stale edits and recovery

**P1, partially implemented, important gaps remain.** `TestCaseVersion` retains BDD/structured content and physical profile. The History UI only reports summaries such as "given changed"; it does not let a user inspect the complete prior procedure, compare arbitrary versions or restore fields. The history output omits stored domain/profile, and the model does not capture all suite/automation/shared-library/dependency/dataset state. The inspected editor protects suite, priority and structured-step revision, not the complete authored BDD/content state.

The concurrent procedure writer now adds a complete `caseRevision` hash spanning all editable content, raw steps and the resolved shared procedure, and rejects a missing/stale full baseline. This closes a narrower stale-content overwrite path when validated; it does not supply the missing inspect/compare/restore UI or complete dependency/dataset version history.

Pointers: `testCases.update/history`, `testCaseVersion.ts`, `TestCaseVersionHistorySection`, dataset/shared-step routers. Authoritative snapshots exist in new manual executions and should remain unchanged by current case edits.

Accept full prior-content inspection, any-two-version comparison, change actor/time, and reviewed field/full restore as a **new revision**. A second stale tab must never overwrite newer title/BDD/conditions/tags/domain/shared-library edits. Dataset/shared-library changes need their own revision and impact review. Preserve completed run definitions and original observations. This is a more complete contract than a list of version numbers.

Documented baseline: [TestRail compare/restore, Enterprise scope](https://support.testrail.com/hc/en-us/articles/7768433966996-Test-case-versioning), [Zephyr edition-specific history](https://support.smartbear.com/zephyr/docs/en/zephyr-squad-to-zephyr-migration-guide/feature-comparison-squad-scale.html).

### FPA-06: case-centric execution history and accessible older runs

**P1, run navigation repair in progress; case-centric history missing.** The inspected `testRuns.list` defaulted to the newest twenty, maximum one hundred, without a cursor; the page supplied no higher take or pagination. Root is adding stable older/newer navigation. The inspector has definition history but no case-centric timeline linking executions, platform/build, actor, status and step observations. Users should not hunt across run rows to learn where one case last failed.

Pointers: `testRuns.list/byId`, run page, inspector History section, `manualExecution.stepHistory`, frozen run context. Step corrections already append revisions; legacy case-level results do not have equivalent append-only correction history. Keep correction distinct from a separate retest.

Accept inventories with more than forty runs, equal timestamps, interrupted sessions and deleted/archived current cases: no skipped/duplicate pages; project-pinned deep links open the exact run; old frozen instructions remain inspectable. A case timeline filters by selected platform/build/environment and distinguishes failed, blocked, skipped and never run. A retest creates a distinct execution and preserves the original failure.

Documented baseline: [Testmo case usage and repository](https://support.testmo.com/hc/en-us/articles/40464014149133-Test-Case-Repository), [Qase runs and retesting](https://docs.qase.io/en/articles/5563702-test-runs).

### FPA-07: actual parameterized execution, not just a dataset preview

**P1, authoring/preview implemented; per-row execution missing.** `testCaseDatasets.expandedPreview` substitutes placeholders in BDD arrays. The inspected manual-start snapshot and execution do not load dataset rows or create a separate execution instance per row. The UI's rendered preview is not evidence that each dataset configuration is tested.

Pointers: dataset router, manual execution and test-plan execution snapshot service, result identity/schema. Presets are reusable configurations, not automatic scheduling or multi-configuration execution.

Accept separately identified immutable row/configuration instances with concrete resolved instructions, native case identity, independent results and a reviewed expansion count/budget. Missing parameters fail visibly; later dataset edits do not alter existing runs. Prerequisite semantics must be defined per instance/configuration rather than applying a pass from the wrong configuration.

Documented baseline: [Qase parameter combinations](https://docs.qase.io/en/articles/5563704-test-cases), [PractiTest test instances and parameters](https://www.practitest.com/help/test-planning-and-execution/test-sets-and-runs/).

### FPA-08: usable scoped reporting and drill-down

**P1, frozen report foundation exists; full reporting baseline incomplete.** New source provides a reviewed report builder, retained private previews, saved definitions, approved workspace snapshots, HTML export and browser-print support. Its definition chooses audience, 7/30/90-day window and metric sections. It cannot scope the frozen report to a specific release/plan/run/environment/platform or arbitrary date interval. The separate inventory query report filters cases but leaves execution and requirements project-wide. Configurable dashboard widgets, report scheduling and cross-entity query composition are missing.

Pointers: `reportSnapshots.ts`, `reports.ts`, ReportBuilder/FrozenReport, reports routes. Approved snapshot links require existing workspace access; there is no permission-reviewed external stakeholder recipient/link workflow. This safe limit must be explicit, not silently changed to public sharing. Actual HTML download/PDF print acceptance remains unverified in the reviewed UI receipts.

Accept a stakeholder task: choose a release/platform, preview exact scope, reconcile totals, drill into contributing cases/runs/requirements and share a frozen approved snapshot with the intended authorized recipient. Unexecuted/blocked/skipped cases and unmatched automated results remain separate; as-of time and denominators are visible. Export and view must agree. Automation labels are inventory, not verified time saved; productivity needs observed execution/time data. Scheduling requires permission/redaction/delivery evidence before activation.

Documented baselines: [BrowserStack sharing and download](https://www.browserstack.com/docs/test-management/reports-and-analytics/reports/share-and-download-reports), [Xray version/plan/environment reporting](https://www.getxray.app/blog/reporting-in-scaling-qa-processes), [qTest Insights](https://docs.tricentis.com/qtest-2026.2/content/insights/insights.htm), [Allure dashboard widgets](https://docs.qameta.io/use-testops/results-and-analytics/dashboards/).

### FPA-09: shared typed queries, configurable columns and usable library scale

**P2, private saved views and sorting implemented; broader query baseline missing.** Saved views are private to one user and contain fixed fields. There is no explicit AND/OR grouping, shared/private view permission, custom case-field definitions or configurable columns. Case list and structure fetch the complete inventory into the browser. This is not the same as a bounded server-side query/page contract.

Pointers: `testCaseViews.ts`, `caseViewFiltersSchema`, case library and `reports.ts`. Keep existing no-arbitrary-SQL validation. Accept private/shared typed saved queries, server-authorized stable pagination, domain-relevant filters, selectable columns, exact export/drill-down equivalence and stale schema-field handling without silent scope changes.

Documented baseline: [PractiTest filter permission/AND/OR/columns](https://www.practitest.com/help/data-management-and-analysis/hierarchical-filter-trees/), [Testmo all/any conditions and sorting](https://support.testmo.com/hc/en-us/articles/40464014149133-Test-Case-Repository). Allure's [AQL](https://docs.qameta.io/reference/aql/) has product-specific constraints; it is not justification for exposing raw database queries.

### FPA-10: folder lifecycle, copy and non-destructive undo

**P2, case suite moves/order implemented; suite lifecycle/copy incomplete.** Suite navigation derives paths from cases; there is no independent empty-folder lifecycle or folder rename/move API in the inspected structure router. Stable case drag and keyboard move support must remain. Clone/duplicate-case and version restore workflows were not found. Archive/restore exists; permanent deletion is intentionally blocked by retained evidence.

Pointers: TestCaseTree, suite-path helpers, `testCaseStructure.ts`, case bulk controls. Accept create/rename/move empty folders, stable case references, reviewed clone semantics (new identity, original provenance, no copied historical verdicts), and safe undo/restore. Do not add destructive deletion simply to copy a competitor's trash behavior.

Documented baseline: [Testmo repository folders/copy/order](https://support.testmo.com/hc/en-us/articles/40464014149133-Test-Case-Repository), [Qase bulk operations](https://docs.qase.io/en/articles/5563704-test-cases).

### FPA-11: durable Analyze all and consistent single-action credit approval

**P2, bounded paid preview/request flow implemented; whole-selection queue missing.** Bulk analysis handles twenty cases per separately reviewed batch. It stops after the first failure, retains completed work and requires a fresh preview. It is not a durable queue for the whole selection, and has no cancellation control during the sequential loop. Single automation generation shows a cost notice but lacks the complete balance/approval/admin-request module used in bulk/risk flows.

Pointers: BulkCaseAnalysis, case action batches, automation draft section, credit-use requests. Retained paid drafts are already implemented and must not be regenerated on reopen. Accept one reviewed bounded total scope/estimate/spend limit, durable per-case state, cancellation before subsequent spend, response-loss recovery with one charge, and identical rerun reuse. Administrator acceptance is not itself a credit/seat grant. Synthetic role/cost fixtures do not prove a real paid provider charge; no paid acceptance was performed in this audit.

### FPA-12: tailored profiles are a foundation, not domain-native operations

**P2, explicit profiles/presets/frozen runs implemented; domain adapters remain incomplete.** Current source tailors game/software/HIL/process labels and run configuration. Native hardware/lab result ingestion, sample chain of custody, instrument/calibration verification, controlled protocol amendments, qualified review/signatures and domain-specific evidence reports remain outside that slice. Stack suggestions based on stored framework family are not connected-repository analysis or proof the chosen test level is best.

Pointers: domain-workflow document, quality profile resolver, test-plan execution template, manual step readings, reverse-engineering intake. Accept one complete synthetic end-to-end task per supported domain before offering it as operational: author procedure, reuse controlled plan/configuration, record distinct repetitions, inspect original evidence/corrections and produce a scoped report. Actual console capture/toolkit work remains James's deferred roadmap. Never claim certification, clinical validity, food-release authorization or hardware control from configuration alone.

## What is present and must not be regressed

Source and retained actual-component fixture receipts support: modal project profile/population screens; optional objective; seven-provider dropdown and Connect; sorting and suite navigation; private saved views; filtered/selected export scope; reviewed free bulk actions; case drag/keyboard movement; step media references; retained paid drafts/design recommendations; prerequisite graph/manual gating; frozen plan/run definitions; step observations with revision/receipt recovery; reviewed defect/task mapping and bidirectional case coverage chips; private report previews and approved frozen workspace snapshots. These are not all production-accepted features.

The read receipts `.local/workbench-ui/validation.md`, `.local/defect-map-ui/validation.md` and `.local/report-snapshot-ui/validation.md` document rendered synthetic desktop/mobile/role/retry evidence. They explicitly exclude live provider/paid output acceptance; report download and browser print were not executed. Root must separately prove the immutable deployed commit/digest and authenticated runtime. New identity/import/run-navigation fixes require their own fresh tests and rendered evidence.

## Functional superiority acceptance, not a styling claim

Use identical synthetic tasks across a documented baseline and Vaettir. Record successful completion, meaningful actions, backtracking, elapsed time, information lost, wrong-scope operations and recovery. Keyboard/mobile and Editor/Viewer/Owner are separate rows. Do not claim measured comparative improvement until the baseline is actually exercised under equivalent conditions.

Required tasks:

1. Import a mixed BDD/structured suite, verify all instructions, assign a project key and find a case by its stable reference.
2. Add conditions and a prerequisite dependency without changing the original steps; run the dependency and then the dependent case.
3. Reorder/move cases, reopen the same saved view and export exactly the approved selected scope without changing content.
4. Edit concurrently from two tabs; resolve the conflict without losing either person's authored work; inspect/compare prior content.
5. Run a parameterized plan twice on two configurations; inspect each original definition and result, including an old run beyond page two.
6. Follow a requirement/defect chip to its covered cases and actual scoped run evidence; missing evidence is not a pass.
7. Approve a credit estimate or request administrator review; interrupt and recover without a duplicate paid result.
8. Generate a release/platform-specific stakeholder snapshot, drill into its denominator and share/export the identical frozen report through the authorized path.

All required tasks must complete without dropped data, silent overwrites, tenant leakage, duplicate identities/charges or false evidence. A useful improvement then removes repeated entry/navigation, preserves scope automatically and offers a concrete evidence-backed next action. Targets for fewer actions/time should be set after measuring the equivalent baseline, not invented from screenshots. Visual identity remains Skald and Stone; competitor proprietary assets are not reused.

## Research limitations

Official public sources were refreshed for TestRail, Qase, Testmo, PractiTest, Xray, Zephyr, BrowserStack, Tricentis qTest and Allure TestOps. Some Xray documentation pages returned only a JavaScript shell; the vendor's public reporting article was readable. The Zephyr Enterprise reporting URL failed retrieval; the readable official edition comparison was used with its edition caveats. No blocked/login-only material was accessed, and no failure was bypassed. This bounded basic-workflow audit does not certify every competitor edition, integration, regulatory workflow or performance limit.

## Reviewed repair checkpoint

Source validation on October 3, before production deployment:

- Stable project-key IDs now have a database allocator/backfill, scoped lookup, prerequisite references, list/search labels and configuration before first allocation. Concurrent insertion, older-client insertion, archive/move/rename stability and rejected identity forgery pass actual disposable PostgreSQL tests.
- Padded spreadsheet headers reproduced a dropped Given/When mapping. Header normalization now preserves those cells and rejects ambiguous or missing mapped columns. Legacy CSV creation, audit, version and retry receipt are atomic; identical retry does not overwrite later human edits.
- Full-content revision checks reject stale editors. Prerequisites remain independent of BDD and structured steps. The inspector exposes recorded historical procedures and warns when imported phases are absent; it never reconstructs missing customer content. Desktop/mobile component rendering verifies both mixed procedures and incomplete original versions, including separated Edit/Close controls.
- Same-project plan/library checks and current full-seat authorization protect case creation/import. Two older tenant-reparenting fixtures were corrected with distinct project keys so their unchanged authorization assertions execute past the new uniqueness constraint.
- A versioned selected/filtered procedure JSON export retains exact supported content and IDs, with strict bounds and explicit exclusions. Spreadsheet CSV is labeled a summary, not a round-trip backup. Actual tenant-scoped export tests pass. A reviewed importer and full archival recovery remain missing.
- Older/newer run navigation uses project-pinned stable keyset ordering. Actual router tests read all 45 synthetic runs, including equal timestamps, without gaps or duplicates. This does not yet supply a case-centric execution timeline.

The full actual API suite passes 1,220 tests across 123 files; web contracts pass 168 tests and core passes 95 tests. Workspace typechecks pass; lint has zero errors and 44 warnings. These receipts establish source/fixture behavior only. Comparative task timings, remaining acceptance tasks and authenticated production acceptance are still required before claiming functional superiority.

## Subsequent functional slice: case execution history

The inspector's History tab now separates executions from authored case changes. It reads one entry per linked/planned run for the selected stable case identity, with older/newer navigation. Case outcomes remain separate from overall run status. Multiple reported results and Flaky outcomes are explicit; planned but unrecorded and partial observations are not passes. Saved manual-definition metadata, recorded platform/build and step observers are shown where available. A run starter's current profile is labelled as current, not a historical name snapshot.

Corrections remain inside their original execution. The existing manual-run link opens the frozen procedure and step revision evidence. A later passing run is not an explicitly linked retest or proof of a verified defect fix. Legacy whole-case result changes lack earlier observation history; the UI states that limitation instead of manufacturing events or substituting current case content.

The new endpoint is read-only, project/case pinned and bounded to 25 runs per page. It rechecks current membership and suspension within its transaction; foreign/deleted cursors fail explicitly. Snapshot metadata is projected without loading full procedures or artifact URLs. No source reading, AI generation, credits or customer writes are involved.

Actual disposable PostgreSQL regressions pass for pagination with equal timestamps, tenant/case/cursor isolation, archived cases, membership revocation, reparenting, suspension, unsupported metadata, frozen-content preservation, correction attribution and mixed results. The subsequent full suite passes 1,231 API tests across 124 files; core passes 98 and web 168. Workspace typechecks and lint pass with zero errors and 44 warnings. Actual-component desktop/mobile fixtures verify lazy queries, case isolation, keyboard expansion, older/newer/latest navigation and retry recovery without presenting errors as empty history.

This closes the basic case-centric read-history gap in source and fixtures, not all FPA-06 execution requirements. Explicit retest relationships, immutable whole-case observation events, parameter-row execution and production acceptance remain separate work. No measured competitor-superiority claim or deployment claim follows from this slice.

## Subsequent functional slice: reviewed case version recovery

The case inspector now provides bounded version navigation and a current-versus-selected-version comparison modal. Desktop comparison is side by side; mobile comparison stacks without horizontal page overflow. BDD instructions and structured action/data/result/response fields render as readable ordered content, not JSON-only summaries. Version authors are labelled as current profiles, not historical identity snapshots. Restore audit reasons remain visible when the case is reopened.

A full editor can select changed, supported fields and provide a required reason and confirmation. The server checks both current full-content and saved-version revisions after locking the project, case, organization, membership and relevant procedure rows. An intervening edit conflicts instead of silently overwriting authored work. Restoring creates a new version and atomic audit receipt; an identical actor-bound retry returns that receipt without another mutation. Current access is still required on retries. Case IDs, placement, prerequisites, source/import provenance, paid drafts, approvals and run evidence are not restore fields. Restoring priority creates a new manual decision with the submitted rationale and current risk context, not an invented earlier business rationale.

Versions without complete profile/media/shared-library information do not acquire fabricated values. Unsupported or missing/foreign media references are excluded from restoration, and an empty resulting procedure is rejected. A persistent audit-derived notice identifies retained approvals and derived outputs as needing an applicability review; it is a conservative warning, not a complete field-specific stale-output or recertification lifecycle.

Validation: 11 new actual disposable PostgreSQL regressions, 53 focused database-backed regressions, and the complete 1,242-test API suite across 125 files pass. Web contracts pass 169 tests; core passes 98. All seven workspace typecheck tasks pass. Lint has zero errors and 46 warnings, including the disclosed one-time preview-baseline effect warning; no rules were suppressed. The initial web regression failure depended on the removed history component name. Its coverage was moved to the actual replacement, expanded to current/saved procedure rendering, lazy reads, reviewed-field/revision checks and retry identity, and the failing test and full web suite were rerun successfully. Original diagnostic logs remain local.

Independent actual-component desktop/mobile/Editor/Viewer/keyboard/error/conflict/uncertain-retry fixtures pass 16 rendered checks with zero console errors. Those fixtures use mocked RPC; actual persistence, authorization and rollback are separately proven by PostgreSQL tests. No provider, customer or authenticated production acceptance is inferred. No new migration is introduced by this slice.

This reduces FPA-05 and the recovery portion of task 4, but does not close the full competitor baseline. TestRail documents [any-two-version comparison, field restore, version comments and shared-step version history](https://support.testrail.com/hc/en-us/articles/7768433966996-Test-case-versioning); Vaettir's accepted slice compares current content with one selected historical version and deliberately preserves unsupported shared-library state. Arbitrary historical-pair comparison, version-comment workflows and complete shared-step recovery remain open. Functional superiority still requires equivalent measured tasks, not a different appearance, a feature name or a passing source suite.

## Subsequent functional slice: arbitrary saved-version comparison

The same modal now supports a native From/To selection for any two saved versions, including versions reached through bounded metadata pages. The selected versions remain available when browsing another page. Historical comparison is explicitly read-only, shows recorded ordered procedures and field differences, and returns no current-case revision or restore authorization token. Same-version comparison shows unchanged fields. Detailed snapshot limitations remain accessible in a collapsed disclosure so mobile users can see differences before lengthy caveats.

Restoration remains a separate target-to-current review. Moving from historical comparison to restore clears the previous field selections, reason and confirmation and obtains the current comparison; a concurrent edit still conflicts at the server. Pending or uncertain restore requests freeze comparison choices and retain their original retry identity. This addition does not expand which historical media, shared-library or verification-context values are restorable.

The historical query requires freshly authorized project membership, scopes both saved versions to the same case, and preflights each snapshot's 512 KiB bound before loading procedures in a repeatable-read transaction. It reads only the current case identity, so an oversized current procedure does not prevent comparing two bounded saved snapshots. It cannot create a version or audit event, mutate the current case, or substitute for a restore request.

Actual disposable PostgreSQL validation passes 57 focused tests, including four additional arbitrary-pair, isolation, bounds and current-restore separation regressions, and the complete API suite passes 1,246 tests across 125 files. Web checks pass 170 tests; core passes 98; all seven workspace typecheck tasks pass. Lint retains zero errors and 46 disclosed warnings with no suppressed rule. After the final disclosure adjustment, the complete web/core/typecheck/lint checks were rerun. No migration changed. Rendered component fixtures remain separate from those database checks and from production acceptance.

Independent frozen-component validation passes 28 rendered desktop/mobile, Editor/Viewer, keyboard, historical paging, conflict and retry checks with zero console errors. The receipt binds the final component hash and uses synthetic RPC, not a production session or the real React Query provider. Two initial paging observations sampled the still-loading page; their original diagnostics remain local. The same assertions passed after waiting for the explicit new-page option to appear, with no application edits, arbitrary sleeps or weakened assertions. Complete snapshot caveats remain keyboard accessible while the first changed field is visible on mobile. This rendering evidence supplements, rather than replaces, the actual PostgreSQL regressions.

This closes arbitrary historical-pair comparison in source, not FPA-05 as a whole. Version comments, shared-library recovery, complete field-specific stale-output lifecycle, retest/event history, parameter execution, reporting and the other listed gaps remain open. Neither this slice nor a configuration-only native diagnostic establishes deployment or measured competitor superiority.

## Subsequent release safety correction: cached review baselines

Independent validation with the installed query library and its real provider reproduced a client-side defect missed by the earlier mocked-query fixtures: cached current-case data survived a failed or paused refresh and could be latched as the next review baseline. This hid verification errors and presented old restore controls. The server's authorization and full-content revision checks still protected writes; the diagnostic did not send a mutation or establish unauthorized persistence.

The baseline now requires an open current-case review, matching version identity and a completed query with no error, active fetch or pause. Failed refreshes keep their explicit error and retry control. Paused refreshes explain that a connection is needed and offer no restore baseline. A successful retry must supply the new comparison before approval. Existing reviewed uncertain requests keep their original retry identity; server checks and historical read-only comparisons are unchanged. The current query's zero stale time is explicit.

Actual QueryClient/QueryObserver regressions cover retained cached data after an error, paused refetch, fresh recovery and identity matching. A paused-test fixture initially replaced its query function with an incomplete observer configuration; the function is now shared with the observer, preserving every original assertion. The original diagnostic remains local. Focused checks pass 15 tests and the complete web suite passes 174, with core 98 and all seven workspace typechecks passing. Lint retains zero errors and 46 disclosed warnings; no checks were suppressed. API source and migrations are unchanged by this correction. Source, rendered synthetic-provider and authenticated deployment evidence remain separate.

Independent frozen-source rendering passes all 28 original interaction regressions and 11 additional checks using the installed TanStack Query 5.102.8 provider and actual query cache, with zero console errors. Failed historical-to-current and explicit refreshes expose Retry instead of stale restore inputs; paused queries show a waiting state, successful recovery requires fresh revision review, and Viewer/mobile and exact uncertain-request retries remain intact. RPC responses and mutations are synthetic, not production or database acceptance. Initial screenshot captures showed the previous compositor frame despite current DOM assertions; those diagnostics remain local, and equivalent states were reproduced, inspected and recaptured in separate browser calls without sleeps, source changes or weakened assertions. This correction is source-validated, not deployed.

## Subsequent functional slices: duplication, scoped reports and dataset execution

Reviewed same-project duplication now shows the complete supported authored procedure before a full-seat editor confirms a title, destination suite and rationale. A new case receives a new stable project-key ID and pending-review status. Human-authored BDD instructions, structured steps and supported physical context are copied; shared steps are materialized rather than retaining an unreviewed library dependency. Attachments, prerequisites, datasets, source links, approvals, run results and paid drafts are explicitly excluded. Atomic actor-bound receipts, source revision checks and current authorization prevent stale or duplicate writes. An unknown response retains the exact retry identity across modal close/reopen. Cached failed or paused previews cannot enable creation. Same-project single-case duplication is not folder copying or cross-project migration.

Reports now accept inclusive UTC dates and exact recorded plan, run, platform, environment and build filters. Combined filters use AND semantics. A focused preview records its denominator, contributing run references and exclusions before approval. Planned-but-unrecorded results, blocked outcomes and unmatched case results remain distinct. Automation comparisons require the same scope and stable case identities; labels do not claim verified automated execution. Defect aggregates are excluded from narrowed execution scopes where a matching run relationship is unavailable. Approved snapshots and portable exports retain the captured scope rather than recomputing it. Release scopes, schedules and advanced query/report customization remain open; the captured-entity drilldown increment below is source-only.

Dataset execution expands a saved bounded dataset into independently identified native manual runs, one per row, after configuration and resolved-procedure review. Every row freezes its values, complete BDD and structured procedure, configuration, source hashes and prerequisite closure. A prerequisite pass in another row does not unlock this row. Unresolved parameters, oversized sources, foreign shared procedures, unsupported prerequisite datasets and concurrent edits fail before starting. The whole batch commits atomically; an actor-bound retry recovers the same runs under current authorization. Historical runs and result identity guards remain intact. This is not multiple row instances within a single run; explicit prerequisite-row pairing and browser-reload recovery of the modal request remain unfinished. Manual starts consume zero AI credits and are not automated/device/provider execution proof.

The integrated actual disposable PostgreSQL suite passes 1,280 tests across 130 files; focused duplication, scoped-report and dataset regressions separately exercise tenant isolation, race rejection, bounds and retry recovery. Web contracts pass 184 and core passes 98. Actual component fixtures verify desktop/mobile procedures, approval, uncertain retries and stale-cache failures. Scoped reports additionally pass 24 checks with the installed TanStack Query provider; their RPC responses remain synthetic. No migration is introduced by these slices. A real traceability foreign-key teardown failure exposed missing organization-erasure dependency handling; the service now counts and removes project-scoped links and receipts before dependent cases, with another tenant's records verified unchanged in disposable fixtures. No production erasure was performed.

These are source and fixture increments, not deployed acceptance or exhaustive market parity. The native release build completed its core compilation but failed the unchanged strict LLVM exported-ABI gate. Its exact binary identities and missing-symbol diagnostic are retained locally. No incompatible runtime image or new production release was approved from that failure.

## Subsequent functional slices: explicit retests and captured report drilldowns

A Failed or Blocked manual case execution can now be reviewed and retested in a separate run. The modal preserves the original frozen procedure, configuration, resolved dataset row and prerequisite closure instead of substituting current case edits. It captures the original observations and immutable step-revision references at approval, keeps the original execution unchanged and copies no Pass or result into the new run. Prerequisites must pass again within the retest. This is a repeat of the original configuration, not a workflow for choosing a different build or evidence that a defect has been fixed.

Current server authorization, same-project relationships, bounded evidence, source/configuration review hashes and actor-bound atomic retry identities protect creation. A changed original observation conflicts before creation; an identical retry can recover its existing run without rewriting the original. Unsupported or incomplete original evidence fails closed. Case history and manual runs expose bounded direct original/retest links. Earlier whole-case correction events are not reconstructed: the captured outcome is explicitly identified as evidence recorded when the retest was approved. General immutable whole-case event history and reload persistence for an uncertain modal request remain open.

New report snapshots additionally capture stable case labels, priority, automation labels, contributing run timestamps/providers and per-entity outcome/planned/missing-result counts in the capture transaction. Read-only drilldowns page these frozen facts and recheck current tenant access before returning native case/run links. Deleted or unavailable records remain in captured facts and denominators without a native link. Older snapshots disclose missing historical facts rather than substituting live data. Failed or paused queries hide cached counts and links until access is freshly verified. Portable exports omit internal case/run/plan identifiers and native entity links. These counts include repeat observations, not an invented final verdict per case.

Focused disposable PostgreSQL checks pass 65 retest/execution regressions and 29 report regressions, overlapping the root's integrated full suite of 1,303 tests across 133 files. Web checks pass 189, core 98 and all seven workspace typecheck tasks pass. Lint retains zero errors and 46 disclosed warnings. Report rendering passes 12 desktop/mobile mock-RPC checks plus six additional checks with the installed TanStack Query provider and actual cache. Retest rendering independently verifies desktop/mobile procedure review, explicit approval, scope changes, failed current authorization, stale evidence and same-request recovery with the installed QueryClient. RPC rendering fixtures are synthetic; persistence and tenant gates are proven separately by database tests. No migration is introduced. No new production deployment or measured competitor-superiority claim follows from these increments.

## Release diagnosis: omitted maintained LLVM component

An actual isolated Linux build identified a concrete source-configuration omission behind the first missing ABI symbol. Debian's authenticated LLVM packaging enables PERF JIT support. Vaettir enabled LIBPFM but omitted `LLVM_USE_PERF`, excluding the real PerfJITEventListener translation unit. That maintained source passes a DILineInfoTable by value through a genuine SmallVector copy path. An isolated configuration changed only PERF enablement and its binary-directory path; all original normalized compiler commands and requested option values were checked unchanged. The real generated object compiled within a 213-command bounded dependency graph and defined the exact missing baseline template symbol. Original recipe, source and configuration hashes remained unchanged throughout the diagnostic.

The recipe now preserves PERF in both release and independent assertion-enabled configurations and verifies the generated cache, header and translation-unit presence. No aliases, invented exports, compiler/hardening changes or relaxed ABI checks were added. Object emission does not establish complete linked ABI recovery, unit acceptance or a safe runtime image. The unchanged complete release/assertion suites, strict full/stripped ABI, ARM, CPU/JIT, packaging, security, compatible migration, recovery and authenticated deployment gates remain required. Public source context: [LLVM PERF JIT listener](https://raw.githubusercontent.com/llvm/llvm-project/llvmorg-19.1.7/llvm/lib/ExecutionEngine/PerfJITEvents/PerfJITEventListener.cpp) and [conditional component inclusion](https://raw.githubusercontent.com/llvm/llvm-project/llvmorg-19.1.7/llvm/lib/ExecutionEngine/CMakeLists.txt).

## Subsequent functional slice: bounded typed case exploration

The case library now opens an in-page read-only query module with explicit all/any condition groups, allowlisted case metadata, archive scope, deterministic sorting, selectable columns and 50-row server pages. Native case links retain the stable project-key reference. Conditions cannot execute arbitrary SQL, and text contains filters treat wildcard characters literally. At most three groups and twelve conditions are accepted. Procedures, attachment references and source bodies are not returned with query metadata; long title and suite labels are explicitly clipped.

Every page rechecks current workspace membership, suspension and project ownership. Authenticated encrypted cursors bind the actor, organization, project, exact typed criteria, sort, read watermark and authoritative anchor revision. Cursors expire after fifteen minutes; changed or unavailable anchors require an explicit restart. The existing configured platform key is domain-separated for cursors, with no ephemeral-key fallback or new credential requirement. The bounded transaction and statement timeout remain server-side. This is a read-time inventory, not a frozen report: subsequent edits are excluded until restart, and metadata is not an execution verdict.

The module preserves the original table's saved views, selection, bulk actions and exports. It does not yet save or share these new grouped queries or columns, implement custom fields, replace the original whole-inventory table, or guarantee query/export equivalence. FPA-09 therefore remains partially open. This deliberately separates a useful bounded explorer from unimplemented saved/shared-query functionality.

The root's fresh migrated and seeded disposable loopback database passes the complete 1,313-test API suite across 135 files, with no skipped suites. Web contracts pass 192 and all seven workspace typecheck tasks pass; lint retains zero errors and 46 disclosed warnings. Real rendering exposed mobile title fragmentation and an overlapping condition input/Remove control; the owned component was corrected and the final 390-pixel screen inspected again. Actual query-provider/cache rendering, database persistence and deployment are separate evidence categories. No migration, customer-source intake, AI charge or production deployment is introduced by this slice. Exact predecessor checkpoint `25d90ea` also completed normal source CI successfully; that does not establish complete native-image or runtime acceptance.

## Release diagnosis: full linked native ABI recovered

The corrected `25d90eacdba18759b0b58705d96b25fa815b6b68` release-core diagnostic completed successfully in existing CodeBuild execution `vaettir-api-build:454480f0-9021-4714-8453-e72c5b1d9c1a`. Its complete candidate shared library passed the unchanged strict exported-symbol, storage, SONAME and native-dependency comparison against the authenticated Debian baseline. Both export sets contain 51,988 symbols. The candidate SHA-256 is `d8a11579f9d03d855dd529b88c749c0f6fc072bebf302cd87dd941058544c6c6`; the baseline is `3523f50f635d2a1ea47518a392451f2854b92823ceaf1345fb806099dd1a3b8a`. The actual recipe took 1,959 seconds. This independently confirms the omitted PERF component repair rather than accepting a synthetic symbol or an equal-count-only check.

The diagnostic cannot feed the runtime package graph. Complete release and independent assertion-enabled unit suites, final stripped package, native runtime, security scan, compatible migrations and authenticated deployment checks are still mandatory and unaccepted. Production is unchanged.

The resource allocator now permits at most 24 compiler jobs on sufficiently large workers while retaining the two-CPU and 4 GiB reserves, 2 GiB per compiler job, cgroup limits and one-linker ceiling. Existing 8-CPU/16-GiB LARGE workers still receive six jobs. No compilation flags, targets, unit assertions or compatibility gates changed. Resource-policy regressions and the operational source suite passed; this does not prove the full native build fits a service deadline.

Read-only AWS evidence still reports an unexplained effective 45-minute build limit despite longer requests. A faster existing-project per-build override was evaluated, not started: Linux/XLarge and Linux/2XLarge concurrency quotas are both zero in the target account/region. No quota request, new fleet, project, service or paid reservation was created. The documented worker shapes are in [AWS compute types](https://docs.aws.amazon.com/codebuild/latest/userguide/build-env-ref-compute-types.html); their availability must be verified against the actual account, not inferred from documentation.

## Subsequent functional slices: shared procedure recovery and durable analysis

Shared step libraries now retain their complete procedure snapshots, including all four step fields and media references. A focused modal supports inspecting older revisions, editing, reviewing usage impact, restoring a prior procedure as a new revision, and archiving/recovering an unused library. Completed runs keep their original instructions and observations. The additive migration captures the exact current content, whitespace and Unicode without inventing earlier edits or actors. Unsupported legacy content remains retained rather than silently normalized. Existing unreviewed update/delete writers deliberately fail closed after migration; reads remain compatible. Rollout must therefore account for mixed-version write refusal, not claim unrestricted backward write compatibility.

Current full-seat authorization, same-project media validation, complete revision hashes, explicit reasons and confirmations, atomic append-only guards and actor-bound request receipts protect changes. An actual two-transaction PostgreSQL deadlock was reproduced and repaired through consistent organization/membership/project locking. Reparenting invalidates the approval. Unknown write responses preserve the exact request through close/reopen and later denials; an initial definitive refusal permits a new review. History is bounded to 100 revisions and 8 MiB without deleting old evidence. Actual desktop/mobile rendering exposed narrow editor fields; full-width controls and wrapped actions repaired that defect. The mounted history fixture is not separate acceptance of the complete New Library page or its cached-permission entry flow.

Case analysis now persists one explicitly reviewed selection rather than relying on a browser-owned twenty-case loop. The server accepts at most 1,000 identities, records immutable input baselines and per-case outcomes, and requires an actor-bound approval of the exact maximum and test-case processing scope. The modal shows the current balance, approval or administrator-request path, saved queues, bounded outcome pages and cancellation. Work can continue after the module closes. Existing saved reviews and human/imported risk assessments are preserved. An identical creation or approval retry recovers the same queue; it does not authorize another charge.

The existing worker leases one case at a time. Fresh tenant, full-seat, suspension, source/shared-procedure and baseline gates run before reservation and again inside atomic debit. Cancellation prevents subsequent spending while an already charged attempt may finish. Definitive unpaid failures remain separate and allow only the other already-approved cases to continue; uncertain paid outcomes or interrupted leases stop for reconciliation without automatic retry. Completion means processing finished, not that every case passed or that any test was executed. Queue risk calls use a ninety-second deadline with SDK retries disabled; ordinary single-case defaults remain unchanged. No repository file is read by this queue. Actual provider calls require the user's separate explicit processing approval and were not used in validation.

Concurrent affordability checks and consumption insertion now serialize on the organization ledger. Queue receipts retain the original charge, metered usage estimate, any one-time refund and excess not charged; each case's approved cap is enforced without an extra debit above it. Actual fault fixtures were corrected to intercept the transactional ledger delegate, preserving ambiguous-charge assertions. A fresh whole-API run exposed a stale-input refusal being mislabeled unknown; the worker now performs the server-owned baseline check before the reused router, whose reservation/debit checks remain intact. Both the original failing diagnostic and the corrected full-suite receipt are retained locally.

The root's newly migrated and seeded disposable PostgreSQL database passes all 1,346 API tests across 140 files, without skipped suites. Independent AI-agent regressions pass twenty mocked-provider tests, including exact queue request bounds and unchanged ordinary behavior; core tests pass 98. Final web contracts pass 197, all seven workspace typecheck tasks pass, and lint reports zero errors and 46 disclosed warnings. Desktop/mobile fixtures use the installed query client, with persistence and money semantics separately tested against PostgreSQL. The thousand-case bound is a safety limit, not a measured production throughput claim. No customer content, production credits, provider grants or production database was changed. These slices remain source/fixture evidence until an immutable release passes the outstanding full native runtime/security, migration and authenticated rollout gates. Production is unchanged; exhaustive parity, regulatory qualification and comparative superiority remain unproven.

The final whole-suite run initially exposed a lock-observation fixture failure. A nonmutating synthetic PostgreSQL diagnostic proved that the writer was actually waiting while the observing transaction retained an earlier activity snapshot. Clearing the statistics snapshot before each poll fixes the observation, retaining the contested-lock assertion and all query/write output checks. The same failing check and complete suite then passed; the original diagnostic remains local. PostgreSQL documents the [transaction-scoped activity snapshot and explicit refresh](https://www.postgresql.org/docs/17/monitoring-stats.html#MONITORING-STATS-VIEWS). Separately, the queue timer now records real poll attempts during bounded provider work without overlapping that work or inventing healthy database/provider status.

An additional actual database regression reproduced foreign library content being returned when a project was reparented between list authorization and content loading. Authorization, collection bounds and content now share one repeatable-read transaction. The same regression verifies the original authorized snapshot, refusal of subsequent old-owner reads and visibility for the new owner. Fifty focused shared-library regressions and the subsequent complete 1,346-test run pass; the original failing evidence is retained rather than dismissed.

The queue's mounted UI passed 21 checks on its pre-style component, including exact first-50/next-23 native identities, approval, cancellation, cached-denial/offline behavior and uncertain-response recovery. A final full-width administrator-request textarea correction then passed nine affected checks on its final source hash, including paging and mobile approval. The receipt distinguishes those source hashes instead of claiming all 21 checks were repeated on the final style-only bytes. Neither synthetic role/cost/RPC fixtures nor screenshots establish production authorization, real credits or provider execution.

## October 4 source-only iteration: purpose-first report starters

The report module now starts with a native dropdown for quality status, execution progress, requirements coverage, defect/regression review, automation improvement or a custom report. Five in-page screens separate purpose, audience/title, metrics/scope, optional commentary and the frozen review. Starter selection prefills supported audience/sections and an untouched starter title; custom titles, authored notes and selected time/scope remain unchanged. Optional starter identity persists with saved definitions and captures; older definitions without it remain supported.

Commentary prompts point to existing recorded evidence and explain missing prerequisites for the requested decision. They are not generated findings. Coverage links do not claim verification, task closure does not establish a repaired deployment, and automation inventory changes do not establish executed automation or ROI. Capture remains private until the existing explicit sharing approval. No new metric formula, provider access, report schedule or external recipient access was added.

This increment is authored and UNVALIDATED: James explicitly deferred tests, typechecks, rendering, builds, AWS and deployment tonight. No prior receipt establishes acceptance of these new bytes. Morning checks must include all five screens, keyboard/mobile navigation, loading/cached-denial/offline guards, preserved authored context on template changes, saved legacy definitions, uncertain preview/save retries, exact approval behavior and matching frozen exports. The [updated sourced gap register](functional-parity-gap-register-20261004.md) still records the larger reporting/QRM gaps.

Recorded outcome bars now accompany the execution section in the frozen preview and portable HTML/print export. Every bar has an exact text count; lengths use the largest recorded count as a visual scale, not an invented pass-rate denominator. Planned-but-unrecorded pairs remain separate in the existing metric table. The export uses escaped labels and inline styling with no scripts, assets or live data fetch. Empty outcomes do not become passing results. Authored chart and starter regression files are also UNEXECUTED; desktop/mobile/print accessibility and export fidelity still need morning validation.

## October 4 source-only iteration: approved report catalog

Approved workspace snapshots now have literal title search, audience/starter filters, inclusive UTC capture dates, title/newest-capture sorting and bounded twenty-row server pages. A private preview is not a shared report; the catalog never selects preview payloads, author notes, raw source, case cohorts or credentials. The new read runs inside the existing fresh organization/membership/project authorization transaction and retains original stored organization scope. Frozen reports keep their own unchanged execution scope and metrics. Capture dates are explicitly not execution dates.

The native UI hides failed, paused, fetching and wrong-query cached pages instead of showing them as current authorized results. Saved-definition and preview selectors also withhold failed/paused cached responses. Successful sharing approval invalidates the catalog, preserving the original reviewed capture. Live catalog pagination is not an immutable search export; new captures can shift page boundaries. The project retention limit is still 500 previews/snapshots and browsing is explicitly bounded to 500 matches. Older/custom reports without starter identity remain discoverable. Unsupported future starter identities are labelled unavailable rather than inferred.

UNVALIDATED source only: four schema regressions, two real-database report catalog scenarios (pagination/filter/privacy and current suspension/revocation) and two UI source contracts were authored, none executed. Morning gates include exact wildcard/backslash literals, UTC endpoints, full pagination, original-tenant/reparent/role races, cached-denial/offline behavior, preserved report creation retries, query identity, mobile/keyboard/table sorting and exported frozen-report fidelity. No generator, database migration, typecheck, build, renderer, cloud check or deployment ran tonight. The date contract was separated into a pure Zod module so the browser does not import a database runtime through the filter schema.

## October 4 source-only iteration: reviewed approved-snapshot comparison

The catalog supports native checkbox selection of two approved snapshots across pages and an in-page comparison modal. The server requires fresh project/organization/member access to both original-tenant captures, an earlier baseline, identical project-wide or exact recorded filters, and at least one selected metric section in common. Private previews, other-tenant captures, ambiguous scope/legacy buckets and unsupported metrics fail closed. No new database model, provider call, live case/result import or spending is involved.

The modal shows original capture times, inclusive recorded run-start bounds, changing active-cohort counts and only common-section metrics. Missing optional or import-excluded evidence remains unavailable, not zero. Count changes are deliberately neutral: no automatic regression, improvement, release readiness, pass-rate, risk acceptance or productivity conclusion. Differing/overlapping execution windows and cohort changes are explicitly disclosed. Both original reports' evidence limitations are retained; their full frozen reports remain available for drill-down.

Reviewed HTML download requires explicit local review of windows, cohorts, unavailable evidence and recipients. It is an escaped, self-contained count comparison, not a new stored approval, public link, scheduled delivery or externally authenticated recipient grant. It exports no cohort/case identities or private author commentary. Existing approved snapshots are unchanged. UNVALIDATED: five pure comparison scenarios, one disposable-database authorization/privacy scenario and two export/UI contracts are authored, NOT EXECUTED. Morning validation must cover exact scope refusal, revoked/suspended/reparented membership, malformed legacy buckets, missing evidence, cross-page selection, cached-denial/offline modal behavior, keyboard/mobile layout and export fidelity. No earlier passing receipt applies to these bytes.

## October 4 source-only iteration: reusable report-definition lifecycle

The report page now offers a bounded reusable-definition catalog and two-screen in-page change review. Existing definitions remain private and active by additive defaults. Authors with a current full editor seat manage personal settings; a full-seat Owner/Admin explicitly reviews saved settings and authored commentary before sharing with current project members. Current administrators manage shared definitions, but another member cannot make someone else's definition private or recover its private historical body. Sharing settings is not approval or sharing of a captured report.

Rename, archive/reactivate and supported recorded settings restoration append immutable before/after receipts and new versions, with exact actor-bound retries and head-version CAS. Captures and prior receipts remain unchanged. Archived settings are retained, counted toward capacity and refused for new referenced captures. History is ten writes per page and supported retained bodies are bounded to16KiB. Legacy/unavailable/unsupported bodies are never reconstructed. Private historical states remain author-only even after the current definition becomes project-shared. Fifty personal definitions per author, fifty project-shared definitions and two thousand project receipts remain explicit retained-capacity bounds.

The module retains an uncertain exact request across close/reopen in mounted memory, not browser reload. Unknown transport outcomes cannot silently become a new review. An explicit server refusal permits a user-reviewed discard and refresh; it does not undo a possible prior application. Successful write acknowledgement is separated from refresh failure to avoid duplicate writes or false uncertainty. Failed, paused, fetching and wrong-page cached catalog/history bodies are withheld. Plan/provider suggestion labels are now server-bounded excerpts with original native identities retained.

UNVALIDATED: additive migration20261004070000 is authored, NOT applied/generated; nine synthetic disposable-database scenarios, three schema scenarios and three UI source contracts are authored, NOT executed. Morning gates include legacy migration compatibility, all current role/seat/suspension/reparent races, exact retry/concurrency, private-history disclosure, archive/capture separation, restore/no-op/CAS refusal, immutable old snapshots, original-organization cache invalidation, actual QueryClient offline/refusal recovery, keyboard/mobile layouts and complete relevant suites. No cloud, build, typecheck, render or deployment occurred tonight. This is not scheduling, external recipient access or complete report-governance parity.

## October 4 source-only integration: coverage and authoring presets

The explicit native requirement coverage matrix and controlled authoring preset modules are mounted in the project workspace. Requirement coverage has twenty-requirement/case/result pages, ten retained-defect pages and exact recorded execution scopes, using run-start time rather than inventing a result-recorded timestamp. It does not infer requirement fulfillment from plan contents, task closure or a passing result alone. Current links/inventory are not a frozen historical baseline; archived/unavailable/unlinked/unmatched and not-recorded/blocked/skipped evidence remain distinct. Nine database, four schema and three UI source scenarios are authored but UNEXECUTED.

Preset use is an explicitly reviewed NEW local draft with separate preconditions, procedure phases/actions/outcomes and supported typed defaults; it cannot overwrite an existing draft or case. Controlled presets have their own immutable revisions and current administrator approval. Applicability is advisory, not a regulatory/TRC certification or a proven correct test design. Both modules and their companion authored migrations remain source-only, requiring morning validation of permissions, CAS/retries, generated clients, current domain applicability, lossless procedures, unavailable dependencies and actual desktop/mobile flows.

## October 4 source-only continuation: edited reusable report settings

Reusable definitions can now be edited without saving another copy: four focused native settings screens cover purpose/audience, metric checklist/time, optional recorded scope and authored commentary, followed by full reviewed application. Existing capture and older settings receipts stay unchanged. Edits retain their source version and written content across mounted close/reopen; a newer current head requires an explicit retained-edit rebase and a new review. The reviewed version, not the latest silently fetched head, supplies write CAS. Project-visible edits again require explicit full-administrator settings/commentary approval.

Settings and historical restoration validate referenced native plans/runs in the same project, refusing foreign/deleted references rather than dropping scope. Archived records may still be renamed or retained; ordinary edits preserve the existing archive timestamp. Complete resulting history bodies remain bounded to16KiB. Shared pure definition/scope contracts avoid importing database runtime into the browser while retaining the previous captured-definition schema and hash ordering.

This source continuation is locally checkpointed as0a87d58dfb6e406dc00f5b632674daec4e0a4a88, UNVALIDATED and UNPUSHED, with fourteen report-owned files and only report-owned Prisma hunks included. Companion schemas/UI remain separately dirty and preserved. Three additional PG settings/privacy/refusal scenarios plus one schema/one UI contract are authored, bringing this report-lifecycle slice to twelve PG/four schema/four UI scenarios, all UNEXECUTED. No test/typecheck/generator/migration/render/build/cloud/deploy was run. Morning real QueryClient and role/concurrency/mobile/export gates remain required; source formatting and a commit are not functionality acceptance.

## October 4 source-only integration: recorded run comparison

A native recorded-run comparison route is mounted in project evidence navigation. Two distinct non-manual runs require a strictly earlier baseline. All five recorded status counts, missing sides, unmatched and unavailable links, bounded current case identity chips and duration availability remain separate. Provider/branch/commit agreement cannot establish equivalent configurations or historical test definitions; this module does not classify regressions, retries, flaky tests or verified fixes. Runs in progress disclose incomplete populations. Case links open current definitions, not reconstructed historic procedures.

Fresh authorization and actor/organization/project/pair fingerprints bind pagination; populations above ten thousand results per run refuse explicitly rather than return partial success. Run catalogs use twenty-row pages and mapped case unions fifty. Existing TestRun lacks historical organization identity, so current project ownership is pinned and no permanent historical-origin guarantee is invented. No schema or mutations are added. Ten PG, three schema and four UI source scenarios are authored UNEXECUTED; router/navigation mounts and the nineteen-route source expectation are also UNVALIDATED. Real cache lifecycle, role races, complete suites and desktop/mobile review remain morning work.

## October 4 source-only continuation: reviewed stakeholder CSV and detail access

Approved frozen reports and neutral approved-snapshot comparisons now have reviewed aggregate CSV source alongside HTML/print. Selected metrics, original UTC windows/scope/cohort basis and retained evidence boundaries stay explicit. Unavailable is not zero; legitimate negative count changes remain numeric. Author summary, risks, next actions and raw entity identity fields are not exported in CSV. Retained titles, scope labels and evidence notes are still internal text to review, not guaranteed secret-free merely because identity fields are omitted. This is a spreadsheet summary, not an archival interchange or recipient access grant.

A shared pure CSV encoder supplies fixed comma/quoted/CRLF/UTF-8 BOM framing and explicit text-formula protection, refusing unsupported Unicode/control/numeric values and overbound cells/rows/one-MiB files rather than truncating. Spreadsheet transformations can remove protections. HTML/CSV/print require explicit review of the exact current approved payload; a different returned payload cannot reuse an earlier review. Detail pages withhold cached content and export/link controls when fresh project/membership/get identity cannot be established, and link copy read-only rechecks original organization and approved identity before clipboard. Private previews remain separate and unexportable here.

Eleven source files are locally checkpointed810a5ac4f901f8093b8cbe88f3e9803a57bc1e02, UNVALIDATED/UNPUSHED. Four core encoder, six CSV/UI and seven detail contracts are authored UNEXECUTED; an existing synthetic API capture scenario gained original-identity assertions, also NOT run. No core build/typecheck/test/render/cloud/migration/deploy occurred. Real TanStack behavior, original-role/reparent races, browser download/clipboard activation, spreadsheet import fidelity and desktop/mobile review remain required morning gates. Separate catalog/comparison current-org cache continuation is now locally checkpointed0a1f8767e22edbccc1f8b830bcd34a5b64039cb0: six files, five static and two PostgreSQL scenarios authored UNEXECUTED. It preserves exact export review and original capture boundaries, with fresh current-parent identity echoes and org-bound selection. This is not comprehensive report governance, scheduled delivery or external sharing parity.

## October 4 source-only integration: whole typed-query CSV and human risk overview

The typed query explorer now mounts a reviewed whole-query CSV module, using the applied definition rather than its editable draft. Current project/member, returned org/project identity, compatible active custom definitions and exact selected custom projection gate the results and export. Native column reorder is retained. Changed custom selections require rerunning criteria, not silently adding fields. Retained authored criteria and uncertain saved writes survive read-access interruptions.

Whole-query exports reuse the maintained page compiler in one locked repeatable-read transaction: up to1,000 complete matches, twenty pages, selected unclipped metadata or refusal. Metadata and neutral inventory-count modes retain missing/null/invalid/empty/false/zero distinctions. Only selected current values are projected; no procedures, attachments, drafts or run history. Fresh confirmation recomputes the actor/org/project/query/schema/identity/revision/value fingerprint. Changed evidence refuses. The exact reviewed object and monotonic availability epoch, including unmount and close, gate late browser completions. The shared CSV bounds and formula-transformation caveats apply. This is not a full-fidelity backup, durable export receipt, frozen report or recipient access grant.

The human risk register now mounts a separate read-only population overview: up to1,000 entries/eight MiB bounded metadata, twenty-entry filtered pages, native case/requirement/run chips, historical captured evidence availability and separate unknown/absent/version-matching/changed ordinary review. Version matching does not reverify later procedures, requirements or result statuses. Native reference availability is not mitigation effectiveness, risk reduction, safety or qualified approval. Original/current project and member identity gates withhold cached counts and evidence. No new database models or normative scores are added for these two read-only modules; their existing typed-field/risk sources and unapplied migrations remain dependencies.

All new source and central mounts remain UNVALIDATED. Export has three schema/eleven PostgreSQL/four UI authored scenarios; overview has four pure/seven PostgreSQL/three UI authored scenarios. Explorer mount/current-schema source assertions and existing API identity assertions were authored or strengthened, not executed. Morning gates include generated clients/disposable migrations, complete current-role/tenant/data-integrity suites, real installed QueryClient mutation/cache/late-close lifecycles, actual CSV artifacts and final desktop/mobile/keyboard flows. No tests, types, builds, rendering, AWS or deployment occurred tonight.

### Native release stakeholder scope and ownership safeguards: October 4 source only

Report builder and reusable settings now offer a native release dropdown alongside plan/run/configuration/date scope. Selection resolves complete current same-project release-plan membership (at most 200 plans), then complete saved/directly linked planned cases within explicit identity/metadata bounds. Unexecuted planned cases remain in the active inventory denominator. Empty releases stay empty; incompatible plans, missing/foreign references, unsupported saved templates and overbound populations refuse rather than producing a clipped report. Other recorded filters intersect. Current authorized scope suggestions echo project/original organization and cached suggestions are withheld while current membership/project access is unavailable.

Capture retains exact resolved release-plan identities, bounded label and explanatory limitations in its immutable report payload. Comparison requires the same release identity and explicitly discloses changed frozen plan membership. Portable exports use the captured label, not an inferred historical association. This is NOT historical run-to-release certification, a release gate verdict, regulated approval, live provider verification or exhaustive parity. Native plan/release relationships are current at capture; platform filters are exact recorded context, not inferred settings. Existing approved captures remain unchanged.

Report deletion preview now distinguishes original-organization records on reparented projects from foreign-original records under current projects and foreign definition references. Existing staff-only, exact-slug erasure refuses unsupported ownership or project-set drift before deleting children. The admin preview exposes those counts/boundaries and blocks its destructive control when current verified nonblocked scope is unavailable. No live erasure occurred. General legacy deletion-log atomicity and other model ownership are not newly certified.

Private/shared saved-query and human-risk read guards are being hardened with fresh authorized organization/actor echoes, retained unknown request scope and no silent actor rebinding. These source safeguards and new authored regressions remain UNVALIDATED. No tests, typechecks, generated client/migrations, rendered review, AWS, build, push-triggered CI or deployment ran. Morning validation must include full release capture/settings/comparison/CSV, empty and foreign scope, relation/concurrent-reparent changes, complete planning denominators, current QueryClient/Clerk lifecycle, native disposable database ownership/rollback, shared/private retry and desktop/mobile walkthroughs. This source implementation does not close any acceptance gate by itself.

### Daily recorded outcome explorer: October 4 source only

A dedicated execution-over-time view adds explicit inclusive UTC dates (at most 90 days), optional exact recorded platform/environment/build filters, complete daily PASS/FAIL/reported-FLAKY/SKIP/BLOCKED result-observation counts, same-project/unmatched/unavailable mapping counts and in-progress run disclosures. Empty days become zero only after a successful complete bounded read; failures/pauses/current-actor/original-organization mismatch withhold cached evidence rather than presenting empty results. Day buttons open bounded current native run pages and deep-link to run inspection. Numeric columns accompany the common-scale colored bars; charts are not the sole evidence.

The API uses current locked tenant/member/project/actor authorization, one repeatable-read transaction, maintained recorded-scope filtering and population refusal above 20,000 runs or 100,000 result observations. An additional conservative native-ID metadata guard applies before configuration filters across the same-project UTC date window, so an overly broad interval may be refused even if exact filters would select fewer runs; narrow dates instead of accepting clipped counts. No raw notes, errors, source or artifacts are projected. Stored run start timestamps determine days, not unavailable original result timestamps. Repeated observations are not unique attempts; these counts are not regression detection, measured flakiness, throughput normalization, root-cause effectiveness or release/regulatory readiness.

The reviewed aggregate CSV retains the applied window/configuration labels and evidence boundaries, refuses unsupported/inconsistent counts, uses bounded formula-safe cells and omits raw actor/org/run/case identities. It is a read-time export, NOT an approved frozen stakeholder report or external recipient grant. The separate approved report workflow remains the route for reviewed immutable snapshots. This view does not add dashboard persistence, custom widgets, scheduled delivery or an approved daily-trend snapshot format.

All sources, central mounts and authored regressions are UNVALIDATED. No tests/types/build/render/migration/cloud/deploy ran. Morning acceptance must cover UTC/time boundaries, empty scopes, import/in-progress/mapping/duration evidence, whole-population bounds, platform/build semantics, exact actor/org reparent/revocation/token changes, actual QueryClient paused/failed/cache/refetch behavior, same-scope day pagination and keyboard/mobile/desktop/chart/CSV artifact review before claiming this functional slice accepted.

### UTC week grouping: October 4 source-only continuation

Execution-over-time now offers a native day/week dropdown. Weeks start Monday UTC;
actual included start/end dates are shown, with incomplete windows explicitly labeled
partial (including a Sunday that is still in progress). Periods retain all original
five-status/mapping/completion/duration counts, with expandable native day-run links.
No normalized velocity, unique attempt count, fixed-length equivalence or quality
verdict is inferred. Year-boundary weeks use Monday date identity, not ambiguous
year/week numbering. Unsupported calendar identities refuse weekly presentation while
the separately mounted dropdown still permits a return to daily evidence.

Only complete ordered daily bins and matching applied UTC windows can be grouped.
Missing days never become zero; inconsistent completion/duration/mapping/outcome totals
refuse the whole displayed/exported aggregate. Default daily CSV v1 is retained;
optional weekly CSV v2 carries actual period dates and partial-week/grouping boundaries.
Changing grouping cancels exact export review and the synchronous download rechecks
both current data and grouping. Four pure and one static UI scenarios are authored
UNEXECUTED. Local source checkpoint f92b96b is UNVALIDATED/UNPUSHED, no new models,
API write, client processing, tests/types/build/render/cloud/deployment. Morning
real calendar/Clerk/QueryClient/download/keyboard/mobile verification remains required.

### Recorded duration evidence: October 4 source-only continuation

The existing day/week explorer now progressively exposes exact valid recorded
duration sums, missing/invalid duration counts and completion/in-progress evidence.
An optional reviewed seven-column CSV extension preserves these fields; default
daily v1 and weekly v2 remain unchanged. Review binds the exact data, grouping and
duration choice, and inconsistent counts refuse output. This is not elapsed time,
human effort, billable cost, execution capacity or comparable performance.

Local checkpoint 52d7e43 is UNVALIDATED/UNPUSHED. Two pure and one static scenario
authored NOT RUN. No model/API writes, tests/types/build/render/cloud/deployment.
Actual authorization/cache/runtime/CSV/desktop/mobile acceptance remains open.

### Explicit execution date shortcuts: October 4 source-only continuation

The recorded-outcomes explorer offers a native optional dropdown and separate
Use shortcut dates button for today, 7/14/30/90 inclusive UTC dates and the
previous complete calendar month. Dates resolve once into editable local fields,
not a saved relative scope. Includes-today shortcuts disclose incomplete evidence.
Draft date changes do not silently alter applied views, refresh or exports; the
user still chooses Show recorded outcomes. Configuration filters stay untouched.

Local checkpoint4df0083 is UNVALIDATED/UNPUSHED. Four pure native-web and one
source UI scenario authored NOT RUN. No tests/types/build/render/cloud/deployment.
Morning calendar/auth/cache/keyboard/desktop/mobile/applied-scope acceptance remains
open. Prior separate Vitest TS aggregate tests require explicit supported discovery;
the native web MJS glob alone does not establish those scenarios passed.

### Human risk overview exports and internal prerequisite copy: October 4 source only

Human risk overview now offers a single reviewed export flow with a native CSV or
portable HTML dropdown. Complete full-project and filtered category/reference counts
stay separate, with observation UTC, literal zero and unknown/no-review distinctions,
all evidence boundaries and categorical scope. The HTML is text-only offline content
with print styling, escaping, controls/Unicode/size refusals and an asset/script-denying
CSP. Browser Print can prepare a PDF after download; Vaettir has not generated a PDF,
delivered a report or granted recipient access. Changing format, data, filters or current
authorization invalidates exact review. Literal search and per-entry/private identity
content are omitted, explicitly preventing complete search reconstruction. These are
read-time files, not approved frozen report captures, calibrated risk scores or evidence
of mitigation effectiveness, safety or regulatory approval.

Internal-prerequisite folder copying is a separate explicitly reviewed opt-in: all
selected endpoints are cloned first, then complete internal edges are mapped to the new
stable IDs atomically. Unsupported external/incoming/cross-project/self/cyclic, media,
shared-library, dataset or archived dependencies refuse the whole copy. Source edges,
human fields, paid drafts, procedures and old run evidence remain unchanged. Exact
historical receipts do not reconstruct later-deleted relationships. New relationship
provenance is separate from procedure history. This does not establish full backup,
cross-project copying or arbitrary media parity.

Local export checkpoints3cc6e65 and6e977ae plus uncommitted companion modules are
UNVALIDATED/UNPUSHED. Twelve current export scenarios and twenty internal-copy scenarios
are authored UNEXECUTED. No tests/types/build/render/cloud/deploy or migrations ran.
Morning must verify actual native module discovery, controls/CSP/download/print and
desktop/mobile/keyboard behavior, QueryClient/current Clerk/original-org access,
disposable database FK/direct-edge concurrency, exact replay and rollback, and all
relevant regressions before claiming these functional workflows accepted.

### Recorded outcome stakeholder overview: October 4 source only

Recorded outcome exports now offer a native CSV/portable HTML dropdown in the same
explicit review modal. The portable overview includes the actual applied UTC interval,
recorded configuration labels, complete selected day/week numeric counts, partial-period
and missing-evidence disclosures, common-scale supplemental bars and optional separate
recorded duration/completion table. Zero and unknown stay distinct. Offline HTML escapes
content, bounds output and denies scripts/network assets with CSP. Browser Print is an
optional user action, not a generated/delivered PDF or approved immutable capture.

Exact response, format, grouping, duration and current query revision must retain review;
refetch, closure, unmount and consumption invalidate it. No raw case/run/actor identifiers,
source, notes or errors are exported. Configuration labels may be internal and require
review before sharing. These read-time counts do not infer flakiness, unique attempts,
regressions, human effort, capacity or release/regulatory readiness.

Local checkpoint66b4dc2 is UNVALIDATED/UNPUSHED. Five pure HTML and one static UI
scenario are authored NOT RUN. No tests/types/build/render/cloud/deploy ran. Morning
must verify actual helper and wrapper discovery/runtime, full relevant regressions,
current authorization/cache transitions, download/CSP/print and desktop/mobile/keyboard
behavior before claiming this reporting workflow accepted.

### Complete current requirement matrix reports: October 4 source only

The matrix now has current Clerk actor/original organization/project/member read guards
and an explicit report modal with a native CSV/portable HTML format dropdown. It requests
the complete selected native requirement/case/outcome population in one bounded transaction,
not joined browse pages. Unlinked requirements, archived cases, title excerpts and missing,
blocked/skipped/planned-without-result evidence remain distinct. Repeated case rows retain
their outcomes while the distinct-case summary counts each case once. Report-local numbers
distinguish requirements within the file, not permanent native requirement identities.

Files omit raw identifiers, literal search, plan/run filter identifiers, source and private
result/defect content, disclosing that omitted selectors prevent full reconstruction. Titles,
public case keys and configuration labels still need recipient review. Exact fresh response,
scope, actor, format and revision/availability epoch must retain review; closure, unmount
and consumption invalidate it. HTML is text-only offline content with CSP and print styling;
CSV uses bounded formula-safe encoding. This is not an approved snapshot, complete backup,
generated/delivered PDF, external grant or evidence of historical fulfilment/readiness.

Six root web files and separate API companion work are UNVALIDATED/UNCOMMITTED. Six pure
and three static UI scenarios are authored NOT RUN; API fixture authoring/final review is
still underway. Bounds are whole-refusal above 1,000 selected rows/requirements/distinct
cases, existing bounded run/result populations, 4 MiB API metadata and 1 MiB portable files.
No tests/types/build/render/cloud/deploy/migration ran. Morning must verify actual discovery,
DB consistency and role/tenant boundaries, cache transitions, full selected rows and unique
denominators, download/CSV/CSP/print, keyboard/desktop/mobile and all relevant regressions.

### October 4 12:27 UTC source preservation update

Complete current requirement coverage API/web source is locally checkpointed at
`6e179d0` (14 files), with native plan/run dropdown scope selection at `2d8035a`
(two files). These are UNVALIDATED and UNPUSHED, not deployed features or a
standalone release candidate. Central mount/page/navigation and other source
companions remain outside these preservation commits. Nineteen new export
scenarios and two chooser source scenarios are authored, NOT RUN. No earlier
passing checks establish acceptance of these bytes.

The scope modal now offers bounded native plan/run choices with names/date/provider,
an explicit all-records choice and preserved older references. Advanced exact
references remain available when the bounded list omits a record. Project/org
echoes and current access gate suggestions and scope application; selected run
context is never guessed or automatically copied from truncated metadata.
Existing evidence, privacy, complete-row and morning acceptance gates remain.

### October 4 12:42 UTC domain authoring and procedure preview source

Local source checkpoint `f322790` adds five advisory guide/preview modules;
case-form and controlled-preset mounts remain dirty companion source, not an
independently runnable release. Five explicitly selected testing workflows
(business/SaaS, developer boundary, games/input/platform, hardware/HIL and
process/sample/laboratory) offer design, procedure and evidence prompt checklists.
These marks are local authoring reminders, not saved outcomes or approvals.
No case content, automation framework, criteria or regulation is generated or
inferred; no source access, AI credits, device connection or protocol execution.

Shared procedure and controlled-preset previews now show stored-order action,
expected data, result and response columns rather than hiding all but the action.
Custom organization labels remain; absent/null/empty expected fields are visibly
not supplied. Media reference counts do not claim to fetch or verify media.
Case setup/preconditions are not folded into executable steps. Source layout
uses native dropdowns/checklists and keyboard-scrollable table regions; real
desktop/mobile/keyboard rendering remains unverified. Six pure/static scenarios
are authored NOT RUN. No tests, types, build, cloud or deployment ran.

### October 4 12:56 UTC complete copy review and baseline integrity source

Folder copy review now uses the same complete ordered action/data/result/response
table, including explicitly absent expected fields and preserved line breaks.
Setup, Given/When/Then and prerequisite relationships remain separate. This is
an uncommitted companion mount with two additional authored, NOT RUN contracts;
desktop/mobile review and the full pending folder-copy acceptance remain open.

Manual baseline source review found that a label join could silently omit an
incompatible native requirement association. Source now performs a bounded
metadata-only completeness check before labels and refuses the whole comparison
or new capture if native links are incompatible. Historical matching successful
retry still returns its original receipt independently of later current links.
Three additional regressions are authored, NOT RUN; database and concurrency
acceptance are deferred. No market-parity, production or regulatory claim follows.

### October 4 13:08 UTC clone and history companion source review

Standalone clone now uses the same complete stored-order procedure table as
folder copy. Empty expected fields are visibly not supplied; setup and imported
Given/When/Then remain distinct. All previous clone contract scenarios remain,
with the procedure-render assertion updated to the exact table mount. One extra
static scenario is authored NOT RUN. Manual inspection also corrected four static
contract API source URLs without removing or relaxing any assertion.

Scoped case-history filtering and separately mounted retained retest drafts have
an eleven-file source freeze with eighteen authored, NOT RUN scenarios. Exact
current actor/original-organization binding on the separate legacy retest API is
still being implemented; UI access guards do not prove write isolation. A narrow
clone actor-row-lock continuation is now frozen with one additional authored,
NOT RUN contention scenario. This is source work, not race acceptance.
All new source remains unvalidated and undeployed; validation is still deferred.

### October 4 13:25 UTC lossless procedure comparison presentation

Reimport comparison source now refuses a structured table as a whole if any
ordered step has unsupported fields, invalid order, missing expected values or
overbound content. The full original raw value remains visible for review;
unsupported rows are never silently omitted. Supported values retain exact
stored order, all expected columns, explicit empty versus absent text, preserved
line breaks and every media reference. References are not fetched or verified.

Five parsing and two static presentation regressions are authored, NOT RUN.
Existing server scope, approvals, conflicts and retained requests are unchanged
by this UI increment. Native table accessibility and responsive layout remain
unvalidated source intent. Source-only work is not deployed or market parity.

### October 4 13:40 UTC scoped retest source checkpoint

Local checkpoint e6b369e contains thirteen privacy-reviewed retest files. Fresh
original-organization, current actor and full-editor checks precede private
preview or successful receipt replay. Unknown requests retain their exact UUID;
an accepted receipt is verified separately from a later history refresh failure.
Legacy omitted-scope hashes and two-field acknowledgements remain unchanged.

Retest approval now reviews original frozen field labels, exact stored step
order, every expected column, empty versus absent literal values and all media
references. Original dataset values are fully listed without filtering empty
values or consulting a subsequently edited dataset. Setup and Given/When/Then
remain distinct from ordered steps and prerequisite cases. No media is fetched
and no previous result is copied into the new run.

Twenty-five new scoped/presentation scenarios are authored, NOT RUN. Existing
manual-retest checks remain, with the modal-opening assertion strengthened to
the current active-scope gate. This local source checkpoint is unvalidated and
unpushed; it is not a deploy or a substitute for real database, mounted-query,
actor-switch, response-loss and desktop/mobile acceptance. Case-history companion
source and broader parity gaps remain separate unfinished work.

### October 4 13:55 UTC requirement review presentation checkpoint

Local source checkpoint5715e01 preserves full seven-field changed/unchanged
wording review, missing-side distinctions, searchable expandable stable case-ID
chips and truthful current-page filtering. Surrounding-whitespace title search
now binds the same canonical term as its existing server echo, without replacing
typed input or rebuilding search semantics.

Missing current requirements no longer imply removed relationships, and current
links without a captured baseline no longer imply newly added relationships.
Comparison summaries distinguish unavailable sides from an unchanged population.
Native links open current authorized same-project identities, not historical
procedures, verified fulfillment or restored links. Fourteen new presentation
scenarios are authored, NOT RUN. This is unvalidated/unpushed presentation source;
backend/migration/central companions and all runtime acceptance remain separate.

### October 4 14:11 UTC saved-query library source checkpoints

Local c377278/081e396 preserve native literal name search, personal/shared/mine
collections, deterministic ordering, metadata-only catalog reads and explicitly
bounded four-page pagination. Loaded criteria, human save drafts and exact
unknown UUIDs survive catalog navigation. Both catalog and independently loaded
definition reads bind original workspace/account scope; current authorization,
not response echoes or supplied IDs, remains authority.

Source review found and repaired an introduced read-only seat regression without
changing existing write assertions: supported current members retain reads;
only current full editor seats can write or replay. Twenty-four new scenarios
are authored NOT RUN. These local checkpoints are unvalidated and unpushed;
companion schema/migration/Explorer sources and installed QueryClient/Clerk
desktop/mobile acceptance remain separate. This does not close cross-entity
queries, configurable dashboards, reload-durable drafts or measured parity.

### October 4 14:45 UTC whole-case observation revision source

New source connects native manual whole-case history and a reviewed initial/correction
modal to the existing run UI. Corrections require a current evidence baseline,
reason, current-head CAS and an actor-bound exact receipt; prior observations and
frozen procedure/configuration remain separate. An older mutable result is captured
at its first correction with original recorder/time explicitly unknown, not backfilled.
Busy/unknown responses block local run completion and step switching; mounted drafts
and original requests survive collapse. Quick initial recording remains explicitly
unversioned and cannot overwrite a displayed existing observation.

Source-only guards separate whole-case revisions from step-derived verdicts, protect
mixed-version native projections, bound cumulative retained history and restrict
history erasure to the complete authorized original-organization transaction.
The additive0800 migration has not run. Local897decd/3a73096 and35 authored NOT-RUN
scenarios are unvalidated/unpushed; schema, central mount and erasure/admin companions
remain dirty outside those commits. Real native/runtime, disposable migration,
authorization, concurrency, exact retry and desktop/mobile acceptance remain open.
These are human evidence corrections, not new executions, defect-resolution proof,
automation improvement metrics or qualified regulatory signatures.

### October 5 hands-on competitor and recurring-complaint review

Status: partial hands-on evaluation and local source implementation, NOT full parity
acceptance or deployment. James completed trial registration/authentication. Qase,
TestRail and Testmo authenticated workspaces were inspected in Chrome using only
vendor sample data. No client cases, source code, provider keys or payment details
were uploaded, and no teammates were invited. Local screenshots remain ignored
under `.local/assistant-history/parity-20261005/`.

Directly observed:

- Qase: searchable suite hierarchy, separate Review navigation, case metadata
  dropdowns, prose description/pre/postconditions, comments, and aligned
  action/data/expected-result steps. Project settings expose field visibility;
  workspace definitions distinguish paragraph fields from single-select fields.
  Run creation offers repository, plan and saved-query selection. Select-all
  selected all 51 vendor sample cases, and one synthetic walkthrough run was
  created. Its UI exposes export, team statistics, timeline and execution views.
- TestRail: vendor-generated sample project, visual run outcome bars and counts,
  open/completed groups, creator/date, passed rate separate from untested count,
  run progress/activity/report routes. Creation offers all, specific cases and
  dynamic filtering. No new TestRail run or notifications were submitted.
- Testmo: vendor-generated Space Shuttle sample, milestone/run activity summaries,
  manual/automation/exploratory navigation, run summary metrics, tags, search,
  multi-run and export controls. Run creation exposes all/specific cases plus
  configuration and milestone. Those controls were inspected, not all exercised.

Recurring feedback sampled from [Qase G2 reviews](https://www.g2.com/products/qase/reviews),
[TestRail G2 reviews](https://www.g2.com/products/testrail/reviews) and
[Testmo G2 reviews](https://www.g2.com/products/testmo/reviews): organization,
clear progress and consolidated workflows are praised. Reporting flexibility,
large-suite speed and customization recur as weaknesses. Testmo reviewers also
raise search, fixed-size layouts, editing and sidebar-only case links; TestRail
reviewers raise navigation and collaboration friction. These are qualitative
review signals, not measured defect rates. Some Qase/TestRail reviews are
incentivized; Testmo's sampled October 2025 reviews include organic reviews.
Older complaints are hypotheses to reproduce against current trials, not proof
the current vendor still has the defect. Competing vendors' comparison blogs are
not independent validation.

Gartner's [Critical Capabilities abstract](https://www.gartner.com/en/documents/7022898)
distinguishes functional evaluation from overall vendor positioning. Its
AI-augmented testing scope is broader than a test-case UI. Public
[TestRail Peer Insights snippets](https://www.gartner.com/reviews/product/testrail)
mention graphical progress and customization; complete review/report access was
unavailable. No claim that Gartner endorses these exact UI patterns or that Qase,
TestRail or Testmo occupies a particular Magic Quadrant position is made.

| Improvement target | Vaettir design decision | Required acceptance, not yet assumed passing |
| --- | --- | --- |
| Too many clicks selecting large suites | Explicit all/filter/suite additions; counts and bounded durable queue approval | All 851 synthetic cases reachable, exact count, no silent truncation, unknown acknowledgements reuse the original request |
| Rigid, unclear reporting | Outcome distributions, recorded percentage, remaining count, timestamps and exports; state the population covered | CSV matches current scoped population, formula-safe cells, empty/error states, mobile layout and authenticated tenant checks |
| Pass rate mistaken for completion | Separate recorded outcomes, pass rate, untested work and release gates; CI planned total remains unknown without evidence | Failed/blocked/skipped runs never look approved merely because all results were recorded |
| Awkward customization | Typed case fields; retain prose where it carries meaning; hide irrelevant compliance by supported profile without deleting values | Hidden fields survive toggles/reimport, existing mappings remain discoverable, invalid options refused |
| Lost context in step descriptions | Tester action next to its own technical behavior and expected response; datasets remain separate | Step order/identity, complete procedures and frozen run evidence survive edits and reimport |
| Limited collaboration | Plain-text authenticated comments including read-only members, separate from case editing | Current membership, cross-tenant denial, suspended/revoked access, paging, duplicate-request and erasure tests |
| Sidebar-only navigation and difficult lookup | Stable full case URLs, optional inspector, searchable/sortable prerequisite selection and ID chips | Direct links/reload/back navigation, keyboard interaction, 851-case search/paging and retained edits |
| Large-suite responsiveness | Bounded reads/queues and deliberate rendering; no client source processing implied | Measure large fixtures rather than infer performance from types or small sample data; cursor-scale work beyond 1,000 remains open |

Current local run-card and execution-summary components were rendered with
synthetic data. Desktop display, a 390px mobile view without horizontal overflow,
and a downloaded five-case outcome CSV were observed. This does not test the full
authenticated run page or production backend. Release date, run-progress and
851-case snapshot focused tests passed (13). Broader fixtures, migration/security,
native/runtime, release and authenticated production gates remain separate.

Integrated October 5 source checkpoint: 41 focused API tests passed across run
progress, manual-start authorization, release-input parsing, snapshot bounds,
collaboration parsing and production-signal full-seat access. Both API and Web
typechecks passed after integration. Library, prerequisite, helper and mounted-page
retry checks also passed. Comments and atomic release creation have authored
native database fixtures that have NOT run. The additive CaseComment migration
has NOT run; its original-tenant erasure triggers require native validation.
Release inputs changed and require a coordinated API/Web rollout. No production
mutation, deployment or new passing full native/runtime gate is implied.

Full local Web suite subsequently passed 572 Node checks plus 48 typed checks
(620 total, zero skips). The initial run exposed one source-contract failure
caused by line wrapping of unchanged native read guards. Contract-compatible
formatting was restored without weakening assertions, response limits, locks
or procedure coverage. This remains local source proof, not deployment.

Current SSE-135/P9-00 was read through authenticated Chrome; the API connector
remains unauthorized. Open user requirements remain tracked here: full
configurable project field profiles, global/multi-run reporting
beyond a displayed page, whole-suite queue scope beyond bounded 1,000-case batches,
Windows signed distribution/device acceptance, and full rendered end-to-end
acceptance. Neither competitor trial access nor source presence closes them.

### October 5 continued user-feedback work, not a stop-at-checkpoint

James clarified that all reported workflows remain in scope: competitor demos,
case authoring/review, bulk actions, execution/reporting, release planning/gates
and helper usability. The existing 15-minute continuation is active with this
scope; routine questions and source checkpoints are not stop instructions.

Hands-on continuation observed Qase's project-level milestone/steps/tags/input
data visibility and Classic/Gherkin defaults, plus its searchable review-request
page. Testmo's run execution exposes folder navigation, search, status, activity
and case links; TestRail keeps blocked/untested work distinct in release-plan
summaries. Vendor samples only; no settings, results or processing were submitted.

New coherent source slice:

- Library run configuration keeps its exact 1,000-case selection, UUID/context
  and original actor/workspace through mounted close/reopen and unknown ACKs.
  Scoped server acknowledgements are verified before navigating. Existing
  unscoped clients remain compatible; their historical attribution is not invented.
- An additional real blocker was found: execution reads and separate retests
  still capped original runs at 500. Their outer case scopes now support 1,000;
  nested 500-step, native byte/head/graph and authorization limits remain intact.
  Actual service code was exercised with mocked 851/1,000/1,001-case preflights,
  not a PostgreSQL or authenticated production acceptance test.
- Manual cards now link to actual execution instead of an empty results table.
  Search, status and next-untested navigation retain mounted rows and drafts.
  Bounded current-record JSON exports preserve present procedures/context/
  observations, not full history or media. CI comparisons are still labeled CI.
- Tag chips preserve literal arrays, including comma-containing saved tags.
  Four aligned step fields are multiline, and expected response appears in the
  frozen step-result dialog. Comments have a mounted, keyboard-reachable tab.
- The dedicated review queue now has stable IDs, search, sorting and 25-item
  pages, excludes archived pending cases and withholds stale failed-read bodies.
  Modified case-link clicks retain normal browser new-tab behavior. Drag-down
  anchors stay in their persisted suite; archived targets cannot accept drops.
- Built-in project preferences persist in a separate quality-profile sibling,
  without changing strict experience v1 or adding a migration. AUTO/SHOW/HIDE
  and preferred type/domain choices retain populated fields, custom labels,
  supported saved choices and unknown siblings. Current FULL Owner/Admin,
  complete-profile CAS, bounded native JSON size and exact UUID replay guard
  configuration. Settings are mounted independently of the Library actions
  dialog; no browser-reload persistence is claimed.
- Release wizard draft criteria support Edit/Save/Cancel/Clear and explicit
  named-plan/criterion limits. Workspace attachment presents only unassigned
  plans, with truthful links to other assignments and discoverable plan/criteria
  actions. It no longer promises a target-date editor that does not exist.

Integrated local checks: API/Web types pass, full Web 655 checks pass with zero
skips, eight focused API suites/77 tests pass. Initial full Web source contracts
failed after formatting; they now ignore trivia only while retaining identifiers,
operators, strings/template identities, mounted history and private-read gates.
Negative tests reject weakened guards. No original acceptance assertion was removed.

Actual synthetic components: tag Enter/Backspace round-trip retained literal
comma/whitespace tags; paired technical behavior and multiline response were
visible; current-record JSON downloaded with five cases/five frozen definitions.
390px layout had no page-level horizontal overflow. These are component fixtures,
not the complete authenticated library, run, comment or configuration workflows.

Still open: persisted criterion text editing with audited history/CAS; server
assignment race protection beyond the unassigned picker; genuine manual-run
comparison and all-pages reporting; plan-led/dataset 500-case expansion limits;
cross-entity tag views; source-derived group drag semantics; browser reload draft
recovery; signed Windows/device acceptance and full native/rendered integration.
The new preferences and other source fixes are NOT deployed. Prior failed
native/runtime/migration/security/production release evidence remains unchanged.

#### Dated complaint recheck, October 5

Old reviews are not a current defect inventory. Testmo's
[current changelog](https://support.testmo.com/hc/en-us/articles/38044957362317-Changelog)
records regular case/search links and ID search in 2022-2023, a May 2026 fix
for bulk edits including previously deselected cases and tag underscore loss,
and August fixes for slow case edits and incomplete BDD-plus-Steps exports.
Its current trial also exposes case links and search. An October 2025 complaint
about sidebar-only navigation cannot therefore establish that normal new-tab
links or search are absent today. Use these complaints to test Vaettir's actual
selection, literal tags, complete procedure export and navigation instead.

[Testmo run selection documentation](https://support.testmo.com/hc/en-us/articles/47544002336653-Test-Runs)
distinguishes browsing a folder from adding it and exposes explicit Set/Add/Remove
filter selection with counts. [Qase export documentation](https://docs.qase.io/en/articles/5563717-export-test-cases)
states that applied filters carry into exports. Vaettir should distinguish
replace/add/remove selection and label whether an export covers the whole saved
run or only a filter; it must never silently infer scope from what is on screen.
These are documented patterns, not proof each vendor route was exercised.

The sampled [Qase reviews](https://www.g2.com/products/qase/reviews) include April
2026 requests for smoother large-suite filtering and more flexible reporting,
often seller-invited/incentivized. The sampled
[Testmo reviews](https://www.g2.com/products/testmo/reviews) include organic
October 2025 requests for better selection, editing and layouts. They support
prioritizing usability measurements, not a quantified market consensus or an
unsupported claim that Gartner endorses a particular control.

#### Continued parallel source repairs, October 5 Pacific / October 6 UTC

- Case step editing now distinguishes retained NULL from explicit empty text.
  Missing-action rows with retained technical/result/media content refuse at
  their exact index. Only entirely empty new placeholders are omitted. Saved
  Given/When/Then empties, whitespace, duplicates and multiline text survive
  unrelated edits and reordering without trim-based deletion.
- Run selection offers explicit Set/Add/Remove on current loaded approved
  scopes, with exact added/removed/result counts. Missing suite scopes refuse
  instead of falling back to other cases. Pending unknown-ACK requests remain
  immutable; over-1,000 results refuse atomically, not partially selected.
- A printable offline current-run HTML export preserves paired step fields,
  phases, prerequisites separately, present observations and step heads. Text
  is escaped, active content/external fetches disabled, and output is bounded
  to 8 MiB with no truncation. A five-case synthetic component export downloaded
  and its rendered summary/procedure text was observed. Printing/PDF, all
  authenticated page states and production delivery are not acceptance proof.
- Dedicated governed criterion-wording/unassigned-plan writes retain complete
  bounded before/after plan scalar and native-criteria snapshots linked to a
  plan version. Current original actor/FULL-editor locks, exact UUID receipt
  replay before CAS, null-assignment protection and native byte checks guard
  these paths. Approved/archived plans and ready/shipped releases require
  explicit reopening. Old TestPlanVersion records lack criteria/assignment;
  these new entries do not invent historical snapshots or case procedures.
- A separate manual comparison reads two complete supported frozen runs,
  distinguishing a case absent from a saved scope from a planned case with no
  verdict. Changed definitions/configuration and unfinished work are explicit;
  conflicting results refuse instead of guessing a last writer. Fifty-row
  pages/exports are pair-hash-bound, not all-history exports. Current friendly
  ID labels are not misrepresented as captured historical labels.

Independent audit found remaining correctness work before release acceptance:
legacy criterion-status handlers resend cached description/requirement fields
and can overwrite newer governed wording; legacy add/delete criteria do not
produce the new complete governance history. Plan details still lack the new
guarded wording/history controls, and their generic array editor splits commas
and trims retained prose. Fix these coherent authoring paths next; do not treat
the new guarded endpoints as proof all older routes are safe or deployed.
Full field parity, global multi-run dashboard scope, separate plan/dataset
500-case limits, native concurrency/recovery, signed Windows/device and full
authenticated rendered acceptance remain open. New governance native fixtures
are explicit-opt-in source only and have NOT run; no migration or deployment.

Integrated local source validation for this continuation: full Web 644 Node
plus 48 typed checks (692 total, zero skips), 106 focused API pure/mocked checks
and API/Web typechecks pass. An intermediate full Web run failed the old
client-only attachment assertion; it now checks the equivalent unassigned
picker, fresh preview and native null-assignment CAS instead. Initial portable
report and exported-hook type errors were corrected, not waived. Native fixtures
were not invoked; no full API/native/runtime/production acceptance is inferred.

Further signed-in Qase field inspection observed system single-select fields,
paragraph Description/Pre-conditions/Post-conditions and a searched/sorted
workspace field list. Its unsaved custom-field dialog exposed Number, Short
text, Paragraph, single/multi-select, Checkbox, Radio, User picker, URL and
Date picker, plus project applicability, placeholder/default, required and
order controls. The dialog was cancelled without creating/changing any field.
Vaettir's supported native TEXT control now uses a multiline textarea without
changing its stored type, 2,000-character limit or original-scope CAS/retry
contract. Nine focused source/component tests pass; this does not establish
complete Qase field parity or authenticated rendered acceptance.

Follow-up coherence repair: both plan and release criterion surfaces now mount
the scoped wording, verdict and governance-history controls. Verdict-only writes
preserve wording/requirement links and use the same bounded revision/UUID/audit
protocol; computed case-evidence decisions cannot be manually substituted.
The legacy status route retains its input shape but treats raw wording and an
optional requirement as locked expectations and changes only status. Mismatches
refuse; it does not invent durable UUID, original-verdict CAS or full history.
Broader legacy criterion add/delete governance remains a separate open gap.

Generic plan fields now use exact multiline string/list rows, native Boolean
controls and finite-number input, retaining unknown or unsupported values
read-only. Synthetic browser interaction preserved commas/newlines/whitespace,
removed only one duplicate row, retained an unknown JSON sibling and refused
an overflowing number without replacing zero. QA-strategy's separate mismatch
filtering and the legacy plan-header write concurrency model are still open.

Test Runs now offers an explicitly loaded all-pages recorded dashboard using
the existing bounded trend reader. It retains draft dates/filters on collapse,
suppresses hidden portal/export/read activity and requires fresh original access
on reopen. It counts recorded observations across the applied UTC run-start
window, not global manual planned cases or remaining work. No new aggregate
query, native scope limit or raw-result denominator was invented.

Fresh integrated source checks: 666 Node plus 48 typed Web tests (714 total,
zero skips), 115 focused API pure/mocked checks and API/Web types pass. The
initial nullable TEXT display type error was corrected while retaining raw
stored values. New native fixtures remain authored NOT RUN. No deployment,
database/customer/provider/security mutation or passing runtime acceptance.

### Further complaint recheck and mounted plan drafts, October 5 Pacific

[TestRail G2 reviews](https://www.g2.com/products/testrail/reviews) include an
organic March 24, 2026 report of slow library navigation/search/bulk updates,
an organic January 7 report of awkward case reuse, and a November 25, 2025
incentivized review describing limited report customization and large-project
loading. These are qualitative workflow signals, not a measured prevalence,
an October 2026 defect reproduction or proof Vaettir performs better.

The vendor's [10.7 release notes](https://support.testrail.com/hc/en-us/articles/52231138481684-TestRail-10-7-0-Default-1021)
describe asynchronous run-statistic recalculation after bulk operations,
improved search/report handling and unsaved-change warnings in Administration
and My Settings. Statistics can briefly lag those operations. Therefore older
complaints must be checked against the current trial, and Vaettir dashboards
must identify observed scope/as-of state rather than claim instant completeness.

[Qase's current user documentation](https://docs.qase.io/en/articles/5563739-users)
explicitly allows Collaborator seats to view permitted entities and comment on
cases, defects and case reviews while prohibiting entity editing. This supports
James's requested separation of discussion from case-authoring permission; it
does not justify widening tenant access or changing live seat policies.

A [Gartner Peer Insights TestRail listing](https://www.gartner.com/reviews/product/testrail)
surfaced in search, but direct retrieval is robots-blocked and excerpts contain
placeholder/repeated material. No complete Gartner review or Magic Quadrant
feature endorsement was verified. It is not used as a feature acceptance gate.

Root follow-up source keeps plan errors inline instead of replacing the entire
page and unmounting governed editors. Read-only hiding retains mounted form
children; pending header saves disable the full field group. Deliberately empty
description differs from untouched native NULL. Plan identity keys prevent one
plan's local form from being rebound to another plan. Four actual-source React
handler/tree checks pass. These controls do not make drafts durable across
drawer closure, route removal or browser restart, and do not fix the legacy
header write's missing native CAS/UUID receipt. Those remain explicit gaps.

Further actual TestRail trial observation: the synthetic vendor sample run list
shows distinct open/completed groups, dated authorship, milestone dates, outcome
counts and linked outcome bars. One sample has 89 passed, 21 blocked, 113
untested, 17 retest and 12 failed, with a 35% label. Arithmetic indicates this
label is the passed share (89/252), not the recorded share (139/252); this is
an inference from displayed values, not a measured performance result. Vaettir
must label its denominators and not equate a recorded/blocked/skipped case with
a passing case or a release-ready decision.

The unsaved Add Test Run screen offered all cases with future automatic
inclusion, explicit specific-case selection, and dynamic filters that include
new matching cases until closure. Its specific picker exposed section bulk
checkboxes, All/None, configurable columns, selection filters and all/any
matching. Both picker and run draft were cancelled; no run/notification was
created. Vaettir's approved frozen run scope intentionally does not auto-admit
new cases after start. A future reusable dynamic selection should be explicitly
reviewed at each new run, not mutate retained execution definitions.

### Integrated parallel continuation, October 5 Pacific / October 6 UTC

Plan and release pages now mount one governed criterion collection instead of
the legacy add/remove controls and unbounded requirement dropdown. The new
operations add a client-identified PENDING criterion, explicitly remove the
reviewed native row with complete retained history, or link/unlink a requirement
from the same project. Original actor/FULL-seat locks, full-plan and criterion
revision checks, exact UUID replay and complete before/after snapshots remain
required. Requirement search pages 25 IDs/titles with native byte admission.
Raw multiline wording is not trimmed. Existing associations are seeded and
before/after choices shown before confirmation. Legacy API add/delete endpoints
remain separate unprotected compatibility gaps; no executable Web callers remain.

QA strategy fields no longer filter mixed arrays or convert unsupported native
values into empty writable lists. Such fields retain their complete original
value read-only. Supported rows preserve empty, repeated, comma-bearing and
multiline text with local stable row identities. The generic plan string lists
use the same identity behavior. Delayed rule-based suggestions refuse changed
fields/siblings, project, mounted epoch or signed-in session; an older result
cannot overwrite a newer notice/loading state. This does not add provider
processing permission or fix the legacy whole-plan write's missing native CAS.

The all-pages dashboard now has a separate manual progress reader for the same
explicitly applied date/configuration scope. It counts supported frozen run-case
instances from matching current whole-case or complete step heads, not raw result
rows or sums of the visible history page. Partial steps remain unfinished;
blocked/skipped outcomes remain recorded, not passed. Legacy/untracked, duplicate
or inconsistent runs are excluded with explicit reason counts, not counted as
untested or complete. Actual foreign native references refuse the whole query.
Native count/byte preflights, a 90-day window, 1,000 instances per run and 100,000
instances per cohort bound the query; procedure bodies and notes are not loaded.
This is a current status summary, not an approved immutable stakeholder snapshot
or complete procedure validation. Its native SQL has NOT been executed.

Manual summary cards, separate outcome colors, all daily totals, exclusions,
as-of time and exact scope render from synthetic actual components. A 2,704-byte
synthetic summary CSV was downloaded; counts and formula-safe configuration text
were inspected. The real query wrapper separately refuses cached data after
reopening/session recovery until a newer read revision, and requires explicit
fresh export review. Neither the synthetic download nor mocked wrapper tests
prove authenticated/native production behavior. No printing/PDF acceptance added.

Case field definitions now have explicit Up/Down draft ordering with stable
keys, preserved unfinished field edits and exact option objects. Order changes
invalidate impact confirmation and still require the existing reviewed schema
CAS/UUID save. No native field shape/type/value was extended. The typed-field
database guard permits five types and scalar values; real multi-select/user
references require a separate additive migration and recovery design, not fake
comma-separated strings. Existing DATE/required controls and reviewed create-only
presets already exist. Signed Windows distribution/OS-policy/device acceptance,
cross-entity tag views and larger-than-1,000 queue scope remain open.

The current durable queue source accepts the reported 851-case selection under
its 1,000-case limit. The 20-case cap belongs to an unused legacy credit-request
endpoint; it is not the queue admission cap. Real large-scope review performance,
provider output and deployed UI are unverified. Consent, one reviewed upper spend,
current full-editor access, cancellation and unknown-charge/no-auto-retry rules
remain mandatory. No paid analysis job was started by this audit.

The version helper now distinguishes explicit native JSON null from an omitted
legacy execution template, preserving JSON null through the explicit Prisma
sentinel instead of converting it to `{}`. Nine mock capture tests verify input
retention; native JSON-null persistence has NOT been exercised.

Root integrated checks: 700 Node plus 48 typed Web checks (748 total, zero skips),
159 focused API pure/mocked checks and API/Web types pass. Post-review presentation
copy remains covered by the actual visual/export/controller tests. One initial
dashboard source contract rejected changed explanatory copy; the original
observation-denominator disclaimer was restored and all original assertions pass.
An initially incorrect release refresh callback name was corrected before final
types. No native fixture, migration, cloud/customer/identity/security/provider
mutation, main merge or deployment, and no earlier failed release gate is cleared.

Final request-encoding review found that making the existing criterion-edit
parser raw by default could change historical accepted UUID hashes for older
clients that submitted padded prose. New wording drafts now explicitly send
`wordingMode: "EXACT"`; no marker/default is injected into retained or older
requests. Unmarked requests keep the original trim-before-length parsing and
hash behavior, so accepted UUID replay remains unchanged. New exact edits and
new ADD operations retain raw multiline text. Mocked historical replay, raw
marked hash/ACK and actual source-controller tests pass; native replay remains
unverified. No receipt format, scope, authorization or CAS was weakened.

Final integrated source after the explicit encoding fix: 702 Node plus 48 typed
Web checks (750 total, zero skips), 162 focused API pure/mocked checks and API/Web
typechecks pass. These are local source receipts only; no native SQL/migration,
full runtime/image-security, authenticated production or deployment gate is closed.

October 6 01:45 UTC continuation: obsolete criterion add/delete endpoints now
refuse writes without any database or private-body lookup. Their public input
and output contracts remain compatible, but authenticated clients must review
current state and use the governed operations. The refusal explicitly warns that
an earlier unknown acknowledgement may already have applied; refresh available
history before a newly reviewed request, never automatically resubmit. Eight new
mocked router checks and 51 combined governance/version/router checks pass. No
native execution or historical receipt recovery is implied.

The 851-case risk preparation audit found repeated per-case scope, credit and
paid-history reads. Its estimated logical database operations are not a native
SQL trace or performance measurement. REVIEW and APPROVE have separate sequential
bottlenecks; optimizing one does not establish end-to-end large-suite usability.
The next bounded foundation shares the exact existing risk-input hash rather
than changing provider context, paid-cache identity, spending, consent or limits.
Project-specific field-control presentation and governed plan-header writes are
being developed in separate ownership lanes. No additional native field types,
database operations, paid jobs or Windows security bypass are authorized here.

October 6 02:40 UTC integrated source continuation:

- Project-specific custom-field controls now have a distinct settings service,
  Owner/Admin review panel and case-editor integration. The new sibling preserves
  other project context and uses current native original actor/tenant checks,
  raw profile/schema CAS, exact UUID recovery and bounded native byte admission.
  Native field types, values, defaults and existing receipts are unchanged.
- Text can use a single-line or paragraph control; choices can use dropdowns or
  radio groups; Boolean controls distinguish missing, NULL and false. Existing
  multiline text falls back to a paragraph without browser normalization. Only
  truly absent optional keys can hide, with an explicit reveal action. Invalid
  numeric spelling stays in its local buffer and immediately blocks saving,
  rather than silently submitting the last valid number. First style admission
  requires a completed mount read; later preferences do not reseed a field draft.
- Field forms now stay mounted across pending responses and access loss. Busy,
  draft, confirmation and receipt references prevent duplicate UUIDs or stale
  same-event saves. Exact known acknowledgements can settle only their own
  request privately; visible effects require the original current frame. Unknown
  responses retain the frozen body. Reload-persistent recovery remains open.
- Plan names/descriptions now use a dedicated reviewed operation. Exact raw
  prose, omitted fields, empty text and native NULL remain distinct, including
  switching description controls without losing unsaved text. Complete native
  revisions, audit/version snapshots and frozen-state refusal remain mandatory.
  Obsolete mixed header writes refuse before private lookup or partial mutation.
- Plan/history reads retain non-object root JSON rather than rejecting the
  whole response. Current authorization and native body/count/structure admission
  precede materialization; foreign strategy/linked-plan bodies are refused.
  Whole-plan bounds are 128 KiB and 200 criteria/links; whole legacy history is
  500 versions/16 MiB, not a silently truncated page. Errors cannot masquerade
  as an empty history. Non-object metadata is read-only; status-only saves omit
  metadata, and explicit legacy replacement is refused. Ordinary records retain
  reserved and unknown own keys. Legacy status/JSON CAS/UUID, paged legacy history
  and complete browser-actor integration remain separate open work.
- Risk-input extraction preserves the exact existing paid-cache bytes/hash and
  provider context. A strongly admitted, opt-in 851-case REVIEW/replay fixture
  is authored but NOT RUN; it makes no approval/provider/charge call and performs
  no destructive cleanup. Actual large-suite batching and timing remain open.
- Chrome exercised actual synthetic controls: invalid numeric text kept the
  prior native number and disabled the disconnected save affordance; `2.00`
  stayed visible while its native value was 2; explicit false and revealing an
  absent field preserved exact values without creating a key. Desktop field
  layout is now a compact responsive grid. No authenticated API/save, native
  persistence or mobile acceptance follows from this synthetic browser work.
- The original 809-byte Windows launcher still exists with inherited allow
  permissions for James and an Internet ZoneId=3 marker. This does NOT identify
  the blocking Windows policy. No unblock, antivirus/policy change or installer
  execution occurred; signed distribution/actual OS/device acceptance stay open.

Final integrated checks: 741 Node + 66 typed Web checks (807 total, zero skips),
215 focused API pure/mocked checks and API/Web typechecks pass. Source-contract
failures for the obsolete mixed-header payload were replaced with exact
status/explicit-metadata-only assertions and negative header-resend guards, not
removed coverage. A NULL ternary formatting match and an incorrect sibling
import path were corrected before passing checks. Focused lint had no errors;
two existing effect-state warnings remain in the field editor integration.
Native SQL, authored fixtures, migrations, full runtime/image-security,
authenticated production and deployment remain unverified; earlier failed
native/release gates are not cleared. These are source-only changes on the
existing codex branch, not a completion claim for all reported workflows.

October 6 03:22 UTC continuing parallel source integration:

- Whole-suite RISK review preparation now uses at most 32 cases per batch and
  fixed paid-status flags rather than re-reading permissions, balances and paid
  bodies for every case. New preparation and queue creation share one current-
  authorized RepeatableRead snapshot and the existing 15-second budget. Exact
  historical input/source/content hashes, sorted positions, paid-status precedence,
  UUID recovery and maximum credit allowances remain unchanged. A separate native
  64,000-byte source-reference admission is additive; it does not replace the
  existing case/procedure limit or add provider context. APPROVE, workers,
  TYPE_DESIGN and spending are unchanged. Native SQL, 851-case timing and approval
  scalability remain untested. Pure/mocked batches at 851 are not performance proof.
- Exact tag navigation now has a separate original-scope read-only hub for cases
  and records linked through those cases. Native tags belong to cases only;
  direct assigned plans/releases and active direct requirement references are
  clearly labeled relationships, not independently tagged records or readiness.
  Runs, historical tags, execution-template/strategy expansion and provider
  verification remain excluded. The default is approved active cases; review and
  archive lanes are explicit. Fifty-row pages use complete admitted counts and
  bounded metadata, with scope/section/base-case population cursor checks.
  Empty, whitespace and punctuation tags remain distinct. The main repository
  also distinguishes no tag filter from a retained empty tag, and offers a
  separate association link without losing the local lane/draft.
- The tag hub requires each activation/session/page to receive its own completed
  read UUID and unchanged native actor/organization echo. Cached results are
  hidden through access loss, A-B-A transitions, fetches, errors and paused
  reads; reconnection restarts the read. Counts say "among matching cases" rather
  than suggesting every case has a link. Independent review corrected cursors
  that omitted unassigned matching cases, and generic refusal now handles the
  distinction between PostgreSQL character counts and DTO UTF-16 limits without
  clipping native text or exposing private validation details.
- Renewed sessions can explicitly verify and adopt the same original account,
  organization and native actor after a separate new completed native full
  Owner/Admin read. Original pending request content, receipt session, UUID and
  hashes stay frozen. Busy/stale verification cannot authorize adoption, and
  A-B-A transitions revoke callbacks/review. This is session recovery, not reload-
  durable receipt storage or a bypass for an unreadable current schema.

Fresh integrated local checks: 747 Node and 80 typed Web checks (827, zero skips),
185 focused API pure/mocked checks and API/Web typechecks pass. New controller checks
exercise exact tag page navigation, native-reader/session loss and paused reads.
These changes are source-only. Native queries/fixtures, migrations, full native
runtime/image-security, authenticated production, deployment and actual Windows
execution remain unverified; earlier failed release evidence remains failed.

Integration lint first rejected render-time ref reads in the new tag view and
JSX constructed inside its parser try/catch. The native reader pin now uses
immutable mounted state; only exact tag parsing is caught, before rendering.
Fresh focused lint and six actual-controller regressions pass without disabling
rules or loosening actor/request admission. No browser/native acceptance is
inferred from those corrections.

October 6 04:13 UTC continuing plan and folder source integration:

- Plan status now has a separate reviewed transition, including explicit reopen
  to Draft for approved/archived plans. Supported declared metadata uses unique
  SET/REMOVE operations rather than resending a stale whole record. Both retain
  complete revision, original native reader, frozen request body/hash/UUID and
  exact acknowledgement recovery. Unknown keys, incompatible/native NULL values,
  duplicate/multiline string-list rows and unrelated plan content are retained.
  Planning status is not a test verdict, release approval or compliance sign-off.
- The legacy whole-plan update endpoint refuses writes before database mutation;
  old clients must refresh and use the new reviewed controls. An earlier missing
  legacy acknowledgement is not proof its write failed. The QA strategy form and
  scoped existing-data suggestions remain available inside the guarded editor,
  with suggestions disabled while its original draft is private or pending.
- New governed writes compare complete decoded snapshot JSON against native JSONB
  before mutation/version capture. Unsupported numeric precision or SQL-null
  representation refuses rather than rewriting rounded data. Schema provenance
  also requires an exact native round-trip. This is an interim refusal, not a
  precision-preserving native read codec; earlier accepted UUID replay is unchanged.
- Folder navigation distinguishes saved folders, persisted case suites, source
  groups and mixed groups. Folder drag and keyboard Move/Rename open the existing
  complete-subtree review only. Source-only groups cannot silently receive case
  assignments. Raw unsupported paths stay exact/visible, and gestures cannot
  replace an existing draft or uncertain request. Archived/hidden cases remain
  part of native move impact, not merely the visible review lane.

Integrated local checks: 748 Node and 131 typed Web checks (879, zero skips),
96 focused API pure/mocked checks and API/Web types pass. Focused source lint has
no errors; seven effect/dependency/prose warnings remain disclosed. An obsolete
QA renderer expectation was corrected with original-scope/active-state assertions;
render-time row counters and folder receipt reads were corrected without rule
disables. Authored native plan lifecycle/metadata/precision/execution fixtures
were NOT RUN. Actual folder drag, native SQL, full runtime/image-security,
authenticated production and deployment remain unverified. Earlier failed native
release gates remain failed. Source checkpoints do not finish the broader parity
work; Windows launch policy, whole-suite approval performance and additional
schema-independent collaboration reads continue in separate lanes.

October 6 04:34 UTC further reported-workflow source repairs:

- RISK approval now admits the complete payable queue's count, unique positions,
  identities and metadata bytes before materializing only needed scalar fields.
  Case/procedure/source baselines are rechecked in batches of at most 32, with
  initial and post-lock native count/byte/relationship admission. Every frozen
  payable case must match; there is no smaller approved subset or repricing.
  Current original authorization, prior approval replay, 1,000-case bound,
  30-second atomic transaction and one aggregate balance check remain. Credits
  are still debited independently by the unchanged current-authorized worker;
  no provider processing or new spend occurred. TYPE_DESIGN is unchanged.
  Native 851-case approval timing is unverified; the REVIEW-only opt-in fixture
  remains separate, not expanded without independently verified worker exclusion.
- Comments no longer depend on a valid custom-field schema. A separate native
  reader pins organization, Clerk and native actor; activation/session/page UUIDs
  hide stale cached comments. READ_ONLY collaboration remains the existing server
  rule, not case-edit authorization. Frozen body/hash/UUID and a synchronous
  busy latch protect retries. Exact known ACKs settle privately after close or
  access loss; a retained known-posted draft cannot silently become a new UUID.
  Hidden inspector tabs stop reads. Native page-size and complete DTO admission
  refuse unsupported retained text generically, without clipping or empty results.
- Windows helper UI now distinguishes a user-reported launch block from detected
  connectivity. Reporting it revokes owned health/discovery generations and
  hides private setup; late results cannot reopen the blocked state. Explicit
  reconnect requires current protected project/member reads and the original
  org/account/session. Timeout only means no paired response was received.
  No security policy was changed, no downloaded helper launched or signed, and
  no device capture was performed. Cause diagnosis, signed distribution, actual
  Windows/device behavior, capture/AI scope guards and reload recovery remain open.
- Actual source folder and plan-control markup was inspected in synthetic Chrome.
  Folder actions are compact native disclosures; metadata controls have full-width
  inputs and responsive cards, with exact lists spanning a complete row. Invalid
  numbers remain visible and block save; native NULL/unknown fields stay read-only.
  The visual plan fixture replaces auth/query/controller hooks, so it proves
  markup/interaction only, not real authorization, mutation or receipt recovery.

Final integrated checks: 764 Node + 155 typed Web (919, zero skips), 159 focused
pure/mocked API checks across 10 suites, API/Web types PASS. Scoped production lint
has zero errors and one disclosed helper layout-effect warning; unchanged legacy
TYPE_DESIGN router lint findings are not claimed cleared. Initial API mock teardown
and in-progress helper harness failures were repaired and complete checks rerun;
no admission assertions or rules were disabled. Native SQL, fixtures/migrations,
paid provider behavior, full runtime/image-security, authenticated production and
deployment are NOT verified. New reader/restore and priority snapshot audit gaps
are recorded for the next bounded source lanes, not silently declared accepted.

October 6 04:53 UTC continuing source, integration UNVALIDATED:

The release wizard now retains complete inline criterion prose, including leading
and trailing whitespace, multiline text, ordering and duplicates. New requests
explicitly select nested wordingMode EXACT. Separate parser branches preserve
the old absent-marker trimming behavior, property order and UUID request hash;
old retained requests are not silently upgraded. Exact new text refuses blank,
oversized, null-character and incomplete-Unicode values rather than clipping.
An unadded whitespace draft also requires explicit clearing before Continue.
Eleven parser/identity API checks, five Web draft checks, two standalone leaf
TypeScript checks and focused lint pass. Full integrated types/render/native
creation are pending the active priority/version/prerequisite writer freeze;
these new bytes are not covered by the earlier 919/159 checkpoint.

October 6 05:06 UTC read-only trial continuation:

The signed-in Qase Fields screen's Priority editor was opened and its General
and Values tabs inspected, then canceled without saving. The actual control is
single-select with a default value, all-project availability and named/icon
choices. Prose remains a separate Paragraph field. This supports a normal
priority dropdown, not a separate business-rationale text box for every case;
it does not prove Vaettir supports Qase's complete configurable system-field set.
TestRail's synthetic run overview still exposes outcome segments, remaining
Untested counts, date/author and milestone timing. One observed row shows 35%
alongside 89 Passed, 21 Blocked, 113 Untested, 17 Retest and 12 Failed. Progress
and pass rate must have explicit, separate meanings in Vaettir rather than
copying an unlabeled percentage. Testmo's vendor sample run has folder navigation,
search, selectable columns and Results/Status/Activity/Issues views. No vendor
record, result, configuration, integration or customer data was changed.

Independent source review also caught collapsed multiline release criterion
wording; the draft display now preserves whitespace and wraps long prose.
Cross-page draft transfer was not implemented or claimed by this change.

### Native-reader workflow source checkpoint, October 6 UTC

Priority uses an independent fresh native reader rather than requiring a valid
custom-field schema. New reviewed requests pin the original native author inside
the locked transaction before receipt recovery; the legacy inner payload, hash
and three-field output are retained. Complete case/procedure preflight and JSONB
round-trip checks refuse unsupported representation. Priority-local history copies
the native profile column instead of coercing JSON null. New own-procedure snapshots
retain all six authored step fields without relational row IDs, so they do not
introduce unsupported historical procedure shapes. Actual native SQL is not proved.

Version list/current/historical reads echo exact native reader, request nonce and
projection. The UI suppresses stale, failed, paused, inactive and mismatched reads;
separately frozen restore reviews retain selected fields/reason and old request
hashes inside an additive native-scope envelope. Exact late acknowledgements settle
only their original private receipt, not another draft or returned view. Historical
comparisons remain read-only. New reviewed writes explicitly refuse inexact or
SQL-null/JSON-null profiles before applying or versioning; this interim refusal is
not a native precision-preserving read codec or full historical reconstruction.

Prerequisites have independent current native access, stable-ID/title search,
numeric Case ID order, explicit Title text order and 20-row population-bound pages.
New links require current approved active same-project cases; retained pending,
rejected, archived or unavailable links stay labeled and explicitly removable.
The whole stored graph and complete saved direct-link set are reviewed with CAS
and atomic native-author UUID/audit recovery. Legacy unreviewed setters refuse
before mutation. Complete graph/text/DTO bounds refuse rather than clip. Drafts,
uncertain requests and removal/Undo labels remain retained across close and tab
changes; stale row closures cannot drop newer choices, and same-session authority
loss revokes old response effects. A refused page can still be narrowed, while
candidate actions remain bound to an admitted page. Draft metadata is bounded.
Reload recovery, renewed-session adoption and native title-collation parity remain
unsupported; old client comparator checks are not evidence of native SQL behavior.

Integrated source checks: 794 Node + 202 typed Web = 996 PASS, zero skips; 192
focused pure/mocked API checks across 10 suites PASS; API/Web types PASS. Scoped
production lint has zero errors and one disclosed prerequisite origin-capture
layout-effect warning. Independent review exposed stale selection/filter/authority
issues and a procedure snapshot shape error; these were corrected with regressions.
An initial old source-contract mismatch and new render-ref lint errors were also
corrected without disabling admission rules or tests. Synthetic controller/SSR
checks are not authenticated browser or native transaction acceptance. No native
SQL, migration, provider spending, full runtime/image-security, production or
deployment acceptance was run or inferred; all earlier failed gates remain failed.

Next bounded review-queue audit remains open: current legacy approval/rejection
branches lack current native FULL-seat authorization, content/review CAS and atomic
UUID/audit recovery. The bulk branch can silently omit requested cases. Those
findings require a coherent reviewed workflow/caller cutover, not a claim that
the existing repository/review queue is production accepted. All reported gaps
remain in scope; this checkpoint does not stop implementation or trigger deployment.

### October 6 scoped goals and rendered prerequisite affordances

Release planning now allows optional custom goal labels alongside ordinary release
presets. Specialized regulatory/hardware/field presets remain opt-in, while every
selected goal stays visible and removable even when those suggestions are hidden.
The existing server limit of 20 goals and 200 characters per label is unchanged;
empty, null-character and incomplete-Unicode drafts refuse. Unadded text must be
explicitly added or cleared before proceeding or creating a new request. Previously
retained release requests keep their exact original body and UUID. This is a
release-local choice, not persisted project-wide goal configuration or a repair of
the separately open calendar-day/time-zone semantics.

Actual prerequisite rendering with real controllers and TanStack Query cache but
synthetic Clerk/RPC exposed apparent Discard, Add and Undo buttons that could look
enabled after current authority became read-only. The controller already refused
those actions; the narrow markup now disables them consistently, without changing
authorization or discarding retained selections. Focused prerequisite/controller
SSR plus release-draft checks: 36 PASS. Working-source API/Web typechecks and scoped
changed-production lint passed; these do not validate all concurrently authored
review-queue source. The inherited origin-capture lint warning remains disclosed.
Root independently inspected local mobile retained-draft and desktop side-by-side
version-comparison captures. Agent measured desktop document 1,265px inside a
1,280px viewport and mobile document/body 375px inside a 390px viewport; ordinary
captures succeeded, while two full-page captures timed out and are not proof.
Post-rebuild synthetic read-only Add/Undo/Discard/Save were visibly disabled.
These demonstrate synthetic layout, not real native authorization, transaction
recovery or production acceptance. Two further apparent-action edges (busy
reopening and undo at the 50-link cap) remain a separate source follow-up.

Qase's authenticated unsaved Create custom field dialog was refreshed read-only:
entity, input type, placeholder/default, requiredness, ordering and an all-projects
availability control were visible. A checkbox interaction timed out and remained
checked, so project-selection behavior was not verified. The dialog was canceled;
no field was saved. This is not a claim of complete configurable-field parity.

Separate native metadata fixture/driver source remains AUTHORED, NOT RUN. Root
review found a nested native-test registration that compilation had not caught,
and a tracked pure test depending on an ignored local driver. Both were corrected
before their separate checkpoint: 25 tracked pure/AST/source checks pass, with
two ignored-local driver contracts reported separately. Strict fixture/test
compilation, API types and scoped lint pass; the eight native fixtures remain
NOT RUN. The byte-exact original failed source remains local. Review-queue
service/UI and central registration remain separately unvalidated until complete
snapshot rendering, caller cutover and focused proof. A formatting-only source
contract failure in the release suite was repaired by accepting JSX whitespace;
the multiline prose display assertion remains enforced and all 36 checks reran.
Earlier failed native/runtime/image-security/erasure gates are unchanged.

### October 6 complaint-led comparison refresh

Public research was refreshed alongside the authenticated demo work, not used
as a substitute for it. No Gartner quadrant/ranking is asserted. Qase's dated
first-person reviews include repeated reporting/customization friction and
large-suite search/navigation friction: May 15 and April 25, 2026 reviewers
describe stakeholder reports needing external rework and limited bulk/filter
workflows; May 13 describes excessive exported PDF whitespace. September 30
reports abandoned CI runs appearing active with no results. These are anecdotal
user reports, many explicitly seller-invited/incentivized, not measured prevalence
or independently reproduced current defects. Positive reports also praise
simple organization, readable steps and run-history visibility.
[Qase reviewer evidence](https://www.g2.com/products/qase/reviews).

A separate 2024 TestRail discussion reports difficulty obtaining usable
top-level metrics and manually extrapolating a pie chart. This older anecdote
does not prove the current trial lacks those capabilities.
[TestRail dashboard discussion](https://www.reddit.com/r/QualityAssurance/comments/1ewzk3o/how_do_you_use_testrail_for_dashboarding_needs/).

Current official field documentation provides a concrete comparison: Qase
describes project-specific custom fields and query/report use, while TestRail
documents that Text, Steps and Scenarios fields cannot become case-list
sort/filter columns. These support scoped typed fields with explicit capabilities,
not turning useful prose into universal dropdowns.
[Qase custom fields](https://docs.qase.io/en/articles/5563701-custom-fields),
[TestRail custom fields](https://support.testrail.com/hc/en-us/articles/7373850291220-Configuring-custom-fields).

Design inference for Vaettir: keep useful text, make project-appropriate typed
fields searchable where supported, show both completion and outcome with exact
scope/empty-run semantics, and keep export layouts compact without dropping
evidence. Large-suite paging must not trap reviewers after ten cases; uncertain
requests cannot be discarded just to free a UI slot. These are acceptance targets,
not claims that every source or production workflow already meets them.

### October 6 supported review and run-start checkpoint

The separate pending-review queue now uses bounded current-native reader pages,
stable-ID search, explicit sort and current population counts. An opened case
shows the admitted complete snapshot: authored/effective procedure columns,
separate prerequisites, useful prose, tags/custom values, project definitions and
source/import context. The complete exact JSON disclosure is available but
starts collapsed. New decisions refuse unsupported additional relationships or
inexact/oversized content instead of omitting it. Current full-editor/native
scope, shown content/trust hashes, an immutable request UUID and an atomic audit
receipt protect a single pending-only decision. This is not bulk-review parity.
Legacy approve/reject/bulk-review and unbounded pending reads now explicitly
refuse before private database access; their callers use the supported queue.
An older uncertain legacy response is not proof that its write failed.

Mounted queue editors retain drafts and uncertain requests across close/access
changes. An explicit child-authorized release frees an unused or known-settled
editor slot; it never evicts a draft or UNKNOWN request to open an eleventh case.
Detail History mounts the same decision component, but record replacement,
route-away and reload recovery are not supplied. A remaining preview-only access
limitation can prevent browser receipt recovery after a case is deleted,
reparented or gains foreign relationships, although the server retains scoped
UUID recovery. A separate project-reader recovery follow-up remains open.

The library's manual-run start callback is mutation-only. Its mounted controller
privately settles an exact original ACK before any current-frame effect, locks
known-confirmed requests against a second start, and allows explicit Open after
original access/session restoration. Close, changed draft, session/authority loss,
A-B-A and unmount suppress late navigation without deleting the retained body.
Unknown responses retry the same immutable request. Existing server payload,
hash, 1,000-case limit and idempotency semantics are unchanged. This does not
complete the separate quick-result, step-ACK, run-completion receipt, run-list
reader/export, cross-reload or other run-entry-point configuration work.

Final compatible working-source checks: 798 Node Web plus 266 typed Web tests
PASS, zero skips; 65 selected pure/mocked API tests PASS; API/Web typechecks PASS.
Scoped production lint reports zero errors, with four inherited Web effect
warnings and one inherited API unused-variable warning still disclosed. Earlier
source-contract failures after moving/formatting controller logic were repaired
with equivalent guarded-completion assertions; no checks or lint rules waived.
Synthetic actual-component queue evidence shows readable step descriptors,
stable prerequisites, false/zero/NULL/empty custom values, read-only decisions
disabled, hidden private material on auth loss, exact uncertain recovery and safe
editor-slot release. This is not native authorization or transactional evidence.
Busy prerequisite reopening and Undo at the 50-link cap now visibly refuse.
Eight separate native metadata fixtures remain AUTHORED, NOT RUN. Native SQL,
migration/recovery, full runtime/image-security and authenticated production
acceptance are not established; prior failed evidence remains failed. No
deployment, customer-data mutation, provider transmission/spend or live
identity/security change was performed for this parity checkpoint.

Independent completion review also caught SDK session loss before React's auth
commit on a rejected response. The final controller revokes that old display
frame before publishing all response paths, not only successful ACKs; 27 focused
actual-controller/modal-function synthetic checks cover retained exact retries,
late success/error, duplicate clicks and explicit same-receipt Open recovery.

### October 6 native reader and immutable-result follow-up boundaries

The next case-review browser increment separates an actual original-project
access read from the actual supported case preview. Only an already immutable
pending UUID/body/hash can retry through current original-project FULL authority
when a deleted/reparented/foreign/unsupported case prevents a new preview. No
new decision or private case/note display is authorized by project-only access.
Root review also identified a missing current SDK session guard before React's
auth state commits; private SDK error-message suppression is not that guard.
The six-path browser recovery increment now passes 74 focused Web checks,
API/Web typechecks and scoped production lint. Actual SDK user/session checks
guard actions and every completion path, and SDK resource notifications revoke
old activations before React auth commits. Matching original ACKs settle privately
before current-frame effects. A fresh native activation is required after observed
session loss; returning SDK state alone does not restore cached authority.
Synthetic actual-component evidence demonstrates the same pending UUID recovering
after a missing preview without displaying procedure/note content, and suppresses
late ACK display when only the SDK session changes. The preview bundle predates
the final SDK resource-listener addition; its complete lifecycle is covered by
focused hook/controller checks, not claimed browser or native acceptance. Other
queue metadata caches are not claimed SDK-hardened by this bounded increment.

Whole-case and per-step execution lanes are separately owned. The existing
whole-case observation service still has two local 500-case checks while manual
execution admits 1,000 cases. Shared retest closure already supports 1,000 IDs
and 10,000 edges; it must not be changed based on the initial contrary suspicion.
A coherent cutover requires native identity/body/relationship admission, reviewed
frozen procedures, lossless prior observations, current native author before
receipt lookup and exact scoped ACK recovery. Current quick controls are not
removed before the compatible replacement is ready.

Per-step source already has frozen procedures, head-ID CAS and current FULL-seat
checks. The audit found missing original native/write pins, revision-ID-only
browser ACK checks, state-only duplicate-click ownership, incomplete native
coordinate coverage and unguarded late callbacks. This is not a demonstrated
cross-actor UI exploit: the parent original-reader gate and scoped transport are
existing protections. New reviewed step source must retain them, refuse unsupported
raw/null/precision values instead of guessing, and keep derived Pass distinct
from independent healing or deployment verification. Neither new execution lane
has native or production acceptance merely because its source is being authored.

The separate five-file reviewed-step API first phase passes 33 pure/mock checks,
API typechecking and scoped lint. It adds original native/org/Clerk pins, atomic
scoped reviewed receipts, complete graph/coordinate admission, exact aggregate
prior evidence and native JSON/size guards. Explicit timestamp projection retains
native revision equality without treating a Prisma Date as plain JSON. The new
namespace is not yet registered in this first-phase checkpoint; old step callers
and UI remain unchanged. Native SQL and runtime behavior have not been exercised.

The concurrent whole-case replacement was still in flight and excluded from the
bounded recovery/step-source checkpoint. Its initial full Web Node run had five
failing legacy source/render contracts around that changed component, retained
as failed evidence until equivalent assertions covered the replacement. The
passing focused increments and 344 passing typed Web checks do not establish an
all-green working tree, completed execution cutover or deployment.

Authenticated Notion access was refreshed and its existing Vaettir handoff was
narrowly updated with the source checkpoint and these acceptance limits, preserving
earlier sections and child references. The project fetch remains partially
truncated with three unsupported external blocks, not a complete PRD audit.
Linear's connector still requires reauthentication; the signed-in existing browser
ticket remains In Progress, with no new browser comment transmission in this
follow-up. Qase's unsaved all-projects checkbox again timed out and remained
checked; its per-project chooser interaction is not claimed verified. The dialog
was canceled without saving, subscribing or changing trial data.

### October 6 reviewed whole-case caller checkpoint

The manual page's quick outcomes now open an explicit reviewed observation
editor; they do not record an unversioned result or convert numbers. One mounted
editor owns the raw note, absent/empty context and measurement buffers. Numeric
blank, non-finite, inverted and precision-losing inputs refuse rather than becoming
zero, an absent limit or rounded evidence. NULL notes remain distinct from exact
empty/multiline text. Known historical context is friendly labelled prose beside
the complete read-only JSON, including unknown roots/siblings. Saved procedure
columns and BDD wording remain distinct from separate prerequisite cases.

The additive exact server pathway admits the whole saved 1,000-case graph and
bounded native observations without relaxing shared dataset/plan limits. New
writes bind original native/org/Clerk authority, frozen procedure evidence and
current result/head fingerprints. Receipt lookup follows current native author
locks and precedes later body/status/cap admissions. Accepted parsed legacy
receipts can recover without creating new legacy writes or fabricating old
review provenance. Raw native JSON roundtrip refusal prevents uncertain facts
being silently normalized, replaced or partially accepted. Friendly current
display does not certify independent execution, defect healing or sign-off.

Actual SDK resource observations and synchronous actions latch revoked native
read nonces through A-B-A and close/reopen; only a new native read can restore
that activation. Exact ACKs settle privately before current-frame callbacks.
Closed status blocks new quick/step writes separately from same-UUID recovery;
filter-hidden/collapsed rows retain mounted buffers without enabling their effects.
Route-away/reload recovery is still unsupported. Legacy unversioned server routes
and older whole-case API writes remain separate mixed-caller cutover work; removing
the current page's old call is not proof every legacy write path is closed.

Independent checks after the repair: 803 Node Web and 359 typed Web checks PASS,
zero skips; 65 focused pure/mock API checks PASS (32 whole-case/legacy-schema and
33 reviewed-step). API/Web types PASS. New whole-case production modules lint
clean; the shared manual page retains its four previously disclosed warnings.
The earlier five obsolete source/render contracts were reconciled against actual
new readers/controller/request construction with equivalent or stronger scope,
escaping, exact text/CAS/ACK assertions, not removed or waived. A later single
source contract still expected the old hidden-row expression; the stronger
hidden-row authority check is now asserted and the complete Node suite rerun.

The reviewed-step protected namespace is now registered for the separately owned
browser-helper phase; the StepExecutionPanel caller has not yet been cut over.
New raw buffer/wire helpers remain outside this whole-case checkpoint until frozen.
Simple linked-plan/type/org-label case-review V2 is also independently in flight;
the prior case-review snapshot does not bind organization-custom step labels.
New rendered whole-case fixtures are pending. No native SQL/concurrency, migrations,
full runtime/image-security, authenticated production or deployment acceptance is
established. Prior native failed evidence remains FAILED; no cloud, database,
customer, provider or live identity/security operations were performed here.

### October 6 complete bounded review context V2

New case-review previews bind the original organization's exact step-column
overrides, their SQL NULL provenance and the four resolved display labels. Only
absent keys use defaults; empty/whitespace values and unknown siblings remain
retained. V1 history explicitly discloses its missing label/context provenance.
Direct case and linked-plan type references are shown separately. TestPlanType
is a global reference model, not a tenant-owned definition; no global catalog
is loaded to infer classification or invent organization ownership.

The supported simple same-project leaf plan includes its complete current header,
custom values, empty execution template, latest version identity and all bounded
direct acceptance criteria. Foreign/missing relationships refuse before private
body projection. Release/strategy/requirement links, reverse linked plans and
nonempty or NULL execution templates remain unsupported. Approved/archived parent
context is readable but refuses new case decisions until the separate parent
workflow reopens it. Dataset/media/compliance/traceability material remains
unsupported; case review is not a readiness or parent approval.

Native scalar/count admission precedes complete projection, with the existing
512 KiB whole-case bound unchanged and separate label/type/plan limits. Complete
native JSON roundtrip refusal remains required. New snapshots are explicitly
CaseReviewSnapshot/v2; decision input/hash/receipt identity are unchanged. An
already accepted V1 UUID recovers before V2 admission; an unaccepted old content
hash conflicts and requires explicit rereview without replacing its frozen body.

Independent focused checks: 72 pure/mock API and 75 actual renderer/controller/
reader Web checks PASS; API/Web types and scoped production lint PASS. These are
source and synthetic SSR checks, not native SQL/concurrency, authenticated browser,
runtime/security, deployment or exhaustive competitor parity acceptance.

### October 6 legacy outcome cutover and reviewed step browser foundations

The unversioned `manualExecution.recordResult` endpoint now refuses before any
database access. Its old parser/protected transport and result wire type remain,
but a matching current result is not an immutable receipt or permission to
overwrite evidence. No request is forwarded with an invented UUID, and no
healing or flaky-state side effect is inferred from a human observation.

The old whole-case `recordManualCaseResult` adapter preserves its historical
parser, canonical key/hash and acknowledgement shape. It now delegates only
LEGACY_PARSED recovery to the reviewed service: current original FULL/native
actor/Clerk/organization authorization precedes receipt lookup, and an exact
accepted UUID can recover before later run completion or unsupported/oversized
private bodies. A missing or mismatched receipt cannot create a new observation.
Positive native integration fixtures using retired writes still need explicit
reviewed-path migration; historical synthetic seeds must remain test-only, not
a production compatibility bypass. That fixture work is authored separately
and is not covered by the pure/mock proof below.

Additive step browser helpers decode actual ISO-string JSON timestamps and keep
raw NULL/empty/multiline notes, context, exact numeric entry buffers and selected
evidence identities. Explicit Review Current binds original native scope and
the complete frozen procedure/current revision. UNKNOWN requests retain their
UUID/hash/body/reviewed session, and a renewed browser session cannot silently
adopt an unsent review. SDK-only movement revokes stale native activations;
matching late acknowledgements settle privately before any refresh callback.
Root review caught a refused-preview Refresh dead end; a current explicit read
retry now requests a new nonce without relying on stale body/write authority.
These helpers are not yet the StepExecutionPanel caller cutover. Existing step
history/evidence read contracts and caller visibility wiring remain open.

Independent final source checks: 803 Node plus 418 typed Web checks (44 typed
suites) PASS, zero skips; 44 selected legacy/reviewed whole-case API checks and
33 reviewed-step API checks PASS; API/Web types PASS. Scoped owned lint is
clean. An ignored actual-component whole-case browser fixture additionally
checked retained raw buffers, exact lost-ACK retry after fake run completion,
SDK-only authority revocation and explicit known-receipt refresh using fake RPC
and authentication only. This is not native SQL, production authentication,
device/runtime/security, migration/recovery or deployment proof. Earlier failed
native gates remain FAILED; no release gate was waived.

### October 6 authenticated Testmo run-selection recheck and complaint signals

The existing signed-in trial was revisited using only its vendor Space Shuttle
samples. The settled run index exposed eight active runs, three unstarted,
milestone groupings, per-run progress, contributors, state/tag filters and a
separate latest-success metric. In the unsaved multiple-run dialog, one row had
an all-cases choice and configuration selection. Its case selector showed folder
counts, case states and ALL/ANY filters. Applying the empty filter in this draft
selected 534/534 cases with explicit feedback. Both dialogs were canceled; no
run was submitted. Export was clicked but no settled dialog or file contents
were verified, so this interaction does not establish export fidelity.
The [official Testmo run guide](https://support.testmo.com/hc/en-us/articles/47544002336653-Test-Runs)
separately documents replacement/add/removal selection and current-result progress;
those modes are not all hands-on verified by this recheck.

First-person reporting complaints recur across tools, but are not a current
vendor defect reproduction or market ranking. A
[2025 Testmo user discussion](https://www.reddit.com/r/QualityAssurance/comments/1nm87hy/test_management_system/)
describes needing external BI for release reporting across projects; another
participant values dashboards that non-QA stakeholders can follow. Multiple
participants in a
[2024 TestRail discussion](https://www.reddit.com/r/QualityAssurance/comments/1ccyp6t/testrail_question/)
describe distributing screenshots/exports instead of expecting stakeholders to
visit the tool, and flag formatting/report flexibility and attribution concerns.
These dated anecdotes motivate scoped, readable, portable reporting and retained
individual authorship, not shared accounts or relaxed tenant permissions.

Current Vaettir source already has visual run cards, outcome/remaining counts,
start/finish dates, current-head multi-run summaries, separately labeled recorded
trends and CSV/HTML exports. Their source presence is not deployed UI proof.
The next owned slice addresses fresh native reader/page authority and explicit
export review rather than duplicating charts or treating an unsupported result
as zero progress. Cross-project reporting remains a separate authorized-scope
design question; no cross-tenant aggregation is inferred from these complaints.

### October 6 step-resource reader and reviewed fixture source continuation

The new `manualStepExecutionResources` namespace is registered as two protected
read-only queries. History and the confirmed-project evidence picker require
original project/run/case/step, organization, independently authenticated Clerk
and native reader pins, an explicit limit and fresh read nonce. Native scalar
count/UTF-8 bounds precede private row projections. Cursors bind the complete
admitted population and frozen procedure; changed populations require an explicit
refresh, not a silently substituted page. Exact NULL/empty notes, raw unknown
observation/evidence metadata and original frozen step fields are retained.
Version metadata is disclosure only: a stored version ID is not proof that the
version was fetched, and absent/unsupported verification is not invented as an
unversioned confirmed file. There is no signing, file-open, upload or provider
operation in this namespace. The existing step panel has NOT yet been cut over;
the additive browser reader/editor and mounted caller remain separate work.

Root independently repeated 39 service/protected-router source/mock checks and
16 reviewed-fixture helper pure/mock/source checks (55 passed across three files).
The router tests check signed-out refusal, strict missing-pin/limit/extra-field
refusal and use of independently authenticated context rather than client pins.
These checks do not execute the authored PostgreSQL statements or inspect files.

The whole-case native history fixture now authors current positive writes through
actual reviewed access/preview/EXACT contracts. Historical v1 replay uses an
explicit test-only synthetic seed with the original parsed wire/hash, not a new
legacy application write. Exact loopback database routing, named opt-in, native
synthetic owner checks and an empty result/head cohort precede seed work. Ordinary
teardown disconnects and retains evidence; the owned hard-delete scenario has an
additional destructive opt-in. All 15 native registrations remain AUTHORED NOT
RUN. Earlier native erasure failures remain FAILED. Other mapped legacy native
fixture call sites, actual concurrency/SQL/migrations/recovery, full runtime and
image security, authenticated production and Windows/device acceptance remain
open. Source checkpoints do not deploy this work or conclude parity.

### October 6 current run-history reader source

The distinct protected `runHistory.access/page` namespace now supplies a bounded
current-reader protocol for the existing visual run list and portable reporting
work. Original organization, authenticated Clerk/native reader, fresh request
nonce and exact requested key are echoed. Page size and millisecond UTC anchor
are explicit, with native `(startedAt, id)` keyset order and one admitted but
unpublished lookahead. The anchor bounds stored run-start times; this is NOT a
globally frozen snapshot or a whole-project count, and corrections can change
progress between pages. Native submillisecond/unsupported dates are refused
before metadata projection rather than silently truncated into a broken cursor.

Manual progress uses unique saved planned identities and current result verdicts,
not pass rate or a substitute for the all-pages frozen/current-head summary.
Unsupported saved scope, duplicate verdicts or inconsistent case/step heads yield
unavailable progress with a reason, never fabricated zero completion. CI progress
counts ingested observations; no planned CI denominator or remaining work is
invented. Actual foreign pointers refuse the complete read before private counts.
Native metadata/identity/status admission precedes the whitelisted projection;
notes, errors, procedures, source bodies and media are not exported by this route.
The 21-row page limit, 128-KiB metadata, 16-MiB selected projection, per-run
1000-identity/1-MiB scope and 100000 grouped-result/head bounds are explicit.

Root independently repeated 48 run-history/protected-router/progress checks,
then 103 selected API source/mock checks across seven files including the step
resource and reviewed-fixture helper tranche. All passed. These remain source
and mocked transport proof, not executed PostgreSQL, production large-history
performance or authenticated runtime. The existing list/card/dashboard/export
callers are NOT yet cut over; additive browser activation and explicit scoped
current-page export are the next workstream. No deployment is inferred.

### October 6 reviewed step-observation editor and resource controls

An additive actual editor now displays the tester action alongside the saved
technical descriptor at the same numbered coordinate. Expected result and
response retain their own columns; unset, NULL and empty text are distinguished.
The full frozen procedure, unknown metadata and media references remain available
as exact disclosures rather than being replaced with current-case content.
Outcome is a dropdown, while actual observations and correction reasons remain
prose. Measurement inputs remain exact string buffers until explicit review,
including zero, decimal precision and optional blank limits. Historical reasons
do not approve a new correction.

Explicit draft creation, current-baseline review and immutable submitted-request
recovery share the actual completion controller. Close/collapse retains state on
this page. Rendering can revoke old private fields and handlers before layout;
only a newly admitted native frame can restore them. Monotonic installed-SDK
generations also reject a posted frame after session A-B-A, and known-ACK refresh
rechecks authority after publishing busy, immediately before its parent callback.
Read-only access does not grant edit authority. Reload/route-away recovery remains
unsupported and is disclosed.

The retained history and confirmed-project evidence controls use separate fresh
native reads with explicit literal search, paging and refresh. Refused reads do
not trap refresh or silently prune selected unavailable references. Exact current
DTO/cache/session checks precede selection callbacks. Version metadata is not
file-retrieval proof; no file-open, signing, upload, device or provider operation
is supplied by the new editor. The central `StepExecutionPanel` caller has NOT
yet been cut over, so this is not an assertion that the reported live page works.

Independent source checks: 120 step-focused checks across nine suites passed,
including real controller/hook execution and actual JSX rendering. The full Web
run then passed 803 Node checks and 529 typed checks across 52 suites, zero skips;
API/Web types passed. A subsequently corrected hook dependency warning was
followed by 38 focused checks and clean hook lint. The isolated actual-component
browser fixture shows a readable 900px dialog with aligned tester/technical
columns, using synthetic auth/RPC only. Its earlier bundle, capture timeout and
same-UUID lost-response evidence are preserved locally. Final source re-pinning
and late-ACK rendered proof remain separately recorded in the local handoff.
These checks are not PostgreSQL, authenticated production or device acceptance.

### October 6 browser-native run page and explicit portable review

The browser reader pins the first native project/organization/Clerk/native actor
separately from the currently observed session. Current cache data, revision,
query keys, posted frame and installed SDK must still agree at every paging,
refresh and export action. Render-time revocation and synchronous cache-generation
revocation prevent old callbacks or a posted layout from restoring an A-B-A
response. Renewed same-actor sessions require explicit refresh and a fresh native
echo. No old page is treated as current after access/refetch refusal.

Current-page CSV is a cloned, frozen review, checked against the actual reader
again before and after encoding. The export labels its page, anchor, receive
time, limit, undisplayed history and progress basis, excluding email, CI URL,
notes, procedures, media and lookahead. Unsupported progress is unavailable, not
zero. It is not a full backup, stakeholder approval, all-project completion or
release-readiness artifact. Independent reader/hook/CSV checks passed 49/3
suites, API/Web types passed, scoped lint passed. The actual central list/card
caller remains separate pending review of its additive visual component.

The authenticated Testmo vendor-sample report center was also exercised. Its
milestone report offered selectable sections and card/table display, including
manual runs, sessions and automation. Generating with the visible "All milestones"
default returned "The milestone field is required." Selecting the existing
Spacecraft rollout milestone then produced a rendered report with progress,
remaining work, status distributions, forecasts and run/session/automation cards.
Print/PDF became enabled but was not used, so print/export fidelity is unverified.
This is one observed trial interaction, not a generalized vendor defect claim.

Its headline work-item denominator includes planned manual cases and sessions;
individual session result entries contribute differently to status distributions.
Those totals are therefore not interchangeable. Vaettir should label its own
work units and distinguish planned-case completion, ingested observations,
session work, pass rate and readiness, rather than copying an unlabeled aggregate
percentage. Only synthetic/vendor samples were used; no run or customer content
was submitted. Earlier dated reporting complaints remain research signals, not
current defect reproductions or unsupported market rankings.

### October 6 reviewed placement prototype and retained native concurrency gate

The additive placement service preserves exact raw NULL/empty/Unicode paths,
stable IDs, hidden review-lane membership and complete bounded source/target
metadata. It uses strict original organization/Clerk/native actor pins, current
FULL write authorization, deterministic order review/CAS and a distinct versioned
request hash/receipt in the existing native unique `CaseFolderWrite` store.
Old folder receipt UUIDs are not adopted as new placement requests. Only placement
fields and the intentional moving actor are changed; procedures/history remain
separate. Independent schema/service mock checks passed 31, and 13 pure native
fixture-safety checks passed. Types and owned lint passed.

This is an UNMOUNTED prototype, not a safe drag/drop cutover. Its Repeatable Read
snapshot begins before the project fence; existing-row locks/repeated reads do
not establish exclusion of all outside-cohort suite-entry/unarchive writers.
An existing INSERT identity trigger may cause an insert serialization refusal,
but that does not clear the independent UPDATE paths. An all-writer, pre-tuple
lock protocol plus a compatible post-fence snapshot must be reviewed across the
actual callers before mounting this route. SERIALIZABLE alone, a late row trigger
or an advisory lock acquired after the snapshot is not asserted as a solution.

Three isolated native interleaving regressions are AUTHORED NOT RUN: genuine
transaction B commits insert, suite-entry or unarchive changes while transaction
A is paused after real native reads. They require a native CONFLICT with no
placement receipt/audit rewrite. Exact loopback/named disposable database opt-in,
synthetic ownership and separate backend identity are checked before operations;
ordinary teardown disconnects without deleting evidence. These fixtures are not
expected-pass mocks, skips or proof of current concurrency. The old placement
callers and prior native failures remain intact. No native SQL or migration was
executed, and no deployment gate is cleared by this source checkpoint.

### October 6 actual central step caller cutover

`StepExecutionPanel` now calls the reviewed native editor rather than its old
unversioned mutation/trimmed draft/history/file-open implementation. An explicit
first visit opens that original numbered step's editor. Visited editors remain
mounted outside the conditional summary list through collapse, filter exclusion,
current-reader refusal and summary refresh. Original project/run/case/step keys
and tenant/actor presentation pins are retained. Custom project step labels are
passed through; only the existing legacy technical label uses its established
display normalization. Raw stored keys and values remain unchanged.

The actual manual page supplies expansion/filter visibility to the retained
panel, so closing a row also deactivates its portalled dialog. Step-specific
pending state aggregates synchronously: acknowledging or releasing one step
cannot clear another step's uncertain request. An explicitly released matched
late ACK under a fresh original read can clear that step's parent pending state
without another mutation or summary refresh. Closing the run does not locally
block identical accepted-request recovery; current FULL access and native
`canRecord/canRecover` govern new writes versus exact replay separately.

Independent checks passed 44 focused typed checks and 29 Node checks initially;
the final compatible Web run passed 803 Node plus 535 typed checks in 54 suites,
zero skips. Web types passed. New caller/editor/helper/controller lint is clean;
four existing manual-page warnings (three effect-state warnings and one prose
apostrophe) remain disclosed, not suppressed. One obsolete legacy source assertion
initially failed after the closed-run recovery cutover, was updated to check the
new native contract, and then the complete Web run passed. Native checks were not
run. The selected API source/mock tranche passed 174 checks across 11 suites.

Root reviewed the pinned actual-panel browser captures and matching source hashes:
two step requests retained separate UUIDs and raw entered buffers across collapse,
filtering and auth loss; one ACK/release left the other request pending. Both exact
replays produced two fake revisions, not duplicate writes. Separate SDK A-B-A late
ACK withheld private fields until a fresh native-shaped read; explicit ACK release
cleared pending without a new mutation/refresh. Read-only history remained visible
with recording disabled. Both fixture tabs had empty warning/error logs. Only
auth/RPC and a minimal parent summary are synthetic; this is not the production
manual page, native CAS/concurrency, real file, device or deployment proof.

The old server step route and remaining legacy native-fixture migrations are
separate compatibility/recovery work, not declared safe or removed by this caller
checkpoint. Prior failed native/runtime/image/security/recovery gates remain
FAILED/open. Production parity and authenticated acceptance remain incomplete.

### October 6 scoped case-history fixture source migration

The existing native scope-history fixture now authors its three current positive
observations through the frozen reviewed access/preview/EXACT helper. Historical
unversioned evidence uses the explicitly owned test-only seed, not the retired
mutable application writer. Exact named-disposable loopback opt-ins are required
before the first database operation. Ordinary teardown retains minted rows,
users, history and failures and disconnects only; this reader suite is not an
organization-erasure scenario.

Root independently reviewed the complete fixture, compared native test ASTs with
the prior source and confirmed all 15 titles and all 51 full assertion chains
unchanged. Population 20,001, metadata volume 450, raw configuration, UTC bounds,
stable cursor, READ_ONLY, recorder and reparent expectations remain intact.
Sixteen helper pure/mock checks, strict standalone fixture compile, owned lint
and diff-check passed. The initial root strict-compile command used the workspace
root without Node type definitions; rerunning in the API package context passed.
All 15 native registrations remain AUTHORED NOT RUN. This preserves a compatible
future runtime gate; it does not turn a source comparison into native acceptance.

### October 6 Windows-helper delivery guidance correction

The device-capture guide now matches the actual delivered unsigned desktop
launchers and raw Node connector rather than guaranteeing launch/connection.
It names the existing Node 22 prerequisite, bounded first-party download,
no-redirect/unique exclusive temporary-file safeguards and explicit connection
controls. A reported Windows refusal is not diagnosed from the screenshot,
download marker or file ACL. Security-administrator review of the blocked file,
error and time remains the supported policy route; no protection, execution-policy,
Mark-of-the-Web or administrator bypass is offered.

Manual setup uses the current downloaded `.mjs` and existing approved Node runtime
only if policy permits. Pairing is private and remains separate from selected
device/app access, capture, client-source processing, AI use and provider spending.
The page does not deliver a signed Windows installer. An unsigned internal binary
is not trusted public distribution or physical-device acceptance. Earlier downloaded
launchers may be old bytes; neither a readable original nor a fresh download proves
the Windows launch problem fixed.

Root independently reviewed the guide/test sources and repeated 13 generated-text
and VM-only bootstrap checks; all passed. The five new guidance checks are wired
into the existing device-capture test command. Owned lint/diff-check passed; the
existing Node package-type warning was disclosed without changing package mode.
No helper, device, provider command or Windows policy was executed or changed.
Actual approved Windows/device acceptance remains open.

### October 6 actual run-list visual/native-reader cutover

The project run page now mounts `RunHistoryDashboard` instead of the old list,
cursor state and unreviewed `RunOverview` export caller. Current native access
and a bounded anchored page drive colored status cards, recorded percentage,
remaining manual cases and stored UTC start/finish times. Supported manual
run-case instances and CI ingested observations have separate summaries;
unavailable progress is excluded and disclosed, never silently treated as zero.
Unknown statuses remain neutral rather than invented success. Transparent badges
use readable text colors, not filled chart tokens with poor foreground contrast.

The separate applied all-pages dashboard stays mounted across current-page
refresh/paging/empty results. Manual run navigation and CI result-opening intents
check the actual current reader again at action time. The existing CI detail,
coverage and healing paths are otherwise unchanged and NOT certified by this
list cutover. Original run-start/bulk selection behavior remains separate.

CSV requires an explicit immutable current-page review and a separate confirmed
handoff. Its dialog shows the reviewed anchor, client response time and limit,
plus exact included/excluded fields. Closed/replaced/consumed reviews cannot be
reused by obsolete handlers. Session/cache loss hides private cards and portalled
review contents while retaining the original review privately. A different page
or fresh nonce requires a new explicit review; no globally frozen or whole-project
completion is inferred from this page.

Root independently reviewed the component, tests and actual caller, repeated
68 dashboard/reader/export checks, and ran the compatible full Web suite:
803 Node plus 554 typed checks in 55 suites passed, zero skips. Web/API types
and owned dashboard/caller lint passed. Root inspected the pinned actual-component
fixture at the caller's 900px maximum: two readable cards per row, manual 25%/three
remaining separate from CI ingestion, and explicit unsupported progress. SDK-only,
real QueryCache and hook-auth loss withheld cards/private modal content; explicit
refresh was required. Twenty plus three older synthetic runs retained one anchor
and rotated page nonces. CSV callback content contained twenty displayed run rows
plus metadata, excluding lookahead, email and CI URLs.

The fixture used actual React/TanStack/read/controller/dialog/visual source; auth,
RPC, routing and a labeled CSV observer were synthetic. An observer-only quoted-row
counting defect was preserved then corrected locally; optional screenshot timeouts
remain recorded, not silently treated as successful captures. No mobile, external
font, real browser-file handoff, native SQL/performance, production identity or
authenticated critical-flow acceptance is implied. All prior native/runtime/image,
migration/recovery/device release gates remain open; this checkpoint is not a
deployment or a reason to stop the remaining authorized workflow repairs.

### October 6 legacy step transport narrowed to accepted-request recovery

After the actual step caller cutover, the old `recordStepResult` service is now
recovery-only. Its original parser, normalization, hash field order/defaults and
small ACK shape are retained for already accepted legacy run/actor/UUID tuples.
New legacy intents without a receipt are refused before any write. Independently
authenticated transport Clerk and currently locked FULL editor membership,
organization, project, native User and run checks precede bounded scalar receipt
access. No run procedure, note, evidence or current head is materialized to recover
an accepted request, so later completed/oversized bodies do not force another write.
Clerk-less service identities remain unsupported by this human recovery adapter;
no native-identity fallback or original recorder-time/tenant provenance is invented.

Legacy uniqueness was compound run/actor/UUID, not global actor/UUID. The adapter
uses the reviewed namespace mutex and native scalar corroboration to refuse
reviewed-envelope downgrade/adoption while allowing an independently retained
legacy run-A tuple alongside a distinct valid reviewed run-B tuple. Unsupported
or corrupt namespace metadata refuses generically. Only identity/status/hash
scalars are projected after count/byte admission; private foreign JSON bodies
are not retrieved. Read Committed is explicit for receipt visibility after lock
waits. Native SQL and concurrency correctness remain runtime gates, not mock proof.

The actual protected router binds directly to this recovery adapter and no longer
recomputes flaky state or heals a current projection while returning an old ACK.
Root added six protected transport/source regressions and independently repeated
89 recovery/reviewed-step/utility/router checks. The combined selected API tranche
passed 239 checks across 14 suites. API/Web types, strict standalone authored-test
compile and final owned lint passed. Two now-unused router imports initially warned
and were removed; no rule suppression was used. The original schema and normalized
hash AST fingerprints still match the accepted pre-edit source.

Sixty legacy native-fixture callsites still require current reviewed-positive or
explicit historical-seed migration; they are not silently declared green. No
fixture was executed, no accepted row was erased or rewritten, and no native/runtime,
production, device, recovery or deployment acceptance follows from this checkpoint.

### October 6 explicit transport provenance and compatibility assertion repair

The server context now preserves the independently verified Clerk JWT subject
separately from the native User mapping. Anonymous, invalid/remapped sessions and
API-key principals receive no human-session subject, even if a service User has a
populated Clerk field. Existing internal contexts may omit this additive field;
human-session-only endpoints must refuse absence rather than infer authentication.
No header or caller input can supply the subject. The legacy step recovery router
now uses that verified subject explicitly; currently locked native mapping and
membership checks still apply. This does not change live identity or seat policy,
grant a feature, or authenticate a device operation.

Root repeated 98 focused context/recovery/reviewed-step/router checks across five
suites. A subsequent full Web run exposed one old source assertion expecting a
new legacy write's whole-case guard and frozen-procedure load. The endpoint is now
recovery-only, so that assertion was replaced with stronger checks requiring locked
authorization, an accepted ACK, generic new-intent refusal, and no procedure,
whole-case private body or writes at all. The failed run is retained as failed;
the corrected full rerun passed 803 Node checks and 554 typed checks across 55
typed suites, with zero skips. Native fixture error semantics and sixty legacy
positive callsites remain separately unmigrated, not repaired by this source test.

### October 6 reviewed-step rollback and independent resource transport

The actual reviewed step writer now captures and deep-freezes the schema-parsed
original actor, UUID, raw body, selected evidence and both reviewed baselines
once. At most two fresh Repeatable Read transactions share a monotonic 20-second
queue-plus-transaction allowance. Only an actual Prisma known P2034 rollback or
P2010 with native SQLSTATE 40001 qualifies; unique-key errors, timeouts,
connection errors, semantic refusals and lookalike objects do not. Every fresh
attempt repeats locked current authorization and accepted-receipt checks before
procedure/current-head CAS. There is no re-preview, new UUID, provider action,
body normalization or timer racing a potentially committing transaction.
Exhaustion preserves the original native error as uncertain, not an invented
semantic conflict or proof an earlier same-UUID request was never accepted.

The mounted reviewed preview/record and step history/evidence routers now require
the independently verified context subject too. API-key or provenance-less
internal contexts cannot promote native Clerk metadata or caller pins into human
session proof. The native service still checks current native mapping, original
tenant and membership. READ_ONLY readers retain their existing native read
permissions; new recordings still need current FULL editing authority. This is
a source transport correction, not a live identity or membership policy change.

Root repeated 224 selected API checks across twelve suites, including the new
rollback helper, actual-service rollback regressions, protected transport and
legacy recovery. Full compatible Web checks passed: 803 Node plus 579 typed
checks in 56 typed suites, zero skips. Both API/Web types and scoped new-source
lint passed. The existing reviewed fixture retains all 24 registrations and
authorization/receipt assertions; only its transaction-budget expectation now
distinguishes unchanged preview options from the bounded write options. Native
same-UUID both-ACK/P2002 behavior and sixty legacy fixture callsites remain open.
No PostgreSQL fixture, migration, native runtime or production test ran here.

### October 6 device capture ownership foundation, not a working-device claim

Six additive API/browser files retain a deliberately unmounted foundation.
A strict metadata-only authorization read checks original native/Clerk/org/project
pins, a fresh read UUID and exact request hash under current locked FULL editor
scope. Its response explicitly grants no processing permission and establishes
neither foreground target verification nor a device operation. Serial numbers,
Appium endpoints/session IDs, pairing credentials and captured source stay out
of this hosted metadata request.

The private browser controller owns exact SDK session, helper connection,
physical device selection and user-confirmed capture intent. It guards duplicate
dispatch and late responses, aborts its injected local request on ownership loss,
and retains prior raw captures/paid drafts privately. It refuses whole unsupported
responses rather than clipping 26 screens to 25 or merging same-model devices by
display name. Unknown/unsupported attempts block replacement; no connector
receipt/retry/recovery contract is invented. Its count-times-per-body aggregate
storage bound still needs a smaller explicit total budget before caller adoption.
The actual capture page/connector, foreground identity, processing consent,
retained unknown recovery and paid generation receipts remain separate open work.
Root repeated 24 API service/router mocks and 25 browser pure checks; they do not
establish a helper launch, physical capture, OS trust/signing or processing consent.

### October 6 authenticated Testmo case interaction recheck

In the signed-in trial's vendor Space Shuttle sample, the repository exposed
folder navigation, search, bulk edit, configurable columns, compact priority
symbols, colored text status badges and tag chips/counts. Opening a sample case
showed template/state/estimate/priority fields and separate Comments, Results,
Issues and History tabs. Its unsaved editor displayed numbered rich action and
expected-result areas together, with useful prose retained in Description.
The editor was canceled without saving, uploading, generating or posting.
One offscreen priority-selector attempt did not open a menu; no dropdown options
or permission behavior are claimed from that failed interaction. Seeing a comment
box as this signed-in actor does not establish Testmo READ_ONLY comment rights.

These observed interactions reinforce Vaettir's compact readable case metadata,
distinct comments and aligned step structure. James's per-step technical
descriptor remains distinct from ordinary expected results; copying a vendor's
two-field layout alone would not meet it. Public recurring reporting/portability
and customization complaints already cited above remain dated signals, not
current defect prevalence, a ranking or proof of superiority. This tranche is
source-only and is not deployed or authenticated production acceptance.

### October 6 bounded CI result detail reader foundation

The additive `ciRunDetails` access/page API namespace is now registered in source.
It requires the independently verified signed-in subject and current locked native
organization/member/project/User scope, including supported read-only members.
Original run/actor scope, request nonce and an explicit 1–50 result limit are echoed;
the UTF-8 result-ID upper bound is an admitted current window, not frozen execution
history or a globally immutable cohort. Whole foreign or missing case/healing
references refuse before private header, counts or body publication.

Native-shaped admission bounds cover 100,000 identities/16 MiB per window,
128 KiB header, separately retained note/error text, at most 200 artifact metadata
references and 512 KiB projected page including JSON escaping. Unsupported content
refuses without clipping or inventing an unmatched case. Captured external IDs and
paths remain distinct from current linked stable-ID/case/source labels; nullable,
empty, whitespace and zero values are not coalesced. No storage/CI URL, source
file, procedure, observations or healing/classification body/action is retrieved.

Root repeated 54 service/router/schema mock and pure checks across two suites.
Native SQL execution, concurrency, performance and authenticated runtime remain
unrun. The six-file browser reader/component is an active separate workstream;
the existing inline CI detail caller has not been cut over. Registration and these
source checks do not prove current production behavior or deployment.

### October 6 Qase execution and complaint-driven acceptance recheck

In the authenticated trial's vendor DEMO sample, the existing synthetic run's
list is a table, not a visual-card precedent. Its dashboard exposes a completion
donut, started time, estimation/total/elapsed time, grouped suites, stable IDs,
compact priority/manual symbols, search/filter controls and readable text status.
Opening DEMO-8 in its execution side panel displayed description, prerequisites,
postconditions and three numbered actions with separate expected results and
per-step outcome controls. No result, assignment, edit or completion was submitted.
The export dialog visibly offered CSV and PDF; it was canceled without exporting
or sharing. These observations establish interactions, not export fidelity,
readonly-member permissions or frozen-procedure semantics.

Two public practitioner discussions retrieved October 6 describe cramped long
titles/procedures, excess result-entry clicks, rigid step structure and reporting
or export friction. These are anecdotal design signals, not verified current
vendor defects, prevalence estimates or rankings. One discussion also contains
positive Qase experience; no universal negative conclusion is inferred.
Sources: [test-management search discussion](https://www.reddit.com/r/QualityAssurance/comments/1tz5j5z/search_for_good_test_management_tool/),
[test-management friction discussion](https://www.reddit.com/r/QualityAssurance/comments/1r7a3ih/why_all_test_management_tools_are_so_bad/).

Acceptance therefore retains useful prose, readable full supported titles and
procedures in execution context, explicit action/expected-result/technical
descriptor distinctions, searchable stable IDs and honest scoped counts. Actual
click costs, responsive readability and export fidelity need Vaettir fixtures;
visible vendor buttons do not clear those checks.

### October 6 device foundation aggregate admission revision

The still-unmounted browser controller now bounds retained plain-JSON content
across original buffers, paid drafts, operation metadata, response history and
current capture views to 32 MiB and 256,000 nodes. It reserves two full per-value
maxima before injected transport and refuses whole without evicting earlier
buffers or retrying. Accounting includes keys and bookkeeping; it is not a claim
about transient parsing, total JavaScript heap or durable recovery. Root repeated
30 pure checks. Actual capture caller/foreground targeting, helper usability,
processing consent, native receipts and physical-device acceptance remain open.

### October 6 actual CI detail caller cutover, source checks only

The test-runs page now mounts the six-file independently scoped CI reader/detail
under its exact project/run key and original organization discovery. It replaces
the old unbounded inline body/cache, unmatched-title inference and automatic
per-result healing reads. Manual run execution routing and both existing run
dashboards remain mounted. The new readonly detail shows current admitted outcome
distribution, UTC metadata, distinct note/error, stable IDs, captured identifiers
and separately disclosed current source/artifact metadata without retrieving files.
Mapping and healing writes are intentionally unavailable in this detail until
their separately reviewed current-authority/receipt workflows exist; this is not
full parity or acceptance of those deferred actions.

SDK-only changes, cache/render A-B-A and obsolete paging handlers revoke private
detail authority; restoration requires an explicit original-scope native refresh.
Nullable, blank, whitespace and zero values remain distinct. ID-window paging is
not immutable history, planned scope, unique-case completion or execution order.
Root reviewed all six files and repeated the complete compatible Web suite:
803 Node checks plus 653 typed checks across 59 suites passed, with zero skipped.
Web typecheck, scoped caller/device lint and source-adoption checks passed.
These include mocked actual-hook and static React-rendering fixtures, not a new
browser-rendered/native SQL/performance/provider or authenticated production test.
No deployment, customer mutation, processing permission or native gate was cleared.

### October 6 reviewed-step native fixture support, authored not executed

Two test-only helper files now prepare an exact immutable reviewed step envelope
through actual service APIs after explicit owned-loopback admission, independent
synthetic transport identity and native ownership/current FULL scope checks.
Retries submit the same retained UUID/body without helper retries, serialization,
new previews or altered recovered metadata. A distinct first historical seed
retains original normalized legacy hashes and nullable aggregate semantics; it
refuses occupied results, heads, revisions and reviewed UUID namespaces. It does
not invent original Clerk/tenant provenance or disable native constraints.

Root reviewed both files and repeated 78 new mocked/pure checks plus the existing
16 whole-case fixture-helper checks; all 94 passed. API typecheck passed. These
are injected source tests, not native SQL or concurrency proof. The original
14-registration manual-step integration fixture remains byte-for-byte unchanged
and unmigrated. Semantic BAD_REQUEST/CONFLICT, prerequisite/history/media,
simultaneous receipt/correction and erasure acceptance remain separate gates.
Erasure-containing future fixtures require separate explicit destructive admission
before their first connection; this helper has no connection creation or erasure
API. No native fixture, database creation, seed, deletion or migration ran here.

### October 6 saved manual scope cannot shrink around missing procedures

The actual manual execution read now returns every ordered saved planned ID and
a complete available/unavailable identity partition. A missing legacy case with
no frozen definition becomes an ID-only read-only unavailable entry, not an empty
executable case or an omitted denominator. Complete frozen scope can still be
read when current mutable cases were deleted; partial/unsupported frozen scope
refuses instead of substituting live wording. Existing legacy current-case
fallback is labeled separately, not certified immutable or approved.

The mounted summary uses saved planned scope for known recorded percentage and
remaining work, with executable untested and unavailable procedures separate.
Completion and whole-run exports refuse an unavailable/reduced scope. The server
also independently checks the locked run and current case identity partition
before rollup/status writes. This extra refusal does not clear legacy completion's
independent actor, durable UUID/CAS or late-acknowledgement recovery gaps. Retained
step/whole-case editors and prerequisite/history semantics remain unchanged.

Root repeated 48 API pure/mocked checks and 14 new Web checks. Final complete
compatible Web run passed 803 Node plus 667 typed checks across 61 suites, zero
skipped; API/Web types and scoped lint passed, with four existing manual-page
warnings unchanged. The first full Web attempt failed its original literal
canEdit source guard after two guards were combined; the original guard was
restored separately with the new availability refusal, without weakening tests.
Native SQL, interleavings and authenticated production acceptance remain unrun.

### October 6 actual CI detail browser fixture, DOM proof only

A pinned loopback-only synthetic fixture exercised the actual CI component,
installed Query client, reader, Drawer/DialogFrame and CSS. Twenty then three
results paged under the same admitted ID anchor; blank linked title, distinct
note/error, nullable and zero/negative duration labels were present. The measured
760px drawer had no horizontal overflow. SDK-only and Query-cache A-B-A withheld
all private rows/header/counts while the hook still reported the original actor;
only explicit fresh native-shaped access restored them. RPC and Clerk were fake,
not real authorization or SQL. Two screenshot requests timed out, so no new pixel
inspection or visual acceptance is claimed. The pinned fixture and failed capture
attempts are retained locally; no provider, customer or file action occurred.

### October 6 helper setup protocol foundation, still unmounted

Four additive browser files recognize only the actual helper's exact protocol-v2
paired-liveness shape. Unknown capabilities/versions refuse whole, without a
legacy fallback or inferred foreground target, operation receipt, Windows launch
acceptance, capture permission or semantic redaction. Named screen/control text
may contain sensitive values even when dedicated credential keys are absent.

Injected metadata-only setup reads bind original native/org/Clerk pins and fresh
nonces before and after an injected health read. Independent SDK/frame epochs
revoke stale responses, blocked-launch reports abort owned attempts and private
primitive setup buffers remain retained. Whole metadata admission is 512 KiB /
16,000 nodes / 64 attempts, with explicit pre-health headroom; this is retained
content accounting, not transport parsing or JavaScript heap proof. Raw native
echo history is not promised. Synchronous local presentation rechecks cached
original native scope plus live SDK/frame only, not fresh server seat/suspension
or download/device/processing authority.

Root reviewed all four files and repeated 41 new pure/injected checks plus 30
capture-ownership checks; all 71 passed, with scoped lint clean. Actual setup,
capture caller, connector and launcher are unchanged. Current blocked Windows
launch, physical device/foreground isolation and separately reviewed processing
consent/paid recovery remain open. No helper was launched or queried here.

### October 6 current manual-run view and actionable execution refusals

The additive manualRunReads.current source route requires independently verified
JWT authority, current locked native tenant/actor scope and an exact request nonce
and key. Its whole supported view includes the complete planned/available/missing
partition. Root compared the prior getter's output schema and projection ASTs
against the extracted shared implementation; both fingerprints match exactly.
The legacy getter retains its original wire shape and separate legacy authority
limitations. Existing normalization is retained, not described as lossless raw
native JSON or complete revision history. Current step recordedAt is a server
Date but a UTC ISO string on JSON wire; browser admission must validate that wire
representation independently. The new browser reader/export cutover is not yet
implemented or accepted.

Reviewed step writes now explain recognized closed-run, missing correction,
out-of-limit Pass, unfinished prerequisite, unavailable evidence and unsupported
requested-step situations. Existing whole-case observations conflict with new
per-step execution instead of being replaced. Corrupt/oversized/unsupported native
metadata still refuses with PRECONDITION_FAILED; exact accepted receipts recover
before later business refusals. Read-preview recovery semantics, request hashes,
original authorization, rollback budget and immutable revisions are unchanged.
Native prerequisite duplicate/byte pre-admission and simultaneous same-UUID
acceptance remain open. The strict native fixture is unchanged and unexecuted.

Root repeated 279 mocked API checks across nine actual suites, then 24 read-bound
and scope-schema checks across two suites separately. No native SQL or runtime proof is implied. Source
contracts were relocated to the actual extracted schema/projection and now also
assert the legacy delegation; no admission predicate was removed. One old
unavailable-evidence assertion deliberately changed from PRECONDITION_FAILED to
BAD_REQUEST while retaining its no-private-file-read/no-write assertions.

### October 6 mounted public Windows refusal guidance

The actual capture page now mounts a public checklist only in its existing
user-reported blocked branch. It preserves the original private draft and explicit
policy-permitted manual action. Filename/error/time collection, security-owner
policy review and unsigned-script/Node requirements are separated from OS launch,
paired liveness, foreground device/app verification, capture consent and paid AI
approval. No protection bypass or cause diagnosis is offered. The old assertion
that a failed launch proves the helper never started was corrected to unknown.
The setup/capture/processing transport itself is unchanged and remains open.

Root's seven actual-source SSR/disclosure checks and existing sixteen connection
controller checks passed. A first controller source assertion failed after copy
moved into the component; it now checks that mounted component and its exact
uncertainty copy without dropping the no-OS-action assertions. Scoped lint has
only one existing capture-page effect warning and two existing API test any
warnings. Compatible Web checks passed 803 Node plus 715 typed checks across 64
suites, zero skips; API/Web types passed. The first full Web pass stopped with
three source-contract failures from the getter extraction; the relocated actual
contracts pass. This remains local source/synthetic evidence, not Windows/device
or authenticated production acceptance.

### October 6 authenticated Testmo run-status observation

The existing signed-in Space Shuttle vendor sample was inspected without saving
results, creating runs, exporting files or touching client data. Its run list
shows eight active/three unstarted runs, workload and a success metric. A sample
run's Status view separately shows 73% completed, 143 of 534 remaining and 71%
successful, with Passed/Failed/Retest/Blocked/Skipped breakdowns, creation date,
elapsed time and forecast. From the displayed counts, excluding the three Retest
results from completion is an inference, not a verified vendor business rule.
These observations support separate clearly named progress/success denominators
and remaining-work visuals, not a claim that recorded or passed means accepted.
Export controls were visible but export fidelity was not exercised. This is
hands-on interaction evidence, not a vendor ranking or complaint-prevalence claim.

### October 6 bounded prerequisite result admission

Reviewed step writes now admit prerequisite scalar counts, duplicate identity,
tenant identity and native byte bounds before materializing case/status rows.
The original current-authorized locked transaction, accepted-receipt recovery,
frozen graph/CAS and exact request hashes are unchanged. Empty dependencies do
not issue prerequisite SQL. A genuinely missing or non-Pass prerequisite remains
an actionable business refusal; malformed, duplicate or oversized evidence is
not disguised as missing. No note, observation or attachment body is fetched by
this helper, and no cohort is clipped or deduplicated into a fabricated Pass.

Root repeated 189 mocked checks across five actual suites. The original 58-case
semantic describe block's AST remains identical to the preceding checkpoint.
This bounds transferred metadata, not database scan cost, latest-live all-writer
currentness, native performance or simultaneous same-UUID ACK acceptance. Those
native gates remain open; the retained strict native fixture was not run.

### October 6 current helper setup identity bootstrap

The additive setup identity endpoint establishes only a new current metadata
scope using independently verified JWT identity and the existing four-lock FULL
editor read. Later reads retain the original native actor pin through the distinct
deviceCaptureAccess.read endpoint. Root registered both metadata reads; neither
grants helper launch, foreground target verification, capture consent, source
processing, spending approval or attribution of an old draft/unknown request.
No legacy capture button or operation handler was adopted by this registration.
Root's 50 mocked bootstrap/current-access checks and API types/scoped lint passed.
Actual guarded setup caller integration, OS launch and physical-device acceptance
remain unfinished. No helper request, launch or live identity change was made.

### October 6 recurring-friction research refresh

The [current Qase run guide](https://docs.qase.io/en/articles/5563702-test-runs)
documents suite/plan/saved-query selection, result-based completion, status
visuals, start/time context, exports and separate retest/clone workflows. Its
snapshot rule distinguishes untested source updates from recorded frozen cases.
These are documented capabilities, not this turn's hands-on acceptance. Vaettir
must keep its own frozen procedure, missing-scope and reviewed correction rules;
copying a visual does not justify mutating recorded evidence or public sharing.

A [June 2026 first-person discussion](https://www.reddit.com/r/QualityAssurance/comments/1tz5j5z/search_for_good_test_management_tool/)
describes friction in manual result entry despite tools' integration/reporting
focus. A [January 2024 Testmo discussion](https://www.reddit.com/r/QualityAssurance/comments/1947q9v/testmo/)
mixes positive everyday usability with spreadsheet markup/PDF-layout complaints
and older Qase archive/field concerns. These are dated anecdotes, not prevalence,
current vendor defects or rankings. The current Qase guide contradicts treating
the old archive complaint as a confirmed present limitation. A direct Testmo
changelog fetch failed, so its current export implementation was not verified.
Use these as regression prompts: retain useful prose, reduce repetitive entry,
make export scope/format explicit and verify exact frozen procedures, not as
evidence that more charts or fields automatically improve the workflow.

### October 6 run-export browser boundary checks

All three mounted manual-run export formats now pass their scope callback into
the shared download mechanics. It checks before/after Blob preparation, after
URL allocation and immediately before clicking the download anchor, and releases
allocated URLs even if preparation or clicking throws. Existing three-argument
callers retain their ordinary behavior. No file is fetched or uploaded.

Root's nine actual mechanics tests, two existing summary-scope checks and six
portable-report checks passed, as did scoped lint and Web types. The first type
check found an unchecked test AST argument; optional access now makes a missing
fourth argument fail the test without a TypeScript non-null assertion or waiver.
These are synthetic local checks, not a real export/download acceptance. The
actual manual page's older broad boolean scope callback still needs the new
captured immutable native reader binding. This boundary change alone does not
prove actor/session ABA safety, production deployment or full audit fidelity.

### October 6 retained helper setup owner and metadata surface

The new standalone setup hook/card uses the current-only native bootstrap and
strict pinned metadata reads, with explicit fresh nonces. Actual SDK listener
installation must return cleanup before metadata can be admitted. Observed SDK
resource/session changes revoke old callbacks; unsupported complete bootstrap
metadata is bounded before parsing, without invoking accessors or stripping a
private body. Loss of current access hides retained setup buffers and uncertain
attempts instead of rebinding them to another actor.

Root repeated 24 focused owner/hook/markup checks and 41 existing protocol/setup
checks, all passing, with scoped lint clean. These use synthetic React/Clerk/RPC
boundaries, the actual retained owner and TanStack, plus static React markup.
They do not verify genuine framework mounting, authentication, native SQL, helper
HTTP, Windows launch or device operation. The hook/card remains unmounted. No
default health transport, polling, download, discovery, capture or AI action is
provided. A future isolated metadata mount must not make the old capture-ready
flag, legacy source drafts or unsafe operation buttons look verified.

### October 6 whole-run browser reader and private row retention

The new browser reader pins the original project/run/workspace/Clerk intent
before accepting a body, then the independently verified native actor echo. It
admits the complete supported wire projection and ordered planned/available/
unavailable partition; no unsupported field or procedure is dropped. Literal
enum strings, exact UTC wire dates, NULL, empty text, multiline descriptors and
zero measurements are preserved or refused explicitly. Client inspection caps
are 16 MiB escaped JSON, depth 64 and one million nodes, with existing field and
cohort limits. These are browser refusal limits, not expanded native capacity.

Installed SDK monitoring, query-cache and render epochs revoke observed
actor/session/resource A-B-A changes. Captured old callbacks stay refused after
a newer valid layout. Cleanup revokes before SDK callbacks and withholds cleanup
exceptions; restoring a cached pointer cannot silently restore a native nonce.
An entirely unobserved SDK swap cannot be claimed detected. The reader owns no
write draft, paid request or UNKNOWN outcome.

The separate private mounting helper pins the first ordered planned scope of at
most 1,000 identities, retains only one latest admitted payload per seen identity
and keeps disappearing procedures privately mounted. Scope/order/actor or full
retention-bound changes refuse the whole candidate without eviction or a stale
progress/export denominator. Never-available identities get no invented row.
Its bounds do not establish total child-draft/cache memory or performance.

Root repeated 82 reader/admission checks and 33 private-retention checks, with
scoped lint and current Web types passing. Root review found enum String coercion
and stale callback/cleanup boundaries; the fixes add negative regressions rather
than weaken assertions. Retained intermediate failed test/type evidence remains
distinct from the final local checks. Actual manual-page/child/export cutover and
synthetic real-page rendering are still unfinished. These unmounted foundations
do not certify genuine authentication, native SQL, completion UUID/CAS recovery,
production deployment or acceptance of James's reported workflows.

The final compatible Web suite also passed: 803 Node checks and 863 typed checks
across 70 files, with no skipped checks. This covers the reviewed source state,
not the later drag-affordance workstream, a release build, genuine browser/device
acceptance or any retained failed native/runtime/security gate.

### October 6 actual manual-page cutover (source in progress)

The actual manual execution page now uses the held whole-native reader rather
than the legacy query. Its private row union is React state, with immutable
candidate identity consumed once, including refusal. Missing procedures retain
their original keyed editors but do not appear in current facts, progress,
prerequisite verdicts or exports. Never-available procedures are still honest
unavailable identities, not invented instructions. No draft or pending UUID is
cleared when the reader is withheld.

Navigation, quick outcome intents, filter changes, linked-page navigation and
all three current-run exports require the captured posted page stamp and exact
reader snapshot equality. Render can revoke an older frame; only layout posts
a new action stamp. Serialization and final download still recheck this same
held snapshot. Explicit metadata-discovery retry is separate from a fresh
native-read intent, avoiding adoption of a newer actor after an awaited lookup.
Children receive the parent's original native pin before their first read;
exact parent presentation/controller integration is being validated separately.

These are in-progress source changes, not a completed rendered workflow or
production acceptance. Initial integration types failed on the not-yet-added
child presentation props and two readonly test-fixture mutations; that evidence
is retained. Root repeated 17 private-row publication checks, six migrated
current-scope source contracts, two progress checks and nine download checks;
53 existing/first-pin child checks also passed at that intermediate source
state. The final full compatible suite and mounted synthetic page checks remain
separate, as do real framework mounting and native API verification.

Legacy run completion still lacks a reviewed durable UUID/receipt, original
native intent and result-cohort CAS/recovery protocol. Guarding its confirmation
and late response presentation does not repair those server boundaries. Retest
still lacks a server-native actor pin. Whole-case access currently fixes the
original observed session, so renewed same-owner session recovery requires a
separate protocol without rewriting held request provenance. None is claimed
resolved by parent props, source tests or a successful metadata read.

Fresh authenticated Testmo vendor-only inspection showed folder context,
priority/latest-result/tag columns, and a case-name/ID search with six matches
across multiple sample folders. Its search-result selection explicitly resets
filters. This is observed interaction feedback, not proof of sort/drag
persistence, customer-scale performance, export fidelity or a recurring vendor
defect. Vaettir should make selection/filter transitions explicit and provide
stable-ID context; it must not mistake a view-only ordering action for a move.
Opening one matching sample showed compact template/estimate/priority/tag
metadata, distinct prose description and expected behavior, and separate
comments/results/issues/history sections. No edit or comment was submitted.
The signed-in trial user's comment box is not proof of read-only-member
permissions. Preserve useful prose and distinguish test data from aligned
per-step technical descriptors rather than replacing every field with a menu.

The final compatible Web source check for this cutover passed 804 Node checks
and 969 typed checks across 74 files (1,773 total, no skips); Web types passed.
Root independently repeated 165 child hook/controller checks across nine files,
the 23 actual-page boundary checks, and 10 new drag-affordance checks plus five
existing repository contracts. Scoped lint has zero errors and nine disclosed
page warnings; no rule was disabled. Intermediate source-contract extraction,
tuple/type and CSV-quote failures were repaired without removing the original
permission, frozen-procedure, receipt or lossless-data predicates.

Private pending completion counters now update synchronously without revoking
the submitting child's own presentation frame. A real reviewed-step controller
driven through the actual page callback made exactly one synthetic submission
and one exact ACK, retained multiline text/zero/UUID/hash, and blocked completion
before React rerender. Native scope and export facts do not change merely
because a private draft is pending. CSV now carries each exact case record ID
even when human display IDs are absent, with native prerequisite-ID fallback;
filtering never silently shrinks its authorized complete run scope.

This remains source/mock proof, not full nested React/concurrent browser or
native/production acceptance. The whole-case reviewed and retest routers still
need independent authenticated-subject transport review; cached native Clerk
metadata must not stand in for verified JWT authority. Retest native-owner pins,
whole-case renewed-session recovery, legacy completion recovery and prior failed
native/runtime/image-security/migration/recovery/release gates remain open.

Repository drag-handle activation now provides a view-only route into manual
ordering, selecting a suite only when its raw supported path is in the current
persisted catalog and agrees with the exact placement baseline. Source-only,
unassigned, unsupported or stale groups are not silently materialized. Case
hover no longer advertises unsupported tree targets. Existing mouse payload,
move/CAS submissions and failure behavior are unchanged. Handler/SSR source
checks are not physical keyboard/mouse or native persistence acceptance.

### October 6 Qase project-field interaction and verified case transport

Fresh authenticated inspection of the authorized Qase trial's vendor DEMO
project showed project settings for enabling milestones, steps, tags and the
Classic step input-data field, plus a Classic/Gherkin default. Workspace fields
separately distinguish single-select case metadata from paragraph description,
preconditions and postconditions, with project applicability and required-state
columns. Opening Priority showed a default and an all-projects applicability
control; its value editor keeps stable slugs and configurable icons. This was
read-only inspection; no setting, value or case was saved. Color semantics and
project-specific persistence were not tested. These observations support compact
typed metadata while retaining useful prose, not universal dropdown conversion.
The input-data setting does not replace James's aligned per-step technical
descriptor, and optional compliance fields must remain project-appropriate.

The four reviewed whole-case routes now require the independently verified
human transport subject before calling a service. The cached native user's
Clerk mapping is never used as that proof; API-key backing users do not acquire
human evidence authority. Existing native scope locks still compare the subject
and original native-owner pins before evidence/receipt operations. Input schemas,
request hashes and the three legacy route shapes are unchanged. Root repeated
39 actual protected-router transport checks plus 21 existing reviewed service
checks (60 total); API types and scoped router lint passed. Services, JWT
cryptography and database transport are mocked in the new tests, not native or
production proof. Legacy direct-service provenance, native positive fixture
contexts, renewed sessions, retest ownership and completion recovery remain
separate validation/compatibility work; this is not a deployment checkpoint.

The two owned native fixture context factories now receive independently
declared synthetic subjects rather than inferring them from a reread native
user. All 29 existing native scenarios and assertion semantics are retained.
Root repeated strict authored compilation and read-only AST comparisons of
the registration expressions, 266 assertion calls and direct historical/legacy
service or seed calls against the preceding checkpoint; none changed. No native
fixture, database connection, erasure, trigger or teardown was executed. These
fixtures remain AUTHORED, NOT RUN, and do not erase prior failed native evidence.

### October 6 reviewed run creation and nested execution recovery

The run list now sends its all/filter/suite selection into the existing,
always-mounted configuration review instead of a second direct start mutation.
The selected approved native IDs are frozen by an explicit user event; captured
older selection callbacks cannot replace them. Pre-send scope edits still use
the modal's SET/ADD/REMOVE controls. The first send locks that cohort, and an
uncertain acknowledgement retains the original configuration/body/UUID. Only
the controller's matching acknowledgement navigates to the original project's
run. Transport errors are classified without displaying raw private messages.
The dashboard CSV path also rechecks the captured authorized review at the
actual download boundary. This does not add a new-run/reset workflow to the
same mounted host, nor certify SDK-only session A-B-A safety in the older run
configuration access layer.

Whole-case review now distinguishes the immutable original owner/session from
an explicitly renewed current session of that same owner. A separately
installed Clerk listener, layout-published access proof and fresh original
native-owner read must agree before current handlers are admitted. Session
changes do not rebase an unsent review or uncertain request. Recovery can
acknowledge the exact earlier request; read-only access cannot create evidence.

Root exercised the actual manual page, nested editors, current reader and real
TanStack provider in an ignored loopback-only synthetic browser fixture. The
first attempt failed because the fixture bundled two TanStack provider copies;
the corrected fixture binds one actual installed module, not a fake provider.
Nested rendering then exposed a real first-observation defect: an unadmitted
waiting frame poisoned the access UUID that would later receive its first
completed read. A new regression failed before the fix. Only positively admitted
readers now acquire the revocation latch; waiting frames remain unauthorized.
Both new waiting-frame regressions and all 49 earlier controller tests pass.
The real nested whole-case editor subsequently opened successfully.

The same rendered fixture retained separate whole-case and step requests after
lost synthetic acknowledgements, dialog close, filtering and native refusal.
An exact step retry acknowledged only that step while the whole-case request
continued to block completion. The later whole-case retry acknowledged its own
original UUID and multiline note. Visible fixture metrics showed two synthetic
receipts, two byte-exact replays, stable case DOM identities, zero completion
calls and zero network/native/provider/device operations. The aligned saved
tester/technical/expected procedure columns were readable in the inspected
desktop rendering. Missing-row recovery, full concurrent rendering, physical
devices and production behavior were not established by this exercise.

Root repeated the full compatible Web suite: 805 Node checks plus 1,032 typed
checks across 75 files, 1,837 passing with no skips. Web types and scoped
17-path lint passed with no errors or warnings. Earlier source-contract and
fixture build failures remain recorded locally; no original test predicate was
dropped to manufacture a passing result. The preview's approved source hashes
include existing core distribution inputs, not a fresh core-build attestation.
Native ABI/runtime/image-security, migrations/recovery and authenticated
production acceptance remain separate, unwaived gates. This is a source
checkpoint, not a deployment or completion of every reported parity gap.

### October 6 current setup surface and session-safe run review

The actual live-app generation page now mounts a metadata-only helper setup
card outside capture-mode and read-only generation sections. Its six-field
intent contains no pairing credential, device target, capture buffer or paid
draft. Explicit review establishes current native metadata and rereads the
same native owner with a fresh nonce. It never constructs a paired-helper
workflow or invokes even an injected health transport. Complete metadata
responses are admitted with descriptor and aggregate retained-content bounds;
these are not transport/heap or native-runtime attestations.

Public Windows-refusal reporting first revokes the card's pending reads, then
synchronously cancels the page's separate polling/discovery generations. It
preserves existing pairing, targets, captures and paid drafts, including when
current metadata identity is unavailable. It does not diagnose Windows policy,
claim that capture stopped, bypass endpoint security or prove an OS launch.
The older automatic pairing initialization and helper operations remain
separate legacy paths; this card does not make them newly safe or accepted.

The actual run configuration modal now requires an installed session monitor
with a real cleanup function. Observed SDK-only A-B-A, resource replacement,
missing monitoring or disposal latch private admission closed; a return to
the earlier hook values does not revive old handlers. Explicit original-access
recheck needs successful current project/member/profile responses and an owned
monitor/visibility token. Exact submitted configuration, cohort, UUID and
private matching acknowledgement remain retained. This is browser-local
admission, not a new native reader nonce/actor echo or a next-run reset feature.

Additive retest transport wrappers require the independently authenticated
session subject and the original native actor before private service calls.
ACCESS is explicitly membership metadata only, not source-relationship proof.
Preview/link reads have exact request/nonces and bounded complete projections;
start wraps the unchanged legacy parsed request and native-owner/UUID identity.
Unsupported DTOs and native error details fail generically without clipping or
new normalization. The old three endpoints and service/hash/receipt behavior
are unchanged. The actual retest wizard has not been cut over, so its older
session/native-owner gaps remain open. Legacy normalization and JavaScript
date precision are disclosed, not certified lossless native evidence.

Root repeated 84 focused API checks across all four intended retest files.
The first command matched only three files because one filename was wrong;
the corrected four-file command passed. Full compatible Web checks passed:
805 Node checks and 1,090 typed checks across 76 files, 1,895 total with no skips.
The first full run retained seven failing older handler fixtures because their
extracted page function set omitted the new cancellation bridge. Adding the
actual bridge and counter to that harness repaired it without changing any
of the sixteen original assertions; all sixteen and the full suite then passed.
Eight new actual-page-body checks additionally verify no helper/pairing/paid
calls, unavailable metadata refusal, read-only placement and preserved legacy
state during synchronous cancellation. These use synthetic hooks, not physical
devices or full React effect/lifecycle acceptance.

API and Web typechecks passed. Scoped source/test lint passed with zero errors;
the live-app page retains its previously disclosed layout state-update warning.
No warning was suppressed to claim a clean page. Native SQL/fixtures, migration
and recovery, signed Windows/device acceptance, full runtime/image security and
authenticated production remain unverified; all prior failed gates remain
failed. No deployment, provider/source processing, customer mutation or AI
spend occurred.

The retained rendered manual-page fixture also exercised SDK-only A-B-A.
Private procedures disappeared until explicit original-run recheck; original
case DOM identities and the two known receipts remained. Counters stayed at
four synthetic write attempts, two receipts/replays, zero completion calls
and zero network/native/provider/device calls. This is the earlier hash-bound
fixture, not a rendered attestation of the newly changed helper or run modal.

Fresh authenticated Testmo vendor-sample inspection confirmed all-case run
creation, a folder checkbox picker with selected/total counts, match-all/any
filters, priority/state/tags/latest-status criteria and an import-from-run
affordance. Both picker and run form were canceled without submission.
The vendor picker displayed draft, under-review and rejected cases alongside
active ones; Vaettir deliberately keeps approved execution selection separate
from its review queue. Aggregate workload/success and individual completion
visuals are different facts and should remain labeled separately. No export
format/fidelity, scaling, competitor ranking or recurring-defect prevalence
is inferred from this sample interaction. The earlier dated complaint sources
remain research inputs, not reasons to copy every vendor behavior.

### October 6 explicit helper response and native run-start read foundation

The actual helper page no longer polls after a launcher download. Downloading
prepares only the local file and preserves existing pairing/device drafts.
An explicit paired-response check makes one redirect-denied, credential-omitted
loopback request with an eight-second abort deadline. The new stream reader
admits exact HTTP metadata, at most 512 delivered bytes, strict UTF-8 and the
existing two-key v2 liveness response; malformed, oversized, duplicate-key or
stale responses refuse generically. Health no longer initiates discovery, and
discovery no longer automatically changes the selected device. The visible
status describes paired liveness, not launch, foreground isolation, device or
processing permission. Existing automatic pairing initialization, installed
session/native authority for legacy operations, capture/paid late responses,
Windows signing/distribution and physical acceptance remain open.

Additive, still-unmounted run-start ACCESS/PREVIEW routes now require an
independently authenticated subject and fresh native org/member/project/User
locks. ACCESS returns membership capabilities only. PREVIEW requires the
original native actor, admits bounded complete profile text and verifies a
native JSONB round trip before hashing the complete stored profile. Unsupported
profiles receive no fabricated hash; current full-editor recovery capability
does not establish receipt acceptance. No writer, UUID/hash/receipt behavior,
legacy callers or central registration changed. Older unpinned plan attempts
cannot be relabeled as reviewed by injecting today's identity into their body.

Root repeated 18 actual extracted helper-handler checks, 56 typed helper/page
checks across three files and 70 API schema/read/protected-transport checks
across three files. Full compatible Web tests passed: 807 Node plus 1,127 typed
checks across 77 files, 1,934 total with no skips. API types passed. Subsequent
whole-Web typechecks encountered in-flight, separately owned retest foundation
test typing failures; these failed attempts remain recorded, not substituted
with the earlier suite result. Scoped helper lint has zero errors and the one
previously disclosed page layout warning. Synthetic source/mocked transaction
proof is not native SQL, full React, Windows/device or production acceptance.
Prior native/runtime/image-security/migration/recovery failures remain failed.

Fresh authenticated Qase vendor-sample interaction confirmed repository,
test-plan and saved-query run sources. Its picker visibly selected 51/51 cases
globally; entering a login search reduced visible folder counts to 1/1 and 6/6
without silently discarding that original global selection. Both unsaved
dialogs were canceled. The existing synthetic run exposed stable IDs,
priority/automation icons, separate started/elapsed/total-time labels, team
stats/timeline navigation and an export dialog with CSV/PDF choices. Export
was canceled; file fidelity, result writes and scale were not tested.

The current [Qase run guide](https://docs.qase.io/en/articles/5563702-test-runs)
also documents completion visualization and repository/suite/plan/query
selection. This contradicts treating older reporting complaints as proof that
Qase currently lacks reporting. Two dated practitioner discussions,
[tool-switching friction](https://www.reddit.com/r/QualityAssurance/comments/1d4duuv/test_management_systems_which_one_you_likedislike/)
and [test-management problems](https://www.reddit.com/r/QualityAssurance/comments/1de3w0h/test_case_management_system_what_are_your_top/),
repeat themes of search friction, fragile editing/results/attachments and
reports that lack actionable context across teams/environments. They are
mixed anecdotal research inputs, not current defect verification, prevalence
estimates or vendor rankings. Vaettir's acceptance should therefore test
retained selection versus visible filtering, lossless recovery, usable search
and evidence-linked remaining/blocking work, not merely copy graphs or labels.
No customer/provider/source processing, AI spend or deployment occurred.

### October 6: reviewed retest reader and progress semantics

Four new, still-unmounted browser retest reader/hook files admit complete
supported ACCESS, PREVIEW and LINKS projections with original native actor,
organization, Clerk actor, run/case, exact request key and fresh read nonce.
Independent installed SDK/cache monitoring and render/layout guards revoke
old callbacks through observed session/resource/cache changes. ACCESS is
membership-only, not source-relationship or creation/recovery permission;
private preview/links require an explicit current read. Original nullable,
empty, multiline and zero values remain intact; unsupported projections are
refused whole. Existing Wizard/callers and accepted write bodies are unchanged.

Root independently repeated 59 focused reader/hook checks, scoped lint and
whole-Web types successfully. Full compatible Web validation passed 807 Node
and 1,186 typed checks across 79 files: 1,993 total, no skips. This repairs the
previously recorded in-flight test typing failures, not native/runtime or
production gates. Four-file hashes were checked against the agent freeze.

Fresh authenticated TestRail vendor-sample inspection showed visual open-run
cards with separate colored outcome counts, milestone dates and a percentage,
plus completed runs grouped by date. Its sample run displayed 89 passed,
21 blocked, 17 retest, 12 failed and 113 untested out of 252. The overview's
35% was the passed fraction, not percent completed. The Progress page
separately labeled 48% completed (122/252), started time, remaining tests/effort,
recorded elapsed effort, forecast date and forecast accuracy. Chart PNG/CSV
controls were visible but not clicked; export fidelity and forecast validity
were not tested. Vaettir should explicitly distinguish recorded progress,
pass rate, remaining work, elapsed effort and release acceptance, rather than
copy an ambiguous percentage or an unsupported forecast. No vendor results
or samples were modified.

The retained actual-page synthetic fixture accepted one new exact whole-case
intent with a deliberately lost fake acknowledgement. Its pending completion
interlock disabled Complete. A subsequent smaller planned cohort withheld
private current facts and exports while retaining the original case DOM node
and exact UUID/body. Restoring the original cohort has not yet re-established
rendered access in this scenario; that runtime acceptance remains open and is
not replaced by green model checks. Eight local source/schema selfchecks,
including accepted receipt/cohort change/restoration, pass. All real native,
provider, device and network counters remain zero. The existing hash-bound
bundle does not attest the new retest foundation or new helper changes.

Four additional unmounted API extraction files preserve the legacy manual-run
start parser, normalization, hash property order, durable UUID-derived identity,
receipt-before-current-profile behavior, original transaction ordering and
RepeatableRead/P2002 recovery. Optional independently supplied reviewed pins
are checked inside every original authorization transaction, never injected
into the retained inner request. Recovery-only mode cannot create a run, and
an old unpinned receipt does not prove historical reviewed workspace/native
provenance. Root independently repeated all 35 source/synthetic checks, API
types, scoped lint and exact freeze hashes. Original router/callers remain
unchanged. Native precision, transport binding, SQL/concurrency, lossless new
writer and rendered caller acceptance remain separate open requirements;
these checks do not authorize a production cutover.

### October 6: restored manual-run rendering and report context

The earlier original-cohort restoration failure is preserved above. A later
explicit recheck in that retained fixture restored the original three-case
view and recovered the exact lost-ACK request, without replacing its UUID or
multiline note. Diagnosis found a concrete mount interaction: a newly visible
failed-case retest child refetched populated shared project/membership caches,
revoking the parent reader immediately after its explicit current read.

The mounted Wizard now declines only those two mount-triggered metadata
refetches. Empty caches still fetch; explicit refresh, focus, invalidation,
fetching/error/paused/role/identity checks and current-read nonce revocation
remain intact. Fourteen new tests exercise the actual installed TanStack
observers using the actual component's option and readiness expressions.
Two old exact option-string assertions were updated without removing any
privacy, pending-request or receipt assertions. Their initial failures and
the before-patch mount reproduction remain recorded.

A separately versioned actual-page bundle reproduced the full sequence:
lost fake ACK, smaller-cohort refusal, original-cohort restoration through
one explicit recheck, then exact UUID recovery. The newly mounted retest
child no longer hid the restored run. All three original case DOM identities
survived; the pending request still disabled Complete. Recovery confirmed
revision 1 with two attempts, one receipt and one exact replay. The exact
multiline note survived. Complete was never invoked; real network, native,
provider and device counters stayed zero. The old fixture and its buffers
were preserved. This is actual React/TanStack rendering with synthetic RPC,
not native authorization, database, production or full retest acceptance.
The bundle pins existing core-dist bytes, not a regenerated core build.

The new unmounted retest controller independently pins the held native actor
when verifying ACKs. UNKNOWN retries preserve the exact original body and
UUID; supported current PREVIEW is conservatively required. Membership ACCESS
is not sufficient. Matching late ACKs settle privately, and publication needs
current LINKS containing the confirmed target. Legacy scope-absent attempts
are retained without injecting today's pins and cannot be transmitted through
this reviewed wrapper. Unsupported/deleted-source recovery and actual caller
cutover remain open.

The new unmounted helper publication owner binds each private result to its
exact original client frame, selected target/input, SDK generation and latest
lease. Supported late data stays private; retained originals are not silently
evicted. Oversized/accessor bodies retain the prior data and uncertain intent,
not a claimed full unsupported response. The bounded retained-content budget
is not a total heap or transport bound. This does not authorize capture,
foreground access, processing, spending, retry or physical-device acceptance.

Root repeated 60 controller/ACK/metadata tests and 55 helper ownership/lease
tests. Full compatible Web validation passed 807 Node plus 1,267 typed checks
across 82 files: 2,074 total, no skips. Whole-Web types passed. Scoped lint has
zero errors and two independently confirmed inherited Wizard warnings.
Initial test-only excess-property type errors were repaired without loosening
production types. Native/runtime/image-security/migration/recovery and
authenticated production failures remain unwaived; no deployment occurred.

Fresh authenticated Testmo inspection generated a read-only milestone report
from its vendor sample. It combines manual runs, exploratory sessions and
automation with separate status/progress sections, dates, remaining counts,
tags and contributors. The sample explicitly distinguished 37% completed
from 36% passed and showed 1,346 remaining out of 2,142 in its aggregate;
these are not asserted to be unique repository cases. Individual run cards
separately showed their own totals and remaining work, while session entries
and automation threads used different denominators. Changing the selected
milestone left the old report visible but disabled its PDF action until
regeneration, a useful stale-report guard. The initially visible all-milestone
choice produced a required-milestone validation error in this one interaction;
that is not evidence of recurring prevalence. No sample results were changed,
PDF was not invoked, and export fidelity or forecast validity was not tested.
Vaettir should label each population, preserve provenance and distinguish
remaining work from pass rate, rather than copy an ambiguous aggregate.

### October 6: case-field and comment interaction follow-up

Fresh signed-in Qase vendor-sample inspection found stable-ID case links and
compact priority/automation indicators with named tooltips. Case detail keeps
description and pre/post conditions as prose, while priority, severity,
status, behavior, type, layer, flaky state and automation use dropdown fields.
The unsaved editor exposes per-step action, data and expected-result cells,
plus separate parameter, tag and attachment sections. Its Configure fields
affordance was observed, but its settings behavior was not verified: attempted
navigation opened an unsaved-editor confirmation, and later browser focus
inspection stalled. No field value was entered or saved.

The separate Comments tab exposes its own composer and a disabled empty Send
action. No comment was posted. This owner-session observation does not prove
read-only member comment permissions, and no vendor role or access policy was
changed. Vaettir's aligned technical descriptor remains a distinct per-step
field, not a claim that Qase's data cell has that same meaning. Useful prose
must remain prose; compact icons still need accessible names, exact searchable
case IDs and separate author/current-role acceptance.

The existing authenticated Notion roadmap now has a current source/workflow
review above its historical ledger. It records all of James's reported
requirements, the exact 6d3a279 source and synthetic-browser evidence, current
In Progress scope and open native/production gates without relabeling old
deployed identities or marking the whole parity effort complete. The update's
async completion and exact content were fetched and verified. Root separately
repeated 84 existing mocked retest transport/schema/large-scope checks across
four files; this is not native database or current in-flight consumer proof.

### October 6: reviewed run-start body admission

The still-unmounted extracted writer now has a reviewed-only admission path.
Under its existing locked authorization, exact receipt recovery reads bounded
ID/project/starter/request-hash scalars rather than materializing a whole saved
execution context. Accepted-UUID recovery does not require a newly supported
profile, current procedure cohort or a new creation. The legacy branch keeps
its original parsing, configuration normalization, hashing, ordering,
acknowledgement, UUID and transaction/recovery behavior.

For new reviewed starts, native graph/cohort/profile/template count, byte,
type and relationship probes precede private JSON decoding. Narrow projections
exclude unrelated custom/source/risk bodies. Shared procedures must belong to
the same project and remain unarchived. Full supported cohort admission
refuses unsupported precision or authored-field normalization; no partial
subset or clipped procedure is substituted. Existing 1,000-case, 10,000-link,
500-entry procedure and 2 MiB frozen-context limits remain. Equality checks
are batched across at most 32 cases per probe; the synthetic 1,000-case test
uses 32 probes, not evidence of native latency or concurrency acceptance.

Known missing verification/step fields still have an explicitly supported
legacy default interpretation. That distinction is currently internal, not
persisted or consumer-visible; it cannot be advertised as arbitrary raw or
lossless snapshot fidelity. Native JSONB equality can detect unsupported
JavaScript numeric representation, not preserve every original decimal spelling.
Unknown authored verification/step properties refuse instead of disappearing.

Root checked the frozen source hashes and independently repeated 83 tests
across three source/mocked suites, API types, strict standalone compilation of
both modified test files and scoped lint with zero errors/warnings. Existing
legacy AST comparisons now verify the exact additive reviewed receipt branch
before comparing every unchanged legacy statement. Reviewed mocks model the
new bounded SQL projection and its byte counts; original authorization,
P2002/unknown recovery, hashes and receipt-first assertions remain enforced.
Initial old-mock and branch-comparison failures, two Root adapter attempts and
an initial BigInt test-title collection failure are preserved as failed evidence
before correction. No native SQL, precision codec, concurrent commits, mounted
transport/caller or production acceptance is established. Reviewed transport
and retained caller cutover continue separately; no deployment occurred.

### October 6: reviewed run-start write transport

The unmounted reviewed router now adds START and LEGACY_RECOVERY endpoints.
New starts require the complete originally reviewed profile/configuration,
distinct supported case IDs, original tenant/Clerk/native author and durable
UUID. Recovery retains old inner omissions and exact key order; it does not
inject newer pins, read a new profile or authorize replacement creation.
Descriptor/byte admission rejects unsupported whole envelopes before getters,
normalization or cloning. The separately frozen writer still owns legacy
normalization, request hashing and every current held-lock authorization check.

A response confirms the deterministic original native-author/UUID run ID and
exact compatible legacy acknowledgement. Its current-scope echo explicitly
marks historical outer provenance UNRECORDED and interpretation
LEGACY_NORMALIZED_NOT_RAW_LOSSLESS. It cannot prove retrospectively recorded
Clerk provenance, raw-native fidelity, or distinguish new creation from replay.
Malformed acknowledgements and private error bodies remain generic UNKNOWN
responses; no automatic retry, UUID replacement or private cause is published.

Root repeated 190 checks across five pure/mocked suites, API types, strict
standalone compilation of both new/modified tests and scoped four-file lint
with no errors or warnings. All original ACCESS/PREVIEW describe assertions
remain AST-identical; new write tests are additive. Two initial negative tests
incorrectly defaulted an omitted synthetic subject and were corrected without
relaxing production checks. No native SQL, real JWT/RPC, registered route,
caller or production acceptance is established. Actual caller cutover remains
independent work; no deployment, migration or live permission change occurred.

### October 6: retained retest consumer and helper presentation repairs

The actual retest consumer now uses explicit independently native-pinned
ACCESS, FULL preview and paged LINKS reads. Its original metadata hook and
sixteen legacy owner initializers remain unchanged. Old UNKNOWN bodies or
known receipts without original native submission provenance stay opaque;
current access never invents that pin or sends a replacement. A separate
reviewed owner remains mounted through temporary privacy refusal or an
explicit legacy handoff. It retains exact body/UUID and privately settles a
matching acknowledgement, then requires a current LINKS page containing that
specific target before navigation. Unsupported/deleted-source UNKNOWN retry,
old already-captured callbacks, reload and hot-reload persistence remain open.

The actual helper page keeps prior capture/draft buffers private, refuses
unsupported whole imports without clipping, and independently guards late
file, generation and commit presentation with installed SDK/frame ownership.
Root review caught connection-generation divergence after explicit health and
unscoped saved-title publication. All connection transitions now synchronize;
new raw commit labels are budget-admitted and visible only in their exact
original frame. Legacy labels remain unattributed. A captured Save handler
cannot dispatch a superseded draft list; late replies cannot remove a newer
list or append current saved labels. These are presentation/intent safeguards,
not durable paid UUID/credit-recovery proof.

Physical capture deliberately refuses before helper HTTP because actual
foreground targeting and scoped capture/processing consent are absent.
Paired v2 liveness, installed SDK and workspace metadata grant none of those
permissions. Native helper inspection also found pre-foreground hierarchy
reads, sole-device fallback, display-name identity and clipping still in its
separate implementation. No device, command, Windows security policy or
provider operation was exercised. Signed Windows launch and native acceptance
remain open; this checkpoint does not call the helper operational.

Final compatible Web checks passed 807 Node plus 1,300 typed assertions with
zero skips, Web types and scoped lint with zero errors/three inherited
warnings. Original metadata observers, controller guards and legacy privacy
assertions remain enforced. Old extracted caller fixtures initially lacked
the new actual ownership/SDK dependencies; Root supplied the actual source
dependencies and retained every original assertion. Failed evidence remains.

Nineteen new author-only v4 fixture schema/model checks and compatible types
passed. Its browser build plan then failed on server-only node:crypto imports
reached through the authoritative retest schemas, before evaluation, artifact
write or server launch. No substitute schema or crypto shim was admitted.
An exact unchanged-schema extraction is separate active work. Consequently,
this new consumer/helper source has no fresh rendered-browser, native SQL,
authenticated production or deployment acceptance. Older 8901/8902 synthetic
manual-run buffers and successful narrow metadata-mount evidence are preserved,
not relabeled as this new consumer proof. All prior release failures remain.

### October 6: actual retest browser recovery and bounded run-start metadata

The two authoritative legacy retest input constructors now live in a pure
schema module and are re-exported as the same instances. Root independently
compared their ASTs and all remaining service/helper statements with the prior
source: inputs, hashes, UUIDs, bounds and native service behavior are unchanged.
This removes the server crypto/Prisma import edge from the browser DTO graph;
it does not replace the schema or waive the earlier failed build evidence.

A hash-reviewed 75-input actual React/TanStack manual-page fixture then exposed
two additional defects: repeated getter revocation dispatched render-phase
state updates after the private view was already withheld, and enabling an
already mounted stale metadata observer on modal open refetched the verified
parent. The getter now returns null before further publication once its view
is null. Actor readiness alone keeps metadata observers subscribed; private
modal, current-native, membership/role, fetching/error/paused and mutation
gates remain unchanged. Installed TanStack regressions reproduced both stale
refetches before repair. Two obsolete literal assertions were reconciled while
preserving their original privacy, exact-request and acknowledgement guards.

Root exercised the actual mounted retest controls: Failed source, explicit
original access and FULL review, synthetic lost response, Close/reopen, fresh
FULL read, identical retry and independently current LINKS. Two exact matching
body/UUID sends produced one in-memory receipt and one replay. The original
case remained Failed; progress showed 33 percent recorded and two remaining,
not a pass rate. No real native/provider/device calls, network requests, run
completion or navigation occurred. This is synthetic browser recovery proof,
not database durability, real session/tenant authorization or production proof.
Earlier failed and successful fixture versions and mounted buffers remain
preserved locally; raw bodies, screenshots and build manifests stay out of Git.

Four new, still-unmounted run-start metadata reader/hook files admit exact
ACCESS/native identity and supported profile-only PREVIEW. They do not admit a
case cohort/configuration/procedure, find a receipt or authorize starting a
run. Independent review reproduced silent render/layout SDK loss, throwing
SDK getters and repeated revoked-view setters; those failures now refuse
generically without reviving the old nonce. Cache scans are query-specific;
retired nonce history has finite count/byte bounds and permanent exhaustion
refusal, never pruning or resetting another owner's draft/request. Actual
caller/controller/namespace cutover remains open.

Root checks on the final coherent source passed 807 Node and 1,412 typed Web
assertions across 86 typed files, 2,219 total with no skips, Web types, 108
focused metadata checks, strict changed-test compilation and scoped lint with
no errors and two inherited Wizard warnings. The unchanged-schema API slice
passed 99 checks across five files, API types and strict/scoped checks. These
are compatible source/synthetic checks, not full native/runtime/image-security,
migration/recovery or authenticated production acceptance. All original
release failures and the broader reported workflow/parity scope remain open.

### October 6: procedure preview fidelity and refreshed Testmo evidence

The mounted shared procedure renderer previously displayed explicit empty text
and absent/NULL expected fields identically. The actual-component SSR regression
reproduced three failures before the repair. It now labels explicit empty text
separately, while preserving raw whitespace, multiline values, custom labels,
stored order, duplicate steps and media-reference counts. No stored procedure,
hash, API or permission changed. Two old source contracts requiring the
conflating expression were strengthened; their other predicates remain intact.
Root's compatible Web run passed 807 Node plus 1,419 typed checks (87 typed
files), 2,226 total, with no skips; Web types and scoped four-path lint passed.
The first full Node run retained 806 passes/one obsolete-literal failure before
that second contract correction. Static synthetic Chrome rendering of the
actual component and application CSS showed aligned technical descriptors,
explicit-empty/absent labels and multiline rows. This is not a saved-case,
authenticated tenant, native-reader or production acceptance check.

Fresh authenticated Testmo trial inspection used its Space Shuttle vendor
sample only: repository search/folders, compact priority/latest-status columns,
tag counts, template/estimate metadata, ordered prose steps and a separate
Comments editor were visible. No case, comment, run or settings were saved.
This supports keeping useful prose and project-specific templates; it does not
establish read-only-member comment permissions, export fidelity or superiority.

Historical [April 2023 discussion](https://www.reddit.com/r/QualityAssurance/comments/12x9mke/test_case_management_tools_question/)
included both praise for project-specific templates and missing API/reporting
features. A [September 2025 discussion](https://www.reddit.com/r/QualityAssurance/comments/1nm87hy/test_management_system/)
described cross-project release reporting workarounds. These are dated individual
experiences, not prevalence estimates or confirmed current defects. The current
[Testmo changelog](https://support.testmo.com/hc/en-us/articles/38044957362317-Changelog)
documents later case APIs/reporting, 2026 automation linking, and fixes for
mixed BDD/step exports, deselected-case bulk edits and retry authentication.
Therefore older absence claims must not be repeated as current facts. Our
acceptance opportunities are lossless mixed-field exports, exact reviewed bulk
cohorts, stable manual/automation identity links and honest cross-project
report scope, not copying every vendor interaction or asserting a ranking.

Ordinary run-start integration is a separate active repair. Its additive reviewed
namespace is being wired to the two shared configuration callers; metadata-only
PREVIEW is not cohort/configuration approval. Existing legacy UNKNOWN requests
lack original submission-native stamps and must remain opaque, never upgraded
from a current read. Plan-template private-read ordering and the Windows helper
collector remain separately owned work; all previous native/runtime/security,
migration/recovery, deployment and authenticated production gates remain open.

### October 6: bounded Android collector source repair, not Windows acceptance

The public self-contained connector and repository collector now require an
explicit approved Android serial/package before collection. Native foreground
is observed before and after the hierarchy read, and unexpected hierarchy
packages refuse. This is window-scope evidence, not atomic app-exclusive capture,
processing consent, a durable operation receipt or physical-device acceptance.
Raw whitespace, numeric XML entities and duplicate named controls are retained;
unsupported/over-limit complete values refuse rather than silently clip.

Only exact unchanged in-memory captures bound privately by the collector may
append within the same observed serial/package. Persisted version-1 files lack
that original authority, so name-only append refuses. CLI existing outputs refuse
before collection and exclusive writes prevent racing overwrite. Documented
Android commands now require both target flags and fresh filenames.

Root independently passed 34 source/synthetic checks across collector, legacy
pure extraction, guidance and launcher construction tests, plus scoped lint with
zero errors/warnings. The old duplicate-coalescing/name-only append assertions
were replaced with exact-retention and refusal assertions, not bypassed. A stale
guidance assertion was strengthened against the actual mounted metadata status
surface. No helper startup, helper HTTP, ADB/Appium, device/provider, actual
capture/file output, source/AI processing, SEA/signing or security changes ran.
Web capture dispatch stays closed pending bound target and consent; iOS target
verification, paid recovery, approved signed delivery and the reported Windows
launch failure remain unaccepted. Later run-start caller bytes are separate
in-flight work and are not covered by these checks.

### October 6: self-hosted GitLab instance selection

The connection flow accepts a pasted dashboard or project URL and selects only
that HTTPS origin. It no longer assumes GitLab.com, even when it is the sole
configured instance. GitLab provider selection opens the instance chooser rather
than a premature blank authorization popup. Account authorization remains a
separate explicit action using existing fresh access checks, followed by reviewed
repository metadata selection. Source reads, AI processing and spending remain
separate, unapproved actions.

An unconfigured host leads to workspace application setup with the validated
origin prefilled. No credentials appear in the customer connection form; existing
server encryption, tenant authorization and provider DNS/SSRF checks remain
unchanged. UI origin parsing is routing convenience, not server admission.

Focused tests cover URL handling, actual-module synthetic React SSR (GitLab does
not infer a configured cloud host; GitHub retains its cloud configuration), and
existing fresh-access, popup, selection/review and revocation contracts.
The focused tranche passed 19 existing source contracts and 15 parser/actual-module
synthetic render checks, scoped lint and Web typecheck. A concurrent full Web run
failed in the separately owned run-start controller and its legacy host assertion;
it is not a green whole-tree result. These checks are not authenticated connection
or deployment proof. The live repository
administration route returned 404 during read-only verification; no OAuth grant,
application credential, repository link, customer source read or processing was
performed. The missing deployed setup route remains an actual release gap.

### October 6: additive plan execution reads and reviewed-start registration

The new plan execution read namespace separates identity-only access from a
bounded template/candidate page. Independently verified transport identity and
current native project, organization, actor and membership are checked before
private template or case metadata. Native byte/count admission and whole saved
selection checks precede materialization. Candidate search is literal and paged;
saved order includes missing and archived cases rather than silently dropping
them. Current pages are not an immutable suite snapshot or execution approval.

Exact native JSONB text is kept separately from the explicitly labeled legacy
interpretation. Existing legacy parsing and hashing are unchanged. Native JSONB
equality must pass before hashing, so a lossy numeric parse cannot acquire a
substitute hash. Unsupported complete values refuse rather than trim, clip or
invent a template. Access does not grant save/start authority, and historical
UNKNOWN requests cannot acquire original native stamps from a current read.

Both this read namespace and the existing reviewed run-start namespace are now
registered additively in the source router. Root independently passed 282 checks
across eight API test files, API typecheck and scoped lint with zero errors or
warnings. This includes 73 new plan read/schema checks, three unchanged legacy
parser checks and 206 existing reviewed-start checks. Database queries, transport identity and failures are
synthetically mocked; no SQL, authenticated API, native transaction, migration,
deployment or production acceptance was executed. The old plan execution caller
and private-read endpoint remain unchanged pending the separately owned current
reader/controller integration. Concurrent run-start Web fixture failures remain
open until independently retested; this is not a green whole-tree result.

### October 6: reviewed ordinary run-start caller cutover

The case repository and run list now forward the complete reviewed-start envelope
through the additive namespace. Their existing approved selection, retained
ordered IDs, project keys and write locks remain. Only a new unsent intent can
record original native identity from a current supported profile read. Original
body, UUID and envelope survive refusal or lost acknowledgement; retries do not
rebuild them. Profile metadata alone does not approve selected cases, procedures
or execution configuration.

The shared modal/controller validates the bounded complete outer acknowledgement
and its deterministic original-native-actor/UUID run ID before privately recording
confirmation. Late confirmation may settle privately but cannot publish or
navigate under a replaced session/read. Opening a known result requires the
original owned envelope, strict acknowledgement, current original access and an
actual guarded navigation callback. Legacy unpinned pending or known requests
remain opaque, not upgraded from a current native read.

Root independently passed 136 focused typed caller/controller/writer checks.
The later compatible Web run passed 807 Node and 1,543 typed checks across 93
typed files, with no skips, and Web typecheck passed. This includes then-current
uncommitted plan-reader tests, not their final freeze or caller integration.
Earlier full-run failures are retained: obsolete legacy caller fixtures were
updated to exercise the actual reviewed protocol, and a resource test's forty
immediate-turn wait was replaced with a finite two-second deadline while retaining
the independent forty-render cap. Its new eighty-turn contention regression
passes without additional dispatch or nonce replacement. No production hook or
retry policy changed for that test repair.

Scoped lint has zero errors and four disclosed state-effect warnings: three
existing repository effects and one finite native-staging modal effect. Actual
new-source browser/native API/SQL/recovery and authenticated production acceptance
remain open. This supersedes the earlier source-fixture failures only for the
tested source; it does not waive any retained release failure or prove deployment.

### October 6: distinct Android window protocol, browser dispatch still closed

An additive authenticated `/capture/android-window-v1` route accepts a complete
bounded request with original nonce, explicit serial/package and raw label. Old
helpers or unsupported paths cannot fall back to legacy `/capture`. The returned
unchanged version-1 manifest is bound to the collector's actual in-memory target
observations. Before/after foreground observations are expressly non-atomic and
not app-exclusive; processing permission, spending permission and durable receipt
availability remain false.

The request reader bounds bytes, iterator yields and a ten-second deadline;
whole malformed, oversized, duplicate-key or stalled inputs refuse with generic
errors and owned iterator cleanup. The pure browser decoder checks the complete
bounded response, exact route/metadata/nonce/target echoes and explicit limitations
without getters, clipping, defaults or network dispatch. Raw capture remains
data, not consent or write authority.

Root independently passed 21 actual-handler synthetic Node tests and 14 typed
protocol checks, including the actual iterator's 8,192-yield refusal and an
injected-clock stalled-read deadline. Native command outputs, pairing and
transport are synthetic; no helper/server startup, helper HTTP, ADB/Appium,
physical device, SEA/signing or security-policy operation ran. Existing Web
capture stays closed. This source foundation does not resolve or accept the
reported Windows launch error, legacy paid recovery, iOS foreground verification
or browser-side stream/SDK/target/consent admission.

### October 6: unmounted browser plan-execution read foundation

The browser reader admits only the complete native-pinned ACCESS or PAGE wire
from the additive plan namespace. Raw JSONB remains separate from verified
legacy interpretation; all saved IDs, including missing and archived rows,
remain ordered and distinct from the current paged candidates. Whole unsupported
values refuse, with no substitute hash, clipping or repaired configuration.

The standalone hook requires installed SDK and cache monitors before reads,
revokes old nonces on session/resource/context/cache movement, and requires
explicit fresh access after revocation. An invalidated installed QueryObserver
cannot revive prior template authority even if old data/status return. PAGE
selection accepts only search, limit and optional cursor before any spread or
nonce creation; unexpected project, plan, native actor or request IDs cannot
replace the originally pinned read scope. Root's review found and corrected that
input boundary before mounting or checkpointing the hook.

Root independently passed 57 checks (29 pure wire/boundary and 28 actual-hook
synthetic checks), whole Web types and four-file lint with zero errors/warnings.
The tests use installed TanStack QueryClient/cache/QueryObserver with synthetic
React, Clerk and RPC boundaries. The hook retains one current snapshot and two
observed query slots, not all-page history. It explicitly grants no save, start,
frozen cohort approval or receipt permission. Old caller/save integration,
historical UNKNOWN recovery, actual browser/native SQL and production acceptance
remain open. These final foundation bytes are not covered by the preceding
2,350-check whole-Web result.

### October 6: unmounted complete Android response consumption

A separate injected response reader consumes one response for an exact frozen
request. It validates response metadata before any read, bounds delivered bytes
to 2 MiB and reads to 8,192, and requires complete EOF within a 30-second deadline.
Abort, original local-attempt loss, malformed/overbound chunks, wrong echoes or
unsupported complete data refuse generically. Cleanup cancels once without
awaiting potentially stalled or rejecting cancellation. Deadline revocation
precedes cleanup callbacks; no late chunk can become a successful response.

This foundation creates no fetch, fallback, retry, helper operation, SDK/native
authorization or consent. The caller still owns the native stream lock, action
lease and incomplete-operation UNKNOWN handling. Failure does not establish that
capture never happened or that the complete raw response was retained. In
particular, the new response must not be stripped into legacy capture state,
which could enable an unrepaired paid-generation path. Actual Web dispatch,
signed helper and device/foreground/processing/spending acceptance remain closed.

Root independently passed 39 focused checks (25 injected-stream and 14 existing
protocol checks), Web typecheck and two-file lint with zero errors/warnings.
Streams, clocks, cancellation and foreground DTOs are synthetic; no helper HTTP,
device operation or actual browser dispatch ran. These final files are outside
the preceding whole-Web result and require separate consumer/rendered acceptance.
