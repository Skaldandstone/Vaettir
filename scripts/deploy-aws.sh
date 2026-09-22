#!/usr/bin/env bash
# One-command redeploy to the Vaettir AWS account (051722405355, us-east-2).
# Rebuilt here 2026-09-02 after the original account (094842496450) was
# removed from the AWS organization -- same architecture, new account, see
# docs/AWS_DEPLOYMENT.md.
#
# Collapses the manual sequence from docs/AWS_DEPLOYMENT.md into one script.
# This is NOT a CI trigger -- it still has to be run by a human (or an agent
# with an active `aws login` session) with the vaettir-toolkit profile active.
# Real push-triggered CI is architecturally impossible in this account: the
# SCP explicitly denies codebuild:StartBuild, s3:PutObject, and
# ecs:UpdateService to every identity except an interactive-browser-SSO
# session assuming AccountFullAccessRole -- confirmed via
# `aws iam simulate-principal-policy` for both the plain IAM user
# (VaettirBot) and the CodeBuild service role itself, both explicitDeny.
# There is no service-role or stored-credential path around that; only a
# human sign-in can produce a working session here.
#
# Usage:
#   ./scripts/deploy-aws.sh          # rebuild + redeploy both api and web
#   ./scripts/deploy-aws.sh api      # only api
#   ./scripts/deploy-aws.sh web      # only web
#
# P10-09: set VAETTIR_DEPLOY_ENV=staging to target the staging stack once it
# exists (see docs/STAGING_ENVIRONMENT.md) instead of production. Defaults
# to production ("") for every existing call site - this is purely additive,
# no behavior change for anyone not setting the env var.

set -euo pipefail

PROFILE=vaettir-toolkit
REGION=us-east-2
ENV_SUFFIX="${VAETTIR_DEPLOY_ENV:+-$VAETTIR_DEPLOY_ENV}"
BUCKET="vaettir-build-source-051722405355${ENV_SUFFIX}"
TARGET="${1:-both}"

cd "$(dirname "$0")/.."

echo "==> Verifying AWS session (vaettir-toolkit)"
if ! aws sts get-caller-identity --profile "$PROFILE" --region "$REGION" >/dev/null 2>&1; then
  echo "Session expired or missing. Run: aws login --region $REGION --profile $PROFILE"
  exit 1
fi

echo "==> Packaging committed source"
ARCHIVE="$(mktemp -u).zip"
git archive --format=zip -o "$ARCHIVE" HEAD
aws s3 cp "$ARCHIVE" "s3://$BUCKET/vaettir-source.zip" --profile "$PROFILE" --region "$REGION"
rm -f "$ARCHIVE"
RELEASE_COMMIT="$(git rev-parse HEAD)"

start_build() {
  local project=$1
  echo "==> Starting $project" >&2
  aws codebuild start-build --project-name "$project" --profile "$PROFILE" --region "$REGION" \
    --environment-variables-override "name=VAETTIR_RELEASE_COMMIT,value=$RELEASE_COMMIT,type=PLAINTEXT" \
    --query "build.id" --output text
}

wait_for_build() {
  local build_id=$1
  echo "==> Waiting for $build_id" >&2
  while true; do
    status=$(aws codebuild batch-get-builds --ids "$build_id" --profile "$PROFILE" --region "$REGION" \
      --query "builds[0].buildStatus" --output text)
    case "$status" in
      SUCCEEDED) echo "    $build_id succeeded"; return 0 ;;
      FAILED|FAULT|STOPPED|TIMED_OUT) echo "    $build_id ended: $status"; return 1 ;;
      *) sleep 15 ;;
    esac
  done
}

deploy_immutable() {
  local name=$1
  echo "==> Pinning $name to the image digest built for $RELEASE_COMMIT"
  AWS_PROFILE="$PROFILE" AWS_REGION="$REGION" ./scripts/pin-ecs-release.sh \
    "$name" "$RELEASE_COMMIT" "vaettir-cluster${ENV_SUFFIX}"
}

if [[ "$TARGET" == "both" || "$TARGET" == "api" ]]; then
  api_build=$(start_build "vaettir-api-build${ENV_SUFFIX}")
  wait_for_build "$api_build"
  deploy_immutable "vaettir-api${ENV_SUFFIX}"
fi

if [[ "$TARGET" == "both" || "$TARGET" == "web" ]]; then
  web_build=$(start_build "vaettir-web-build${ENV_SUFFIX}")
  wait_for_build "$web_build"
  deploy_immutable "vaettir-web${ENV_SUFFIX}"
fi

echo "==> Done. Verify: curl https://d35bt2repnvk6t.cloudfront.net/api/health"
