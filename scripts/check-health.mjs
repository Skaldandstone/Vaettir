import { parseArgs } from 'node:util';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { probeHealth } from './lib/health-evidence.mjs';

const { values } = parseArgs({ options: { url: { type: 'string' }, commit: { type: 'string' }, record: { type: 'boolean', default: false } } });
if (!/^[a-f0-9]{40}$/.test(values.commit)) throw new Error('Pass --commit with the exact full candidate SHA.');
const result = await probeHealth(values.url, values.commit);
const evidence = { checkedUtc: new Date().toISOString(), expectedCommit: values.commit, ...result };
if (values.record) {
  const folder = join('.local', 'health-evidence', evidence.checkedUtc.replace(/[:.]/g, '-'));
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'manifest.json'), JSON.stringify(evidence, null, 2) + '\n');
}
console.log(JSON.stringify(evidence, null, 2));
process.exitCode = result.healthy ? 0 : 1;
