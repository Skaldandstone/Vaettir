// TEST FIXTURE ONLY. Never use this inverse to admit current runtime images.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
export const GIT_OPENSSL_DOCKERFILE_SHA256 = "887c8d385e57e59eddef7386226cab25513309c26cb31e4f4efa219a5ee87160";
const previous = "bdcc0fd1dff0b04962aaecbf9400d4aebdb7c9390ae1d47bb5a5aa5766e475a3";
const hunks = [
  {
    "oldStart": 95,
    "oldCount": 0,
    "newStart": 96,
    "newCount": 15,
    "old": [],
    "next": [
      "# Signed maintained Git/curl source, narrowly configured HTTP(S) with OpenSSL.",
      "# Git's static transport avoids admitting GnuTLS/Kerberos/LDAP/RTMP to runtime.",
      "# Existing certificate verification and all native checks remain mandatory.",
      "FROM public.ecr.aws/docker/library/node:22-trixie-slim@sha256:b26b04c123d9ff8ab646ceb18b9d75a1173acf64b9a401094b906d27b29338d4 AS git-openssl-build",
      "RUN apt-get update --error-on=any \\",
      "    && apt-get install -y --no-install-recommends openssl ca-certificates perl-base libpcre2-8-0 build-essential pkg-config autoconf automake libtool binutils dpkg-dev gpgv debian-keyring libssl-dev libnghttp2-dev libexpat1-dev libpcre2-dev zlib1g-dev perl python3 liberror-perl \\",
      "    && dpkg --compare-versions \"$(dpkg-query -W -f='${Version}' perl-base)\" ge '5.40.1-6+deb13u1' \\",
      "    && dpkg --compare-versions \"$(dpkg-query -W -f='${Version}' libpcre2-8-0)\" ge '10.46-1~deb13u3' \\",
      "    && rm -rf /var/lib/apt/lists/*",
      "WORKDIR /build",
      "COPY scripts/fetch-git-openssl-sources.mjs scripts/git-openssl-sources.json scripts/build-git-openssl-runtime.sh scripts/check-git-openssl-runtime.mjs /build/scripts/",
      "RUN node /build/scripts/fetch-git-openssl-sources.mjs /build/git-curl-sources/git git \\",
      "    && node /build/scripts/fetch-git-openssl-sources.mjs /build/git-curl-sources/curl curl \\",
      "    && sh /build/scripts/build-git-openssl-runtime.sh /build/git-curl-sources /build/git-openssl-build /build/scripts/check-git-openssl-runtime.mjs",
      ""
    ]
  },
  {
    "oldStart": 110,
    "oldCount": 0,
    "newStart": 126,
    "newCount": 1,
    "old": [],
    "next": [
      "COPY --from=git-openssl-build /build/git-openssl-build/vaettir-git-openssl_2.47.3-0+deb13u1+vaettir1_amd64.deb /tmp/vaettir-vendor/"
    ]
  },
  {
    "oldStart": 127,
    "oldCount": 2,
    "newStart": 143,
    "newCount": 1,
    "old": [
      "    && apt-get install -y --no-install-recommends openssl ca-certificates git perl-base libpcre2-8-0 /tmp/vaettir-vendor/*.deb \\",
      "    && apt-get install -y --no-install-recommends -t trixie-backports libcurl3t64-gnutls libcurl4-gnutls \\"
    ],
    "next": [
      "    && apt-get install -y --no-install-recommends openssl ca-certificates perl-base libpcre2-8-0 /tmp/vaettir-vendor/*.deb \\"
    ]
  },
  {
    "oldStart": 132,
    "oldCount": 1,
    "newStart": 147,
    "newCount": 1,
    "old": [
      "    && dpkg --compare-versions \"$(dpkg-query -W -f='${Version}' libcurl4-gnutls)\" ge '8.21.0-2~bpo13+1' \\"
    ],
    "next": [
      "    && test \"$(dpkg-query -W -f='${Version}' vaettir-git-openssl)\" = '1:2.47.3-0+deb13u1+vaettir1' \\"
    ]
  },
  {
    "oldStart": 139,
    "oldCount": 0,
    "newStart": 155,
    "newCount": 1,
    "old": [],
    "next": [
      "    && rm /tmp/vaettir-vendor/vaettir-git-openssl_2.47.3-0+deb13u1+vaettir1_amd64.deb \\"
    ]
  },
  {
    "oldStart": 163,
    "oldCount": 0,
    "newStart": 180,
    "newCount": 1,
    "old": [],
    "next": [
      "RUN --network=none node scripts/check-git-openssl-runtime.mjs --installed"
    ]
  }
];
const sha = b => createHash("sha256").update(b).digest("hex");
export function restorePreGitOpensslDockerfileFixture(raw) {
  assert.equal(arguments.length, 1);
  assert.ok(Buffer.isBuffer(raw));
  const text = raw.toString("utf8");
  assert.deepEqual(Buffer.from(text), raw);
  assert.equal(text.includes("\r"), false, "Only exact known LF input");
  assert.equal(sha(raw), GIT_OPENSSL_DOCKERFILE_SHA256, "Unknown complete Git transport edit");
  const lines = text.split("\n");
  for (const h of [...hunks].reverse()) {
    assert.equal(h.old.length, h.oldCount);
    assert.equal(h.next.length, h.newCount);
    assert.deepEqual(lines.slice(h.newStart - 1, h.newStart - 1 + h.newCount), h.next);
    lines.splice(h.newStart - 1, h.newCount, ...h.old);
  }
  const restored = Buffer.from(lines.join("\n"));
  assert.equal(sha(restored), previous, "Historical native body must be exact");
  return restored;
}
