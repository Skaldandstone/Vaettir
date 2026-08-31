# Browser and onboarding QA lane evidence

Date: 2026-08-30. Owner: Engineering, browser lane. Integration owner: task `01a0548c-0995-7c21-9634-fff5931643ac`.

Status: implementation candidate, not browser or beta acceptance. See the [readiness register](readiness-register.md), [parallel handoff](parallel-handoff.md), [onboarding guide](onboarding.md) and [E2E contract](../../apps/web/e2e/README.md). The integration owner records the combined release SHA and final gate results.

## Checkout and scope

All work is in `C:/Users/James/Documents/vaettir-beta-worktrees/browser` on `codex/beta-browser`, based on `a6b5554ddd53cb0e3326264557c0931a00336f6f`. The implementation commit is the commit introducing this document. Later evidence-only commits do not change the tested application sources. This is not the final integrated release.

Changed web permission controls, onboarding/invitation recovery, project selection, beta allowance copy, accessible case step labels and strict E2E fixtures/specs/config. No package, lockfile, workflow, Docker, instrumentation, cloud, mobile or parent readiness-register edits. No push, deployment, account changes, external invitation delivery or paid model requests.

## Local checks

| Check | Result | What it proves |
|---|---|---|
| Frozen dependency installation | Passed with pnpm 11.23.0, Node 24.19.0 | Assigned checkout installs the checkpoint lockfile; not dependency-security acceptance |
| Prisma generation, migration deployment, reference seed | Passed, 39 migrations, PostgreSQL 17 | Local schema/reference setup only |
| Shared core/db/ai-agent builds | Passed through Turbo, cached outputs restored | Workspace type/build prerequisites available |
| Permission/environment unit tests | 30 passed | Role/seat matrix fails closed; unsafe E2E targets/production keys rejected |
| Fixture contract tests | 5 passed, including teardown assertions | Disposable seeding and cleanup, owner onboarding database bootstrap and invitation/non-member setup; no browser or Clerk calls |
| Web and E2E typecheck | Passed | Type consistency only |
| Web lint | Passed with 34 existing warnings, zero errors | No lint errors; warning cleanup is not complete |
| Default Playwright discovery | 87 listed tests in 17 files, including auth setup; paid scenarios excluded | Test collection only; none of these authenticated/signed-out browser cases have been executed in this lane |
| Web production-server build | Passed with `VAETTIR_LOCAL_BUILD=1` | Next compilation and static generation; not Windows standalone/Linux container packaging or deployed health |
| Patch whitespace check | Passed | No whitespace errors |

The dedicated local database is `vaettir_browser_test` on `127.0.0.1:55439`, user `vaettir_test`. The browser lane created it and applied migrations/reference seed. Fixture-owned organizations, owners, controls, enrollments, service accounts and deletion-log entries are cleaned after tests. The schema/reference seed remains for repeatable local checks. The shared PostgreSQL server was not stopped or reconfigured. No customer or other lane's database was mutated.

Build-only validation used a synthetic Clerk publishable-key shape and localhost API URL, not a real session. Authenticated E2E must use approved development-instance keys and identity. Do not reuse build placeholders as credentials.

## CI/startup contract for operations

Operations task `01a0550b-a91f-77c0-b21b-b49b7dd72518` owns workflow/process startup. Keep dedicated Clerk secret preflight and no paid AI by default. No workflow edits are required from this lane.

Credential-free PR commands, from repository root after install, Prisma generation, shared builds and test-database migrations/reference seed:

```powershell
node --experimental-strip-types --test apps/web/lib/beta-ui.test.mjs
pnpm --filter @vaettir/web exec playwright test --config e2e/fixture.config.ts
pnpm --filter @vaettir/web typecheck
pnpm --filter @vaettir/web lint
pnpm --filter @vaettir/web exec playwright test --list
```

Only the fixture command needs `DATABASE_URL`; its config supplies process-local synthetic placeholders and never authenticates. Keep this runner separate from `playwright.config.ts`. The default runner requires local API/web servers and a dedicated verified Clerk development identity, with `DATABASE_URL`, `NEXT_PUBLIC_API_URL`, `PLAYWRIGHT_BASE_URL`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `CLERK_TEST_EMAIL`, `CLERK_TEST_PASSWORD`, `CLERK_TEST_USER_ID`. API and web must use the same Clerk test instance and database. No project IDs, existing organizations or paid provider keys are required for default scenarios.

Default browser command: `pnpm --filter @vaettir/web test:e2e`. Use one worker and one test process per identity/database. Retries are zero. Identity setup verifies ID, primary email and verified status before writing private storage state. All browser fixtures reject an identity with existing memberships or enrollment. Test reports/storage state are private; do not upload auth files or tokens.

## Remaining acceptance gates and dependencies

- Blocked: dedicated verified Clerk DEVELOPMENT user ID/email/password and matching approved test keys have not been supplied. No identity was provisioned or borrowed. Authentication, actual invitation acceptance, UI interactions and all selectors still require runtime validation.
- Blocked: no genuine browser screenshots or recordings were captured or reviewed in this lane. The parent reported `ERR_BLOCKED_BY_CLIENT`; it was not bypassed. Builds and mocked failure assertions are not visual acceptance.
- Deferred until approved: live `@ai` calls, real isolated Git/source-linked failure fixtures, model availability/accounting and asynchronous worker completion. Default fixtures deliberately contain no connected repository. CI ingestion and webhook/attachment acceptance require their own isolated resources and evidence.
- Permissions task `01a054fa-c9b9-78f3-80e2-9241673a60ae` owns enforcement/atomicity: seat races, credit races/idempotency, tenant isolation, revoked access and ambiguous CI mappings. UI capability tests do not replace server authorization tests. Browser error paths must preserve actionable server messages after integration.
- Dependency task `01a05504-36ed-7a83-8493-9c9d7f754fd5` owns coordinated upgrades. Rerun these checks after merging dependency and API changes. This branch does not claim to resolve checkpoint advisories.
- UI authorization is a usability layer, not a security boundary. Manual exploratory-session/execution screens and all unexercised flows remain part of release-candidate review. A passing targeted test is not a universal read-only or revocation proof.
- No native, physical-device, restore, rollback, alert delivery or operational acceptance was performed here. Final invitation/go-no-go remains with James after the integrated register is satisfied.
