# CI integrations

Scripts that post JUnit XML test results to a Vaettir project from a CI system, via `testRuns.ingestJUnit` (see [`apps/api/src/routers/testRuns.ts`](../apps/api/src/routers/testRuns.ts)).

CircleCI and Jenkins both already report test results as JUnit XML natively (`store_test_results` and the JUnit plugin, respectively) - there's no separate "native format" to translate here, unlike JUnit ingestion itself which had real parsing work to do. Each script's job is just deriving the CI run's context (commit, branch, run URL) from that platform's own standard environment variables and POSTing to the same endpoint.

For a GitHub Actions workflow, use [`.github/actions/report-test-results`](../.github/actions/report-test-results) instead - a composite action rather than a standalone script, since GitHub Actions supports that natively.

| Platform | Script | Context env vars |
|---|---|---|
| CircleCI | [`circleci/report.sh`](circleci/report.sh) | `CIRCLE_SHA1`, `CIRCLE_BRANCH`, `CIRCLE_BUILD_URL` |
| Jenkins | [`jenkins/report.sh`](jenkins/report.sh) | `GIT_COMMIT`, `GIT_BRANCH`, `BUILD_URL` |

Every script needs `VAETTIR_API_URL`, `VAETTIR_API_KEY` (an API key from Organization Settings → API keys, granted at least `EDITOR` - keep it in your CI system's secret/credential store, never in the pipeline config itself), `VAETTIR_PROJECT_ID`, and `JUNIT_PATH` (path to the JUnit XML file to report). See each script's own header comment for a usage snippet.

The framework-neutral evidence uploader accepts JUnit XML plus a JSON manifest:

```json
[{"externalTestId":"tests/checkout::opens checkout","files":[{"path":"checkout-diff.png","type":"SCREENSHOT"}]}]
```

Set `VAETTIR_JUNIT_PATH`, `VAETTIR_MANIFEST_PATH`, `VAETTIR_COMMIT_SHA` and
`VAETTIR_BRANCH` in addition to the API credentials above, then run
`node ci-integrations/report-junit-evidence.mjs`. The manifest ID must match
Vaettir's JUnit ID (the explicit stable ID if present, otherwise
`classname::name` or just `name` if classname is absent).
Evidence attaches only to failed results. Use one result per manifest ID.
Playwright generates the manifest automatically. Other runners can generate
it alongside their JUnit report using their own screenshot or video hooks.

For a visual assertion, keep an approved PNG per device/browser, viewport,
theme and fixture in your test repository. With Pillow installed, run
`python ci-integrations/compare-screenshots.py baseline.png actual.png diff.png`.
It writes a new PNG with changed pixels in magenta and exits 1 when the
changed-pixel limit is exceeded or image dimensions differ. Use a new output
path each run. Capture its exit code as a JUnit failure in your framework and
attach the diff using the manifest. Approve baseline changes in source review.
