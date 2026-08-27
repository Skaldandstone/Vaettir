#!/usr/bin/env bash
set -euo pipefail

# Posts a JUnit XML results file to Vaettir at the end of a CircleCI job.
# CircleCI's own test-reporting story is already JUnit XML (the same format
# store_test_results consumes), so no format translation is needed here --
# just deriving the CI context from CircleCI's own environment variables
# instead of GitHub's, and reusing the same testRuns.ingestJUnit endpoint
# .github/actions/report-test-results posts to.
#
# Required env vars: VAETTIR_API_URL, VAETTIR_API_KEY, VAETTIR_PROJECT_ID,
# JUNIT_PATH. Optional: VAETTIR_CI_PROVIDER (defaults to "circleci").
#
# Usage in .circleci/config.yml:
#   - run:
#       name: Report test results to Vaettir
#       command: bash ci-integrations/circleci/report.sh
#       when: always
#       environment:
#         JUNIT_PATH: test-results/junit.xml
#       # VAETTIR_API_URL / VAETTIR_PROJECT_ID as plain env, VAETTIR_API_KEY
#       # from a CircleCI contexts/project env var, never checked into config.yml.

: "${VAETTIR_API_URL:?Set VAETTIR_API_URL}"
: "${VAETTIR_API_KEY:?Set VAETTIR_API_KEY}"
: "${VAETTIR_PROJECT_ID:?Set VAETTIR_PROJECT_ID}"
: "${JUNIT_PATH:?Set JUNIT_PATH to the JUnit XML file to report}"

CI_PROVIDER="${VAETTIR_CI_PROVIDER:-circleci}"

PAYLOAD=$(JUNIT_PATH="$JUNIT_PATH" \
  VAETTIR_PROJECT_ID="$VAETTIR_PROJECT_ID" \
  CI_PROVIDER="$CI_PROVIDER" \
  CIRCLE_BUILD_URL="${CIRCLE_BUILD_URL:-}" \
  CIRCLE_SHA1="${CIRCLE_SHA1:-}" \
  CIRCLE_BRANCH="${CIRCLE_BRANCH:-}" \
  node -e '
    const fs = require("fs");
    const xml = fs.readFileSync(process.env.JUNIT_PATH, "utf8");
    process.stdout.write(JSON.stringify({
      projectId: process.env.VAETTIR_PROJECT_ID,
      ciProvider: process.env.CI_PROVIDER,
      ciRunUrl: process.env.CIRCLE_BUILD_URL || undefined,
      commitSha: process.env.CIRCLE_SHA1,
      branch: process.env.CIRCLE_BRANCH,
      junitXml: xml,
    }));
  ')

API_URL="${VAETTIR_API_URL%/}"
RESPONSE=$(curl -sS -w '\n%{http_code}' -X POST "${API_URL}/trpc/testRuns.ingestJUnit" \
  -H "Authorization: Bearer ${VAETTIR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')
echo "$BODY"

if [ "$HTTP_CODE" -ge 400 ]; then
  echo "Vaettir ingestion failed with HTTP $HTTP_CODE" >&2
  exit 1
fi
