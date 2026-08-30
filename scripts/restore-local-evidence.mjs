import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { validateTestDatabase, sha256, redactOutput } from './lib/release-evidence.mjs';

// Synthetic LOCAL databases only. This never calls AWS or alters an existing
// target. Its output is explicitly not evidence of RDS retention or RTO.
const { values } = parseArgs({ options: { 'postgres-bin': { type: 'string' } } });
const sourceUrl = process.env.DATABASE_URL || '';
const targetUrl = process.env.RESTORE_DATABASE_URL || '';
const source = validateTestDatabase(sourceUrl);
const target = validateTestDatabase(targetUrl);
if (source.host !== target.host || source.port !== target.port || source.name === target.name || !target.name.endsWith('_restore_test')) {
  throw new Error('Restore requires a different *_restore_test database on the same loopback server.');
}
const started = Date.now();
const evidence = join('.local', 'restore-evidence', new Date().toISOString().replace(/[:.]/g, '-'));
mkdirSync(evidence, { recursive: true });
const manifest = { schemaVersion: 1, releaseCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  source, target, startedUtc: new Date().toISOString(), status: 'IN_PROGRESS', productionRestoreVerified: false, sevenDayWindowVerified: false };
const binary = name => values['postgres-bin'] ? join(values['postgres-bin'], name + (process.platform === 'win32' ? '.exe' : '')) : name;
function pg(name, urlValue, args, databaseOverride) {
  const url = new URL(urlValue);
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^PG/i.test(key)) delete env[key];
  Object.assign(env, { PGPASSWORD: decodeURIComponent(url.password), PGCONNECT_TIMEOUT: '5', PGSSLMODE: 'disable', PGPASSFILE: join(evidence, 'no-password-file') });
  return execFileSync(binary(name), ['-h', url.hostname, '-p', url.port || '5432', '-U', decodeURIComponent(url.username), '-w',
    ...(name === 'createdb' ? [] : ['-d', databaseOverride || url.pathname.slice(1)]), ...args], { env, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
const sql = (url, text, databaseOverride) => pg('psql', url, ['--no-psqlrc', '--no-align', '--tuples-only', '-v', 'ON_ERROR_STOP=1', '-c', text], databaseOverride);
const counts = `SELECT json_build_object('migrations', (SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL), 'plans', (SELECT count(*) FROM "PlanTier"), 'organizations', (SELECT count(*) FROM "Organization"), 'ledger', (SELECT count(*) FROM "AiCreditTransaction"), 'probe', (SELECT payload FROM "_OpsRestoreProbe" WHERE id = 'readiness-v1'))`;
try {
  if (sql(targetUrl, `SELECT 1 FROM pg_database WHERE datname = '${target.name}'`, 'postgres') !== '') throw new Error('Restore target already exists. Choose a fresh target; never overwrite it.');
  sql(sourceUrl, `CREATE TABLE IF NOT EXISTS "_OpsRestoreProbe" (id text PRIMARY KEY, payload text NOT NULL); INSERT INTO "_OpsRestoreProbe" VALUES ('readiness-v1', 'synthetic restore probe') ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload`);
  manifest.before = JSON.parse(sql(sourceUrl, counts));
  const dump = join(evidence, 'synthetic.dump');
  pg('pg_dump', sourceUrl, ['--format=custom', '--no-owner', '--no-acl', '--file', dump]);
  manifest.dumpSha256 = sha256(readFileSync(dump));
  pg('createdb', targetUrl, [target.name]);
  manifest.targetCreated = true;
  pg('pg_restore', targetUrl, ['--exit-on-error', '--no-owner', '--no-acl', dump]);
  manifest.after = JSON.parse(sql(targetUrl, counts));
  if (JSON.stringify(manifest.before) !== JSON.stringify(manifest.after)) throw new Error('Restored counts or probe data differ.');
  manifest.status = 'LOCAL_SYNTHETIC_RESTORE_PASSED_NOT_RDS_ACCEPTANCE';
} catch (error) {
  manifest.status = 'FAILED';
  manifest.failure = redactOutput(redactOutput(error.message, sourceUrl), targetUrl);
  process.exitCode = 1;
} finally {
  manifest.finishedUtc = new Date().toISOString();
  manifest.elapsedSeconds = (Date.now() - started) / 1000;
  manifest.cleanup = 'Retained exact synthetic source, new target and dump for evidence; no automatic deletion.';
  writeFileSync(join(evidence, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Restore status: ${manifest.status}. Evidence: ${evidence}`);
}
