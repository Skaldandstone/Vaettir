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

REPOSITORY_URI=$(aws ecr describe-repositories --repository-names "$SERVICE" --region "$REGION" --query 'repositories[0].repositoryUri' --output text)
IMAGE_DIGEST=$(aws ecr describe-images --repository-name "$SERVICE" --image-ids imageTag=latest --region "$REGION" --query 'imageDetails[0].imageDigest' --output text)
CURRENT_TASK=$(aws ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" --region "$REGION" --query 'services[0].taskDefinition' --output text)

INPUT=$(mktemp)
OUTPUT=$(mktemp)
trap 'rm -f "$INPUT" "$OUTPUT"' EXIT

aws ecs describe-task-definition --task-definition "$CURRENT_TASK" --region "$REGION" > "$INPUT"
node scripts/render-ecs-task-definition.mjs \
  --input "$INPUT" \
  --output "$OUTPUT" \
  --container "$SERVICE" \
  --repository "$REPOSITORY_URI" \
  --commit "$RELEASE_COMMIT" \
  --digest "$IMAGE_DIGEST"

NEW_TASK=$(aws ecs register-task-definition --cli-input-json "file://$OUTPUT" --region "$REGION" --query 'taskDefinition.taskDefinitionArn' --output text)
aws ecs update-service --cluster "$CLUSTER" --service "$SERVICE" --task-definition "$NEW_TASK" --region "$REGION" --query 'service.[serviceName,taskDefinition,status]' --output text
aws ecs wait services-stable --cluster "$CLUSTER" --services "$SERVICE" --region "$REGION"

RUNNING_IMAGE=$(aws ecs describe-task-definition --task-definition "$NEW_TASK" --region "$REGION" --query "taskDefinition.containerDefinitions[?name=='$SERVICE'].image | [0]" --output text)
if [[ "$RUNNING_IMAGE" != "$REPOSITORY_URI@$IMAGE_DIGEST" ]]; then
  echo "registered task image does not match the built digest" >&2
  exit 1
fi

echo "$SERVICE is stable at $RELEASE_COMMIT ($IMAGE_DIGEST)"
