import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';
test('optional native proof uses existing public standard CI and bounded scratch custody, never deploy credentials or services',()=>{
 const ci=readFileSync(new URL('../.github/workflows/ci.yml',import.meta.url),'utf8'),start=ci.indexOf('  maintained-native-proof:'),end=ci.indexOf('  llvm-configure-diagnostic:',start),job=ci.slice(start,end);
 assert.ok(start>0&&end>start);assert.match(ci,/maintained_native_proof:[\s\S]*?default: false/);assert.match(job,/runs-on: ubuntu-latest/);assert.match(job,/timeout-minutes: 60/);assert.match(job,/test "\$visibility" = public/);assert.match(job,/test "\$\(nproc\)" -ge 4/);assert.match(job,/8388608/);assert.match(job,/timeout --signal=TERM --kill-after=20 3500 docker build/);assert.match(job,/VAETTIR_NATIVE_JOBS=4/);assert.match(job,/docker create.*\/not-executed/);assert.match(job,/\.State.Status.*created/);assert.match(job,/268435456/);assert.match(job,/runtimeEligible:false/);assert.match(job,/retention-days: 1/);
 assert.doesNotMatch(job,/id-token: write|secrets\.|aws |docker (?:push|run|start)|--privileged|--security-opt|cdk deploy|migrate deploy|--force/);
 assert.match(ci,/  build:\n    runs-on: ubuntu-latest/);assert.match(ci,/name: Build production artifacts/);assert.match(ci,/name: Verify standalone native image receipt packaging/);
});
test('progress headers use a separate stderr stream without changing original vendor logs or full check budget',()=>{
 const watcher=readFileSync(new URL('./watch-native-build-logs.mjs',import.meta.url),'utf8'),builder=readFileSync(new URL('./build-maintained-runtime.sh',import.meta.url),'utf8');
 assert.match(watcher,/process\.stderr\.write\('\\nNATIVE_VENDOR_LOG /);assert.match(watcher,/chunk=>process\.stdout\.write\(chunk\)/);assert.doesNotMatch(watcher,/\b(?:writeFile(?:Sync)?|appendFile(?:Sync)?|f?truncate(?:Sync)?)\b/);
 assert.match(builder,/deadline=\$\(\(started \+ 3500\)\)/);assert.match(builder,/make -C "\$build_dir" -j"\$native_jobs" check >/);assert.match(builder,/check-abi >/);assert.match(builder,/meson test .*--no-rebuild --print-errorlogs/);
});
test('optional namespace prerequisite probe uses normal existing host permissions and never changes policy or accepts a native build',()=>{
 const ci=readFileSync(new URL('../.github/workflows/ci.yml',import.meta.url),'utf8'),job=ci.slice(ci.indexOf('  native-environment-probe:'));
 assert.match(ci,/native_environment_probe:[\s\S]*?default: false/);assert.match(job,/runs-on: ubuntu-22\.04/);assert.match(job,/timeout-minutes: 5/);
 assert.match(job,/test "\$\(id -u\)" -ne 0/);assert.match(job,/timeout 10 unshare --user --map-root-user --mount --fork/);assert.match(job,/unshare --user --map-root-user --mount --fork \/bin\/true/);
 for(const key of ['securityPolicyChanged','nativeTestsExecuted','nativeAcceptance','securityAcceptance','deploymentAcceptance'])assert.match(job,new RegExp(key+':false'));
 assert.doesNotMatch(job,/\bsudo\b|\bsysctl\s+-w|--privileged|--security-opt|\bsetcap\b|\b(?:useradd|usermod|groupadd)\b|id-token: write|secrets\.|\baws\b|docker (?:run|start|push)|migrate deploy/);
 assert.match(job,/persist-credentials: false/);assert.match(job,/contents: read/);assert.match(ci,/  build:\n    runs-on: ubuntu-latest/);
});
