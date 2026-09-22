import assert from "node:assert/strict";
import test from "node:test";
import { renderImmutableTaskDefinition } from "./render-ecs-task-definition.mjs";

const commit = "a".repeat(40);
const imageDigest = `sha256:${"b".repeat(64)}`;

test("renders a registrable task definition pinned to a digest with release identity", () => {
  const source = {
    taskDefinition: {
      taskDefinitionArn: "arn:old",
      revision: 3,
      status: "ACTIVE",
      family: "vaettir-api",
      containerDefinitions: [
        {
          name: "vaettir-api",
          image: "example/vaettir-api:latest",
          environment: [{ name: "KEEP", value: "yes" }],
        },
      ],
      registeredAt: "now",
      registeredBy: "someone",
    },
  };
  const result = renderImmutableTaskDefinition(source, {
    containerName: "vaettir-api",
    repositoryUri: "example/vaettir-api",
    commit,
    imageDigest,
  });

  assert.equal(result.taskDefinitionArn, undefined);
  assert.equal(result.revision, undefined);
  assert.equal(
    result.containerDefinitions[0].image,
    `example/vaettir-api@${imageDigest}`,
  );
  assert.deepEqual(result.containerDefinitions[0].environment, [
    { name: "KEEP", value: "yes" },
    { name: "VAETTIR_RELEASE_COMMIT", value: commit },
    { name: "VAETTIR_IMAGE_DIGEST", value: imageDigest },
  ]);
});

test("rejects mutable or ambiguous release identity", () => {
  const source = {
    family: "x",
    containerDefinitions: [{ name: "x", image: "x:latest" }],
  };
  assert.throws(
    () =>
      renderImmutableTaskDefinition(source, {
        containerName: "x",
        repositoryUri: "x:latest",
        commit,
        imageDigest,
      }),
    /tag or digest/,
  );
  assert.throws(
    () =>
      renderImmutableTaskDefinition(source, {
        containerName: "x",
        repositoryUri: "x",
        commit: "main",
        imageDigest,
      }),
    /Git SHA/,
  );
  assert.throws(
    () =>
      renderImmutableTaskDefinition(source, {
        containerName: "missing",
        repositoryUri: "x",
        commit,
        imageDigest,
      }),
    /not found/,
  );
});
