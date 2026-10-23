import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const REPOSITORY_PATTERN =
  /^(?:[a-zA-Z0-9._-]+|[a-zA-Z0-9.-]+(?::[0-9]+)?(?:\/[a-zA-Z0-9._-]+)+)$/;
const SECRET_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const SECRET_REFERENCE_PATTERN =
  /^arn:aws(?:-cn|-us-gov)?:secretsmanager:[a-z0-9-]+:[0-9]{12}:secret:[a-zA-Z0-9/_+=.@-]+(?::[a-zA-Z0-9/_+=.@-]*:[a-zA-Z0-9/_+=.@-]*:[a-zA-Z0-9/_+=.@-]*)?$/;
const SERVER_FIELDS = [
  "taskDefinitionArn",
  "revision",
  "status",
  "requiresAttributes",
  "compatibilities",
  "registeredAt",
  "registeredBy",
];

export function renderImmutableTaskDefinition(
  source,
  { containerName, repositoryUri, commit, imageDigest, secretBindings = [] },
) {
  if (!COMMIT_PATTERN.test(commit))
    throw new Error("commit must be a lowercase 40-character Git SHA");
  if (!DIGEST_PATTERN.test(imageDigest))
    throw new Error("imageDigest must be a sha256 digest");
  if (!REPOSITORY_PATTERN.test(repositoryUri ?? ""))
    throw new Error("repositoryUri must not contain a tag or digest");
  if (!Array.isArray(secretBindings))
    throw new Error("secretBindings must be an array of secret references");

  const taskDefinition = structuredClone(source.taskDefinition ?? source);
  for (const field of SERVER_FIELDS) delete taskDefinition[field];
  const container = taskDefinition.containerDefinitions?.find(
    (item) => item.name === containerName,
  );
  if (!container)
    throw new Error(
      `container ${containerName} was not found in the task definition`,
    );

  // Add references only. Never read secret values or replace an existing key
  // (especially the encryption key protecting already stored customer grants).
  const secrets = container.secrets ?? [];
  const seen = new Set();
  for (const binding of secretBindings) {
    if (
      !binding ||
      Object.keys(binding).some(
        (key) => !["name", "valueFrom"].includes(key),
      ) ||
      !SECRET_NAME_PATTERN.test(binding.name ?? "") ||
      !SECRET_REFERENCE_PATTERN.test(binding.valueFrom ?? "") ||
      ["VAETTIR_RELEASE_COMMIT", "VAETTIR_IMAGE_DIGEST"].includes(binding.name)
    )
      throw new Error(
        "secret binding must contain only a name and Secrets Manager ARN",
      );
    if (seen.has(binding.name))
      throw new Error("duplicate secret binding name");
    seen.add(binding.name);
    if (container.environment?.some((entry) => entry.name === binding.name))
      throw new Error("secret binding conflicts with an environment variable");
    const existing = secrets.filter((entry) => entry.name === binding.name);
    if (
      existing.length > 1 ||
      (existing.length === 1 && existing[0].valueFrom !== binding.valueFrom)
    )
      throw new Error(
        "secret binding would replace or duplicate an existing reference",
      );
    if (existing.length === 0) secrets.push({ ...binding });
  }
  if (secretBindings.length > 0) container.secrets = secrets;

  container.image = `${repositoryUri}@${imageDigest}`;
  const environment = (container.environment ?? []).filter(
    (entry) =>
      entry.name !== "VAETTIR_RELEASE_COMMIT" &&
      entry.name !== "VAETTIR_IMAGE_DIGEST",
  );
  container.environment = [
    ...environment,
    { name: "VAETTIR_RELEASE_COMMIT", value: commit },
    { name: "VAETTIR_IMAGE_DIGEST", value: imageDigest },
  ];
  return taskDefinition;
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`missing ${name}`);
  return process.argv[index + 1];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const input = readArg("--input");
    const output = readArg("--output");
    const rendered = renderImmutableTaskDefinition(
      JSON.parse(readFileSync(input === "-" ? 0 : input, "utf8")),
      {
        containerName: readArg("--container"),
        repositoryUri: readArg("--repository"),
        commit: readArg("--commit"),
        imageDigest: readArg("--digest"),
        ...(process.argv.includes("--secret-bindings")
          ? {
              secretBindings: JSON.parse(
                readFileSync(readArg("--secret-bindings"), "utf8"),
              ),
            }
          : {}),
      },
    );
    const serialized = `${JSON.stringify(rendered, null, 2)}\n`;
    if (output === "-") process.stdout.write(serialized);
    else writeFileSync(output, serialized);
  } catch {
    // JSON parse errors can contain input excerpts. Task metadata may carry
    // environment values; never echo input, paths or binding values on failure.
    console.error(
      "Task rendering failed: verify release identity, container and nonconflicting secret references. Input values were not logged.",
    );
    process.exitCode = 1;
  }
}
