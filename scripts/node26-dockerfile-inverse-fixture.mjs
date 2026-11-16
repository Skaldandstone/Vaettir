// TEST FIXTURE ONLY. Never use this inverse for runtime or source admission.
// Restores the exact pre-Node-26 Dockerfiles from this single reviewed pin update.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

export const NODE26_API_DOCKERFILE_SHA256 =
  "929d72689bb339ed79c4e1b22547d01e79a34617076bf9a0fcf2304f34a7902a";
export const PRE_NODE26_API_DOCKERFILE_SHA256 =
  "d15d3ecbecc3ea49f1af7f30805ef56815bac98a73b47a75a71357ea4495d3c0";
export const NODE26_WEB_DOCKERFILE_SHA256 =
  "11b2a4e5ac01607d3d8e3fd4eb6c71a6da04409d2cb1e9343b1ae8dea49bc874";
export const PRE_NODE26_WEB_DOCKERFILE_SHA256 =
  "3ef10df06706d0f45e4d0b1946a727b24faa38e27f861c99dc9541932dd9265b";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const node26 =
  "public.ecr.aws/docker/library/node:26-trixie-slim@sha256:e4db4c914bf8ad241bd24804fc25d272d89bad97e68cdc8a1414862790a02c39";
const node22 =
  "public.ecr.aws/docker/library/node:22-trixie-slim@sha256:b26b04c123d9ff8ab646ceb18b9d75a1173acf64b9a401094b906d27b29338d4";

export function restorePreNode26DockerfileFixture(raw) {
  assert.equal(arguments.length, 1);
  assert.ok(Buffer.isBuffer(raw));
  const text = raw.toString("utf8");
  assert.deepEqual(Buffer.from(text), raw);
  assert.equal(text.includes("\r"), false, "Only exact known LF input");
  const hash = sha(raw);
  const expected = new Map([
    [NODE26_API_DOCKERFILE_SHA256, PRE_NODE26_API_DOCKERFILE_SHA256],
    [NODE26_WEB_DOCKERFILE_SHA256, PRE_NODE26_WEB_DOCKERFILE_SHA256],
  ]);
  assert.ok(expected.has(hash), "Unknown complete Node 26 Dockerfile edit");
  assert.ok(text.includes(node26));
  const restored = Buffer.from(
    text
      .replaceAll(node26, node22)
      .replaceAll(
        "RUN npm install --global --no-audit --no-fund pnpm@11.23.0",
        "RUN corepack enable",
      ),
  );
  assert.equal(sha(restored), expected.get(hash), "Pre-Node-26 Dockerfile differs");
  return restored;
}
