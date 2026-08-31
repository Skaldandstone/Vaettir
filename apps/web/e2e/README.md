# Isolated browser acceptance

Never run these scenarios against customer data or an existing internal organization.

Use the same disposable local PostgreSQL database for API and fixtures. Its name must match vaettir_*test. Apply migrations and reference seeding first. Run one test process at a time with a dedicated, verified Clerk DEVELOPMENT identity having no other memberships. Tests create a new organization and synthetic projects/cases/releases per scenario and clean up exact recorded IDs.

Required environment: DATABASE_URL, NEXT_PUBLIC_API_URL (local), PLAYWRIGHT_BASE_URL (local), NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY (pk_test_), CLERK_SECRET_KEY (sk_test_), CLERK_TEST_EMAIL, CLERK_TEST_PASSWORD, CLERK_TEST_USER_ID. Never use production Clerk keys. The API must have matching Clerk TEST credentials and the same isolated database.

Run local API/web with these variables, then from the repository root:

```powershell
pnpm --filter @vaettir/web exec playwright install chromium
pnpm --filter @vaettir/web test:e2e
```

The setup project uses Clerk's test helper and verifies the signed-in user ID, normalized primary email and verified-email status before saving private storage state. Supply all three dedicated identity variables together. Do not substitute a real user's session, production keys or an existing internal organization. The identity must have no memberships or beta enrollment before a scenario. Authenticated browser execution is currently blocked until dedicated identity credentials are supplied. Test discovery and TypeScript success are not browser acceptance.

Start the API from this checkout with `pnpm --filter @vaettir/api dev` and web with `pnpm --filter @vaettir/web dev` in separate terminals with the same approved test environment. The browser configuration does not start either server. Build shared workspace packages first. Keep database, Clerk instance, API URL and web build-time API URL aligned. CI owns process startup and readiness checks; do not point a local browser at an already-running server without verifying its configuration.

## Credential-free deterministic checks

These can run on relevant PRs without Clerk credentials, a browser, model access or a running API/web server. Use Node 22.18+ or Node 24 for the built-in TypeScript stripping command. The dependency lane owns any engine/toolchain changes.

```powershell
node --experimental-strip-types --test apps/web/lib/beta-ui.test.mjs
$env:DATABASE_URL='postgresql://vaettir_test@127.0.0.1:55439/vaettir_browser_test?schema=public'
pnpm --filter @vaettir/web exec playwright test --config e2e/fixture.config.ts
```

The database must already exist with migrations and reference seeding applied. The example is this lane's local database, not a portable CI credential. CI should create its own `vaettir_browser_test` database. The fixture config sets synthetic `.invalid` identities and test-key placeholders only within its process and overrides the browser-token fixture. It does not authenticate or contact Clerk. Five contract tests prove seeding/cleanup, non-member invitation setup, read-only membership, admitted owner bootstrap and unadmitted setup. They do not prove rendered UI or invitation acceptance.

The Node tests cover role/seat capabilities and refusal of remote, shared, production-key and database-host-override test environments. A database name is a safety guard, not permission to reuse somebody else's local test database.

## Strict scenario scope

Each scenario receives its own org, two projects, cases, plan/criterion, two releases, mixed CI results, an unmatched result, a pending healing suggestion, coverage, a mapped synthetic compliance control and audit entries. Special fixture modes start with admission only, no admission, or a pending invitation without membership. Cleanup follows exact created IDs, including the organization claimed by owner onboarding. No Kall/TCM records or pre-existing project IDs are used.

Assertions cover persisted case/review/mapping decisions, exact run and coverage counts, hard-block release refusal, invitation acceptance/expiry/email mismatch, owner onboarding, project switching, beta seats/credits and role-specific compliance controls. Read-only coverage includes direct editor URLs and the review/import/requirements/shared-step routes. Network/session failures and simulated insufficient-credit/provider errors check recovery copy, retained input and absence of automatic mutation retries. Simulated provider responses do not establish real-provider or ledger correctness.

There are no conditional `isVisible().catch(...)` pass-through assertions. Playwright retries are zero, including CI. Every UI locator still needs an authenticated execution; static discovery is not evidence that all selectors or runtime behaviors pass.

The manual release-validation workflow runs only when dispatched, behind the private-beta-validation environment. Configure required reviewers and TEST secrets before enabling it. Paid AI scenarios are tagged @ai and excluded unless VAETTIR_LIVE_AI_TESTS=1. Approve model usage before setting this flag. Do not auto-retry paid mutations whose result is uncertain.

Paid change-impact and failure-classification scenarios still require an approved isolated Git repository, source-linked failures and explicit model-use approval. Default fixtures do not connect to a real Git repository. These are prerequisites, not permission to use customer source or weaken assertions. The readiness register remains HOLD until strict end-to-end assertions and screenshots have actually passed.

After authenticated execution is available, record full-page screenshots of onboarding, project selection, case/review, release readiness, members/allowances, compliance and recovery states at desktop and narrow widths. Use synthetic data, retain artifacts privately and have a human inspect clipping, focus order, contrast, loading/error states and understandable copy. Automatic failure screenshots alone do not establish visual acceptance. The parent browser attempt returned `ERR_BLOCKED_BY_CLIENT`; do not bypass that barrier or relabel it a visual pass.

See [browser lane evidence](../../../docs/private-beta/browser-lane-evidence.md) for the local validation results and remaining gates.

Browser traces may contain test tokens and synthetic data. Keep reports private, exclude .auth and .fixtures from version control, retain CI artifacts for seven days, and never upload them publicly. Do not save real-user sessions.

Reference: [Clerk Playwright testing](https://clerk.com/docs/guides/development/testing/playwright/overview).
