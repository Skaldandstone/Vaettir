import { closeSync, openSync, readSync } from "node:fs";
import { isIP } from "node:net";
import { fileURLToPath } from "node:url";

const DEFAULT_ORIGIN = "https://vaettir.skaldandstone.com";
const SECRET_REFERENCE =
  /^arn:aws(?:-us-gov|-cn)?:secretsmanager:[a-z0-9-]+:\d{12}:secret:[A-Za-z0-9/_+=.@-]+(?::[^\s:]*){0,3}$/;
const PROVIDERS = ["gitlab", "github"];
const INPUT_LIMIT = 2 * 1024 * 1024;

function readBoundedInput(input) {
  const fd = input === "-" ? 0 : openSync(input, "r");
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const chunk = Buffer.alloc(Math.min(65536, INPUT_LIMIT - total + 1));
      const count = readSync(fd, chunk, 0, chunk.length, null);
      if (!count) return Buffer.concat(chunks).toString("utf8");
      total += count;
      if (total > INPUT_LIMIT) throw new Error("Input exceeds limit");
      chunks.push(chunk.subarray(0, count));
    }
  } finally {
    if (fd !== 0) closeSync(fd);
  }
}

function publicOrigin(value) {
  if (typeof value !== "string" || value.length > 1000) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      isIP(url.hostname) ||
      !url.hostname.includes(".") ||
      url.hostname.endsWith(".localhost") ||
      url.hostname.endsWith(".local") ||
      url.hostname.startsWith("[")
    )
      return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Offline ECS wiring check only. Never resolves secrets or contacts a provider.
 * Results intentionally omit task values, secret ARNs, IDs, tokens and raw errors.
 */
export function checkRepositoryOAuthWiring(
  source,
  { containerName = "vaettir-api", expectedOrigin = DEFAULT_ORIGIN } = {},
) {
  const issues = [];
  const expected = publicOrigin(expectedOrigin);
  if (!expected) issues.push("invalid_expected_origin");
  const definition = source?.taskDefinition ?? source;
  const containers = definition?.containerDefinitions;
  const matches = Array.isArray(containers)
    ? containers.filter((row) => row?.name === containerName)
    : [];
  if (matches.length !== 1) issues.push("expected_one_api_container");
  const container = matches.length === 1 ? matches[0] : {};
  const environment = Array.isArray(container.environment)
    ? container.environment
    : [];
  const secrets = Array.isArray(container.secrets) ? container.secrets : [];
  const binding = (name) => {
    const plain = environment.filter((row) => row?.name === name);
    const secret = secrets.filter((row) => row?.name === name);
    if (plain.length + secret.length > 1) return "ambiguous";
    if (plain.length) return "plaintext";
    if (!secret.length) return "missing";
    return typeof secret[0].valueFrom === "string" &&
      SECRET_REFERENCE.test(secret[0].valueFrom)
      ? "secret_reference"
      : "invalid_reference";
  };
  const callbackEntries = environment.filter(
    (row) => row?.name === "WEB_APP_URL",
  );
  const callback =
    callbackEntries.length === 1 &&
    !secrets.some((row) => row?.name === "WEB_APP_URL")
      ? publicOrigin(callbackEntries[0].value)
      : null;
  const callbackConfigured = Boolean(expected && callback === expected);
  if (!callbackConfigured)
    issues.push("callback_origin_missing_invalid_or_mismatched");
  const storageBinding = binding("PRODUCTION_SIGNAL_ENCRYPTION_KEY");
  if (storageBinding !== "secret_reference")
    issues.push("encryption_key_reference_unavailable");
  const providers = PROVIDERS.map((provider) => {
    const prefix = provider.toUpperCase();
    const clientIdBinding = binding(`${prefix}_OAUTH_CLIENT_ID`);
    const clientSecretBinding = binding(`${prefix}_OAUTH_CLIENT_SECRET`);
    const complete =
      clientIdBinding === "secret_reference" &&
      clientSecretBinding === "secret_reference";
    if (!complete) issues.push(`${provider}_application_references_incomplete`);
    return {
      provider,
      clientIdBinding,
      clientSecretBinding,
      callback: expected
        ? `${expected}/connections/${provider}/callback`
        : null,
      wiringComplete:
        complete &&
        callbackConfigured &&
        storageBinding === "secret_reference" &&
        matches.length === 1,
      registration: "unverified",
      runtimeAuthorization: "unverified",
    };
  });
  return {
    evidence: "offline_ecs_task_metadata_only",
    wiringComplete: issues.length === 0,
    callbackConfigured,
    encryptionKeyBinding: storageBinding,
    providers,
    issues,
    limitations: [
      "Secret reference presence does not validate secret content or execution-role permissions.",
      "Existing tenant application configuration is not inspected.",
      "Application registration, deployed code, callback reachability and real authorization remain unverified.",
    ],
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const options = {};
    let input = "-";
    for (let index = 0; index < args.length; index += 2) {
      const name = args[index];
      const value = args[index + 1];
      if (!value || !["--input", "--container", "--origin"].includes(name))
        throw new Error("Invalid arguments");
      if (name === "--input") input = value;
      if (name === "--container") options.containerName = value;
      if (name === "--origin") options.expectedOrigin = value;
    }
    const raw = readBoundedInput(input);
    const result = checkRepositoryOAuthWiring(JSON.parse(raw), options);
    console.log(JSON.stringify(result, null, 2));
    if (!result.wiringComplete) process.exitCode = 1;
  } catch {
    console.error(
      "Repository OAuth wiring check failed: expected bounded ECS task JSON and valid --input/--container/--origin options. Input and values were not logged.",
    );
    process.exitCode = 2;
  }
}
