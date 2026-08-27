#!/usr/bin/env bash
set -euo pipefail

# Posts a JUnit XML results file to Vaettir at the end of a Jenkins build.
# Jenkins' own JUnit plugin already consumes JUnit-format XML, so no format
# translation is needed here -- just deriving the CI context from the
# standard env vars the Jenkins Git plugin sets, and reusing the same
# testRuns.ingestJUnit endpoint .github/actions/report-test-results posts to.
#
# Required env vars: VAETTIR_API_URL, VAETTIR_API_KEY, VAETTIR_PROJECT_ID,
# JUNIT_PATH. Optional: VAETTIR_CI_PROVIDER (defaults to "jenkins").
#
# Usage in a Jenkinsfile:
#   stage('Report to Vaettir') {
#     steps {
#       withCredentials([string(credentialsId: 'vaettir-api-key', variable: 'VAETTIR_API_KEY')]) {
#         sh 'JUNIT_PATH=build/test-results/junit.xml bash ci-integrations/jenkins/report.sh'
#       }
#     }
#   }
# VAETTIR_API_URL / VAETTIR_PROJECT_ID as plain pipeline env, VAETTIR_API_KEY
# from a Jenkins credential, never checked into the Jenkinsfile.

: "${VAETTIR_API_URL:?Set VAETTIR_API_URL}"
: "${VAETTIR_API_KEY:?Set VAETTIR_API_KEY}"
: "${VAETTIR_PROJECT_ID:?Set VAETTIR_PROJECT_ID}"
: "${JUNIT_PATH:?Set JUNIT_PATH to the JUnit XML file to report}"

CI_PROVIDER="${VAETTIR_CI_PROVIDER:-jenkins}"

PAYLOAD=$(JUNIT_PATH="$JUNIT_PATH" \
  VAETTIR_PROJECT_ID="$VAETTIR_PROJECT_ID" \
  CI_PROVIDER="$CI_PROVIDER" \
  BUILD_URL="${BUILD_URL:-}" \
  GIT_COMMIT="${GIT_COMMIT:-}" \
  GIT_BRANCH="${GIT_BRANCH:-}" \
  node -e '
    const fs = require("fs");
    const xml = fs.readFileSync(process.env.JUNIT_PATH, "utf8");
    process.stdout.write(JSON.stringify({
      projectId: process.env.VAETTIR_PROJECT_ID,
      ciProvider: process.env.CI_PROVIDER,
      ciRunUrl: process.env.BUILD_URL || undefined,
      commitSha: process.env.GIT_COMMIT,
      branch: process.env.GIT_BRANCH,
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
