import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
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
  { containerName, repositoryUri, commit, imageDigest },
) {
  if (!COMMIT_PATTERN.test(commit))
    throw new Error("commit must be a lowercase 40-character Git SHA");
  if (!DIGEST_PATTERN.test(imageDigest))
    throw new Error("imageDigest must be a sha256 digest");
  if (
    !repositoryUri ||
    repositoryUri.includes("@") ||
    repositoryUri.endsWith(":latest")
  )
    throw new Error("repositoryUri must not contain a tag or digest");

  const taskDefinition = structuredClone(source.taskDefinition ?? source);
  for (const field of SERVER_FIELDS) delete taskDefinition[field];
  const container = taskDefinition.containerDefinitions?.find(
    (item) => item.name === containerName,
  );
  if (!container)
    throw new Error(
      `container ${containerName} was not found in the task definition`,
    );

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
  const input = readArg("--input");
  const output = readArg("--output");
  const rendered = renderImmutableTaskDefinition(
    JSON.parse(readFileSync(input === "-" ? 0 : input, "utf8")),
    {
      containerName: readArg("--container"),
      repositoryUri: readArg("--repository"),
      commit: readArg("--commit"),
      imageDigest: readArg("--digest"),
    },
  );
  const serialized = `${JSON.stringify(rendered, null, 2)}\n`;
  if (output === "-") process.stdout.write(serialized);
  else writeFileSync(output, serialized);
}
