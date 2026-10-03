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

const secretArn =
  "arn:aws:secretsmanager:us-east-2:123456789012:secret:vaettir/hosted-oauth-AbCdEf";
const release = {
  containerName: "api",
  repositoryUri: "123456789012.dkr.ecr.us-east-2.amazonaws.com/vaettir-api",
  commit,
  imageDigest,
};

test("adds API-only OAuth references idempotently without changing recovery or encryption keys", () => {
  const source = {
    family: "api",
    taskRoleArn: "arn:existing-role",
    networkMode: "awsvpc",
    containerDefinitions: [
      {
        name: "api",
        image: "existing/api:old",
        secrets: [
          {
            name: "ENCRYPTION_KEY",
            valueFrom: `${secretArn}:ENCRYPTION_KEY::`,
          },
        ],
        environment: [{ name: "KEEP", value: "unchanged" }],
      },
      { name: "web", image: "existing/web:old" },
    ],
  };
  const recovery = structuredClone(source);
  const secretBindings = [
    {
      name: "GITHUB_OAUTH_CLIENT_ID",
      valueFrom: `${secretArn}:GITHUB_OAUTH_CLIENT_ID::`,
    },
    {
      name: "GITHUB_OAUTH_CLIENT_SECRET",
      valueFrom: `${secretArn}:GITHUB_OAUTH_CLIENT_SECRET::`,
    },
  ];
  const result = renderImmutableTaskDefinition(source, {
    ...release,
    secretBindings,
  });
  assert.deepEqual(source, recovery);
  assert.equal(result.taskRoleArn, recovery.taskRoleArn);
  assert.equal(result.networkMode, "awsvpc");
  assert.deepEqual(
    result.containerDefinitions[1],
    recovery.containerDefinitions[1],
  );
  assert.deepEqual(result.containerDefinitions[0].secrets, [
    ...recovery.containerDefinitions[0].secrets,
    ...secretBindings,
  ]);
  assert.deepEqual(
    renderImmutableTaskDefinition(result, { ...release, secretBindings }),
    result,
  );
  secretBindings[0].valueFrom = "changed by caller";
  assert.equal(
    result.containerDefinitions[0].secrets[1].valueFrom,
    `${secretArn}:GITHUB_OAUTH_CLIENT_ID::`,
  );
});

test("rejects conflicting references, plaintext, duplicate bindings and environment collisions", () => {
  const source = {
    containerDefinitions: [
      { name: "api", secrets: [{ name: "KEY", valueFrom: secretArn }] },
    ],
  };
  for (const secretBindings of [
    [{ name: "KEY", valueFrom: `${secretArn}:other::` }],
    [{ name: "KEY", valueFrom: secretArn, value: "never print me" }],
    [{ name: "KEY", valueFrom: "a plaintext credential" }],
    [
      { name: "NEW", valueFrom: secretArn },
      { name: "NEW", valueFrom: secretArn },
    ],
    [{ name: "VAETTIR_RELEASE_COMMIT", valueFrom: secretArn }],
    [{ name: "NEW", valueFrom: `${secretArn}:key` }],
    {},
  ]) {
    assert.throws(
      () =>
        renderImmutableTaskDefinition(source, { ...release, secretBindings }),
      /secret binding|secretBindings/,
    );
  }
  assert.throws(
    () =>
      renderImmutableTaskDefinition(
        {
          containerDefinitions: [
            { name: "api", environment: [{ name: "NEW", value: "existing" }] },
          ],
        },
        { ...release, secretBindings: [{ name: "NEW", valueFrom: secretArn }] },
      ),
    /conflicts with an environment/,
  );
});

test("rejects all repository tags, schemes and malformed references, not only latest", () => {
  const source = { containerDefinitions: [{ name: "api" }] };
  for (const repositoryUri of [
    "registry/api:v1",
    "registry/api:123",
    "registry/api@sha256:abc",
    "https://registry/api",
    "registry/api?tag=x",
    "registry/api\n",
    "registry//api",
  ]) {
    assert.throws(
      () =>
        renderImmutableTaskDefinition(source, { ...release, repositoryUri }),
      /tag or digest/,
    );
  }
  assert.equal(
    renderImmutableTaskDefinition(source, {
      ...release,
      repositoryUri: "localhost:5000/vaettir/api",
    }).containerDefinitions[0].image,
    `localhost:5000/vaettir/api@${imageDigest}`,
  );
});
