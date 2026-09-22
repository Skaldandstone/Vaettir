# Vaettir's own E2E suite

Dogfooding: these Playwright tests exercise the Vaettir platform itself
(this repo, `apps/web`), and are reverse-engineered into `TestCase`s in
Vaettir's own **"TCM"** project (Test Case Management - Vaettir tracking
its own testing, same as any customer's repo) using the exact same
reverse-engineering pipeline every customer uses. Playwright is a native
`FrameworkFamily` (see `packages/core/src/frameworks.ts`), so these get
deterministic structural extraction, not a pure AI read.

## Running locally

```bash
# 1. Start the API and web dev servers (see the root README)
pnpm --filter @vaettir/api dev
pnpm --filter @vaettir/web dev

# 2. Set real credentials for a seeded test user with access to the org
#    that owns the "Kall" and "TCM" projects
export CLERK_TEST_EMAIL="you@example.com"
export CLERK_TEST_PASSWORD="..."

# 3. Install browsers once
pnpm --filter @vaettir/web exec playwright install chromium

# 4. Run the suite
pnpm --filter @vaettir/web test:e2e
```

The `auth-setup` Playwright project signs in once via the real Clerk
email/password form and saves the session (`e2e/.auth/user.json`, gitignored)
for the authenticated project to reuse. The signed-out project does not
depend on it, so credential-free auth-shell checks can run independently:

```bash
pnpm --filter @vaettir/web exec playwright test --project=signed-out
```

## Full loop: reporting real run results back into TCM

`ci-integrations/playwright/vaettir-reporter.mjs` (built earlier for
customer use) is a generic Playwright→Vaettir reporter - wiring it into
this suite's own `playwright.config.ts` would let a real run of this
suite report its own pass/fail results back into TCM's `TestRun`s via
`testRuns.ingestJUnit`, closing the loop all the way (write the e2e
tests → reverse-engineer them into cases → run them → see real results on
the same cases). Not wired in yet - it needs each TCM test case's
`TestCaseSource.externalTestId` to match the reporter's
`<file>::<titlePath>` format, which the reverse-engineering pass didn't
set that way, and this needs a real run to verify against, which needs
the credentials above. Natural next step once someone can actually run
this suite.

## What's covered

13 spec files, ~75 scenarios, across every major surface built this
project: auth, projects, test cases (BDD authoring, quick-add, bulk ops,
search, CSV import), test plans, requirements, AI reverse-engineering
(paste/background-job/Gherkin/Postman/custom-framework-heuristic),
compliance (framework/control mapping, evidence, sign-off, CSV export),
test strategy (risk assessment, change-impact analysis, PR scan policy),
release readiness (acceptance criteria, risk flags, release gates, trend
charts), the org-wide dashboard, test runs (result linking, self-healing
classify/approve/reject), the audit log, members/invites/seat usage/plan
switching, and AI credits.

## Not covered here

- **Mobile** (`apps/mobile`) - Playwright drives a browser, not Expo/React
  Native; mobile needs its own device/simulator-based E2E tooling if that
  becomes a priority.
- **The GitHub App webhook path** (P6-01/P6-05) - needs a real installed
  GitHub App delivering a real webhook, not something a browser-driven
  suite can trigger; see the verification approach already used for that
  ticket in `ROADMAP.md` instead (a locally-posted, correctly-signed
  simulated payload).
- **Exact AI output content** - these tests check that AI-powered features
  *respond* (a classification appears, a recommendation list renders),
  not that the LLM's specific wording matches something fixed - LLM output
  isn't stable enough for that, same reasoning as
  `packages/ai-agent/scripts/promptRegression.ts`.
