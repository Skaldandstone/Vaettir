import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
test('bounded maintained native proof graph never builds LLVM or becomes an application deployment image',()=>{
 const docker=readFileSync(new URL('../Dockerfile.runtime-security',import.meta.url),'utf8');
 assert.match(docker,/node:22-trixie-slim@sha256:b26b04c123d9ff8ab646ceb18b9d75a1173acf64b9a401094b906d27b29338d4/);
 assert.match(docker,/USER node/);assert.match(docker,/RUN --network=none sh .*build-maintained-runtime/);
 assert.match(docker,/FROM scratch AS runtime-security-proof/);assert.match(docker,/runtime-eligible="false"/);
 assert.match(docker,/libc6_2\.41-12\+deb13u4\+vaettir1_amd64\.deb/);assert.match(docker,/libc-bin_2\.41-12\+deb13u4\+vaettir1_amd64\.deb/);
 assert.match(docker,/freetype-acceptance-gap\.txt/);assert.doesNotMatch(docker,/build-llvm|libc6\.so|--privileged|--allow-unauthenticated|trusted=yes|\bEXPOSE\b|\bENTRYPOINT\b|\bCMD\b/);
});
