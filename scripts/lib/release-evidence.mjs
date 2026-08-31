import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const COMPILE_KEY = 'pk_test_ZGV2LnZhZXR0aXIuZXhhbXBsZS5jb20k';
export function validateTestDatabase(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('A local PostgreSQL test database URL is required.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1'].includes(url.hostname)
    || !/^\/vaettir_[a-z0-9_]+_test$/.test(url.pathname) || url.hash
    || [...url.searchParams].some(([key, value]) => !(key === 'schema' && value === 'public') && !(key === 'connection_limit' && /^(?:[1-9]|10)$/.test(value)))) {
    throw new Error('Only loopback PostgreSQL vaettir_<lane>_test databases with the public schema are allowed.');
  }
  return { name: url.pathname.slice(1), host: url.hostname, port: url.port || '5432' };
}

export function localValidationEnvironment(source, databaseUrl, revision, variant, evidenceRoot) {
  validateTestDatabase(databaseUrl);
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('A full source commit is required.');
  if (!['standalone', 'local-server'].includes(variant)) throw new Error('Unknown web build variant.');
  const env = { ...source };
  for (const key of Object.keys(env)) {
    if (/^(AWS_|ANTHROPIC_|STRIPE_|CLERK_|NEXT_PUBLIC_CLERK_|EXPO_|EAS_|SENTRY_|NEXT_PUBLIC_SENTRY_|GITHUB_|GH_|TURBO_|VAETTIR_|NEXT_PUBLIC_API_URL$|DATABASE_URL$|NODE_OPTIONS$)/i.test(key)) delete env[key];
  }
  return Object.assign(env, {
    DATABASE_URL: databaseUrl, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: COMPILE_KEY, EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: COMPILE_KEY,
    NEXT_PUBLIC_API_URL: 'http://127.0.0.1:4000', EXPO_PUBLIC_API_URL: 'http://127.0.0.1:4000',
    VAETTIR_RELEASE_COMMIT: revision, NEXT_PUBLIC_RELEASE_COMMIT: revision, EXPO_PUBLIC_RELEASE_COMMIT: revision,
    VAETTIR_LOCAL_BUILD: variant === 'local-server' ? '1' : '0', VAETTIR_LIVE_AI_TESTS: '0',
    AWS_EC2_METADATA_DISABLED: 'true', AWS_SHARED_CREDENTIALS_FILE: join(evidenceRoot, 'no-aws-credentials'),
    AWS_CONFIG_FILE: join(evidenceRoot, 'no-aws-config'),
    CI: 'true', TURBO_FORCE: 'true', NEXT_TELEMETRY_DISABLED: '1', EXPO_NO_TELEMETRY: '1',
  });
}

export function assertNoEnvironmentFiles(root) {
  for (const folder of ['', 'apps/api', 'apps/web', 'apps/mobile', 'packages/db']) {
    for (const file of readdirSync(join(root, folder))) {
      if (/^\.env(?:\.|$)/.test(file) && !/\.(example|sample|template)$/.test(file)) {
        throw new Error('Environment files can override isolated validation. Use a clean worktree without local .env files.');
      }
    }
  }
}

export function assertCleanStatus(porcelain) {
  const unexpected = porcelain.split(/\r?\n/).filter(Boolean).filter(line => line !== '?? NEEDS_ATTENTION.md');
  if (unexpected.length) throw new Error('Commit source changes, including untracked files, before collecting candidate evidence.');
}

export const sha256 = value => createHash('sha256').update(value).digest('hex');
export function migrationInventory(root) {
  const folder = join(root, 'packages/db/prisma/migrations');
  return readdirSync(folder).sort().filter(name => existsSync(join(folder, name, 'migration.sql')))
    .map(name => ({ name, sha256: sha256(readFileSync(join(folder, name, 'migration.sql'))) }));
}

export const releaseChecks = [
  ['install', ['install', '--frozen-lockfile', '--prefer-offline']],
  ['generate', ['db:generate']],
  ['migrate', ['--filter', '@vaettir/db', 'exec', 'prisma', 'migrate', 'deploy']],
  ['seed', ['--filter', '@vaettir/db', 'run', 'seed']],
  ['migration-status', ['--filter', '@vaettir/db', 'exec', 'prisma', 'migrate', 'status']],
  ['typecheck', ['typecheck', '--force']],
  ['lint', ['lint', '--force']],
  ['tests', ['test', '--force', '--', '--maxWorkers=2']],
  ['web-permission-tests', ['--filter', '@vaettir/web', 'exec', 'node', '--experimental-strip-types', '--test', 'lib/beta-ui.test.mjs']],
  ['web-fixture-contracts', ['--filter', '@vaettir/web', 'exec', 'playwright', 'test', '--config', 'e2e/fixture.config.ts']],
  ['build', ['build', '--force']],
  ['expo-compatibility', ['--filter', '@vaettir/mobile', 'exec', 'expo', 'install', '--check']],
  ['browser-discovery', ['--filter', '@vaettir/web', 'exec', 'playwright', 'test', '--list']],
];

export function redactOutput(text, databaseUrl) {
  return text.replaceAll(databaseUrl, '[isolated test database]')
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[database URL redacted]')
    .replace(/(?:(?:sk|rk)_(?:live|test)_|whsec_|sk-ant-)[A-Za-z0-9_-]+/g, '[credential redacted]');
}
