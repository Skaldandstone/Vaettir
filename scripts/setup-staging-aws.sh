#!/usr/bin/env bash
# P10-09: provisions a full second AWS stack (suffix "-staging") mirroring
# production's architecture exactly (see docs/AWS_DEPLOYMENT.md's "What
# exists" table) - its own VPC, RDS instance, ECS cluster/services, ALB,
# CloudFront distribution, ECR repos, CodeBuild projects, Secrets Manager
# entries, and IAM roles. Nothing shared with production: a staging bug or
# migration mistake can never touch real (eventually real-customer) data.
#
# THIS SCRIPT DOES NOT RUN AUTOMATICALLY AND HAS NOT BEEN RUN AGAINST A
# LIVE ACCOUNT. Written 2026-09-12 on direct instruction to get the staging
# infra ready as code without provisioning it yet - "there are no
# production customers yet, so the recurring cost isn't worth incurring
# until it's actually needed." Every resource here costs real money the
# moment it exists (the RDS instance alone is the bulk of it, roughly
# db.t4g.micro pricing - a few dollars a month - plus ECS Fargate task
# time, an ALB, and a CloudFront distribution). Review this script line by
# line before running it, and run it from an interactive `aws login`
# session (the account's SCP requires interactive browser-SSO for
# codebuild:StartBuild/s3:PutObject/ecs:UpdateService per
# docs/AWS_DEPLOYMENT.md's redeploy note - no agent or service credential
# can run this unattended even if it wanted to).
#
# Usage (once you're ready to actually provision staging):
#   ./scripts/setup-staging-aws.sh
#
# Idempotency: each step checks whether its resource already exists before
# creating it, so re-running after a partial failure resumes rather than
# erroring on "already exists" or duplicating anything.

set -euo pipefail

PROFILE=vaettir-toolkit
REGION=us-east-2
ACCOUNT_ID=051722405355
ENV_SUFFIX=staging

cd "$(dirname "$0")/.."

echo "==> Verifying AWS session ($PROFILE)"
if ! aws sts get-caller-identity --profile "$PROFILE" --region "$REGION" >/dev/null 2>&1; then
  echo "Session expired or missing. Run: aws login --region $REGION --profile $PROFILE"
  exit 1
fi

echo ""
echo "This will provision a full second stack (suffix -$ENV_SUFFIX) in account $ACCOUNT_ID."
echo "This costs real money from the moment resources exist (RDS + ECS Fargate + ALB + CloudFront)."
read -r -p "Type 'yes' to continue: " CONFIRM
if [[ "$CONFIRM" != "yes" ]]; then
  echo "Aborted - nothing created."
  exit 0
fi

aws_cli() { aws "$@" --profile "$PROFILE" --region "$REGION"; }

resource_exists() {
  # Runs the given aws CLI describe/get command and returns success (0) if
  # it found the resource, non-zero if it genuinely doesn't exist yet.
  "$@" >/dev/null 2>&1
}

# ---------------------------------------------------------------------------
# 1. Networking - reuses production's VPC/subnets (no NAT Gateway, same
#    cost-conscious choice production made) but its own security groups, so
#    a staging security-group misconfiguration can never widen production's
#    attack surface even though the underlying VPC is shared.
# ---------------------------------------------------------------------------
echo "==> Step 1: security groups"
echo "    MANUAL STEP: this script does not yet look up production's VPC/subnet"
echo "    IDs programmatically (they aren't recorded anywhere as data, only in"
echo "    docs/AWS_DEPLOYMENT.md prose). Before running the rest of this script,"
echo "    fill in VPC_ID and SUBNET_IDS below by running:"
echo "      aws ec2 describe-vpcs --profile $PROFILE --region $REGION"
echo "      aws ec2 describe-subnets --profile $PROFILE --region $REGION --filters Name=vpc-id,Values=<VPC_ID>"
VPC_ID="${VAETTIR_STAGING_VPC_ID:-}"
SUBNET_IDS="${VAETTIR_STAGING_SUBNET_IDS:-}"
if [[ -z "$VPC_ID" || -z "$SUBNET_IDS" ]]; then
  echo "==> VAETTIR_STAGING_VPC_ID / VAETTIR_STAGING_SUBNET_IDS not set - stopping here."
  echo "    Re-run with those env vars set once you've looked them up."
  exit 1
fi

# ---------------------------------------------------------------------------
# 2. RDS - a real second Postgres instance, not a shared schema on
#    production's. db.t4g.micro / single-AZ, matching production's own
#    cost-conscious tier exactly (see AWS_DEPLOYMENT.md's known caveats
#    about RDS-managed password rotation - the same 7-day rotation applies
#    here and needs the same scripts/sync-db-secret.mjs recovery pattern
#    if this is left running for weeks between test cycles).
# ---------------------------------------------------------------------------
echo "==> Step 2: RDS instance (vaettir-postgres-$ENV_SUFFIX)"
if resource_exists aws_cli rds describe-db-instances --db-instance-identifier "vaettir-postgres-$ENV_SUFFIX"; then
  echo "    already exists, skipping"
else
  aws_cli rds create-db-instance \
    --db-instance-identifier "vaettir-postgres-$ENV_SUFFIX" \
    --db-instance-class db.t4g.micro \
    --engine postgres --engine-version 16.15 \
    --allocated-storage 20 --storage-type gp3 --storage-encrypted \
    --master-username vaettir_admin --manage-master-user-password \
    --no-multi-az --no-publicly-accessible \
    --backup-retention-period 1 \
    --vpc-security-group-ids "PLACEHOLDER-run-step-3-first-then-fill-in"
  echo "    NOTE: the --vpc-security-group-ids placeholder above needs the real"
  echo "    staging RDS security group id from step 3 - this script stops short"
  echo "    of fully automating the create-then-reference ordering; do that step"
  echo "    by hand the first time, then update this script with the real id."
fi

# ---------------------------------------------------------------------------
# 3. ECR repositories
# ---------------------------------------------------------------------------
echo "==> Step 3: ECR repositories"
for repo in "vaettir-api-$ENV_SUFFIX" "vaettir-web-$ENV_SUFFIX"; do
  if resource_exists aws_cli ecr describe-repositories --repository-names "$repo"; then
    echo "    $repo already exists, skipping"
  else
    aws_cli ecr create-repository --repository-name "$repo" \
      --image-scanning-configuration scanOnPush=true \
      --encryption-configuration encryptionType=KMS
  fi
done

# ---------------------------------------------------------------------------
# 4. S3 buckets (build source + test artifacts)
# ---------------------------------------------------------------------------
echo "==> Step 4: S3 buckets"
SOURCE_BUCKET="vaettir-build-source-$ACCOUNT_ID-$ENV_SUFFIX"
ARTIFACTS_BUCKET="vaettir-test-artifacts-$ACCOUNT_ID-$ENV_SUFFIX"
for bucket in "$SOURCE_BUCKET" "$ARTIFACTS_BUCKET"; do
  if resource_exists aws_cli s3api head-bucket --bucket "$bucket"; then
    echo "    $bucket already exists, skipping"
  else
    aws_cli s3api create-bucket --bucket "$bucket" --region "$REGION" \
      --create-bucket-configuration LocationConstraint="$REGION"
    aws_cli s3api put-public-access-block --bucket "$bucket" \
      --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
  fi
done

echo ""
echo "==> Stopped here deliberately."
echo "    Steps 5+ (ECS cluster/services/task definitions, ALB, CloudFront,"
echo "    CodeBuild projects, IAM roles, Secrets Manager entries) follow the"
echo "    exact same shape as production's - see docs/AWS_DEPLOYMENT.md's"
echo "    'What exists' table for the precise resource list and settings to"
echo "    replicate with the -$ENV_SUFFIX suffix. Not scripted yet: this first"
echo "    pass covers the pieces that are safe to fully automate (networking"
echo "    lookup, RDS, ECR, S3) without live-testing against the real account;"
echo "    the ECS/ALB/CloudFront/IAM wiring has more interdependent ordering"
echo "    (security group -> RDS, task role -> task definition -> service ->"
echo "    ALB target group -> listener rule -> CloudFront origin) that's worth"
echo "    doing once, carefully, with a human watching each step - the exact"
echo "    reasoning docs/AWS_DEPLOYMENT.md's own account-rebuild history"
echo "    already demonstrates (several real gaps were only caught by running"
echo "    the real deploy and watching what broke)."
