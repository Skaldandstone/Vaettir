#!/usr/bin/env bash
set -euo pipefail

# Builds the request body with Node (present on every GitHub-hosted runner
# image) rather than shell string interpolation, since a JUnit file's
# content -- quotes, newlines, non-ASCII failure messages -- is exactly the
# kind of thing that's unsafe to splice into a curl -d argument by hand.
CI_RUN_URL="${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}"

PAYLOAD=$(INPUT_JUNIT_PATH="$INPUT_JUNIT_PATH" \
  INPUT_PROJECT_ID="$INPUT_PROJECT_ID" \
  INPUT_CI_PROVIDER="$INPUT_CI_PROVIDER" \
  CI_RUN_URL="$CI_RUN_URL" \
  GITHUB_SHA="$GITHUB_SHA" \
  GITHUB_REF_NAME="$GITHUB_REF_NAME" \
  node -e '
    const fs = require("fs");
    const xml = fs.readFileSync(process.env.INPUT_JUNIT_PATH, "utf8");
    process.stdout.write(JSON.stringify({
      projectId: process.env.INPUT_PROJECT_ID,
      ciProvider: process.env.INPUT_CI_PROVIDER,
      ciRunUrl: process.env.CI_RUN_URL,
      commitSha: process.env.GITHUB_SHA,
      branch: process.env.GITHUB_REF_NAME,
      junitXml: xml,
    }));
  ')

API_URL="${INPUT_API_URL%/}"
RESPONSE=$(curl -sS -w '\n%{http_code}' -X POST "${API_URL}/trpc/testRuns.ingestJUnit" \
  -H "Authorization: Bearer ${INPUT_API_KEY}" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

echo "$BODY"

if [ "$HTTP_CODE" -ge 400 ]; then
  echo "Vaettir ingestion failed with HTTP $HTTP_CODE" >&2
  exit 1
fi
