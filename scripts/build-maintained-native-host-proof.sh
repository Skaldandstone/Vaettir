#!/bin/bash
# Existing public CI only. Review authorizes this pinned isolation PROCEDURE,
# not future artifact/native/image/deployment acceptance. Full native gates stay.
set -euo pipefail
test "${CI:-}" = true && test "${GITHUB_ACTIONS:-}" = true
test "$GITHUB_REPOSITORY" = Skaldandstone/Vaettir
test "$(gh api repos/Skaldandstone/Vaettir --jq .visibility)" = public
[[ "$GITHUB_SHA" =~ ^[a-f0-9]{40}$ && "$GITHUB_RUN_ID" =~ ^[1-9][0-9]*$ && "$GITHUB_RUN_ATTEMPT" =~ ^[1-9][0-9]*$ ]]
test "$(git rev-parse HEAD)" = "$GITHUB_SHA"
test "$(id -u)" -ne 0
test "$(nproc)" -ge 4
test "$(awk '/^MemTotal:/ {print $2}' /proc/meminfo)" -ge 8388608
test "$(df -Pk "$RUNNER_TEMP" | awk 'NR == 2 {print $4}')" -ge 12582912
for tool in /usr/bin/sudo /usr/bin/unshare /usr/sbin/pivot_root /usr/bin/mount /usr/sbin/ip /usr/bin/findmnt /usr/bin/python3; do test -x "$tool"; done
unset GH_TOKEN GITHUB_TOKEN
started=$(date +%s)
deadline=$((started + 3500))
bounded() {
  local remaining=$((deadline - $(date +%s)))
  test "$remaining" -gt 0
  timeout --signal=TERM --kill-after=10 "$remaining" "$@"
}
release=$(mktemp -d "$RUNNER_TEMP/vaettir-native-host.XXXXXXXX")
chmod 700 "$release"
proof_dir="$RUNNER_TEMP/vaettir-maintained-proof"
mkdir "$proof_dir"
printf '%s\n' "$release" > "$proof_dir/host-release-path.txt"
printf '{"purpose":"maintained-native-host-once-intent/v1","commit":"%s","runId":"%s","attempt":"%s","nativeAccepted":false,"deploymentAccepted":false}\n' "$GITHUB_SHA" "$GITHUB_RUN_ID" "$GITHUB_RUN_ATTEMPT" > "$release/once-intent.json"
environment="vaettir-native-environment:$GITHUB_SHA-$GITHUB_RUN_ID"
image="vaettir-maintained-proof:$GITHUB_SHA-$GITHUB_RUN_ID"
cid=
cleanup() {
  rc=$?; trap - EXIT
  # Never erase the extracted filesystem, original logs or failed evidence.
  # Only this exact owned, never-started container can be removed.
  if [[ "$cid" =~ ^[a-f0-9]{64}$ ]]; then timeout 20 docker rm "$cid" >/dev/null || exit 91; fi
  exit "$rc"
}
trap cleanup EXIT
bounded docker build --progress=plain --no-cache --target maintained-native-environment \
  -f Dockerfile.runtime-security --build-arg VAETTIR_RELEASE_COMMIT="$GITHUB_SHA" \
  --build-arg VAETTIR_NATIVE_JOBS=4 -t "$environment" . > "$release/environment-build.log" 2>&1
docker image inspect "$environment" > "$release/environment-image.json"
cid=$(bounded docker create --name "vaettir-env-$GITHUB_RUN_ID" "$environment" /not-executed)
[[ "$cid" =~ ^[a-f0-9]{64}$ ]]
docker inspect "$cid" > "$release/environment-container.json"
node - "$release" <<'IDENTITY'
const fs=require('node:fs'),a=require('node:assert/strict'),p=process.argv[2];
const images=JSON.parse(fs.readFileSync(p+'/environment-image.json')),containers=JSON.parse(fs.readFileSync(p+'/environment-container.json'));
a.equal(images.length,1);a.equal(containers.length,1);const i=images[0],c=containers[0];
a.match(i.Id,/^sha256:[a-f0-9]{64}$/);a.equal(i.Os,'linux');a.equal(i.Architecture,'amd64');a.equal(i.Config.User,'node');
a.equal(c.Image,i.Id);a.equal(c.State.Status,'created');a.equal(c.State.Running,false);a.equal(c.HostConfig.Privileged,false);a.equal(c.HostConfig.Binds,null);a.deepEqual(c.Mounts,[]);
for(const env of i.Config.Env)a.match(env,/^(?:PATH|NODE_VERSION|YARN_VERSION|VAETTIR_NATIVE_JOBS)=/);
a.ok(i.Config.Env.includes('VAETTIR_NATIVE_JOBS=4'));
IDENTITY
bounded docker export "$cid" > "$release/environment.tar"
test "$(stat -c %s "$release/environment.tar")" -gt 0
test "$(stat -c %s "$release/environment.tar")" -le 4294967296
timeout 20 docker rm "$cid" >/dev/null
cid=
# The fixed reader validates the WHOLE tar before creating a rootfs. No tar -x,
# generic extract, archived code execution, host mounts or runtime byte rewrites.
bounded sudo --non-interactive env -i PATH=/usr/bin:/bin \
  /usr/bin/python3 -I scripts/prepare-maintained-native-rootfs.py "$release" "$(id -u)"
cp scripts/isolated-maintained-native-host.sh "$release/host-check.sh"
cp scripts/launch-maintained-native-namespace.py "$release/host-namespace-launcher.py"
node - "$release" <<'PROCEDURE'
const fs=require('node:fs'),c=require('node:crypto'),a=require('node:assert/strict'),p=process.argv[2],sha=b=>c.createHash('sha256').update(b).digest('hex');
const image=JSON.parse(fs.readFileSync(p+'/environment-image.json'))[0],root=fs.lstatSync(p+'/rootfs');
for(const name of ['runtime-security-sources.json','fetch-runtime-security-sources.mjs','fetch-freetype-test-corpus.mjs','build-maintained-runtime.sh','runtime-build-proof.mjs','watch-native-build-logs.mjs'])a.deepEqual(fs.readFileSync(p+'/rootfs/build/scripts/'+name),fs.readFileSync('scripts/'+name));
const record={purpose:'reviewed-isolated-native-host-procedure/v1',commit:process.env.GITHUB_SHA,runId:process.env.GITHUB_RUN_ID,attempt:Number(process.env.GITHUB_RUN_ATTEMPT),releaseDir:p,rootfsDev:root.dev,rootfsIno:root.ino,ownerUid:process.getuid(),createdAt:Math.floor(Date.now()/1000),rootfsImageDigest:image.Id,rootfsInventorySha256:sha(fs.readFileSync(p+'/rootfs.inventory.json')),wrapperSha256:sha(fs.readFileSync(p+'/host-check.sh')),launcherSha256:sha(fs.readFileSync(p+'/host-namespace-launcher.py')),jobs:4,rootfsCopyProcedureReviewed:true,acceptance:{native:false,installedFamily:false,cid:false,security:false,deployment:false}};
fs.writeFileSync(p+'/root-review.json',JSON.stringify(record)+'\n',{flag:'wx',mode:0o600});
PROCEDURE
review_sha=$(sha256sum "$release/root-review.json" | cut -d' ' -f1)
bounded /bin/bash --noprofile --norc "$release/host-check.sh" --parent "$release" "$release/root-review.json" "$review_sha"
# Fixed passive reader copies ONLY the unchanged fourteen-export data inputs.
# Never feed the whole compiler rootfs (including protected old-root/OS/private
# test directories) into the unprivileged BuildKit sender or relax their modes.
bounded sudo --non-interactive env -i PATH=/usr/bin:/bin \
  /usr/bin/python3 -I scripts/prepare-maintained-native-proof-context.py \
  "$release" "$(id -u)" "$GITHUB_SHA" "$GITHUB_RUN_ID" "$GITHUB_RUN_ATTEMPT"
# Named-context priority deliberately replaces ONLY the maintained-native stage
# with an exact byte copy of its proof data. Original 14 COPY recipe stays intact.
# No native test or application image is rebuilt or published by this step.
bounded docker build --progress=plain --no-cache --target runtime-security-proof \
  --build-context "maintained-native=$release/proof-context" -f Dockerfile.runtime-security \
  --build-arg VAETTIR_RELEASE_COMMIT="$GITHUB_SHA" -t "$image" .
docker image inspect "$image" > "$proof_dir/image.json"
node - "$proof_dir/image.json" <<'CONFIG'
const a=require('node:assert/strict'),fs=require('node:fs');const x=JSON.parse(fs.readFileSync(process.argv[2]));a.equal(x.length,1);const c=x[0].Config;a.equal(c.Labels['vaettir.runtime-eligible'],'false');a.equal(c.Labels['vaettir.artifact-purpose'],'maintained-native-package-proof');a.equal(c.Labels['vaettir.source-commit'],process.env.GITHUB_SHA);a.ok(!c.Cmd||c.Cmd.length===0);a.ok(!c.Entrypoint||c.Entrypoint.length===0);
CONFIG
cid=$(bounded docker create --name "vaettir-proof-$GITHUB_RUN_ID" "$image" /not-executed)
[[ "$cid" =~ ^[a-f0-9]{64}$ ]]
test "$(docker inspect --format '{{.State.Status}}' "$cid")" = created
bounded docker cp "$cid:/proof/." - > "$proof_dir/proof.tar"
test "$(stat -c %s "$proof_dir/proof.tar")" -gt 0
test "$(stat -c %s "$proof_dir/proof.tar")" -le 268435456
timeout 20 docker rm "$cid" >/dev/null
cid=
node - "$proof_dir" <<'CUSTODY'
const fs=require('node:fs'),c=require('node:crypto'),p=process.argv[2],b=fs.readFileSync(p+'/proof.tar');
fs.writeFileSync(p+'/proof.json',JSON.stringify({purpose:'github-maintained-native-proof-custody/v1',commit:process.env.GITHUB_SHA,runId:process.env.GITHUB_RUN_ID,attempt:process.env.GITHUB_RUN_ATTEMPT,archiveBytes:b.length,archiveSha256:c.createHash('sha256').update(b).digest('hex'),runtimeEligible:false,installedFamilyAcceptance:false,securityAcceptance:false,deploymentAcceptance:false})+'\n',{flag:'wx'});
CUSTODY
printf '%s\n' 'Maintained native host candidate collected; independent Root/native/CID/image/deployment acceptance still required.'
