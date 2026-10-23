# Case workbench implementation, 2026-10-01

James approved the direction in [the functional UI review](functional-ui-review-20261001.md).
This is the first source implementation slice, not a whole-product redesign or
production/deployment acceptance. Existing SSE-130 P4-DOMAIN-2 and SSE-136 P10-13
track the work; the Notion product specification retains intent.

## Built

- Compact library: shared page heading, search/saved view/Filters/Add case/More
  toolbar, removable filter summaries, explicit shown count and sort scope.
- Desktop suites and sortable table; mobile suite chooser and labelled case cards
  expose a real case in the initial390x844 viewport. Neutral drag handles preserve
  manual ordering and suite movement; existing keyboard movement remains available.
- Contextual selection: eligible Run count, existing reviewed Analyze module,
  Organize and secondary actions. Archive/restore/delete preview captures stable
  selected IDs and presents the affected cases before writes. Free actions retain
  sequential200-case bounds, stop-on-failure and confirmed-ID pruning. Paid
  analysis remains20 per reviewed batch; this is not a new durable Analyze-all queue.
- Procedure-first inspector: compact identity, clickable suite, readable metadata,
  expandable long titles, explicit Edit case, steps before prerequisites. Mounted
  Procedure/Intelligence/Evidence/History sections retain local drafts. Saved paid
  automation and design recommendations remain viewable without regeneration;
  viewer design browsing has no evidence intake, generate or apply controls.
- Prerequisite search/pagination instead of an851-option native selector;
  unavailable selected IDs and optimistic baseline checks remain intact.
- Grouped project navigation preserves all14 destinations. Secondary groups reveal
  active deep links. Native dialogs retain background modality, focus return and
  nested-dialog ownership; explicit Tab endpoints include expandable summaries.
  Drawer resize range agrees with actual viewport width, including classic
  scrollbars, with keyboard/pointer cancellation and observer cleanup.

No API contract, database model, membership, customer record, source-processing
permission or credential change is introduced by this presentation slice.

## Rendered validation

Actual source components were bundled into a loopback synthetic fixture, including
Sidebar, library, Drawer, inspector and native Modal. This was not a static mockup.
Owner, full-seat non-admin editor and read-only viewer fixtures cover selection,
restricted credit preview/request affordances, saved recommendations and retained
drafts. Paid/provider mutations fail closed; no real customer or AI writes occur.

Desktop1440x900 and mobile390x844: first mobile case title top487/bottom528,
body375px within390px viewport. Filtering/sorting/suite/saved-view scope, reviewed
archive/delete cancellation, archived eligibility,225-case free action bounds
(200+25), cached-error retention, long-title procedure layout, keyboard tabs,
modal boundaries/focus return and nested Escape were exercised.

Investigated and repaired failures, without weakening product assertions:

- Synthetic inspector seed omitted router-required verificationProfile and draft
  arrays. Corrected fixture shape after exact React stack evidence.
- Adjacent prerequisite/dataset children shared a key after layout consolidation.
  Fixed actual product duplication; three tab-switch cycles now preserve exactly
  one editor plus its unsaved selection/search.
- Native modal boundary behavior let DOM focus leave on ShiftTab. Explicit
  wrapping repaired it; review caught omitted summary controls and those remain
  keyboard reachable. Native showModal/inert behavior stays in place.
- Classic scrollbar width disagreed with resize ARIA. Actual layout-width
  observation now gives equal rendered width/value/max375mobile and1425desktop.
- Prior source contracts relied on replaced button text and formatting. Equivalent
  assertions retain export identity/archive scope, eligible run capture, all five
  bounded free-action forwards and confirmed-selection pruning.

Local diagnostics/screenshots/receipts remain under .local/workbench-ui and
.local/inspector-validation-20261001, outside Git. Regression and exact commit/CI
status are recorded in the current project handoff and existing Linear records.
Fixtures, source checks and CI do not establish production or provider acceptance.

Fresh disposable loopback validation passed migrations/seed,151focused and1120full
API tests,121web checks,33operations tests, workspace typechecks/lint and API
compilation;81core tests also passed. No customer database was used. Exact Linux
production-artifact CI is a separate checkpoint check, never deployment proof.

## Remaining

Apply the reviewed workbench pattern to overview, reports, execution and wizard
copy only after this representative slice receives rendered review. Full case
editing remains a separate deep-linked editor. Single automation generation still
lacks the fuller balance/approval/admin-request modal; it is not claimed fixed.
Large paid selections still require separately reviewed batches. No universal
market parity, qualified regulatory workflow or exhaustive screen-reader/device
acceptance is claimed. The known critical runtime-image security gate still holds
production deployment independently of this source implementation.
