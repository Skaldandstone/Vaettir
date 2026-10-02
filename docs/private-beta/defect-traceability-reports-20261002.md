# Reviewed defect mapping, case traceability and stakeholder reports

Source implementation under SSE-135/P9-00 and production linkage. This document does not establish deployment, provider acceptance, resolution of Sentry issues, or exhaustive competitor parity.

## Defect map

The project workbench has a full-width cluster list and a selected detail pane, with compact provider chips for confirmed task links and reviewable suggestions. Mobile stacks the panes. Search and mapping filters operate on retained metadata.

Intake accepts a bounded normalized metadata export for Sentry, Crashlytics or analytics summaries and Jira, Linear or Asana tasks. It is not a native live-sync adapter. The user approves metadata reading, previews changes and explicitly approves the import. No source, stack traces, AI calls, provider credentials or imported executable code are processed. Source scopes and observations are recorded; unavailable or missing inputs do not delete the approved baseline.

Native provider/scope/group/variant/release/environment/platform identities remain distinct. Task suggestions use explicit references or matching known component, release and environment, not a claim of common root cause. Confirmation/rejection is a human decision. Changed evidence marks only the affected decision stale. Counts use the maximum reported observation window, not sums of overlapping windows or unique users. A closed task does not establish a deployed fix.

Reviewed writes use fresh full-editor authorization, project/workspace pins, optimistic versions, durable actor/request receipts and bounded retained records. Identical reruns are no-ops. An unknown write response retains the exact UUID, payload and reviewed version, even if a later attempt is denied. It cannot be discarded as though it never committed.

## Bidirectional case coverage

The case Evidence screen separates import provenance from what the case tests. Confirmed chips reference local requirements/defects or Jira, Linear, Asana, Notion and wiki records. HTTPS section/block anchors are supported without fetching their content. Reciprocal requirement and defect panes show covering cases and let full editors explicitly add links. These are coverage references, not passing execution evidence.

Links use stable project/native identities, same-project database foreign keys, version checks, durable receipts and removal tombstones. Historical links prevent hard deletion of their case/requirement; the API explains the retained-reference constraint. Human records and approvals are not automatically rewritten by discovery or lost access.

## Report generation

The in-page modal has four screens: audience, metric sections and execution window, optional authored commentary, and frozen review. Audience presets suggest sections; the author can change them. Saved private definitions are reusable. Private previews are retained and resumable. Approval creates an immutable workspace-sharing snapshot with the same captured values and timestamp, not a fresh recomputation. Links require existing workspace membership. No anonymous token, automatic email, invitation or recurring report delivery is created.

HTML export and browser print/save-PDF produce stakeholder copies. The HTML escapes authored content, contains no scripts/external assets or internal cohort IDs, and warns about sharing internal metrics. Exported files do not retain workspace access controls after download.

Metrics are read from one repeatable-read database snapshot:

- Active inventory, priority distribution, risk-assessed count and recorded flaky flags.
- Runs and result outcomes in the selected window. Distinct-case execution coverage counts PASS, FAIL and FLAKY, never SKIP/BLOCKED. High/critical-priority execution uses its own explicit denominator, not a risk-weighted or readiness claim.
- Explicit active case/requirement traceability coverage, separate from execution.
- Reviewed defect clusters, confirmed/suggested mapping and unavailable sources. Missing defect evidence is not zero defects.
- Recorded automation labels and same-case transitions since the previous approved capture. Added/removed active cases are separate. Net change can be normalized per seven days only with a meaningful comparison interval and comparable identities; it does not prove automation ran or time was saved.

The builder is currently project-wide. Existing saved/custom case queries still filter the older live inventory report only, not executions or requirements. Frozen report section selection controls presentation; the underlying bounded capture retains metric provenance and comparison identities.

Not yet supported: live crash/task sync, cross-provider root-cause inference, execution-context/release filters in this builder, automatic scheduling/email/public snapshot sharing, escaped/reopened defect rates without lifecycle evidence, measured flake rates, code coverage, planned effort, resolution time or regulatory approval claims. Missing evidence is explicit, not a fabricated zero.

## Public references

[ISTQB Foundation syllabus 4.0.1, sections 5.3.1–5.3.3](https://istqb.org/wp-content/uploads/2024/11/ISTQB_CTFL_Syllabus_v4.0.1.pdf) discusses monitoring metrics and audience-appropriate progress/completion reporting. The implementation uses independently defined metric semantics, not copied syllabus templates or certification claims.

[TestRail report configuration](https://support.testrail.com/hc/en-us/articles/9004266861588-General-configurations-for-reports) provides a comparator for reusable reports, access, printing and portable exports. Vaettir's authenticated frozen snapshots are a tested increment, not full TestRail report parity.

[Sentry issue details](https://docs.sentry.io/product/issues/issue-details/) documents native issue groups and tracker linkage. [Crashlytics BigQuery export](https://firebase.google.com/docs/crashlytics/bigquery-export) is an optional future intake route; no BigQuery service, paid query or customer export was enabled. [Asana webhooks](https://developers.asana.com/docs/webhooks-guide) can support future approved incremental task intake.

## Acceptance evidence boundary

Synthetic disposable-database tests cover tenant/role revocation, identical imports, partial/unavailable inputs, stale evidence, CAS, durable retries, immutable sharing, automation cohort drift, private drafts and saved definitions. Rendered synthetic desktop/mobile flows validate chips, split panes, modal navigation, inaccessible states and response-loss recovery. Native image guards validate isolated DOM/screenshot, Git HTTPS and Expat ABI behavior separately. None of those prove live provider grants, customer-source processing, production rollout or defect resolution. Release/security scan receipts and authenticated smoke evidence remain required for deployment.
