# Reporting parity audit and delivery record

Audited 2026-10-28 against source base `6a5dd462591d64e857985337a6b74c345ef4425c` (merged PR81). Scope: TestRail, Zephyr, Xray, qTest, PractiTest and Qase. This is a capability audit of published product contracts, not a claim to have operated licensed competitor instances. Cloud, Data Center, add-ons and plan restrictions must not be conflated. An implemented route is not hosted acceptance.

## Evidence sources

1. [TestRail report catalog](https://support.testrail.com/hc/en-us/articles/9285210470420-Reports-overview): cases, results, defects, summaries, references, cross-project summary/workload and scheduled generation.
2. [qTest Insights](https://docs.tricentis.com/qtest-2026.2/content/insights/insights.htm) and [saved reports](https://docs.tricentis.com/qtest-saas/content/insights/manage_saved_reports.htm): custom dashboards, exploration/formulas, portfolio and scheduled PDF/HTML/XLS/CSV.
3. [Qase custom widgets](https://docs.qase.io/en/articles/17059961-custom-widget-builder): entity/filter/group/segment configuration, bar/line/donut/table, reusable workspace widgets, project scope and time buckets. [Run reports](https://docs.qase.io/en/articles/5563702-test-runs): public sharing and CSV/PDF.
4. [Xray Cloud features](https://getxraydocs.atlassian.net/wiki/spaces/XRAYCLOUD/pages/392921546): traceability, coverage, plan/execution/run/list reports and Jira gadgets. [Document generator add-ins](https://getxraydocs.atlassian.net/wiki/spaces/XMA/overview?homepageId=51085314): Word/Excel templates; do not imply native PowerPoint.
5. [Zephyr Reporting for Confluence](https://marketplace.atlassian.com/apps/1218691/zephyr-reporting-for-confluence?tab=overview): separate SmartBear app for Confluence reports and dashboards, including project/epic/story breakdowns.
6. [PractiTest reports](https://www.practitest.com/help/data-management-and-analysis/reports/) and [product reporting](https://www.practitest.com/product/): filtered templates, schedules, dashboards/embeds and PDF/Excel exports.
7. [Forge macro](https://developer.atlassian.com/platform/forge/manifest-reference/modules/macro/) and [Forge Remote](https://developer.atlassian.com/platform/forge/remote/): supported Confluence integration mechanism. Existing Vaettir FIT/viewer verification and explicit installation/space binding remain mandatory.

## Capability matrix

Status is observed source coverage at the base, not a percentage or a universal parity claim. Existing screens outside Reports count as implemented capabilities but still need a unified entry point. A requirement without source data must show unavailable, never invented metrics.

| Key | Capability and competitor examples | Vaettir baseline evidence | Gap and acceptance |
|---|---|---|---|
| R01 | Simple report starters (all) | Five `report-templates.ts` presets, ReportBuilder, PR81 | Keep purpose → scope → preview. Advanced settings collapsed; no obligatory dashboard construction. |
| R02 | Inventory/property distribution (TestRail/Qase) | reports.overview, saved case filters, priority/type/automation distributions | Reusable configurable widgets; verify filters and zero/unknown buckets. |
| R03 | Case creation/edit activity (TestRail) | Case versions and audit history | Add dated activity aggregation; distinguish edits from distinct cases. |
| R04 | Execution progress/status (all) | reportSnapshots, manual runs, CI runs, planned/not-recorded counts | Present consistently in reports/widgets, no skipped-to-pass inference. |
| R05 | Run/configuration comparison (TestRail/Xray) | recordedRunComparison, manualRunComparison | Expose from report catalog; preserve comparable cohorts and contexts. |
| R06 | Results over time (qTest/Qase/TestRail) | recordedExecutionTrends, release trend | Configurable time buckets, no invented historical inventory. |
| R07 | Requirement coverage/traceability (all) | requirementCoverage, caseTraceability, report evidence | Preserve uncovered requirements and link-versus-result distinction. |
| R08 | Defect summary/traceability (all) | defectMap, report defects, linked task verification | Only scoped, source-backed defects; external stale state stays labeled. |
| R09 | Defect age/reopen/escape analytics (qTest/PractiTest) | Snapshot limitations explicitly mark unavailable | Requires dated defect lifecycle/production evidence; do not infer from current status. |
| R10 | Workload/assignment (TestRail/qTest) | Native manual run scope and recorded actor/result evidence; no explicit workload assignment ledger found | Assigned/unassigned/executed breakdown, no employee productivity ranking. |
| R11 | Effort/forecast/velocity (qTest) | Some execution timestamps; no complete planned effort baseline | Actual recorded duration only; forecasts unavailable without explicit inputs. |
| R12 | Release/plan summaries (all) | release readiness, exit criteria, release closure snapshots | Include in report navigation and deck; preserve recorded/frozen distinction. |
| R13 | Cross-project portfolio (TestRail/qTest/PractiTest) | orgReadiness and digest | Dashboard scope across authorized projects; no partial aggregate labeled complete. |
| R14 | Custom dashboards (qTest/Qase/PractiTest) | Fixed project dashboards and charts | Persist layout, widget selection and display choice; rename/duplicate/reorder/remove with keyboard. |
| R15 | Custom metrics/filter/group (qTest/Qase) | Saved case filters; fixed visual model | Bounded typed dimensions/metrics, explicit denominator; no arbitrary SQL. |
| R16 | Private/shared definitions (all) | ProjectReportDefinition lifecycle, visibility/version/history | Dashboard equivalents with current tenant/member checks and optimistic concurrency. |
| R17 | Scheduled reporting (TestRail/qTest/PractiTest) | Slack readiness digest only | Durable schedules, timezone/DST, due-run identity, retry/pause/history; no duplicate capture or fabricated session. |
| R18 | Scheduled delivery (TestRail/qTest/PractiTest) | Existing Slack digest transport | Separate recurring capture from recipient approval; authenticated report link initially, no unsolicited recipients. |
| R19 | Live Confluence reporting (Zephyr/PractiTest) | Existing Forge macro is frozen/latest-approved, not live | Explicit opt-in live aggregate scope; fresh authorization every refresh, no stale data after denial, no iframe bearer links. |
| R20 | Historical Confluence evidence (Xray/Zephyr) | Existing snapshot/release closure selectors | Keep fixed captures available alongside live mode; label time and mode. |
| R21 | HTML/CSV/Markdown/PDF (all vary) | Frozen HTML/CSV, browser print PDF, release HTML/Markdown | Preserve parity of charts and tables; PDF is browser print, not server delivery. |
| R22 | XLSX/DOC templates (qTest/PractiTest/Xray) | CSV, no native document templates found | Structured editable workbook/document outputs remain distinct from CSV rename. |
| R23 | Editable investor deck (explicit product requirement) | No PPTX exporter found | Native text, tables and editable chart data; title/context/summary/risks/actions/evidence. No invented traction/revenue/ROI. |
| R24 | Shared/public links (Qase/others) | Authenticated reports and explicit Forge target sharing | Preserve access-controlled sharing; anonymous disclosure is not implied by embed request. |
| R25 | Audit/reproducibility/revocation | Immutable approved snapshots, retained definitions, scoped reads | All new workflows preserve tenant ingress, suspension, current membership, source provenance and service-token separation. |
| R26 | Real usability and distribution | Local PR81 component proof retained | Populated dark/light/narrow, keyboard/focus/errors; actual sandbox and Confluence verification plus PowerPoint editability required before completion. |

## Implementation order and architecture

1. Native editable presentation export from the existing approved report payload, sharing its chart semantics. Generate locally in the browser; re-check the original actor/report authorization before download after asynchronous work.
2. Persist configurable dashboards using explicit versions and a bounded widget catalog. Existing metric readers remain authoritative; query or partial failures must not silently become zero.
3. Durable schedules capture reports under an explicit stored owner mandate, rechecking current native membership/full seat/suspension and definition version. No human session is synthesized. New captures require review before external publication unless a separately scoped recurring publication mandate is actually implemented.
4. Extend the registered Forge macro with separately approved live aggregate mode. Existing snapshot approvals must never be silently broadened. Use existing FIT, viewer, installation, site and target checks on each request.
5. Add missing report families to the simple catalog, with an explicit unavailable state for metrics that lack source evidence. Surface existing capabilities before duplicating them.

Main owns deployment/provider operations and active import changes. Reporting owns dedicated report files and additive reporting schema models/migration. Router registration and scheduler startup are integration patches coordinated with Main. The identity preservation branch remains untouched. Linear was unavailable (UNAUTHORIZED); direct owner scope drives this work, and tracker reconciliation remains pending without a duplicate login request.

## Acceptance ledger

- Audit: initial source/provider mapping complete; detailed family-specific acceptance remains open.
- Implemented in the reporting branch: versioned private/project dashboards; chart selection/order/display/layout; four bounded custom metric widgets with source, grouping, filters and UTC buckets; case creation and retained version activity; measured result duration with missing observations explicit; daily/weekly/monthly private report capture; pause/resume and run history; exact-request retries; separate opt-in live Confluence aggregate mode; browser-local editable PowerPoint exports from approved reports; unified links to existing report families.
- Native PostgreSQL: 24 focused tests passed. Includes the existing report capture regression plus new authorization, private/shared reads, retry/conflict, concurrent capture, membership removal/rejoin, transient downgrade/suspension, project transfer and subject remap, and fault-injected capture/receipt rollback. Two additive migrations applied to an owned disposable cluster only.
- Forge service/route/sharing: 18 focused tests passed, including fresh viewer authorization on live refresh, no snapshot fallback after denial and explicit live-grant scope. No Forge installation/configuration/deployment was performed.
- Browser/render/transport: 20 focused checks passed; actual reporting component controls exercised in light/dark and desktop/390px layouts. Keyboard reorder retains focus, an uncertain save retries the exact request, invalid timezone is rejected, and current-access loss hides retained drafts. Synthetic RPC boundaries are not hosted acceptance.
- Editable deck: two package checks prove native charts, embedded XLSX chart data, text and tables, no raster slides, and no internal cohort IDs. An actual browser download test passes and discards in-flight output after report/access changes. Desktop PowerPoint and LibreOffice are not installed on this host; native application visual/editability acceptance remains open.
- API/web type checks and Forge type check passed. Optimized local Next compile passed after a package-scoped PptxGenJS browser-import fix; full production image and runtime verification remain separate. No deployment or full parity claim.

### Remaining parity gaps and explicit limits

| Scope | Current disposition |
|---|---|
| Scheduled external delivery / server PDF attachments | Private captures are implemented; recurring recipient/channel delivery is not implemented. Existing Slack readiness digest does not count as report delivery. |
| Portfolio custom widgets | Existing authorized workspace release portfolio remains linked; multi-project configurable report widgets are not implemented. |
| Editable XLSX/DOCX and custom document templates | Existing CSV/HTML/Markdown/browser-print PDF plus new editable PPTX; native workbook/document template engines remain open. |
| Arbitrary formulas, pivots and segments | Bounded typed metrics are implemented. No arbitrary SQL, arbitrary formula language, pivot builder or unrestricted BI claim. |
| Assignment workload / capacity forecasts | Recorded execution is not an assignment or capacity baseline. Assignment/estimate records and forecast semantics remain open. |
| Defect age/reopen/escape/root-cause measures | Current reviewed defect exports do not establish the required lifecycle/production timestamps. No fabricated rates or durations. |
| Hosted Confluence and scheduled execution | Main owns deployment/provider acceptance; current source and synthetic/local proofs do not establish it. |
| Native presentation acceptance | File structure and actual browser generation pass; native PowerPoint opening, editing and rendering remain unverified on this host. |

### Operator integration notes

- Base: main `6a5dd462591d64e857985337a6b74c345ef4425c`. Integrate reporting registration and scheduler startup/heartbeat/shutdown hunks alongside Main's separate `caseSuggestions` registration; do not replace either file wholesale.
- Preserve bootstrap side-effect order: release identity validation, database URL resolution and instrumentation precede imports which instantiate the database client.
- Apply `20261028230000_reporting_workflows` and `20261028233000_reporting_authorization_fences`. The latter only pauses report schedules on loss of membership/full editor access, suspension, project transfer or Clerk subject remapping. Restoring access does not re-enable the old mandate; an explicit current save does.
- `pptxgenjs` 4.0.1 is an exact, lazy web dependency. The additive package/lock change requires new source-bound build/runtime evidence; old accepted image/native proof identities cannot be reused.
- Existing Forge grants default to live sharing disabled. Existing snapshot mode remains historical/latest-approved. No new Forge scope, account or credential is requested by this change.
- API detailed health gains `reportScheduleWorker` at a 60-second interval. A tick atomically captures one current private preview and run receipt per due schedule; it does not manufacture missed historical periods. Failure pauses the schedule with a recoverable receipt.
- End-to-end acceptance must exercise real authorized application save/read/retry, actual schedule execution, revoked viewer/live grant denial in the installed Confluence macro, and reviewed deck export. Keep fixture proof separate from deployment/provider acceptance.
