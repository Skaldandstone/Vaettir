# Playwright failure evidence capture

Captures a screenshot/video on every test run (via Playwright's own `screenshot`/`video` config) but only ever uploads one as a `TestResultArtifact` when the test actually failed - a passing run's capture is discarded by Playwright itself, never touched by this integration.

## Setup

1. Configure Playwright to capture on failure only (this integration relays whatever Playwright already captured - it doesn't take screenshots itself):

```js
// playwright.config.mjs
export default defineConfig({
  reporter: [
    ['junit', { outputFile: 'junit.xml' }], // optional, for other tooling
    ['./ci-integrations/playwright/vaettir-reporter.mjs'],
  ],
  use: {
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
});
```

2. Run tests, then report:

```bash
npx playwright test
node ci-integrations/playwright/report.mjs
```

`vaettir-reporter.mjs` writes `vaettir-junit.xml` (its own JUnit XML, built independently of any other JUnit reporter you also have configured - this keeps the classname/name identifiers it uses internally consistent with the manifest, rather than depending on two separate tools agreeing on a format) and `vaettir-artifacts-manifest.json` (failed tests' screenshot/video file paths). `report.mjs` posts the JUnit XML to `testRuns.ingestJUnit` (same as [`.github/actions/report-test-results`](../../.github/actions/report-test-results)), then uploads each manifest entry's files via `testRuns.requestArtifactUpload` and links them to the right `TestResult`.

## Required env vars for `report.mjs`

`VAETTIR_API_URL`, `VAETTIR_API_KEY`, `VAETTIR_PROJECT_ID`, `VAETTIR_COMMIT_SHA`, `VAETTIR_BRANCH`. Optional: `VAETTIR_CI_PROVIDER` (default `playwright`), `VAETTIR_JUNIT_PATH` / `VAETTIR_MANIFEST_PATH` if you passed custom `junitPath`/`manifestPath` options to the reporter.

## Cypress / WebdriverIO

Not built yet. The same manifest + `report.mjs`-style upload script pattern applies, but each runner has its own plugin/reporter architecture (Cypress's `after:screenshot`/`after:spec` plugin events, WebdriverIO's `Reporter` service class) - a runner-specific adapter is needed for each, not a shared reporter file.
