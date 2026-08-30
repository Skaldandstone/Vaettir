import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { sha256, migrationInventory } from './lib/release-evidence.mjs';

const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const artifact = 'apps/web/.next/standalone/apps/web/server.js';
if (!existsSync(artifact)) throw new Error('Standalone server artifact is missing.');
mkdirSync('.local', { recursive: true });
writeFileSync('.local/build-evidence.json', JSON.stringify({
  schemaVersion: 1, releaseCommit: revision, collectedUtc: new Date().toISOString(), platform: process.platform,
  node: process.version, lockfileSha256: sha256(readFileSync('pnpm-lock.yaml')),
  migrations: migrationInventory(process.cwd()), artifact, artifactSha256: sha256(readFileSync(artifact)),
  containerRuntimeVerified: false, productionVerified: false, deviceAccepted: false,
  note: 'Build artifact identity only. CI step outcomes are separate evidence; this is not beta acceptance.',
}, null, 2) + '\n');
