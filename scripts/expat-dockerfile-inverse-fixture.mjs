// TEST FIXTURE ONLY. This never approves a current image, source or runtime.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { GIT_OPENSSL_DOCKERFILE_SHA256 } from "./git-openssl-dockerfile-inverse-fixture.mjs";
export const EXPAT_290_DOCKERFILE_SHA256 =
  "401ae9ef8a65cd212f52d999864695ff210db6dddd947a83f8420f3830917374";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function restorePreExpat290DockerfileFixture(raw) {
  assert.ok(Buffer.isBuffer(raw));
  assert.equal(
    sha(raw),
    EXPAT_290_DOCKERFILE_SHA256,
    "Unknown complete Expat edit",
  );
  let text = raw.toString("utf8");
  assert.deepEqual(Buffer.from(text), raw);
  assert.equal(text.includes("\r"), false);
  const replace = (next, previous) => {
    assert.equal(text.split(next).length, 2);
    text = text.replace(next, previous);
  };
  replace(
    "COPY scripts/fetch-expat-runtime-sources.mjs scripts/expat-runtime-sources.json /build/scripts/\n",
    "",
  );
  replace(
    "RUN node /build/scripts/fetch-expat-runtime-sources.mjs /build/runtime-sources",
    "RUN node /build/scripts/fetch-runtime-vendor-sources.mjs /build/runtime-sources",
  );
  replace(
    "# Build signed maintained Debian Expat 2.9.0, including the XML_ParseBuffer\n# bounds fix. No unstable binary packages or compiler reach runtime.",
    "# Build the maintained Debian Expat source (including CVE-2026-102633's\n# patch) against Trixie. No unstable binary packages or compiler reach runtime.",
  );
  replace(
    "COPY scripts/check-expat-wide-runtime.c scripts/check-expat-buffer-runtime.c /build/scripts/",
    "COPY scripts/check-expat-wide-runtime.c /build/scripts/",
  );
  const slash = String.fromCharCode(92);
  replace(
    [
      "    && gpgv --keyring /usr/share/keyrings/debian-keyring.gpg --status-fd 1 expat_2.9.0-1.dsc > /build/expat-source-signature.status " +
        slash,
      "    && grep -q '^" +
        slash +
        "[GNUPG:" +
        slash +
        "] VALIDSIG 7D887DC8BA7BBBA7B835E3BADCE310E7864CC8BF ' /build/expat-source-signature.status " +
        slash,
    ].join("\n"),
    "    && gpgv --keyring /usr/share/keyrings/debian-keyring.gpg expat_2.9.0-1.dsc " +
      slash,
  );
  const start = text.indexOf("    && timeout 10 /build/check-expat-wide \\\n");
  const end = text.indexOf("\nCOPY scripts/build-dash-runtime.sh", start);
  assert.ok(start > 0 && end > start);
  text =
    text.slice(0, start) +
    "    && timeout 10 /build/check-expat-wide" +
    text.slice(end);
  assert.equal(text.split("2.9.0-1").length, 6);
  const restored = Buffer.from(text.replaceAll("2.9.0-1", "2.8.5-2"));
  assert.equal(sha(restored), GIT_OPENSSL_DOCKERFILE_SHA256);
  return restored;
}
