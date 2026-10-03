# Functional test-management acceptance audit, October 3, 2026

## Outcome and evidence boundary

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
