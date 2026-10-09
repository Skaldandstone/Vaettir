import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { restorePreGitOpensslDockerfileFixture, GIT_OPENSSL_DOCKERFILE_SHA256 } from './git-openssl-dockerfile-inverse-fixture.mjs';
import { historicalRuntimeDockerfileFixture, ABSENCE_FIXED_DOCKERFILE_SHA256, HISTORICAL_DOCKERFILE_SHA256 } from './historical-runtime-dockerfile-test-fixture.mjs';
const current = Buffer.from(readFileSync(new URL('../Dockerfile.api', import.meta.url), 'utf8').replaceAll('\r\n', '\n'));
const sha = b => createHash('sha256').update(b).digest('hex');
test('exact closed Git transport inverse retains every historical native byte and actual source identity', () => {
  assert.equal(sha(current), GIT_OPENSSL_DOCKERFILE_SHA256);
  const prior = restorePreGitOpensslDockerfileFixture(current);
  assert.equal(sha(prior), ABSENCE_FIXED_DOCKERFILE_SHA256);
  const original = historicalRuntimeDockerfileFixture(current);
  assert.equal(original.sourceSha256, GIT_OPENSSL_DOCKERFILE_SHA256);
  assert.equal(sha(original.bytes), HISTORICAL_DOCKERFILE_SHA256);
  assert.deepEqual(historicalRuntimeDockerfileFixture(prior).bytes, original.bytes);
  assert.deepEqual(historicalRuntimeDockerfileFixture(original.bytes).bytes, original.bytes);
});
test('unknown complete changes, missing native/TLS checks, stale bytes and malformed inputs cannot restore', () => {
  for (const raw of [
    Buffer.concat([current, Buffer.from('# unrelated edit\n')]),
    Buffer.from(current.toString().replace('check-git-runtime.mjs', 'skip-git-runtime.mjs')),
    Buffer.from(current.toString().replace('check-git-openssl-runtime.mjs --installed', 'check-git-openssl-runtime.mjs --unsafe')),
    Buffer.from(current.toString().replace('1:2.47.3-0+deb13u1+vaettir1', '1:2.47.3-0+deb13u1')),
    Buffer.from(current.toString().replaceAll('\n', '\r\n')),
    Buffer.from([0xff]),
    restorePreGitOpensslDockerfileFixture(current),
  ]) assert.throws(() => restorePreGitOpensslDockerfileFixture(raw));
  assert.throws(() => restorePreGitOpensslDockerfileFixture(current, 'extra'));
  assert.throws(() => restorePreGitOpensslDockerfileFixture(current.toString()));
});
