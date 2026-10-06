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
