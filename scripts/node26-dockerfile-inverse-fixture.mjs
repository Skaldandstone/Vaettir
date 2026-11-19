// TEST FIXTURE ONLY. Never use this inverse for runtime or source admission.
// Restores the exact pre-Node-26 Dockerfiles from this single reviewed pin update.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

export const NODE26_API_DOCKERFILE_SHA256 =
  "58b3366e0965d8552233ea1d2428cb0c2d59b0f356eafaeebe6ecd53702c1905";
export const PRE_NODE26_API_DOCKERFILE_SHA256 =
  "d15d3ecbecc3ea49f1af7f30805ef56815bac98a73b47a75a71357ea4495d3c0";
export const NODE26_WEB_DOCKERFILE_SHA256 =
  "060d06d9f92e4be26cc42fb0d28accfcdf5174a1172cac04251f6fe7214f042c";
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
  const restoredText = text
    .replace(/FROM [^\n]+ AS glibc-security\n[\s\S]*?(?=FROM [^\n]+ AS runtime\n)/, "")
    .replace(/^COPY --from=glibc-security.*\n/gm, "")
    .replace(/^    && (?:test .*libc6.*2\.43-7\+vaettir1.*|rm \/tmp\/vaettir-vendor\/libc6_.*)\n/gm, "")
    .replaceAll("2.55.1-0+vaettir1", "2.47.3-0+deb13u1+vaettir1")
    .replaceAll(node26, node22)
    .replace("    NODE_EXTRA_CA_CERTS=/app/certs/rds-global-bundle.pem \\\n", "")
    .replace(
      hash === NODE26_WEB_DOCKERFILE_SHA256
        ? "ENV NODE_OPTIONS=--max-old-space-size=4096\n"
        : "\u0000",
      "",
    )
    .replaceAll(
      "RUN npm install --global --no-audit --no-fund pnpm@11.23.0",
      "RUN corepack enable",
    )
    .replaceAll(
      "debian-keyring libbrotli1=1.1.0-2+b7",
      hash === NODE26_WEB_DOCKERFILE_SHA256
        ? "debian-keyring libbrotli1"
        : "debian-keyring libbrotli1=1.1.0-2+b7",
    );
  const restored = Buffer.from(restoredText);
  assert.equal(sha(restored), expected.get(hash), "Pre-Node-26 Dockerfile differs");
  return restored;
}
