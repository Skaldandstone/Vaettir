# Assistive workflows: implementation and acceptance

This is an in-progress implementation record, not a claim that the screenshot backlog is complete. The September 28 release deployed the implemented slice below; remaining gates are explicitly listed.

## Implemented slice

| User request | Implemented slice |
| --- | --- |
| Useful billing even without Stripe | Side-by-side plan/AI-credit modules, per-operation credit costs, per-pack unit prices, larger seat/cost module. Purchases disabled when unavailable or unauthorized. Estimates are not invoices. |
| Bulk access review | Select-all/individual selection, bulk confirm/revoke/note, explicit decisions for every member, final revocation confirmation, fail-closed admin access. |
| Account context menu | Organization links moved out of sidebar; non-admin/read-only entries greyed without navigation. Keyboard-accessible disclosure, Escape returns focus. |
| Security methods | Clerk-backed passkey/TOTP/backup-code management, reverification, destructive confirmation and session-replay masking of enrollment secrets. Provider configuration still gates availability. |
| Guided creation | Project objective/system/assurance/review wizard; release identity/scope/review wizard with persisted goals and atomic plan attachment; reverse-engineering source selection; strategy-before-plans navigation and missing strategy-type self-healing. |
| Project overview | Compact expandable connection chips and test-type distribution with review queue and readiness entry point. Inventory is not falsely labeled readiness. |
| Compliance usability | Human-readable audit labels; additional starter sets; project-local hide/restore that never deletes global reference data or retained evidence. |
| Hardware/HIL/lab cases | Separate validation domain; fixture, safety, calibration and acceptance-criteria authoring, detail and execution display; profile retained in version snapshots. |
| Manual physical results | Device/specimen/batch, HW/FW/environment and structured readings with units, limits and instruments. Finite-value/range validation. Out-of-range readings cannot be saved as Pass. These are operator-entered observations, not automated instrument captures. |
| Manual-run correctness | Empty/incomplete runs cannot pass. Completed/non-manual runs reject edits. Row locks serialize competing result writes and completion. |
| Imports | Method/provider navigation around existing CSV/XLSX/TestRail/Xray/qTest/Zephyr paths. Existing CSV/XLSX inline repair retained. Unsupported inbound test-case webhooks are explicitly identified rather than presented as working. |
| Missing repo connection | Requirements page has an actionable connect chip instead of an unexplained disabled extraction button. |
| Native connector | Standalone Windows executable built and smoke-tested. No external Node installation required. Native build script and manual-only CI workflow include a macOS app wrapper build path. No binaries committed. |

## Verified

- Prisma client regenerated. New migration applied successfully to fresh, isolated local PostgreSQL test databases.
- Root typecheck: 7 tasks passed, including API, web and mobile.
- API suite: 342 tests passed across 61 files with 2 workers and a 5-connection pool.
- Focused billing/measurement/workflow run: 19 tests passed, including 4 real database integration tests.
- Core: 47 tests passed. Web permission/environment contracts: 30 passed. Device capture/connector: 8 passed.
- Standalone Windows binary: startup, paired health, wrong-code rejection and foreign-origin rejection passed. No device capture was exercised.
- Windows Next standalone build compiled and prerendered but failed packaging on EPERM symlink creation. This is not a successful production artifact.
- Supported local-server web build (`VAETTIR_LOCAL_BUILD=1 pnpm --filter @vaettir/web build`) passed, including type checking and prerendering. This does not validate Linux/container packaging.
- API/web focused lint had no errors; existing warnings remain. Subsequent Linux builds and scoped authenticated browser checks are recorded below, without implying all-role/device acceptance.

Earlier failed API logs are retained. Staff fixtures were corrected to use exact synthetic allowlists, without weakening the real owner-only gate. The beta-capacity test now accounts for both invited-owner and self-service-owner reservations.

## Still open before claiming the requested experience complete

1. Signed/notarized native connector publication and in-product native download flow; macOS app launch and actual Android/connected iOS/remote iOS acceptance. The production helper is still the previous script-based download until release integration is completed.
2. Production Clerk passkey/MFA configuration verification and enrollment acceptance. Development-instance settings are not production evidence. Enterprise SAML/SSO provisioning and local-organization-to-provider binding remain unimplemented; do not expose a fake configuration success.
3. Direct requirements intake from Jira/Linear/Google Drive. Existing Jira/Linear status linking is not requirements extraction. A follow-up now adds a source-first requirements wizard for manual/Markdown/repository input, editable extracted rows and acknowledged-write-aware retries. Repository extraction starts only on explicit confirmation. This follow-up is separate from the `707a0dd` release batch.
4. Complete import provider branding, all-row/one-at-a-time repair across vendor formats, and real authenticated inbound test-case webhook/API connectors. Do not advertise notification webhooks as import pipelines.
5. Review custom compliance reference tenancy: legacy framework/control definitions are globally shared. Project-local hiding avoids cross-project deletion but does not convert legacy custom definitions into private tenant-owned templates. Resolve ownership/migration before promising isolated custom compliance catalogs.
6. Version-pinned, authoritative and license-appropriate expansion of regulated starter catalogs. Starter controls are not certification, regulatory advice or a complete standard. Instrument connectors, step-level evidence, signed regulated execution records and calibration enforcement remain separate work.
7. Rendered desktop/mobile visual review of the new forms, role-specific flows, multi-workspace context and error recovery. No test count substitutes for that review.
8. Fresh Sentry triage. The existing Chrome Sentry OAuth tab reports an expired session; no callable Sentry connector or local API token was available. No issue was resolved or suppressed. Linux/container release builds, deployment and scoped production smoke checks subsequently succeeded as recorded below. No provider-factor or customer-data changes were made.

## Native build

Use Node 26.8.1 only for the standalone connector compiler (server runtime unchanged):

```powershell
pnpm dlx node@26.8.1 scripts/build-device-connector.mjs
node scripts/smoke-device-connector-binary.mjs dist/device-connector/win32-x64/VaettirDeviceConnector.exe
```

Artifacts and hashes are under ignored `dist/device-connector/<platform>-<arch>/`. The manifest explicitly labels the artifact unsigned and device-unverified. The manual CI workflow does not publish a release or change production download links.

## Local evidence

The accepted full API run is under `.local/ux-validation/vaettir_ux_test_1790647328555/`. That disposable database is retained for inspection. Earlier isolated attempts and failure logs are retained alongside it. The later authorized release applied the additive production migration separately. Never commit local credentials or raw assistant history.

## Requirements follow-up

Source-first creation now guides manual entry through description and review; document/repository extraction flows retain editable rows until the user closes review. Empty selected titles block saving rather than dropping rows. Acknowledged successes are locked and excluded from retries, while uncertain network failures explicitly require reconciliation with the list. This is not durable server-side idempotency. Extraction/saving disables modal dismissal; merely opening repository extraction no longer spends credits.

Verification: 33 web tests passed, web typecheck passed, focused lint had zero errors and one existing warning, and the supported local web build passed. Commit `1f08119` deployed successfully to web revision 13. Authenticated production checks verified source selection, descriptive entry fields, and empty-title validation without saving customer records or invoking AI.

## September 28 production release

- API `707a0ddc7c6dee5a77ad46427115a561cf22411e` built successfully in Linux CodeBuild and deployed as `vaettir-api:21`, pinned to `sha256:38e7acaf7fd95cd4f7754c95b63eda30eac93a712c3086245100acb7a03c14e7`.
- ECS reported one completed API deployment, running 1, pending 0. The additive `20260928190000_physical_validation_domains` migration applied successfully. Detailed health reported the expected release identity, healthy database and fresh worker heartbeats.
- The web release includes the full original batch and the separate requirements follow-up. Authenticated owner checks verified the account/admin menu, billing modules and balance, disabled unavailable checkout, requirement entry and release wizard. This is scoped visual evidence, not multi-role or end-to-end business acceptance.
- Live review found empty plan availability text and internal camelCase credit operation labels. Follow-up `3f3e221` supplies explicit availability text, readable operation descriptions and singular seat grammar; 34 web tests, web typecheck and focused lint passed.
- Final web artifact `3f3e2215f80671439976afdaa4c80fdc67067c8c` passed Linux CodeBuild and deployed as `vaettir-web:14`, pinned to `sha256:5068c92eb38314d749981ed6058585e7f445723b18718c1c7f4d28daeddf181a`. Authenticated production rendering confirmed the new availability text, singular seat label and all 12 readable operation costs.
- Final ECS verification: API revision 21 and web revision 14 each have one COMPLETED deployment, running 1, pending 0, failed tasks 0. Linear SSE-136 comment `8b252416-1c1f-4726-8cd6-f83f0cc2cc93` and the existing Notion project handoff record the release without closing remaining scope.
- Exact build requests, task-definition preservation and immutable release metadata remain under ignored `.local/deploy-707a0dd/`, `.local/deploy-1f08119/` and `.local/deploy-3f3e221/`. No secrets or raw logs belong in Git.
- Backup retention was confirmed as seven days with a fresh latest-restorable timestamp. No restore drill was performed and this is not RTO proof. Do not downgrade to pre-security-fix images or reverse uniqueness migrations to force compatibility.
