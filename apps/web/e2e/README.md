# Isolated browser acceptance

Never run these scenarios against customer data or an existing internal organization.

Use the same disposable local PostgreSQL database for API and fixtures. Its name must match vaettir_*test. Apply migrations and reference seeding first. Run one test process at a time with a dedicated, verified Clerk DEVELOPMENT identity having no other memberships. Tests create a new organization and synthetic projects/cases/releases per scenario and clean up exact recorded IDs.

Required environment: DATABASE_URL, NEXT_PUBLIC_API_URL (local), PLAYWRIGHT_BASE_URL (local), NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY (pk_test_), CLERK_SECRET_KEY (sk_test_), CLERK_TEST_EMAIL, CLERK_TEST_PASSWORD, CLERK_TEST_USER_ID. Never use production Clerk keys. The API must have matching Clerk TEST credentials and the same isolated database.

Run local API/web with these variables, then from the repository root:

```powershell
pnpm --filter @vaettir/web exec playwright install chromium
pnpm --filter @vaettir/web test:e2e
```

The setup project uses Clerk's test helper. Authenticated browser execution is currently blocked until dedicated identity credentials are supplied. Test discovery and TypeScript success are not browser acceptance.

The manual release-validation workflow runs only when dispatched, behind the private-beta-validation environment. Configure required reviewers and TEST secrets before enabling it. Paid AI scenarios are tagged @ai and excluded unless VAETTIR_LIVE_AI_TESTS=1. Approve model usage before setting this flag. Do not auto-retry paid mutations whose result is uncertain.

Legacy scenario assertions are being hardened alongside this fixture migration. In particular, change-impact tests still require an isolated real Git repository and model access; healing workflows need source-linked failures. A passing conditional/no-op assertion is not evidence for a release gate. The readiness register remains HOLD until strict end-to-end assertions and screenshots have actually passed.

Browser traces may contain test tokens and synthetic data. Keep reports private, exclude .auth and .fixtures from version control, retain CI artifacts for seven days, and never upload them publicly. Do not save real-user sessions.

Reference: [Clerk Playwright testing](https://clerk.com/docs/guides/development/testing/playwright/overview).
