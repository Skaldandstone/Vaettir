# Assistive workflows: implementation and acceptance

This is an in-progress implementation record, not a claim that the screenshot backlog is complete or deployed.

## Implemented locally

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
- API/web focused lint had no errors; existing warnings remain. Protected-browser visual acceptance has not been performed for this batch.

Earlier failed API logs are retained. Staff fixtures were corrected to use exact synthetic allowlists, without weakening the real owner-only gate. The beta-capacity test now accounts for both invited-owner and self-service-owner reservations.

## Still open before claiming the requested experience complete

1. Signed/notarized native connector publication and in-product native download flow; macOS app launch and actual Android/connected iOS/remote iOS acceptance. The production helper is still the previous script-based download until release integration is completed.
2. Production Clerk passkey/MFA configuration verification and enrollment acceptance. Development-instance settings are not production evidence. Enterprise SAML/SSO provisioning and local-organization-to-provider binding remain unimplemented; do not expose a fake configuration success.
3. Direct requirements intake from Jira/Linear/Google Drive, and a unified guided requirements-creation workflow. Existing Jira/Linear status linking is not requirements extraction.
4. Complete import provider branding, all-row/one-at-a-time repair across vendor formats, and real authenticated inbound test-case webhook/API connectors. Do not advertise notification webhooks as import pipelines.
5. Review custom compliance reference tenancy: legacy framework/control definitions are globally shared. Project-local hiding avoids cross-project deletion but does not convert legacy custom definitions into private tenant-owned templates. Resolve ownership/migration before promising isolated custom compliance catalogs.
6. Version-pinned, authoritative and license-appropriate expansion of regulated starter catalogs. Starter controls are not certification, regulatory advice or a complete standard. Instrument connectors, step-level evidence, signed regulated execution records and calibration enforcement remain separate work.
7. Rendered desktop/mobile visual review of the new forms, role-specific flows, multi-workspace context and error recovery. No test count substitutes for that review.
8. Fresh Sentry triage, Linux/container release build, deployment and production smoke checks. The existing Chrome Sentry OAuth tab reports an expired session; no callable Sentry connector or local API token was available. No issue was resolved or suppressed. No AWS, provider-factor or customer-data changes were made in this batch.

## Native build

Use Node 26.8.1 only for the standalone connector compiler (server runtime unchanged):

```powershell
pnpm dlx node@26.8.1 scripts/build-device-connector.mjs
node scripts/smoke-device-connector-binary.mjs dist/device-connector/win32-x64/VaettirDeviceConnector.exe
```

Artifacts and hashes are under ignored `dist/device-connector/<platform>-<arch>/`. The manifest explicitly labels the artifact unsigned and device-unverified. The manual CI workflow does not publish a release or change production download links.

## Local evidence

The accepted full API run is under `.local/ux-validation/vaettir_ux_test_1790647328555/`. That disposable database is retained for inspection. Earlier isolated attempts and failure logs are retained alongside it; no existing application database was migrated. Never commit local credentials or raw assistant history.
