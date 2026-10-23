# Functional UI review, 2026-10-01

## Verdict

The product needs a coherent working interface, not another layer of controls on
each page. The Skald and Stone identity can stay. The main problems are hierarchy,
workflow, density and repeated explanatory copy, not the palette alone.

Recommended direction: a compact quality workbench with guided overlays for
occasional decisions. Daily work should be visible immediately; configuration,
advanced options and evidence limitations should appear where relevant.

This document records the review and proposed acceptance contract. James approved
the first library/inspector slice; its separate source implementation and remaining
scope are recorded in [the workbench checkpoint](workbench-implementation-20261001.md).
Neither document claims production readiness or deployment.

## What was reviewed

Read-only interaction with the signed-in deployed application: project overview,
case library, suite filtering, risk sorting, case inspector, bulk analysis cost
preview, reports, mobile navigation and the project-update modal. Tested desktop
and a 390 x 844 mobile viewport. Closed overlays and restored the original project
overview and viewport afterward.

Separately reviewed the actual source manual-execution components in a loopback
synthetic fixture: frozen procedure, step-by-step mode and step-result overlay.
Source previews are not evidence that these features are deployed. Private
customer screenshots and detailed fixture receipts stay under `.local/`.

No customer records were changed. No generation was approved, credits spent,
repository authorization started, run created, invitation sent or source fetched.
This was an owner-session review, not exhaustive keyboard, screen-reader or
multi-role acceptance. No model switch was performed or inferred.

## Findings and proposed corrections

### 1. Overview puts setup ahead of work

The repository/provider area dominates the top of an established project. The
testing summary is principally an inventory count and generic guidance. The
navigation presents fourteen project destinations at the same level.

Put current work first: resume execution, review changes, outstanding decisions
and recent outcomes. Use truthful empty states with a direct next action. Collapse
source setup into a compact connection summary and Add sources action. Group
navigation by the working cycle, with secondary tools under their relevant group.
Do not turn missing execution evidence into an invented readiness score.

### 2. Case library has too many simultaneous controls

Suite filtering and risk-column sorting work in the deployed UI. The inspector
has a resize control. Preserve these capabilities rather than treating earlier
reports as current failures.

The default view nevertheless exposes multiple page actions, quick add, saved
views, search, five categorical filters, a separate sort selector and archive
controls. Selection exposes review, execution, organization and destructive
actions together, including actions inappropriate to the current view.

Use one top row: search, saved view, Filters, Add case and a secondary menu. Show
active filters as removable summaries. Selection should produce a contextual
action bar: Run, Analyze, Organize and More. Destructive actions belong behind an
explicit selection review, not beside primary work at equal visual weight.

At 390 px, the page heading is squeezed into a narrow column by the action cluster,
wrapping into several short lines. The full suite list and controls occupy the
first viewport before any case can be inspected. Mobile needs a full-width heading,
one primary action, a suite chooser and a compact filter summary. Prefer a readable
case list or deliberately constrained table to shrinking desktop controls.

Source inspection corroborates the heading issue: the case page uses a custom
non-wrapping flex header, while the action child wraps. The shared PageHeading
has responsive styling but is not used here. Consolidating these patterns is
preferable to a separate page-specific visual convention.

### 3. Inspector mixes reading with several editing workflows

Prerequisite editing appears ahead of the procedure and uses a native selector
containing the entire case inventory. Risk, automation, compliance mapping,
attachments and dataset forms compete for attention. Long titles consume a large
part of the panel. Enum labels remain raw uppercase identifiers in several places.

Make Procedure the default: compact title, stable identity, clickable suite,
concise metadata and steps. Distinguish read and edit states. Use searchable
prerequisite selection only when requested. Place Intelligence, Evidence and
History in consistent secondary sections or tabs. Show human-readable labels,
not storage enums. Keep paid automation drafts discoverable and retained.

### 4. Bulk analysis has useful safeguards but an incomplete large-selection flow

The deployed preview shows selected count, current bounded batch, previously
assessed cases, credit estimate, balance and explicit approval. These are useful
and must remain. Merely selecting cases does not spend credits.

Each preview handles twenty cases, leaving the remainder explicitly unqueued.
This is honest, but a large selection still requires many separate reviews.
Design a durable bounded queue with a reviewed total estimate and limit, progress,
cancellation and partial-recovery state before claiming Analyze all support.
Do not silently expand the current approval or weaken credit authorization.
Make cost and the decision primary; move secondary explanatory text into details.

### 5. Reports explain limitations before presenting useful results

The query scope is correctly disclosed: case queries affect inventory, while
requirements and execution remain project-wide. That is a real functional limit,
not merely a wording issue. Empty reports repeat absence and formula explanations
without a focused next action.

On mobile, the query explanation and evidence-boundary panel consume the first
screen; no report metric is visible in the initial viewport.

Start with the user's question: inventory health, execution outcomes, requirement
traceability or release evidence. Show scope/date and results first. Explain
limitations adjacent to the affected metric or in expandable help. Empty results
should offer an appropriate next action. A future shared report filter must apply
consistently or clearly identify unsupported sections; no implied coverage.

### 6. Wizards are now overlays, but still feel like forms wrapped in prose

The project-update flow stays on the current page, supports forward/back and
cancellation, and shows previous-state/save concepts. Preserve the overlay pattern.
Repeated title/status/introduction text occupies significant vertical space.
Selection options are styled as action chips even where a labelled multi-select
checklist would communicate the decision better.

Use a consistent frame: short title, named step and progress, one decision,
essential fields, optional details, persistent Back/Continue/Save controls. Use
provider chips for connection actions and checklists for configuration choices.
Unsaved, saved, reviewed and applied states must remain distinct. Verify actual
keyboard focus, scroll containment and footer visibility, not just DOM presence.

### 7. Source execution preview exposes the same hierarchy problem

The new step-result overlay has explicit outcomes and a review before recording,
which are good foundations. It is too tall when controlled context is expanded.
Food-only procedures show hardware/firmware fields prominently. Frozen-definition
explanations and safety copy crowd the recording task; long-run status is weak.

Keep the expected procedure and actual result side by side on suitable desktops,
stacked clearly on mobile. Surface measurements relevant to the approved project
profile; unrelated fields remain available under advanced context. Put outcome,
measurement, evidence and next step in a stable hierarchy. Corrections must retain
previous values and require a reason; visual simplification must not erase history.

## Proposed first redesign slice

Build a representative case-library and inspector workbench before reskinning the
whole application. It exercises navigation, density, actions, editing, evidence
and AI decisions. Review it side by side with the existing UI using synthetic
software, game and physical-procedure examples. Then reuse the approved shell for
overview, execution, reports and overlays.

Preserve a single product language across domains. Tailoring changes relevant
terms, evidence and controls; it should not create unrelated applications or
pretend food, clinical and machinery validation are ordinary software workflows.

### Acceptance for that slice

- At desktop and 390 px, the title and primary task are readable without crowded
  wrapping. Mobile exposes a case within the first screen, not only setup controls.
- Search, suite selection, sorting, saved views, filter reset and selection scope
  remain functional and unambiguous. No client-side view claims to include records
  that were not queried.
- Reading a case does not expose unrelated editable forms. Steps are first after
  the compact case/suite header; resizing does not clip actions.
- Bulk actions show eligible count, scope and progress. Paid actions show balance,
  estimate/limit and authorization before execution; non-spenders can request
  administrator approval without starting a chargeable job.
- All overlays support keyboard operation, focus containment and return, readable
  errors, stable footer actions and intentional draft/retry recovery.
- Human edits, stable identities, approvals, drafts and historical evidence are
  preserved. No redesign write silently changes customer data or access.
- Empty states are actionable. Reports show useful results before extended scope
  explanations while still being accurate about missing/conflicting evidence.
- Rendered desktop/mobile, owner/editor/viewer and keyboard checks accompany
  regression tests. Source and deployed acceptance are recorded separately.
