import assert from "node:assert/strict";
// Source-only until Main runs the generated script in the admitted immutable image.
export function assertProbeEnvironment(env, platform, cwd, source, role) {
  assert.match(source, /^[a-f0-9]{40}$/);
  assert.ok(["plugin", "android", "import"].includes(role));
  assert.equal(platform, "linux");
  assert.equal(cwd, "/app/apps/api");
  assert.equal(env.NODE_ENV, "production");
  assert.equal(env.VAETTIR_RELEASE_COMMIT, source);
  assert.match(env.VAETTIR_IMAGE_DIGEST, /^sha256:[a-f0-9]{64}$/);
  assert.equal(
    env.DATABASE_URL,
    `postgresql://oauth_test:synthetic-local-only@vaettir-review111-images-${source.slice(0, 12)}-release-pg:5432/vaettir_case_review111_${role}?connection_limit=5`,
  );
  for (const name of [
    "DB_SECRET_ID",
    "CLERK_SECRET_KEY",
    "SENTRY_DSN",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "ATLASSIAN_OAUTH_CLIENT_ID",
    "ATLASSIAN_OAUTH_CLIENT_SECRET",
  ])
    assert.ok(!env[name], `Provider credential must be absent: ${name}`);
}
export function assertSubset(actual, expected) {
  if (expected === null || typeof expected !== "object")
    return assert.deepEqual(actual, expected);
  assert.ok(actual !== null && typeof actual === "object");
  if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual));
    assert.equal(actual.length, expected.length);
  }
  for (const [key, value] of Object.entries(expected)) {
    assert.ok(Object.hasOwn(actual, key));
    assertSubset(actual[key], value);
  }
}
