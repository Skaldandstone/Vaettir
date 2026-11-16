#!/usr/bin/env bash
set -euo pipefail

phase=${1:-}
commit=${2:-}
builder=${3:-}
if [[ $# != 3 || ! "$phase" =~ ^(prepare-native|build-image)$ ||
      ! "$commit" =~ ^[a-f0-9]{40}$ || ! "$builder" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]]; then
  echo "Usage: $0 {prepare-native|build-image} <commit> <builder>" >&2
  exit 2
fi

cd "$(dirname "$0")/.."
[[ "$(git rev-parse --verify "$commit^{commit}")" == "$commit" ]]
image="vaettir-api:$commit"
flags=(--builder "$builder" --platform linux/amd64 --progress plain --file Dockerfile.api
       --build-arg "VAETTIR_RELEASE_COMMIT=$commit")

if [[ "$phase" == prepare-native ]]; then
  # Use the production target, with fresh compiler inputs and both unit suites.
  flags+=(--no-cache-filter llvm-build-inputs,llvm-build --target llvm-build --output type=cacheonly)
else
  # Keep the native cache but rerun the final image checks.
  flags+=(--no-cache-filter runtime --load --tag "$image")
fi

# A tar from Git preserves tracked file modes and excludes working-tree files.
git archive --format=tar "$commit" | docker buildx build "${flags[@]}" -

if [[ "$phase" == build-image ]]; then
  docker image inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$image" \
    | grep -Fx "VAETTIR_RELEASE_COMMIT=$commit"
  docker image inspect --format '{{.Id}}' "$image"
fi
