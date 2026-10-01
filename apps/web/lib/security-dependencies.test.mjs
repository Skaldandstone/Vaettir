import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const nextManifestPath = require.resolve('next/package.json');
const nextRequire = createRequire(nextManifestPath);

function assertPatchedVersion(version, minimum, dependency) {
  assert.match(version, /^\d+\.\d+\.\d+$/, `${dependency} must be a stable release`);
  const actual = version.split('.').map(Number);
  const floor = minimum.split('.').map(Number);
  const comparison = actual.reduce((result, value, index) => result || Math.sign(value - floor[index]), 0);
  assert.ok(comparison >= 0, `${dependency} ${version} is below the security patch floor ${minimum}`);
}

test('installed Next.js includes the Windows and AVIF RCE security fixes', () => {
  // GHSA-p293-qw3h-jr36 and GHSA-2xp9-vwfh-vxw4. A dependency declaration
  // alone is insufficient: validate what the frozen installation actually uses.
  assertPatchedVersion(require(nextManifestPath).version, '15.5.24', 'Next.js');
});

test('Next.js resolves patched image decoding libraries', () => {
  // GHSA-rgj7-g3m4-5g8c (libheif) and GHSA-f88m-g3jw-g9cj (libvips).
  // Resolve from Next.js, not an unrelated top-level copy of sharp.
  assertPatchedVersion(nextRequire('sharp').versions.sharp, '0.35.4', 'sharp');
});

test('Next.js resolves PostCSS with the complete source-map traversal fix', () => {
  // GHSA-fxqj-rqcc-2cmp includes the incomplete earlier source-map patches.
  assertPatchedVersion(nextRequire('postcss/package.json').version, '8.5.23', 'PostCSS');
});
