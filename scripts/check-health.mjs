import { parseArgs } from 'node:util';
import { probeHealth } from './lib/health-evidence.mjs';

const { values } = parseArgs({ options: { url: { type: 'string' }, commit: { type: 'string' } } });
const result = await probeHealth(values.url, values.commit);
console.log(JSON.stringify({ checkedUtc: new Date().toISOString(), ...result }, null, 2));
process.exitCode = result.healthy ? 0 : 1;
