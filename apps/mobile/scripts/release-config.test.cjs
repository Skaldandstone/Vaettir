/* eslint-disable @typescript-eslint/no-require-imports -- Node's dependency-free test runner. */
const test = require("node:test");
const assert = require("node:assert/strict");
const { releaseConfigErrors } = require("./release-config.cjs");
const config = require("../app.json").expo;
const env = { EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_live_static_test_not_a_credential", EXPO_PROJECT_ID: "00000000-0000-4000-8000-000000000000" };
test("missing/test/secret keys cannot be mistaken for distribution configuration", () => {
  assert.ok(releaseConfigErrors({}, config).length >= 2);
  assert.match(releaseConfigErrors({ ...env, EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_placeholder" }, config).join(), /production Clerk/);
  assert.match(releaseConfigErrors({ ...env, EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: "sk_live_private" }, config).join(), /production Clerk/);
});
test("release configuration rejects HTTP and unapproved endpoints", () => {
  assert.match(releaseConfigErrors({ ...env, EXPO_PUBLIC_API_URL: "http://localhost:4000" }, config).join(), /HTTPS/);
  assert.equal(releaseConfigErrors(env, config).length, 0);
});
test("invalid identifiers and native version numbers are rejected", () => {
  assert.ok(releaseConfigErrors(env, { ...config, android: { package: "wrong", versionCode: 0 } }).length >= 2);
  assert.match(releaseConfigErrors(env, { ...config, ios: { ...config.ios, buildNumber: "0" } }).join(), /positive native/);
});
test("Android does not request obsolete storage or overlay permissions or enable app backup", () => {
  for (const name of ["READ_EXTERNAL_STORAGE", "WRITE_EXTERNAL_STORAGE", "SYSTEM_ALERT_WINDOW", "VIBRATE"]) {
    assert.ok(config.android.blockedPermissions.includes(`android.permission.${name}`));
  }
  assert.equal(config.android.allowBackup, false);
  assert.match(releaseConfigErrors(env, { ...config, android: { ...config.android, allowBackup: true } }).join(), /backup/);
});
