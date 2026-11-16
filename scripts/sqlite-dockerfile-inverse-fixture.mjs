// TEST FIXTURE ONLY. Never use this inverse for runtime/source admission.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {API_DIRECT_PRISMA_DOCKERFILE_SHA256, restorePreApiDirectPrismaDockerfileFixture} from './api-startup-dockerfile-inverse-fixture.mjs';
export const SQLITE_DOCKERFILE_SHA256 = "450e99bfc2599f642f4bb6fd247db60f5f67c4beed6f99fbea9d8f614ef837e9";
export const PRE_SQLITE_DOCKERFILE_SHA256 = "3053480495dd451d4297717aadea4ad0f61e1923c1359c69ccd40b9f0e1aadda";
const hunks = [
  {
    "start": 0,
    "text": "# Pinned upstream SQLite, preserving NSS and libsqlite3.so.0 consumers.\nFROM public.ecr.aws/docker/library/node:22-trixie-slim@sha256:b26b04c123d9ff8ab646ceb18b9d75a1173acf64b9a401094b906d27b29338d4 AS sqlite-security\nRUN test \"$(dpkg --print-architecture)\" = amd64 \\\n    && apt-get update --error-on=any \\\n    && apt-get install -y --no-install-recommends openssl ca-certificates perl-base libpcre2-8-0 build-essential binutils python3 tcl8.6-dev libnss3-tools libsqlite3-0=3.46.1-7+deb13u2 \\\n    && dpkg --compare-versions \"$(dpkg-query -W -f='${Version}' perl-base)\" ge '5.40.1-6+deb13u1' \\\n    && dpkg --compare-versions \"$(dpkg-query -W -f='${Version}' libpcre2-8-0)\" ge '10.46-1~deb13u3' \\\n    && rm -rf /var/lib/apt/lists/*\nWORKDIR /build\nCOPY scripts/sqlite-runtime-sources.json scripts/fetch-sqlite-runtime-sources.mjs scripts/build-sqlite-runtime.sh scripts/check-sqlite-runtime.mjs scripts/sqlite-runtime-regression.c /build/scripts/\nRUN node /build/scripts/fetch-sqlite-runtime-sources.mjs /build/sqlite-inputs\nARG VAETTIR_RELEASE_COMMIT\nENV VAETTIR_SQLITE_SOURCE_COMMIT=$VAETTIR_RELEASE_COMMIT\nRUN --network=none sh /build/scripts/build-sqlite-runtime.sh /build/sqlite-inputs /build/sqlite-native /build/scripts\n\n"
  },
  {
    "start": 240,
    "text": "# Install the tested SQLite package after all apt/browser dependency changes.\nCOPY --from=sqlite-security /build/sqlite-native/libsqlite3-0_3.54.1-0+vaettir1_amd64.deb /tmp/vaettir-sqlite.deb\nCOPY --from=sqlite-security /build/sqlite-native/sqlite-runtime-proof.json /build/sqlite-native/sqlite-runtime-regression /usr/share/vaettir/sqlite-security/\nCOPY scripts/sqlite-runtime-sources.json scripts/fetch-sqlite-runtime-sources.mjs scripts/check-sqlite-runtime.mjs /app/scripts/\nRUN --network=none timeout 60 dpkg --install /tmp/vaettir-sqlite.deb \\\n    && test -z \"$(dpkg --audit)\" \\\n    && rm /tmp/vaettir-sqlite.deb \\\n    && node /app/scripts/check-sqlite-runtime.mjs --installed /usr/share/vaettir/sqlite-security\n\n"
  }
];
const sha = value => createHash('sha256').update(value).digest('hex');
export function restorePreSqliteDockerfileFixture(raw) {
  assert.equal(arguments.length, 1);
  assert.ok(Buffer.isBuffer(raw));
  if (sha(raw) === API_DIRECT_PRISMA_DOCKERFILE_SHA256) raw = restorePreApiDirectPrismaDockerfileFixture(raw);
  const text = raw.toString('utf8');
  assert.deepEqual(Buffer.from(text), raw);
  assert.equal(text.includes('\r'), false);
  assert.equal(sha(raw), SQLITE_DOCKERFILE_SHA256, 'Unknown complete SQLite Dockerfile edit');
  const lines = text.split('\n');
  for (const hunk of [...hunks].reverse()) {
    const added = hunk.text.split('\n');
    assert.equal(added.pop(), '');
    assert.deepEqual(lines.slice(hunk.start, hunk.start + added.length), added);
    lines.splice(hunk.start, added.length);
  }
  const prior = Buffer.from(lines.join('\n'));
  assert.equal(sha(prior), PRE_SQLITE_DOCKERFILE_SHA256, 'Pre-SQLite baseline differs');
  return prior;
}
