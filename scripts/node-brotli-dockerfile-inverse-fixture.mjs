// TEST FIXTURE ONLY. Never use this inverse for runtime or source admission.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
export const NODE_BROTLI_DOCKERFILE_SHA256 =
  "f1798e46692f2d6457b6d19701658d458665a731f9480d5096a73bebdabfd091";
const prior =
  "401ae9ef8a65cd212f52d999864695ff210db6dddd947a83f8420f3830917374";
const hunks = [
  {
    start: 32,
    lines: [
      "",
      "# Isolated C/C++ and signed Node proof. This image never receives customer data",
      "# or provider credentials. The final target contains only reviewed artifacts.",
      "FROM public.ecr.aws/docker/library/node:22-trixie-slim@sha256:b26b04c123d9ff8ab646ceb18b9d75a1173acf64b9a401094b906d27b29338d4 AS node-brotli-security",
      'RUN test "$(dpkg --print-architecture)" = amd64 \\',
      "    && apt-get update --error-on=any \\",
      "    && apt-get install -y --no-install-recommends openssl ca-certificates perl-base libpcre2-8-0 build-essential binutils cmake debhelper pkg-config gpg gpgv debian-keyring libbrotli1 \\",
      "    && dpkg --compare-versions \"$(dpkg-query -W -f='${Version}' perl-base)\" ge '5.40.1-6+deb13u1' \\",
      "    && dpkg --compare-versions \"$(dpkg-query -W -f='${Version}' libpcre2-8-0)\" ge '10.46-1~deb13u3' \\",
      "    && test \"$(dpkg-query -W -f='${Version}' libbrotli1)\" = 1.1.0-2 \\",
      "    && rm -rf /var/lib/apt/lists/*",
      "WORKDIR /build",
      "COPY scripts/fetch-node-brotli-sources.mjs scripts/node-brotli-runtime-sources.json scripts/build-node-brotli-security.sh scripts/check-node-security-runtime.mjs scripts/check-brotli-block-switch.c scripts/record-brotli-security-proof.mjs scripts/retain-brotli-test-corpus.mjs scripts/brotli-runtime-test-corpus.json /build/scripts/",
      "COPY scripts/public-keys/node-5BE8A3F6C8A5C01D106C0AD820B1A390B168D356.asc /build/scripts/public-keys/",
      "RUN node /build/scripts/fetch-node-brotli-sources.mjs /build/inputs",
      "ARG VAETTIR_RELEASE_COMMIT",
      "ENV VAETTIR_SECURITY_SOURCE_COMMIT=$VAETTIR_RELEASE_COMMIT",
      "RUN --network=none sh /build/scripts/build-node-brotli-security.sh /build/inputs /build/native /build/scripts",
      "",
      "",
    ],
  },
  {
    start: 211,
    lines: [
      "",
      "# Replace only the signed Node runtime after verifying the maintained baseline.",
      "COPY --from=node-brotli-security /build/native/proof/node/bin/node /usr/local/bin/node",
      "COPY --from=node-brotli-security /build/native/proof/node/LICENSE /usr/share/doc/node/LICENSE",
      "COPY scripts/check-node-security-runtime.mjs scripts/node-brotli-runtime-sources.json /app/scripts/",
      "ENV NODE_VERSION=22.23.4",
      "RUN --network=none node scripts/check-node-security-runtime.mjs",
      "COPY --from=node-brotli-security /build/native/proof/packages/libbrotli1_1.1.0-2+vaettir1_amd64.deb /tmp/vaettir-brotli-security.deb",
      "COPY --from=node-brotli-security /build/native/proof/receipts/check-brotli-block-switch /build/native/proof/receipts/security-proof.json /usr/share/vaettir/node-brotli-security/",
      "RUN --network=none timeout 60 dpkg --install /tmp/vaettir-brotli-security.deb \\",
      '    && test -z "$(dpkg --audit)" \\',
      "    && rm /tmp/vaettir-brotli-security.deb \\",
      "    && timeout 10 /usr/share/vaettir/node-brotli-security/check-brotli-block-switch",
      "RUN --network=none node scripts/check-browser-runtime.mjs",
      "RUN --network=none node scripts/check-browser-graphics.mjs",
      "RUN --network=none node scripts/check-prisma-runtime.mjs",
      "RUN --network=none node scripts/check-git-runtime.mjs",
      "RUN --network=none node scripts/check-git-openssl-runtime.mjs --installed",
      "RUN --network=none node scripts/check-dash-runtime.mjs",
      "RUN --network=none node scripts/check-zlib-runtime.mjs --installed /usr/lib/x86_64-linux-gnu/libz.so.1 /usr/share/vaettir/zlib-runtime-proof.json /usr/share/vaettir/zlib-runtime-regression",
      "RUN --network=none node scripts/check-image-runtime.mjs",
      "RUN --network=none node scripts/check-mesa-runtime.mjs",
      "",
    ],
  },
];
const sha = (b) => createHash("sha256").update(b).digest("hex");
export function restorePreNodeBrotliDockerfileFixture(raw) {
  assert.equal(arguments.length, 1);
  assert.ok(Buffer.isBuffer(raw));
  const text = raw.toString("utf8");
  assert.deepEqual(Buffer.from(text), raw);
  assert.equal(text.includes("\r"), false);
  assert.equal(
    sha(raw),
    NODE_BROTLI_DOCKERFILE_SHA256,
    "Unknown complete Node/Brotli edit",
  );
  const lines = text.split("\n");
  for (const h of [...hunks].reverse()) {
    assert.deepEqual(lines.slice(h.start, h.start + h.lines.length), h.lines);
    lines.splice(h.start, h.lines.length);
  }
  const result = Buffer.from(lines.join("\n"));
  assert.equal(sha(result), prior, "Historical native bytes differ");
  return result;
}
