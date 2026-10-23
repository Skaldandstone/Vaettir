#!/usr/bin/env bash
set -euo pipefail

SERVICE=${1:?service name is required}
RELEASE_COMMIT=${2:?release commit is required}
CLUSTER=${3:-vaettir-cluster}
REGION=${AWS_REGION:-us-east-2}

if [[ ! "$RELEASE_COMMIT" =~ ^[a-f0-9]{40}$ ]]; then
  echo "release commit must be a lowercase 40-character Git SHA" >&2
  exit 1
fi
if [[ ! "$SERVICE" =~ ^vaettir-(api|web)(-staging)?$ ]]; then
  echo "unsupported Vaettir service" >&2
  exit 1
fi
cd "$(dirname "$0")/.."

REPOSITORY_URI=$(aws ecr describe-repositories --repository-names "$SERVICE" --region "$REGION" --query 'repositories[0].repositoryUri' --output text)
IMAGE_DIGEST=$(aws ecr describe-images --repository-name "$SERVICE" --image-ids "imageTag=$RELEASE_COMMIT" --region "$REGION" --query 'imageDetails[0].imageDigest' --output text)
CURRENT_TASK=$(aws ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" --region "$REGION" --query 'services[0].taskDefinition' --output text)

# Preserve recovery evidence even if the candidate fails or ECS rolls back.
# Only generated deployment metadata lives here; never retrieved secret values.
mkdir -p ".local/releases/$SERVICE/$RELEASE_COMMIT"
EVIDENCE_DIR=$(mktemp -d ".local/releases/$SERVICE/$RELEASE_COMMIT/attempt.XXXXXX")
INPUT="$EVIDENCE_DIR/task-before.json"
OUTPUT="$EVIDENCE_DIR/task-candidate.json"
CONFIG="$EVIDENCE_DIR/rollback-config.json"

aws ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" --region "$REGION" > "$EVIDENCE_DIR/service-before.json"
aws ecs describe-task-definition --task-definition "$CURRENT_TASK" --region "$REGION" > "$INPUT"
node scripts/render-ecs-rollback-config.mjs "$EVIDENCE_DIR/service-before.json" "$INPUT" "$SERVICE" "$REPOSITORY_URI" > "$CONFIG"
RECOVERY_DIGEST=$(aws ecs describe-task-definition --task-definition "$CURRENT_TASK" --region "$REGION" --query "taskDefinition.containerDefinitions[?name=='$SERVICE'].environment[] | [?name=='VAETTIR_IMAGE_DIGEST'].value | [0]" --output text)
# The completed predecessor must still be pullable from ECR.
aws ecr describe-images --repository-name "$SERVICE" --image-ids "imageDigest=$RECOVERY_DIGEST" --region "$REGION" > "$EVIDENCE_DIR/recovery-image.json"
node scripts/render-ecs-task-definition.mjs \
  --input "$INPUT" \
  --output "$OUTPUT" \
  --container "$SERVICE" \
  --repository "$REPOSITORY_URI" \
  --commit "$RELEASE_COMMIT" \
  --digest "$IMAGE_DIGEST"

# Git Bash supplies POSIX /tmp paths, while the installed AWS CLI is a
# native Windows executable and cannot open those paths. Translate only at
# that process boundary; Linux/macOS continue using the mktemp path as-is.
AWS_OUTPUT=$OUTPUT
AWS_CONFIG=$CONFIG
if command -v cygpath >/dev/null 2>&1; then
  AWS_OUTPUT=$(cygpath -w "$OUTPUT")
  AWS_CONFIG=$(cygpath -w "$CONFIG")
fi
NEW_TASK=$(aws ecs register-task-definition --cli-input-json "file://$AWS_OUTPUT" --region "$REGION" --query 'taskDefinition.taskDefinitionArn' --output text)
printf '%s\n' "$NEW_TASK" > "$EVIDENCE_DIR/registered-task.txt"
aws ecs update-service --cluster "$CLUSTER" --service "$SERVICE" --task-definition "$NEW_TASK" --deployment-configuration "file://$AWS_CONFIG" --region "$REGION" > "$EVIDENCE_DIR/service-update.json"
aws ecs wait services-stable --cluster "$CLUSTER" --services "$SERVICE" --region "$REGION"
# services-stable can succeed after automatic rollback to the OLD revision.
aws ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" --region "$REGION" > "$EVIDENCE_DIR/service-after.json"
node scripts/check-ecs-release.mjs "$NEW_TASK" < "$EVIDENCE_DIR/service-after.json"

RUNNING_IMAGE=$(aws ecs describe-task-definition --task-definition "$NEW_TASK" --region "$REGION" --query "taskDefinition.containerDefinitions[?name=='$SERVICE'].image | [0]" --output text)
if [[ "$RUNNING_IMAGE" != "$REPOSITORY_URI@$IMAGE_DIGEST" ]]; then
  echo "registered task image does not match the built digest" >&2
  exit 1
fi

echo "$SERVICE is stable at $RELEASE_COMMIT ($IMAGE_DIGEST)"
