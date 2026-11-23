// TEST FIXTURE ONLY. Never use this inverse for runtime or source admission.
// Restores the exact pre-Node-26 Dockerfiles from this single reviewed pin update.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

export const NODE26_API_DOCKERFILE_SHA256 =
  "712eb42270f3549d006f1005f2e4c5502200581e8c51661242b028627d12d75a";
export const PRE_NODE26_API_DOCKERFILE_SHA256 =
  "d15d3ecbecc3ea49f1af7f30805ef56815bac98a73b47a75a71357ea4495d3c0";
export const NODE26_WEB_DOCKERFILE_SHA256 =
  "32410452b2f5a9733a6c5339aceec6e6e51e8a22b3264ab0dd5797a3bf8b70fe";
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
  const restoredText = text.replace("# Full-suite-tested native packages from the dedicated cloud builder.\n", "")
    .replace("# Exact ABI-test baseline remains available outside the rolling APT index.\nADD --checksum=sha256:0fb79f88db210afbd69282ab9649e525f393ec6950ca34da1a6b359250b8d7db https://deb.debian.org/debian/pool/main/b/brotli/libbrotli1_1.1.0-2+b7_amd64.deb /tmp/vaettir-brotli-baseline.deb\n", "")
    .replace("debian-keyring /tmp/vaettir-brotli-baseline.deb ", "debian-keyring libbrotli1=1.1.0-2+b7 ")
    .replace(/FROM [^\n]+ AS glibc-security\n[\s\S]*?(?=FROM [^\n]+ AS runtime\n)/, "")
    .replace(/^COPY --from=glibc-security.*\n/gm, "")
    .replace(/^COPY --from=openssl-security.*\n/gm, "")
    .replace(/^COPY scripts\/check-openssl-runtime\.sh.*\n/gm, "")
    .replace(/^RUN --network=none sh \/app\/scripts\/check-openssl-runtime\.sh (?:packages|installed)\n/gm, "")
    .replace(/^    && dpkg --path-include=.*--install \/tmp\/vaettir-openssl\/\*\.deb.*\n/gm, "")
    .replace(/^    && rm \/tmp\/vaettir-openssl\/\*\.deb.*\n/gm, "")
    .replace(" /tmp/vaettir-vendor/*.deb /tmp/vaettir-openssl/*.deb ", " /tmp/vaettir-vendor/*.deb ")
    .replace(/^    && (?:test .*libc6.*2\.43-7\+vaettir1.*|rm \/tmp\/vaettir-vendor\/libc6_.*)\n/gm, "")
    .replaceAll("2.55.1-0+vaettir1", "2.47.3-0+deb13u1+vaettir1")
    .replace("perl python3 liberror-perl git gpg \\\n", "perl python3 liberror-perl \\\n")
    .replace(/^    && test .*iconv -f UTF-8.*\n/gm, "")
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
