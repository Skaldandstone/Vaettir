import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

if (!JSON.parse(readFileSync('package.json', 'utf8')).scripts?.['test:dependencies']) {
  console.log('Dependency consumer regressions are not present. Integrate the dependency-security lane before beta acceptance.');
} else {
  const result = spawnSync('pnpm', ['test:dependencies'], { stdio: 'inherit', shell: process.platform === 'win32', windowsHide: true });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
