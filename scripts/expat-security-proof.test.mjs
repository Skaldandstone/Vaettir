import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
test('Expat proof is the exact production component recipe with only original test-log capture and an ineligible export',()=>{
  const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8').replaceAll('\r\n','\n');
  const source=read('Dockerfile.api').split('COPY scripts/build-dash-runtime.sh')[0].trimEnd();
  const proof=read('Dockerfile.expat-security');
  const prefix=proof.split('\nFROM scratch AS expat-security-proof\n')[0].trimEnd();
  const log='    && (timeout 600 make -C build check > /build/expat-upstream-check.log 2>&1 || { cat /build/expat-upstream-check.log; exit 1; }) ';
  assert.equal(prefix.split(log).length,2);
  assert.equal(prefix.replace(log,'    && timeout 600 make -C build check '),source);
  assert.match(proof,/vaettir.runtime-eligible="false"/);
  assert.match(proof,/COPY --from=vendor-build \/build\/libexpat1_2.9.0-1_\*.deb \/proof\/packages\//);
  assert.match(proof,/COPY --from=vendor-build \/build\/expat-upstream-check.log/);
  assert.match(proof,/COPY --from=vendor-build \/build\/check-expat-buffer-wide/);
  assert.doesNotMatch(proof,/nocheck|allow-unauthenticated|trusted=yes|no-check-certificate/);
});
