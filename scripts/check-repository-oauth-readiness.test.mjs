import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { checkRepositoryOAuthWiring } from "./check-repository-oauth-readiness.mjs";

const names = [
  "PRODUCTION_SIGNAL_ENCRYPTION_KEY",
  "GITLAB_OAUTH_CLIENT_ID",
  "GITLAB_OAUTH_CLIENT_SECRET",
  "GITHUB_OAUTH_CLIENT_ID",
  "GITHUB_OAUTH_CLIENT_SECRET",
];
const reference =
  "arn:aws:secretsmanager:us-east-2:123456789012:secret:synthetic-oauth-AbCdEf";
const fixture = () => ({
  containerDefinitions: [
    {
      name: "vaettir-api",
      environment: [
        { name: "WEB_APP_URL", value: "https://vaettir.skaldandstone.com" },
      ],
      secrets: names.map((name) => ({
        name,
        valueFrom: `${reference}:${name}::`,
      })),
    },
  ],
});

test("complete metadata wiring never claims provider or runtime acceptance", () => {
  const result = checkRepositoryOAuthWiring({ taskDefinition: fixture() });
  assert.equal(result.wiringComplete, true);
  assert.deepEqual(result.issues, []);
  assert.equal(
    result.providers[0].callback,
    "https://vaettir.skaldandstone.com/connections/gitlab/callback",
  );
  assert.ok(
    result.providers.every(
      (provider) =>
        provider.registration === "unverified" &&
        provider.runtimeAuthorization === "unverified",
    ),
  );
  assert.ok(!JSON.stringify(result).includes(reference));
});
test("recorded encryption alone does not imply hosted apps exist", () => {
  const task = fixture();
  task.containerDefinitions[0].secrets =
    task.containerDefinitions[0].secrets.slice(0, 1);
  const result = checkRepositoryOAuthWiring(task);
  assert.equal(result.wiringComplete, false);
  assert.equal(result.encryptionKeyBinding, "secret_reference");
  assert.ok(
    result.providers.every(
      (provider) =>
        !provider.wiringComplete && provider.clientSecretBinding === "missing",
    ),
  );
});
test("partial provider setup cannot be advertised as complete", () => {
  const task = fixture();
  task.containerDefinitions[0].secrets =
    task.containerDefinitions[0].secrets.filter(
      (row) => row.name !== "GITLAB_OAUTH_CLIENT_SECRET",
    );
  const result = checkRepositoryOAuthWiring(task);
  assert.equal(result.providers[0].wiringComplete, false);
  assert.equal(result.providers[1].wiringComplete, true);
  assert.equal(result.wiringComplete, false);
});
test("plaintext application credentials fail redacted, never echo values", () => {
  const task = fixture();
  const container = task.containerDefinitions[0];
  container.secrets = container.secrets.filter(
    (row) => row.name !== "GITLAB_OAUTH_CLIENT_SECRET",
  );
  container.environment.push({
    name: "GITLAB_OAUTH_CLIENT_SECRET",
    value: "synthetic-sensitive-value",
  });
  const result = checkRepositoryOAuthWiring(task);
  assert.equal(result.providers[0].clientSecretBinding, "plaintext");
  assert.equal(result.wiringComplete, false);
  assert.ok(!JSON.stringify(result).includes("synthetic-sensitive-value"));
});
test("plaintext encryption key fails redacted", () => {
  const task = fixture();
  const container = task.containerDefinitions[0];
  container.secrets = container.secrets.filter((row) => row.name !== names[0]);
  container.environment.push({ name: names[0], value: "synthetic-key-value" });
  const result = checkRepositoryOAuthWiring(task);
  assert.equal(result.encryptionKeyBinding, "plaintext");
  assert.equal(result.wiringComplete, false);
  assert.ok(!JSON.stringify(result).includes("synthetic-key-value"));
});
test("ambiguous duplicated or overlapping bindings fail closed", () => {
  for (const duplicate of ["secret", "environment"]) {
    const task = fixture();
    const container = task.containerDefinitions[0];
    if (duplicate === "secret")
      container.secrets.push({ ...container.secrets[1] });
    else
      container.environment.push({ name: names[1], value: "synthetic-client" });
    const result = checkRepositoryOAuthWiring(task);
    assert.equal(result.providers[0].clientIdBinding, "ambiguous");
    assert.equal(result.wiringComplete, false);
  }
});
test("malformed secret references are not resolved or logged", () => {
  const task = fixture();
  task.containerDefinitions[0].secrets[2].valueFrom =
    "https://synthetic.example/token?secret=synthetic-value";
  const result = checkRepositoryOAuthWiring(task);
  assert.equal(result.providers[0].clientSecretBinding, "invalid_reference");
  assert.ok(!JSON.stringify(result).includes("synthetic-value"));
});
test("callbacks reject local/http/credential/path/mismatched origins", () => {
  for (const value of [
    "http://vaettir.skaldandstone.com",
    "https://localhost",
    "https://127.0.0.1",
    "https://test.local",
    "https://user:synthetic-value@vaettir.skaldandstone.com",
    "https://vaettir.skaldandstone.com/path",
    "https://vaettir.skaldandstone.com/?secret=synthetic-value",
    "https://other.example",
  ]) {
    const task = fixture();
    task.containerDefinitions[0].environment[0].value = value;
    const result = checkRepositoryOAuthWiring(task);
    assert.equal(result.callbackConfigured, false);
    assert.equal(result.wiringComplete, false);
    assert.ok(!JSON.stringify(result).includes("synthetic-value"));
  }
});
test("explicit staging callback identity is supported but invalid expected input is redacted", () => {
  const task = fixture();
  task.containerDefinitions[0].environment[0].value = "https://staging.example";
  assert.equal(
    checkRepositoryOAuthWiring(task, {
      expectedOrigin: "https://staging.example",
    }).wiringComplete,
    true,
  );
  const result = checkRepositoryOAuthWiring(task, {
    expectedOrigin: "https://user:synthetic-value@staging.example",
  });
  assert.equal(result.wiringComplete, false);
  assert.ok(result.providers.every((row) => row.callback === null));
  assert.ok(!JSON.stringify(result).includes("synthetic-value"));
});
test("absent/duplicate API containers and invalid input fail closed", () => {
  for (const source of [
    null,
    {},
    { containerDefinitions: [] },
    {
      containerDefinitions: [
        ...fixture().containerDefinitions,
        ...fixture().containerDefinitions,
      ],
    },
  ]) {
    assert.equal(checkRepositoryOAuthWiring(source).wiringComplete, false);
    assert.ok(
      checkRepositoryOAuthWiring(source).issues.includes(
        "expected_one_api_container",
      ),
    );
  }
});
test("CLI reads fixture metadata on stdin without credential inheritance or leakage", () => {
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(
        new URL("./check-repository-oauth-readiness.mjs", import.meta.url),
      ),
    ],
    { input: JSON.stringify(fixture()), encoding: "utf8", env: {} },
  );
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).wiringComplete, true);
  assert.ok(!result.stdout.includes(reference));
  assert.equal(result.stderr, "");
});
test("CLI malformed JSON cannot leak input in diagnostics", () => {
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(
        new URL("./check-repository-oauth-readiness.mjs", import.meta.url),
      ),
    ],
    { input: "synthetic-sensitive-value", encoding: "utf8", env: {} },
  );
  assert.equal(result.status, 2);
  assert.equal(result.stdout, "");
  assert.ok(!result.stderr.includes("synthetic-sensitive-value"));
});
test("CLI bounds streamed input before parsing and cannot echo its content", () => {
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(
        new URL("./check-repository-oauth-readiness.mjs", import.meta.url),
      ),
    ],
    {
      input: " ".repeat(2 * 1024 * 1024 + 1) + "synthetic-sensitive-value",
      encoding: "utf8",
      env: {},
    },
  );
  assert.equal(result.status, 2);
  assert.equal(result.stdout, "");
  assert.ok(!result.stderr.includes("synthetic-sensitive-value"));
});
test("CLI rejects incomplete wiring with exit1, not runtime acceptance", () => {
  const task = fixture();
  task.containerDefinitions[0].secrets =
    task.containerDefinitions[0].secrets.slice(0, 1);
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(
        new URL("./check-repository-oauth-readiness.mjs", import.meta.url),
      ),
    ],
    { input: JSON.stringify(task), encoding: "utf8", env: {} },
  );
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).wiringComplete, false);
  assert.ok(!result.stdout.includes(reference));
});
