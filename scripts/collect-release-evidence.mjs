import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { assertCleanStatus, assertNoEnvironmentFiles, localValidationEnvironment, migrationInventory, redactOutput, releaseChecks, sha256, validateTestDatabase } from './lib/release-evidence.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({ options: { 'web-build': { type: 'string', default: process.platform === 'win32' ? 'local-server' : 'standalone' } } });
const databaseUrl = process.env.DATABASE_URL || '';
const database = validateTestDatabase(databaseUrl);
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trimEnd();
assertNoEnvironmentFiles(root);
assertCleanStatus(git('status', '--porcelain', '--untracked-files=all'));
const revision = git('rev-parse', 'HEAD');
const evidenceRoot = join(root, '.local', 'readiness', `${revision}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
mkdirSync(evidenceRoot, { recursive: true });
const env = localValidationEnvironment(process.env, databaseUrl, revision, values['web-build'], evidenceRoot);
const manifest = {
  schemaVersion: 2, releaseCommit: revision, branch: git('branch', '--show-current'),
  startedUtc: new Date().toISOString(), platform: process.platform, node: process.version,
  database, lockfileSha256: sha256(readFileSync(join(root, 'pnpm-lock.yaml'))),
  migrations: migrationInventory(root), webBuildVariant: values['web-build'], checks: [],
  security: { status: 'NOT_RUN' }, acceptance: 'IN_PROGRESS_NOT_BETA_ACCEPTANCE',
  productionVerified: false, browserAuthenticated: false, deviceAccepted: false,
};
const saveManifest = () => writeFileSync(join(evidenceRoot, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
saveManifest();

async function run(name, command, args, allowFailure = false) {
  const start = Date.now();
  console.log(`${name}: running`);
  let output = '';
  const child = spawn(command, args, { cwd: root, env, shell: process.platform === 'win32' && command === 'pnpm', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  // Fixed source-controlled arguments only. Windows requires the shell for
  // pnpm.cmd; user-provided data is carried exclusively in the environment.
  const code = await new Promise((resolve, reject) => {
    child.stdout.on('data', data => { output += data.toString(); });
    child.stderr.on('data', data => { output += data.toString(); });
    child.once('error', reject);
    child.once('close', (exitCode, signal) => resolve(signal ? 1 : exitCode ?? 1));
  });
  const safeOutput = redactOutput(output, databaseUrl);
  writeFileSync(join(evidenceRoot, `${name}.log`), safeOutput);
  manifest.checks.push({ name, command: [command, ...args], exitCode: code, elapsedSeconds: (Date.now() - start) / 1000, logSha256: sha256(safeOutput) });
  saveManifest();
  console.log(`${name}: ${code === 0 ? 'PASS' : 'FAILED'} (${Math.round((Date.now() - start) / 1000)}s)`);
  if (code && !allowFailure) throw new Error(`${name} failed; inspect its sanitized local log.`);
  return { code, output: safeOutput };
}

try {
  const version = await run('pnpm-version', 'pnpm', ['--version']);
  manifest.pnpm = version.output.trim();
  await run('operations-tests', process.execPath, ['--test', 'scripts/tests/release-evidence.test.mjs', 'scripts/tests/health-evidence.test.mjs']);
  for (const [name, args] of releaseChecks) {
    await run(name, 'pnpm', args);
    if (name === 'install') {
      await run('operations-lint', 'pnpm', ['exec', 'eslint', 'scripts/collect-release-evidence.mjs', 'scripts/check-health.mjs', 'scripts/restore-local-evidence.mjs', 'scripts/write-build-evidence.mjs', 'scripts/run-dependency-regressions.mjs', 'scripts/lib', 'scripts/tests']);
      if (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts?.['test:dependencies']) {
        await run('dependency-regressions', 'pnpm', ['test:dependencies']);
      } else {
        manifest.dependencyRegressions = 'NOT_PRESENT_REQUIRES_DEPENDENCY_LANE_INTEGRATION';
      }
    }
  }
  const audit = await run('dependency-audit', 'pnpm', ['audit', '--prod', '--json'], true);
  try {
    const data = JSON.parse(audit.output);
    if (!data.metadata?.vulnerabilities) throw new Error('Missing audit counts');
    manifest.security = { status: audit.code ? 'BLOCKED_ADVISORIES' : 'PASSED', counts: data.metadata.vulnerabilities };
  } catch { manifest.security = { status: 'BLOCKED_AUDIT_UNAVAILABLE' }; }
  assertCleanStatus(git('status', '--porcelain', '--untracked-files=all'));
  if (git('rev-parse', 'HEAD') !== revision) throw new Error('Source commit changed during validation.');
  manifest.acceptance = manifest.security.status === 'PASSED' ? 'LOCAL_CHECKS_PASSED_NOT_BETA_ACCEPTANCE' : 'LOCAL_CHECKS_PASSED_SECURITY_BLOCKED';
  if (manifest.security.status !== 'PASSED') process.exitCode = 1;
} catch (error) {
  manifest.acceptance = 'FAILED_NOT_BETA_ACCEPTANCE';
  manifest.failure = redactOutput(error.message, databaseUrl);
  console.error(manifest.failure);
  process.exitCode = 1;
} finally {
  manifest.finishedUtc = new Date().toISOString();
  saveManifest();
  console.log(`Evidence: ${evidenceRoot}`);
}
