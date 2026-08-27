# report-test-results

Posts a JUnit XML results file to a Vaettir project as a `TestRun`, so results ingested by [`testRuns.ingestJUnit`](../../../apps/api/src/routers/testRuns.ts) show up on that project's Test Runs page.

## Usage

```yaml
- name: Run tests
  run: npm test -- --reporter=junit --outputFile=junit.xml

- name: Report results to Vaettir
  if: always()
  uses: ./.github/actions/report-test-results
  with:
    api-url: https://your-vaettir-api.example.com
    api-key: ${{ secrets.VAETTIR_API_KEY }}
    project-id: your-project-id
    junit-path: junit.xml
```

Use `if: always()` so a failing test suite still gets reported, not just a green run.

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `api-url` | yes | | Base URL of the Vaettir API |
| `api-key` | yes | | An API key from Organization Settings → API keys, granted at least `EDITOR` |
| `project-id` | yes | | The Vaettir project to report against |
| `junit-path` | yes | | Path to a JUnit XML file |
| `ci-provider` | no | `github-actions` | Recorded as the `TestRun.ciProvider` |

`commitSha`, `branch`, and `ciRunUrl` are derived automatically from the GitHub Actions context (`GITHUB_SHA`, `GITHUB_REF_NAME`, `GITHUB_SERVER_URL`/`GITHUB_REPOSITORY`/`GITHUB_RUN_ID`) - not inputs.

Only a single JUnit file per step is supported. A suite that produces multiple report files needs one step per file (or a separate merge step that combines them into one file first).
