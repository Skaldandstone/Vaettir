import test from 'node:test';
import assert from 'node:assert/strict';
import { assertCleanStatus, localValidationEnvironment, redactOutput, releaseChecks, validateTestDatabase } from '../lib/release-evidence.mjs';

const databaseUrl = 'postgresql://runner:secret@127.0.0.1:55441/vaettir_operations_test?schema=public';
const revision = 'a'.repeat(40);
test('database guard accepts only explicit loopback test databases and safe query options', () => {
  assert.equal(validateTestDatabase(databaseUrl).name, 'vaettir_operations_test');
  assert.equal(validateTestDatabase(databaseUrl + '&connection_limit=5').name, 'vaettir_operations_test');
  for (const value of ['https://localhost/vaettir_operations_test', 'postgresql://remote/vaettir_operations_test',
    'postgresql://localhost/production', 'postgresql://localhost/vaettir_test', databaseUrl + '&host=remote',
    databaseUrl + '&schema=private', databaseUrl + '&connection_limit=999', 'postgresql://localhost/vaettir_operations%5Ftest']) assert.throws(() => validateTestDatabase(value));
});
test('isolated children do not inherit production, paid AI, remote cache or telemetry credentials', () => {
  const source = { PATH: 'bin', AWS_PROFILE: 'production', AWS_ACCESS_KEY_ID: 'secret', ANTHROPIC_API_KEY: 'secret',
    CLERK_SECRET_KEY: 'secret', SENTRY_DSN: 'secret', GITHUB_TOKEN: 'secret', TURBO_TOKEN: 'secret', NODE_OPTIONS: '--require malicious.js',
    VAETTIR_LIVE_AI_TESTS: '1', NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_live_secret' };
  const env = localValidationEnvironment(source, databaseUrl, revision, 'standalone', '/evidence');
  assert.equal(env.VAETTIR_LOCAL_BUILD, '0');
  assert.equal(env.VAETTIR_LIVE_AI_TESTS, '0');
  assert.equal(env.AWS_EC2_METADATA_DISABLED, 'true');
  assert.equal(env.VAETTIR_RELEASE_COMMIT, revision);
  assert.equal(env.PATH, 'bin');
  for (const key of ['AWS_PROFILE','AWS_ACCESS_KEY_ID','ANTHROPIC_API_KEY','CLERK_SECRET_KEY','SENTRY_DSN','GITHUB_TOKEN','TURBO_TOKEN','NODE_OPTIONS']) assert.equal(env[key], undefined);
  assert.equal(source.AWS_PROFILE, 'production');
});
test('tracked and untracked source changes fail, preserved attention note is permitted', () => {
  assert.doesNotThrow(() => assertCleanStatus('?? NEEDS_ATTENTION.md\n'));
  assert.throws(() => assertCleanStatus(' M apps/api/src/server.ts\n'));
  assert.throws(() => assertCleanStatus('?? apps/api/src/new.ts\n'));
});
test('checks apply migrations before tests and force fresh compilation without running paid/browser acceptance', () => {
  const names = releaseChecks.map(([name]) => name);
  assert.ok(names.indexOf('migrate') < names.indexOf('tests'));
  assert.ok(releaseChecks.find(([name]) => name === 'build')[1].includes('--force'));
  assert.deepEqual(releaseChecks.at(-1)[1].slice(-2), ['test', '--list']);
});
test('database credentials are excluded from output logs', () => {
  assert.doesNotMatch(redactOutput(`failed: ${databaseUrl} sk_test_secret`, databaseUrl), /secret|postgresql/);
});
